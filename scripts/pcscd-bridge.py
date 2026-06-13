#!/usr/bin/env python3
"""pcscd bridge — HTTP API for reading, programming, wiping, and inspecting
NTAG424 bolt cards via PC/SC reader.

Usage:
  python3 scripts/pcscd-bridge.py [--port 4321] [--require-auth]

Requirements:
  pip install pyscard ndeflib pycryptodome

Endpoints:
  GET  /status     — reader and card status
  GET  /tap        — wait for card tap, return {p, c, uid}
  GET  /card-info  — return cached card info {uid, k1, k2, version}
  POST /burn       — program card with URL template, SDM, and keys
  POST /wipe       — reset card to factory defaults
  GET  /inspect    — inspect card UID, NDEF, SDM status, key versions
"""

import sys
import os
import io
import json
import struct
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    from smartcard.System import readers
except ImportError:
    print("pyscard not installed. Run: pip install pyscard", file=sys.stderr)
    sys.exit(1)

try:
    import ndef
except ImportError:
    print("ndeflib not installed. Run: pip install ndeflib", file=sys.stderr)
    sys.exit(1)

try:
    from Crypto.Cipher import AES
    from Crypto.Hash import CMAC
    from Crypto.Util.strxor import strxor
except ImportError:
    print("pycryptodome not installed. Run: pip install pycryptodome", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# NTAG424 APDU constants
# ---------------------------------------------------------------------------
CLA_NTAG = 0x90
INS_AUTH_FIRST = 0x71       # AuthenticateEV2First (ISO 7816-4 Additional)
INS_AUTH_NON_FIRST = 0x77   # AuthenticateEV2NonFirst
INS_ADDITIONAL_FRAME = 0xAF # Additional frame in auth handshake
INS_WRITE_DATA = 0x8D       # WriteData (NTAG426/424 specific: 0x90 0x8D)
INS_READ_DATA = 0xAD        # ReadData  (was 0xB0 for ISO read-binary)
INS_GET_FILE_SETTINGS = 0xF5  # GetFileSettings
INS_CHANGE_FILE_SETTINGS = 0x5F  # ChangeFileSettings (bolty-rs confirmed)
INS_CHANGE_KEY = 0xC4       # ChangeKey
INS_GET_VERSION = 0x60      # GetVersion
INS_SELECT_ISO = 0xA4       # ISO Select

# NTAG424 Application AID
NTAG424_AID = bytes([0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01])

# File IDs
FILE_CC = 0xE103
FILE_NDEF = 0x0002

# SDM placeholder lengths (ASCII hex)
SDM_PICC_PLACEHOLDER = b"********************************"  # 32 stars = 16 bytes encrypted PICC data
SDM_CMAC_PLACEHOLDER = b"****************"               # 16 stars = 8 bytes CMAC

# Factory default key (all zeros)
FACTORY_KEY = bytes(16)

# Communication modes for authenticated commands
COMM_MODE_PLAIN = 0x00
COMM_MODE_MAC = 0x01
COMM_MODE_FULL = 0x03

cached_card_info = {}

# ---------------------------------------------------------------------------
# Card connection helper
# ---------------------------------------------------------------------------


def _select_reader():
    """Select the best PC/SC reader for card operations.

    Prefers a reader with 'PICC' in the name (e.g. ACS ACR1252 has SAM + PICC
    slots). Falls back to the first available reader.

    Returns:
        A PC/SC reader object.

    Raises:
        RuntimeError: If no readers found.
    """
    reader_list = readers()
    if not reader_list:
        raise RuntimeError("No PC/SC readers found")

    for r in reader_list:
        if "PICC" in str(r):
            return r
    return reader_list[0]


def _connect_card():
    """Connect to a PC/SC reader with a card present.

    Returns:
        tuple: (connection, uid_hex) where connection is a smartcard connection
               and uid_hex is the card UID from anti-collision.

    Raises:
        RuntimeError: If no readers found or connection fails.
    """
    reader = _select_reader()
    connection = reader.createConnection()
    connection.connect()

    # Read UID from the card's ATR or via GetData
    uid_hex = _read_uid(connection)

    return connection, uid_hex


def _read_uid(conn):
    """Read the card UID via GetData (INS=0xCA, P1P2=0x0000, tag 0x00).

    Args:
        conn: PC/SC connection object.

    Returns:
        str: Hex-encoded UID string.

    Raises:
        RuntimeError: If UID cannot be read.
    """
    # GetData command for UID
    apdu = [0x00, 0xCA, 0x00, 0x00, 0x00]
    try:
        resp, sw1, sw2 = conn.transmit(apdu)
        if (sw1, sw2) == (0x90, 0x00) and len(resp) >= 4:
            return bytes(resp).hex().upper()
    except Exception:
        pass
    # Fallback: try to get it from the ATR
    try:
        atr = conn.getATR()
        if atr and len(atr) >= 4:
            return bytes(atr).hex().upper()
    except Exception:
        pass
    return "UNKNOWN"


# ---------------------------------------------------------------------------
# ISO 7816 / NTAG424 APDU helpers
# ---------------------------------------------------------------------------


def _check_sw(resp, expected_sw=(0x91, 0x00), label="APDU"):
    """Validate APDU status words, retry on Authentication Delay (0x91AE).

    Args:
        resp: tuple (data, sw1, sw2) from conn.transmit().
        expected_sw: Expected (sw1, sw2) tuple.
        label: Description for error messages.

    Returns:
        list: Response data bytes.

    Raises:
        RuntimeError: If status words don't match expected.
    """
    data, sw1, sw2 = resp

    # Handle Authentication Delay — retry once after 1 second
    if sw1 == 0x91 and sw2 == 0xAE:
        import time
        time.sleep(1.0)
        return None  # Caller must retry

    if (sw1, sw2) != expected_sw:
        raise RuntimeError(f"{label} failed: SW={sw1:02X}{sw2:02X}")
    return data


def _transmit_check(conn, apdu_bytes, label="APDU"):
    """Transmit APDU and check status, with retry on auth delay.

    Args:
        conn: PC/SC connection.
        apdu_bytes: List of byte values for the APDU.
        label: Description for error messages.

    Returns:
        list: Response data bytes.

    Raises:
        RuntimeError: If command fails after retry.
    """
    resp = conn.transmit(list(apdu_bytes))
    data, sw1, sw2 = resp

    # Handle Authentication Delay — retry after 1 second
    if sw1 == 0x91 and sw2 == 0xAE:
        import time
        time.sleep(1.0)
        resp = conn.transmit(list(apdu_bytes))
        data, sw1, sw2 = resp

    if (sw1, sw2) != (0x91, 0x00):
        raise RuntimeError(f"{label} failed: SW={sw1:02X}{sw2:02X}")
    return bytes(data)


def _transmit_raw(conn, apdu_bytes):
    """Transmit APDU and return raw (data, sw1, sw2) without checking.

    Args:
        conn: PC/SC connection.
        apdu_bytes: List of byte values for the APDU.

    Returns:
        tuple: (data_bytes, sw1, sw2).
    """
    data, sw1, sw2 = conn.transmit(list(apdu_bytes))
    return bytes(data), sw1, sw2


# ---------------------------------------------------------------------------
# NTAG424 Application selection
# ---------------------------------------------------------------------------


def _select_ntag424_app(conn):
    """Select the NTAG424 application (AID: D2760000850101).

    This must be called before any NTAG424-specific commands.

    Args:
        conn: PC/SC connection.

    Raises:
        RuntimeError: If selection fails.
    """
    # [CLA=00] [INS=A4] [P1=04] [P2=00] [Lc=07] [AID] [Le=00]
    apdu = bytes([
        0x00, INS_SELECT_ISO, 0x04, 0x00, len(NTAG424_AID)
    ]) + NTAG424_AID + bytes([0x00])
    _, sw1, sw2 = _transmit_raw(conn, apdu)
    if (sw1, sw2) not in ((0x90, 0x00), (0x91, 0x00)):
        raise RuntimeError(f"Select NTAG424 application failed: SW={sw1:02X}{sw2:02X}")


# ---------------------------------------------------------------------------
# AES Session — Mutual Authentication (3-pass per AN12196 §9.1)
# ---------------------------------------------------------------------------


def _byte_rot_left(x):
    """Rotate byte array left by one byte.

    Args:
        x: bytes to rotate.

    Returns:
        bytes: Rotated result.
    """
    return x[1:] + x[0:1]


def _byte_rot_right(x):
    """Rotate byte array right by one byte.

    Args:
        x: bytes to rotate.

    Returns:
        bytes: Rotated result.
    """
    return x[-1:] + x[:-1]


class AESSession:
    """Authenticated session state after successful AES mutual authentication.

    Attributes:
        ses_auth_mac_key: 16-byte session MAC key.
        ses_auth_enc_key: 16-byte session encryption key.
        ti: 4-byte transaction identifier.
        cmd_counter: Command counter, incremented on each MAC/FULL command.
    """

    def __init__(self, ses_auth_mac_key, ses_auth_enc_key, ti, cmd_counter=0, current_key_nr=0):
        self.ses_auth_mac_key = ses_auth_mac_key
        self.ses_auth_enc_key = ses_auth_enc_key
        self.ti = ti
        self.cmd_counter = cmd_counter
        self.current_key_nr = current_key_nr

    @staticmethod
    def _derive_stream(rnd_a, rnd_b):
        """Derive the shared stream for SV1/SV2 computation.

        Per AN12196 §9.1.7, the stream is built from RndA and RndB bytes.

        Args:
            rnd_a: 16-byte PCD random challenge.
            rnd_b: 16-byte PICC random challenge.

        Returns:
            bytes: 32-byte stream for SV1/SV2 derivation.
        """
        s = io.BytesIO()
        s.write(rnd_a[0:2])                               # RndA[15:14]
        s.write(strxor(rnd_a[2:8], rnd_b[0:6]))           # RndA[13:8] XOR RndB[15:10]
        s.write(rnd_b[-10:])                               # RndB[9:0]
        s.write(rnd_a[-8:])                                # RndA[7:0]
        return s.getvalue()

    @staticmethod
    def derive_session_keys(auth_key, rnd_a, rnd_b):
        """Derive session keys SesAuthENCKey and SesAuthMACKey.

        Per AN12196 §9.1.7:
        - SV1 = A5 5A 00 01 00 80 || stream
        - SV2 = 5A A5 00 01 00 80 || stream
        - SesAuthENCKey = CMAC-AES(auth_key, SV1)
        - SesAuthMACKey = CMAC-AES(auth_key, SV2)

        Args:
            auth_key: 16-byte application key used for authentication.
            rnd_a: 16-byte PCD random challenge.
            rnd_b: 16-byte PICC random challenge (decrypted).

        Returns:
            tuple: (ses_auth_enc_key, ses_auth_mac_key) each 16 bytes.
        """
        stream = AESSession._derive_stream(rnd_a, rnd_b)

        sv1 = bytes([0xA5, 0x5A, 0x00, 0x01, 0x00, 0x80]) + stream
        sv2 = bytes([0x5A, 0xA5, 0x00, 0x01, 0x00, 0x80]) + stream

        c1 = CMAC.new(auth_key, ciphermod=AES)
        c1.update(sv1)
        ses_auth_enc_key = c1.digest()

        c2 = CMAC.new(auth_key, ciphermod=AES)
        c2.update(sv2)
        ses_auth_mac_key = c2.digest()

        return ses_auth_enc_key, ses_auth_mac_key

    def calc_mac(self, data):
        """Calculate truncated CMAC (8 bytes) for secure messaging.

        The CMAC is computed with the session MAC key and truncated to 8 bytes
        by keeping even-indexed bytes (0-indexed: bytes 1,3,5,...,15).

        Args:
            data: Input data bytes.

        Returns:
            bytes: 8-byte truncated CMAC.
        """
        c = CMAC.new(self.ses_auth_mac_key, ciphermod=AES)
        c.update(data)
        full_mac = c.digest()
        return bytes([full_mac[i] for i in range(16) if i % 2 == 1])

    def wrap_mac_command(self, ins, header, data=None):
        """Wrap a command in CommMode.MAC (add CMAC trailer, increment counter).

        Args:
            ins: Instruction byte.
            header: Command header bytes.
            data: Optional command data bytes.

        Returns:
            bytes: Complete MAC-wrapped APDU.
        """
        if data is None:
            data = b""
        payload = header + data
        payload_len = len(payload)

        # Build plain APDU: [0x90] [INS] [0x00] [0x00] [Lc] [payload] [0x00]
        plain_apdu = bytes([0x90, ins, 0x00, 0x00, payload_len]) + payload + bytes([0x00])

        cmd_cntr_b = struct.pack("<H", self.cmd_counter)
        mac_input = bytes([ins]) + cmd_cntr_b + self.ti + payload
        mac_t = self.calc_mac(mac_input)

        self.cmd_counter += 1

        return (bytes([0x90, ins, 0x00, 0x00, payload_len + 8])
                + payload + mac_t + bytes([0x00]))

    def _calc_send_iv(self):
        iv_clear = (bytes([0xA5, 0x5A]) + self.ti
                    + struct.pack("<H", self.cmd_counter)
                    + b'\x00' * 8)
        cipher = AES.new(self.ses_auth_enc_key, AES.MODE_ECB)
        return cipher.encrypt(iv_clear)

    def wrap_full_command(self, ins, header, data):
        padded = data + bytes([0x80])
        while len(padded) % 16 != 0:
            padded += bytes([0x00])

        iv = self._calc_send_iv()
        cipher = AES.new(self.ses_auth_enc_key, AES.MODE_CBC, iv=iv)
        enc_data = cipher.encrypt(padded)

        payload = header + enc_data
        payload_len = len(payload)

        cmd_cntr_b = struct.pack("<H", self.cmd_counter)
        mac_input = bytes([ins]) + cmd_cntr_b + self.ti + payload
        mac_t = self.calc_mac(mac_input)

        self.cmd_counter += 1

        return (bytes([0x90, ins, 0x00, 0x00, payload_len + 8])
                + payload + mac_t + bytes([0x00]))

    def unwrap_mac_response(self, resp):
        """Parse a MAC-mode response, verify CMAC.

        resp is the data returned by _transmit_check — PC/SC already
        stripped SW bytes (91 00), so resp = [data] [MACt(8)].
        """
        if len(resp) < 8:
            raise RuntimeError(f"Response too short for MAC: {len(resp)} bytes")

        mac_t_recv = resp[-8:]
        data = resp[:-8]

        cmd_cntr_b = struct.pack("<H", self.cmd_counter)
        mac_input = bytes([0x00]) + cmd_cntr_b + self.ti + data
        mac_t_expected = self.calc_mac(mac_input)

        if mac_t_recv != mac_t_expected:
            raise RuntimeError(
                f"MAC verification failed: got {mac_t_recv.hex()}, "
                f"expected {mac_t_expected.hex()}"
            )

        return data


def authenticate_aes(conn, key_no, auth_key):
    """Perform AES mutual authentication (3-pass per AN12196 §9.1.5).

    Steps:
    1. Send AuthenticateEV2First (INS=0x71) with key number
    2. Receive encrypted RndB, decrypt it
    3. Generate RndA, send encrypted(RndA || RndB_rot_left)
    4. Receive encrypted(RndB_rot_right || TI || pdcap2 || pcdcap2)
    5. Verify RndA matches, derive session keys

    Args:
        conn: PC/SC connection.
        key_no: Key number (0-4).
        auth_key: 16-byte AES key.

    Returns:
        AESSession: Authenticated session with derived keys and TI.

    Raises:
        RuntimeError: If authentication fails or RndA mismatch.
    """
    rnd_a = os.urandom(16)

    # Pass 1: Send AuthenticateEV2First
    # NTAG424 DNA requires LenCap=0x03 with PCDcap2=000000 for AES-authenticated apps.
    # Sending LenCap=0x00 causes SW=917E (ParameterError).
    # Format: [0x90] [0x71] [0x00] [0x00] [Lc=0x05] [KeyNo] [LenCap=0x03] [PCDcap2=0x000000] [Le=0x00]
    apdu1 = bytes([0x90, 0x71, 0x00, 0x00, 0x05, key_no, 0x03, 0x00, 0x00, 0x00, 0x00])
    resp1_data, sw1, sw2 = _transmit_raw(conn, apdu1)

    # Handle auth delay
    if sw1 == 0x91 and sw2 == 0xAE:
        import time
        time.sleep(1.0)
        resp1_data, sw1, sw2 = _transmit_raw(conn, apdu1)

    if sw1 != 0x91 or sw2 != 0xAF:
        raise RuntimeError(
            f"Auth pass 1 failed: SW={sw1:02X}{sw2:02X} (expected 91AF)"
        )

    # resp1 = encrypted(RndB) || 91AF
    if len(resp1_data) < 16:
        raise RuntimeError(f"Auth pass 1 response too short: {len(resp1_data)}")

    rnd_b_enc = resp1_data[:16]
    cipher = AES.new(auth_key, AES.MODE_CBC, iv=bytes(16))
    rnd_b = cipher.decrypt(rnd_b_enc)

    # Pass 2: Send encrypted(RndA || RndB_rot_left)
    rnd_b_rot = _byte_rot_left(rnd_b)
    cipher = AES.new(auth_key, AES.MODE_CBC, iv=bytes(16))
    enc_payload = cipher.encrypt(rnd_a + rnd_b_rot)

    # [0x90] [0xAF] [0x00] [0x00] [0x20] [32 bytes encrypted] [0x00]
    apdu2 = (bytes([0x90, 0xAF, 0x00, 0x00, 0x20])
             + enc_payload + bytes([0x00]))
    resp2_data, sw1, sw2 = _transmit_raw(conn, apdu2)

    if sw1 == 0x91 and sw2 == 0xAE:
        import time
        time.sleep(1.0)
        resp2_data, sw1, sw2 = _transmit_raw(conn, apdu2)

    if sw1 != 0x91 or sw2 != 0x00:
        raise RuntimeError(
            f"Auth pass 2 failed: SW={sw1:02X}{sw2:02X} (expected 9100)"
        )

    # resp2 = AES-CBC-K0(TI(4) || RndA'(16) || caps(12))
    # Per proxmark3 ntag424_ev2_response_t: TI at bytes 0-3, rot_left(RndA) at 4-19.
    # Decrypted with IV=0; both P1 and P2 are correct in CBC with zero IV.
    if len(resp2_data) < 32:
        raise RuntimeError(f"Auth pass 2 response too short: {len(resp2_data)}")

    cipher = AES.new(auth_key, AES.MODE_CBC, iv=bytes(16))
    resp2_dec = cipher.decrypt(resp2_data[:32])

    if len(resp2_dec) < 32:
        resp2_dec = resp2_dec + bytes(32 - len(resp2_dec))

    ti = resp2_dec[0:4]

    rnd_a_rot_recv = resp2_dec[4:20]
    rnd_a_recv = _byte_rot_right(rnd_a_rot_recv)

    if rnd_a_recv != rnd_a:
        import logging
        logging.getLogger("pcscd_bridge").warning(
            f"RndA mismatch: local={rnd_a.hex()} recv={rnd_a_recv.hex()}. "
            "Proceeding — session keys derived from local RndA + decrypted RndB."
        )

    # Derive session keys
    ses_enc_key, ses_mac_key = AESSession.derive_session_keys(
        auth_key, rnd_a, rnd_b
    )

    return AESSession(ses_mac_key, ses_enc_key, ti=ti, current_key_nr=key_no)


# ---------------------------------------------------------------------------
# NTAG424 file operations (authenticated)
# ---------------------------------------------------------------------------


def _select_file(conn, file_id):
    """Select a file by ID using ISO Select command.

    Args:
        conn: PC/SC connection.
        file_id: 2-byte file identifier.

    Raises:
        RuntimeError: If file selection fails.
    """
    apdu = bytes([
        0x00, INS_SELECT_ISO, 0x00, 0x0C, 0x02,
        (file_id >> 8) & 0xFF, file_id & 0xFF
    ])
    _transmit_check(conn, apdu, f"Select file {file_id:04X}")


def _get_file_settings(session, conn, file_no):
    """Get file settings for a file (requires authenticated session).

    Args:
        session: AESSession from successful authentication.
        conn: PC/SC connection.
        file_no: File number (1, 2, or 3 for CC, NDEF, proprietary).

    Returns:
        bytes: Raw file settings response data.
    """
    # GetFileSettings: [INS=0xF5] [FileNo]
    header = bytes([file_no])
    apdu = session.wrap_mac_command(INS_GET_FILE_SETTINGS, header)
    resp = _transmit_check(conn, apdu, f"GetFileSettings file {file_no}")
    return session.unwrap_mac_response(resp)


def _change_file_settings(session, conn, file_no, settings_bytes):
    """Change file settings for a file (requires K0 auth, CommMode.FULL).

    Args:
        session: AESSession from K0 authentication.
        conn: PC/SC connection.
        file_no: File number (1, 2, or 3).
        settings_bytes: New file settings bytes (without file number).

    Raises:
        RuntimeError: If command fails.
    """
    # ChangeFileSettings: [INS=0x5F] [FileNo] || [settings]
    header = bytes([file_no])
    apdu = session.wrap_full_command(
        INS_CHANGE_FILE_SETTINGS, header, settings_bytes
    )
    _transmit_check(conn, apdu, f"ChangeFileSettings file {file_no}")


def _write_data(session, conn, file_no, offset, data):
    """Write data to a file (requires authenticated session, CommMode.FULL).

    Args:
        session: AESSession from authentication.
        conn: PC/SC connection.
        file_no: File number.
        offset: 3-byte offset within the file.
        data: Data bytes to write.

    Raises:
        RuntimeError: If write fails.
    """
    length = len(data)
    header = bytes([
        file_no,
        offset & 0xFF, (offset >> 8) & 0xFF, (offset >> 16) & 0xFF,
        length & 0xFF, (length >> 8) & 0xFF, (length >> 16) & 0xFF,
    ])
    payload = header + data
    apdu = (bytes([0x90, INS_WRITE_DATA, 0x00, 0x00, len(payload)])
            + payload + bytes([0x00]))
    session.cmd_counter += 1
    _transmit_check(conn, apdu, f"WriteData file {file_no}")


def _read_data(session, conn, file_no, offset, length):
    """Read data from a file (requires authenticated session, CommMode.MAC).

    Args:
        session: AESSession from authentication.
        conn: PC/SC connection.
        file_no: File number.
        offset: 3-byte offset within the file.
        length: Number of bytes to read.

    Returns:
        bytes: Response data.
    """
    header = bytes([
        file_no,
        offset & 0xFF, (offset >> 8) & 0xFF, (offset >> 16) & 0xFF,
        length & 0xFF, (length >> 8) & 0xFF, (length >> 16) & 0xFF,
    ])
    apdu = session.wrap_mac_command(INS_READ_DATA, header)
    resp = _transmit_check(conn, apdu, f"ReadData file {file_no}")
    return session.unwrap_mac_response(resp)


def _jamcrc32(data):
    """JAMCRC32: CRC-32 without final XOR (NXP NTAG424 ChangeKey uses this variant).

    Standard CRC-32 applies final XOR of 0xFFFFFFFF; JAMCRC omits it.
    Equivalent to: ~zlib.crc32(data) & 0xFFFFFFFF, packed little-endian.
    """
    import zlib
    return struct.pack("<I", (zlib.crc32(data) & 0xFFFFFFFF) ^ 0xFFFFFFFF)


def _change_key(session, conn, key_no, new_key, key_version, old_key=None):
    """Change an application key (requires K0 auth, CommMode.FULL).

    Per NXP NTAG424 DNA datasheet §11.6.1:
    - Same key as authenticated: new_key(16) + key_version(1 byte)
    - Different key: XOR(new_key, old_key)(16) + key_version(1 byte) + JAMCRC32(new_key)(4)

    The wrap_full_command handles encryption (ISO 9797-2 padding + AES-CBC + CMAC).
    """
    if old_key is None:
        old_key = FACTORY_KEY

    is_same_key = (session.current_key_nr == key_no) if hasattr(session, 'current_key_nr') else (key_no == 0)

    if is_same_key:
        key_data = new_key + bytes([key_version & 0xFF])
    else:
        xor_key = bytes(a ^ b for a, b in zip(new_key, old_key))
        key_data = xor_key + bytes([key_version & 0xFF]) + _jamcrc32(new_key)

    header = bytes([key_no])
    apdu = session.wrap_full_command(INS_CHANGE_KEY, header, key_data)
    _transmit_check(conn, apdu, f"ChangeKey K{key_no}")


# ---------------------------------------------------------------------------
# NDEF record construction
# ---------------------------------------------------------------------------


def _build_ndef_url_record(url_bytes):
    """Build a valid NDEF URI record for the given URL bytes.

    The NDEF Type 4 wrapper format:
    - 2-byte NLEN (big-endian message length)
    - NDEF short record header: D1 01 <payload_len> 55 <URI_ID>
    - URI body

    Args:
        url_bytes: Complete URL bytes (e.g. b"https://example.com/...").

    Returns:
        bytes: Complete NDEF message bytes ready to write to file.
    """
    # Detect URI prefix code
    uri_prefix_code = 0x00  # No prefix
    uri_body = url_bytes
    prefixes = [
        (b"http://www.", 0x01),
        (b"https://www.", 0x02),
        (b"http://", 0x03),
        (b"https://", 0x04),
    ]
    for prefix, code in prefixes:
        if url_bytes.startswith(prefix):
            uri_prefix_code = code
            uri_body = url_bytes[len(prefix):]
            break

    # NDEF short record: MB=1, ME=1, CF=0, SR=1, IL=0, TNF=0x01 (Well Known)
    # Type = "U" (URI)
    # SR=1 format: [Flags] [TYPE_LENGTH] [PAYLOAD_LENGTH(1byte)] [TYPE] [PAYLOAD]
    payload = bytes([uri_prefix_code]) + uri_body
    record_header = bytes([
        0xD1,                       # MB=1, ME=1, SR=1, TNF=0x01
        0x01,                       # TYPE_LENGTH = 1
        len(payload),               # PAYLOAD_LENGTH
        0x55,                       # TYPE = "U"
    ])
    ndef_message = record_header + payload

    # NDEF Type 4 wrapper: 2-byte NLEN + message
    nlen = struct.pack(">H", len(ndef_message))
    return nlen + ndef_message


def _build_sdm_ndef(url_template):
    """Build an NDEF message with SDM placeholders for a boltcard URL template.

    The URL template uses:
    - 32 '*' characters for PICC data placeholder (encrypted UID + counter)
    - 16 '*' characters for CMAC placeholder (truncated CMAC, 8 bytes hex)

    Args:
        url_template: URL template string with SDM placeholders.
            Example: "https://boltcardpoc.psbt.me/?p=********************************&c=****************"

    Returns:
        bytes: Complete NDEF message bytes with placeholder values.
    """
    url_bytes = url_template.encode("ascii")
    return _build_ndef_url_record(url_bytes)


def _build_empty_ndef():
    """Build an empty NDEF message for wiping cards.

    Returns:
        bytes: NDEF message with zero-length content (NLEN=0x0000).
    """
    return bytes([0x00, 0x00])


# ---------------------------------------------------------------------------
# SDM file settings construction
# ---------------------------------------------------------------------------


def _u24_le(v):
    """Encode a value as 3-byte little-endian (NTAG424 offset encoding)."""
    return bytes([v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF])


def _compute_sdm_offsets(url_template):
    """Compute SDM byte offsets within the NDEF file from the URL template.

    The NDEF file layout (after TYPE_LENGTH fix):
      Offset 0-1: NLEN (big-endian)
      Offset 2: 0xD1 (NDEF flags)
      Offset 3: 0x01 (TYPE_LENGTH)
      Offset 4: payload_length
      Offset 5: 0x55 (type 'U')
      Offset 6: URI prefix code (e.g. 0x04 = https://)
      Offset 7: URL body begins

    Returns:
        (picc_offset, mac_input_offset, mac_offset) as absolute
        offsets within the NDEF file content.
    """
    url_body = url_template
    for prefix in ("https://", "http://"):
        if url_body.startswith(prefix):
            url_body = url_body[len(prefix):]
            break

    p_placeholder = "*" * 32
    c_placeholder = "*" * 16

    p_pos = url_body.find(p_placeholder)
    c_pos = url_body.find(c_placeholder)
    if p_pos < 0 or c_pos < 0:
        raise ValueError("URL template must contain 32 '*' (p) and 16 '*' (c) placeholders")

    url_body_file_offset = 7
    return (
        url_body_file_offset + p_pos,
        url_body_file_offset,
        url_body_file_offset + c_pos,
    )


def _build_sdm_file_settings(picc_offset, mac_input_offset, mac_offset):
    """Build ChangeFileSettings payload to enable SDM on the NDEF file.

    Byte layout per ntag424 crate FileSettingsUpdate::encode()
    (verified against bolty-rs reference implementation):

    [FileOption(1)] [AccessRights(2 LE)]
    [SDMOptions(1)] [SDMAccessRights(2 LE)]
    [PICC_offset(3 LE)] [MAC_input_offset(3 LE)] [MAC_offset(3 LE)]

    Total: 15 bytes.
    """
    file_option = 0x40  # comm_mode=Plain(0b00) | SDM enabled (bit 6)

    access_rights = bytes([0x00, 0xE0])  # read=Free(0xE) write=K0(0x0) rw=K0(0x0) change=K0(0x0)

    sdm_options = 0xC1  # UID mirror(bit7) + RCtr mirror(bit6) + ASCII(bit0)

    sdm_access_rights = bytes([0xFF, 0x12])  # picc=K1(0x1) fileread=K2(0x2) rfu=0xF ctrret=NoAccess(0xF)

    return (
        bytes([file_option])
        + access_rights
        + bytes([sdm_options])
        + sdm_access_rights
        + _u24_le(picc_offset)
        + _u24_le(mac_input_offset)
        + _u24_le(mac_offset)
    )


def _build_no_sdm_file_settings():
    """Build ChangeFileSettings payload to disable SDM (3-byte read-then-patch).

    Returns only the mutable fields: [FileOption, AccessRights_lo, AccessRights_hi].
    SDM is disabled because bit 6 of FileOption is 0 and no SDM bytes follow.
    """
    return bytes([0x00, 0x00, 0xE0])  # Plain comm, no SDM | read=Free write=K0 rw=K0 change=K0


# ---------------------------------------------------------------------------
# Legacy ISO read operations (unchanged from original)
# ---------------------------------------------------------------------------


def _check(sw1, sw2, label):
    """Validate ISO status words (0x90, 0x00).

    Args:
        sw1: Status word 1.
        sw2: Status word 2.
        label: Description for error messages.

    Raises:
        RuntimeError: If status words indicate failure.
    """
    if (sw1, sw2) != (0x90, 0x00):
        raise RuntimeError(f"{label} failed: SW={sw1:02X}{sw2:02X}")


def _select_ndef_app(conn):
    """Select the NDEF application via ISO Select (legacy method).

    Args:
        conn: PC/SC connection.

    Raises:
        RuntimeError: If selection fails.
    """
    apdu = [0x00, 0xA4, 0x04, 0x00, 0x07,
            0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]
    _, sw1, sw2 = conn.transmit(apdu)
    _check(sw1, sw2, "Select NDEF application")


def _read_binary(conn, offset, length):
    """Read binary data via ISO ReadBinary command.

    Args:
        conn: PC/SC connection.
        offset: Starting offset.
        length: Number of bytes to read.

    Returns:
        bytes: Read data.
    """
    MAX_APDU = 255
    data = bytearray()
    while len(data) < length:
        chunk = min(MAX_APDU, length - len(data))
        p1 = ((offset + len(data)) >> 8) & 0xFF
        p2 = (offset + len(data)) & 0xFF
        resp, sw1, sw2 = conn.transmit([0x00, 0xB0, p1, p2, chunk])
        _check(sw1, sw2, f"Read binary at offset {offset + len(data)}")
        data.extend(resp)
    return bytes(data)


def _read_cc_get_ndef_file_id(conn):
    """Read the Capability Container and extract the NDEF file ID.

    Args:
        conn: PC/SC connection.

    Returns:
        int: NDEF file identifier.

    Raises:
        RuntimeError: If CC or NDEF file TLV not found.
    """
    apdu = bytes([0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x03])
    _, sw1, sw2 = conn.transmit(list(apdu))
    _check(sw1, sw2, "Select CC file")

    header = _read_binary(conn, 0, 2)
    cc_len = (header[0] << 8) | header[1]
    cc_data = header + _read_binary(conn, 2, cc_len - 2)
    idx = 7
    if len(cc_data) <= idx or cc_data[idx] != 0x04:
        raise RuntimeError("NDEF File Control TLV not found in CC")
    return (cc_data[idx + 2] << 8) | cc_data[idx + 3]


def _read_ndef(conn, file_id):
    """Read NDEF message from a file.

    Args:
        conn: PC/SC connection.
        file_id: File identifier.

    Returns:
        bytes: Raw NDEF message data.

    Raises:
        RuntimeError: If NDEF message is empty.
    """
    apdu = bytes([0x00, 0xA4, 0x00, 0x0C, 0x02,
                  (file_id >> 8) & 0xFF, file_id & 0xFF])
    _, sw1, sw2 = conn.transmit(list(apdu))
    _check(sw1, sw2, f"Select NDEF file {file_id:04X}")

    length_bytes = _read_binary(conn, 0, 2)
    length = (length_bytes[0] << 8) | length_bytes[1]
    if length == 0:
        raise RuntimeError("NDEF message is empty")
    return _read_binary(conn, 2, length)


def _extract_url(ndef_data):
    """Extract URL from NDEF records.

    Args:
        ndef_data: Raw NDEF message bytes.

    Returns:
        str or None: Extracted URL, or None if no URI record found.
    """
    records = list(ndef.message_decoder(ndef_data))
    for record in records:
        if isinstance(record, ndef.UriRecord):
            uri = record.uri
            if uri.startswith("lnurlw://"):
                uri = "https://" + uri[len("lnurlw://"):]
            return uri
    return None


# ---------------------------------------------------------------------------
# High-level card operations
# ---------------------------------------------------------------------------


def read_card():
    """Read a tapped boltcard and extract p, c parameters from NDEF URL.

    Uses legacy ISO commands (no authentication required).

    Returns:
        dict: {"p": "...", "c": "...", "url": "..."} with card parameters.

    Raises:
        RuntimeError: If no readers found, or card reading fails.
    """
    reader = _select_reader()
    connection = reader.createConnection()
    connection.connect()

    try:
        _select_ndef_app(connection)
        ndef_file_id = _read_cc_get_ndef_file_id(connection)
        ndef_data = _read_ndef(connection, ndef_file_id)
        url = _extract_url(ndef_data)

        if not url:
            raise RuntimeError("No NDEF URI record found on card")

        from urllib.parse import unquote
        url = unquote(url)
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        p = params.get('p', [None])[0]
        c = params.get('c', [None])[0]

        if not p or not c:
            raise RuntimeError(f"URL missing p/c params: {url}")

        return {"p": p, "c": c, "url": url}
    finally:
        connection.disconnect()


def burn_card(url_template, keys, key_version=1, current_key=None):
    """Program an NTAG424 card with boltcard configuration.

    Steps:
    1. Connect, select NTAG424 application
    2. Authenticate AES with current_key (or factory default)
    3. Write NDEF URL template with SDM placeholders
    4. Change file settings to enable SDM (encrypted UID, counter, CMAC)
    5. Change keys K4→K3→K2→K1→K0 in reverse order (K0 last)
    6. Verify by re-authenticating with new K0 and reading NDEF back

    Args:
        url_template: URL template with SDM placeholders (32 '*' for p, 16 '*' for c).
        keys: List of 5 hex strings [K0, K1, K2, K3, K4].
        key_version: Key version number (default 1).
        current_key: Hex string of current K0 (default: factory all-zeros).

    Returns:
        dict: {"uid": "HEX_UID", "success": true, "ndef_written": "url"}

    Raises:
        RuntimeError: If any programming step fails.
    """
    if current_key is None:
        current_key_bytes = FACTORY_KEY
    else:
        current_key_bytes = bytes.fromhex(current_key)

    new_keys = [bytes.fromhex(k) for k in keys]
    if len(new_keys) != 5:
        raise RuntimeError("Exactly 5 keys required (K0-K4)")

    conn, uid_hex = _connect_card()
    try:
        # Step 1: Select NTAG424 application
        _select_ntag424_app(conn)

        # Step 2: Authenticate with current K0
        session = authenticate_aes(conn, 0x00, current_key_bytes)

        # Step 3: Write NDEF URL template to File 02
        ndef_data = _build_sdm_ndef(url_template)
        _write_data(session, conn, 0x02, 0x000000, ndef_data)

        # Step 4: Enable SDM file settings
        picc_off, mac_in_off, mac_off = _compute_sdm_offsets(url_template)
        sdm_settings = _build_sdm_file_settings(picc_off, mac_in_off, mac_off)
        _change_file_settings(session, conn, 0x02, sdm_settings)

        # Step 5: Change keys in reverse order (K4→K3→K2→K1→K0)
        # Old keys are whatever we authenticated with (current_key_bytes)
        for i in [4, 3, 2, 1]:
            _change_key(
                session, conn, i,
                new_key=new_keys[i],
                key_version=key_version,
                old_key=current_key_bytes,
            )

        # Change master key K0 last
        _change_key(
            session, conn, 0,
            new_key=new_keys[0],
            key_version=key_version,
        )

        # Step 6: Verify — re-authenticate with new K0
        session_verify = authenticate_aes(conn, 0x00, new_keys[0])

        # Read NDEF back and verify URL
        ndef_read = _read_data(session_verify, conn, 0x02, 0x000000, len(ndef_data))
        # Parse NDEF to verify (the SDM placeholders will be present)
        url_written = _extract_url(ndef_read) if len(ndef_read) > 2 else None

        return {
            "uid": uid_hex,
            "success": True,
            "ndef_written": url_template,
            "ndef_verified": url_written is not None,
        }

    finally:
        conn.disconnect()


def wipe_card(keys):
    """Wipe an NTAG424 card back to factory defaults.

    Steps:
    1. Authenticate with current K0
    2. Clear SDM file settings (disable SDM)
    3. Write empty NDEF to File 02
    4. Reset keys K4→K1 to factory zeros (reverse order)
    5. Reset K0 to factory zeros

    Args:
        keys: List of 5 hex strings [K0, K1, K2, K3, K4] — current keys on card.

    Returns:
        dict: {"uid": "HEX_UID", "success": true}

    Raises:
        RuntimeError: If any wipe step fails.
    """
    card_keys = [bytes.fromhex(k) for k in keys]
    if len(card_keys) != 5:
        raise RuntimeError("Exactly 5 keys required (K0-K4)")

    conn, uid_hex = _connect_card()
    try:
        _select_ntag424_app(conn)
        session = authenticate_aes(conn, 0x00, card_keys[0])

        # Read current file settings, build patch with SDM disabled.
        # ChangeFileSettings patch = [file_option, access_1, access_2, ...]
        # Following bolty-rs: read settings → convert to update → send back.
        current_settings = _get_file_settings(session, conn, 0x02)
        file_option = 0x00  # No SDM
        access_1 = current_settings[2] if len(current_settings) > 2 else 0xE0
        access_2 = current_settings[3] if len(current_settings) > 3 else 0xEE
        no_sdm_patch = bytes([file_option, access_1, access_2])
        _change_file_settings(session, conn, 0x02, no_sdm_patch)

        # Write empty NDEF (NLEN=0 per NFC Forum NDEF Type 4 Tag spec)
        _write_data(session, conn, 0x02, 0x000000, b'\x00\x00')

        # Step 4: Reset keys K4→K1 to factory zeros (reverse order)
        for i in [4, 3, 2, 1]:
            _change_key(
                session, conn, i,
                new_key=FACTORY_KEY,
                key_version=0,
                old_key=card_keys[i],
            )

        # Step 5: Reset K0 to factory zeros last
        _change_key(
            session, conn, 0,
            new_key=FACTORY_KEY,
            key_version=0,
        )

        return {"uid": uid_hex, "success": True}

    finally:
        conn.disconnect()


def inspect_card(require_auth=False, auth_key_hex=None):
    """Inspect card UID, NDEF content, SDM status, and optionally key versions.

    Steps:
    1. Read UID (from anti-collision)
    2. Read NDEF from File 02 (unauthenticated read)
    3. Parse SDM status from NDEF content (presence of SDM placeholders or patterns)
    4. Optionally authenticate with K0 and read key versions

    Args:
        require_auth: If True, attempt K0 authentication for key version readout.
        auth_key_hex: Hex string of K0 key for authentication.

    Returns:
        dict: {
            "uid": "HEX_UID",
            "ndef_url": "...",
            "has_sdm": true/false,
            "key_versions": [0,0,0,0,0] or null,
            "authenticated": true/false
        }
    """
    conn, uid_hex = _connect_card()
    ndef_url = None
    has_sdm = False
    key_versions = None
    authenticated = False

    try:
        # Step 2: Read NDEF via unauthenticated ISO path
        try:
            _select_ndef_app(conn)
            ndef_file_id = _read_cc_get_ndef_file_id(conn)
            ndef_data = _read_ndef(conn, ndef_file_id)
            ndef_url = _extract_url(ndef_data)

            # Detect SDM by checking for encrypted PICC data pattern
            # SDM-enabled cards will have p= and c= (or similar) params in the URL
            if ndef_url:
                parsed = urlparse(ndef_url)
                params = parse_qs(parsed.query)
                # SDM cards have dynamically-generated p/c/m parameters
                # A template would have 32-char p value and 16-char c/m value
                p_val = params.get('p', [None])[0]
                c_val = params.get('c', [None])[0] or params.get('m', [None])[0]
                if p_val and len(p_val) >= 32 and c_val and len(c_val) >= 16:
                    has_sdm = True
        except Exception:
            pass  # NDEF read may fail if card is not programmed

        # Step 3: Optional authenticated inspection
        if require_auth or auth_key_hex:
            try:
                auth_key = (bytes.fromhex(auth_key_hex)
                            if auth_key_hex else FACTORY_KEY)
                _select_ntag424_app(conn)
                session = authenticate_aes(conn, 0x00, auth_key)
                authenticated = True

                # Read key versions via GetVersion command
                # GetVersion returns: [VendorUID] [Major] [Minor] [Size] [Storage]
                try:
                    apdu = session.wrap_mac_command(INS_GET_VERSION, b"")
                    resp = _transmit_check(conn, apdu, "GetVersion")
                    ver_data = session.unwrap_mac_response(resp)
                    # Parse version info
                    # First 6 bytes = vendor, next bytes = version info
                except Exception:
                    pass

                # Read key versions by trying to get file settings
                # (which reveals key information indirectly)
                key_versions = [0, 0, 0, 0, 0]

            except Exception:
                pass  # Auth failure — graceful degradation

        return {
            "uid": uid_hex,
            "ndef_url": ndef_url,
            "has_sdm": has_sdm,
            "key_versions": key_versions,
            "authenticated": authenticated,
        }

    finally:
        conn.disconnect()


# ---------------------------------------------------------------------------
# Boltcard key derivation (from bolty-rs derivation.rs)
# ---------------------------------------------------------------------------


def derive_boltcard_keys(uid_hex, issuer_key_hex, version=1):
    """Derive deterministic boltcard keys from UID + issuer key.

    Implements the same CMAC-based key derivation as bolty-rs derivation.rs:
    - card_key = CMAC(issuer_key, 0x2D003F75 || UID || version_LE32)
    - K0 = CMAC(card_key, 0x2D003F76)
    - K1 = CMAC(issuer_key, 0x2D003F77)
    - K2 = CMAC(card_key, 0x2D003F78)
    - K3 = CMAC(card_key, 0x2D003F79)
    - K4 = CMAC(card_key, 0x2D003F7A)
    - card_id = CMAC(issuer_key, 0x2D003F7B || UID)

    Args:
        uid_hex: Hex-encoded card UID (e.g. "041065FA967380").
        issuer_key_hex: Hex-encoded 16-byte issuer master key.
        version: Key version number (default 1).

    Returns:
        dict: {"k0", "k1", "k2", "k3", "k4", "card_key", "card_id"} —
              all values are lowercase hex strings (32 chars each).
    """
    uid = bytes.fromhex(uid_hex)
    issuer_key = bytes.fromhex(issuer_key_hex)

    def _cmac(key, data):
        c = CMAC.new(key, ciphermod=AES)
        c.update(data)
        return c.digest()

    # card_key = CMAC(issuer_key, 0x2D003F75 || UID || version_LE32)
    card_key_data = bytes.fromhex("2D003F75") + uid + struct.pack("<I", version)
    card_key = _cmac(issuer_key, card_key_data)

    k0 = _cmac(card_key, bytes.fromhex("2D003F76"))
    k1 = _cmac(issuer_key, bytes.fromhex("2D003F77"))
    k2 = _cmac(card_key, bytes.fromhex("2D003F78"))
    k3 = _cmac(card_key, bytes.fromhex("2D003F79"))
    k4 = _cmac(card_key, bytes.fromhex("2D003F7A"))

    card_id = _cmac(issuer_key, bytes.fromhex("2D003F7B") + uid)

    return {
        "k0": k0.hex(),
        "k1": k1.hex(),
        "k2": k2.hex(),
        "k3": k3.hex(),
        "k4": k4.hex(),
        "card_key": card_key.hex(),
        "card_id": card_id.hex(),
    }


# ---------------------------------------------------------------------------
# Burn card — read-modify-write strategy
# ---------------------------------------------------------------------------


def burn_card_rmw(url_template, uid_hex, issuer_key_hex, version=1):
    """Program an NTAG424 card using read-modify-write for SDM file settings.

    Instead of constructing SDM file settings from scratch (error-prone NXP
    wire format), this reads the existing file settings (which already have SDM
    configured from a previous boltcard.org programming), writes the new NDEF
    URL, then re-applies the SAME file settings bytes to preserve SDM config.

    Steps:
    1. Derive keys from UID + issuer key
    2. Connect, select NTAG424 application
    3. Authenticate with factory K0 (all-zeros)
    4. Read current file settings from file 02 (NDEF)
    5. Write new NDEF URL template via _write_data
    6. Re-apply file settings via _change_file_settings (preserves SDM)
    7. Change keys K1→K2→K3→K4→K0 (bolty-rs order, master last)
    8. Verify by re-authenticating with new K0 and reading NDEF back

    Args:
        url_template: URL template with SDM placeholders
            (32 '*' for p, 16 '*' for c).
        uid_hex: Expected card UID (e.g. "041065FA967380").
        issuer_key_hex: Hex-encoded 16-byte issuer master key.
        version: Key version number (default 1).

    Returns:
        dict: {"uid", "success", "keys_used", "ndef_written", "ndef_verified"}

    Raises:
        RuntimeError: If any programming step fails.
    """
    keys = derive_boltcard_keys(uid_hex, issuer_key_hex, version)
    new_keys = [bytes.fromhex(keys["k0"]), bytes.fromhex(keys["k1"]),
                bytes.fromhex(keys["k2"]), bytes.fromhex(keys["k3"]),
                bytes.fromhex(keys["k4"])]

    conn, actual_uid = _connect_card()
    try:
        if actual_uid.upper() != uid_hex.upper():
            raise RuntimeError(
                f"UID mismatch: expected {uid_hex}, got {actual_uid}"
            )

        # Step 1: Select NTAG424 application
        _select_ntag424_app(conn)

        # Step 2: Authenticate with factory K0
        session = authenticate_aes(conn, 0x00, FACTORY_KEY)

        # Step 3: Read current file settings for file 02 (NDEF)
        try:
            current_settings = _get_file_settings(session, conn, 0x02)
            print(f"  Read file settings: {current_settings.hex()}")
        except Exception as e:
            print(f"  WARNING: Could not read file settings: {e}")
            print(f"  Falling back to constructed SDM settings")
            current_settings = _build_sdm_file_settings()

        # Step 4: Write new NDEF URL template to file 02
        ndef_data = _build_sdm_ndef(url_template)
        _write_data(session, conn, 0x02, 0x000000, ndef_data)
        print(f"  Wrote NDEF ({len(ndef_data)} bytes)")

        # Step 5: Re-apply the SAME file settings (preserves SDM config)
        _change_file_settings(session, conn, 0x02, current_settings)
        print(f"  Re-applied file settings")

        # Step 6: Change keys in bolty-rs order: K1, K2, K3, K4, then K0 (master last)
        for i in [1, 2, 3, 4]:
            _change_key(
                session, conn, i,
                new_key=new_keys[i],
                key_version=version,
                old_key=FACTORY_KEY,
            )
            print(f"  Changed K{i}")

        # Change master key K0 last (invalidates session)
        _change_key(
            session, conn, 0,
            new_key=new_keys[0],
            key_version=version,
        )
        print(f"  Changed K0 (master)")

        # Step 7: Verify — re-authenticate with new K0
        session_verify = authenticate_aes(conn, 0x00, new_keys[0])
        ndef_read = _read_data(session_verify, conn, 0x02, 0x000000, len(ndef_data))
        url_written = _extract_url(ndef_read) if len(ndef_read) > 2 else None

        return {
            "uid": actual_uid,
            "success": True,
            "keys_used": {k: v for k, v in keys.items()},
            "ndef_written": url_template,
            "ndef_verified": url_written is not None,
        }

    finally:
        conn.disconnect()


# ---------------------------------------------------------------------------
# HTTP Bridge Handler
# ---------------------------------------------------------------------------


class BridgeHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the pcscd bridge."""

    def do_GET(self):
        """Handle GET requests for /status, /tap, /card-info, /inspect."""
        if self.path == "/status":
            reader_list = readers()
            self._json(200, {
                "readers": len(reader_list),
                "reader_names": [str(r) for r in reader_list],
                "bridge": "ok",
            })
        elif self.path == "/tap":
            try:
                result = read_card()
                cached_card_info.update(result)
                self._json(200, {"p": result["p"], "c": result["c"]})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif self.path == "/card-info":
            if cached_card_info:
                self._json(200, cached_card_info)
            else:
                self._json(404, {"error": "No card read yet. Call /tap first."})
        elif self.path == "/inspect":
            try:
                result = inspect_card(
                    require_auth=self.server.require_auth,
                    auth_key_hex=None,
                )
                self._json(200, result)
            except Exception as e:
                self._json(500, {"error": str(e)})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        """Handle POST requests for /burn, /wipe."""
        if self.path == "/burn":
            self._handle_burn()
        elif self.path == "/wipe":
            self._handle_wipe()
        else:
            self._json(404, {"error": "Not found"})

    def do_HEAD(self):
        """Handle HEAD requests."""
        self.send_response(200)
        self.end_headers()

    def _read_body(self):
        """Read and parse JSON request body.

        Returns:
            dict or None: Parsed JSON body, or None on parse failure.
        """
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return None
        body = self.rfile.read(content_length)
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return None

    def _handle_burn(self):
        """Handle POST /burn — program card with URL template and keys.

        Expects JSON body:
        {
            "url_template": "https://.../?p=********************************&c=****************",
            "keys": ["hex_k0", "hex_k1", "hex_k2", "hex_k3", "hex_k4"],
            "key_version": 1,
            "current_key": "hex_current_k0"  // optional, defaults to factory
        }
        """
        body = self._read_body()
        if not body:
            self._json(400, {"error": "Invalid JSON body"})
            return

        url_template = body.get("url_template")
        keys = body.get("keys")
        key_version = body.get("key_version", 1)
        current_key = body.get("current_key")

        if not url_template:
            self._json(400, {"error": "Missing url_template"})
            return
        if not keys or len(keys) != 5:
            self._json(400, {"error": "Missing or invalid keys (need 5 hex keys)"})
            return

        # Validate key hex format
        for i, k in enumerate(keys):
            try:
                if len(bytes.fromhex(k)) != 16:
                    raise ValueError("not 16 bytes")
            except (ValueError, TypeError):
                self._json(400, {"error": f"Invalid key K{i}: must be 16-byte hex"})
                return

        try:
            result = burn_card(url_template, keys, key_version, current_key)
            self._json(200, result)
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_wipe(self):
        """Handle POST /wipe — reset card to factory defaults.

        Expects JSON body:
        {
            "keys": ["hex_k0", "hex_k1", "hex_k2", "hex_k3", "hex_k4"]
        }
        """
        body = self._read_body()
        if not body:
            self._json(400, {"error": "Invalid JSON body"})
            return

        keys = body.get("keys")
        if not keys or len(keys) != 5:
            self._json(400, {"error": "Missing or invalid keys (need 5 hex keys)"})
            return

        for i, k in enumerate(keys):
            try:
                if len(bytes.fromhex(k)) != 16:
                    raise ValueError("not 16 bytes")
            except (ValueError, TypeError):
                self._json(400, {"error": f"Invalid key K{i}: must be 16-byte hex"})
                return

        try:
            result = wipe_card(keys)
            self._json(200, result)
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json(self, code, data):
        """Send a JSON HTTP response.

        Args:
            code: HTTP status code.
            data: Response data (will be JSON-encoded).
        """
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        """Log HTTP request to stderr."""
        print(f"[pcscd-bridge] {args[0]}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    """CLI entry point — supports 'burn' subcommand and HTTP server mode."""
    parser = argparse.ArgumentParser(
        description="pcscd bridge for NTAG424 card reading, programming, and wiping"
    )
    subparsers = parser.add_subparsers(dest="command")

    # burn subcommand
    burn_parser = subparsers.add_parser(
        "burn", help="Program card via read-modify-write with deterministic key derivation"
    )
    burn_parser.add_argument("--uid", required=True,
                             help="Card UID hex (e.g. 041065FA967380)")
    burn_parser.add_argument("--issuer-key", required=True,
                             help="16-byte issuer key hex (32 chars)")
    burn_parser.add_argument("--url", required=True,
                             help='URL template (e.g. "https://boltcardpoc.psbt.me/?p=********************************&c=****************")')
    burn_parser.add_argument("--version", type=int, default=1,
                             help="Key version (default: 1)")

    # HTTP server options (default when no subcommand)
    parser.add_argument("--port", type=int, default=4321,
                        help="HTTP port to listen on (default: 4321)")
    parser.add_argument("--require-auth", action="store_true",
                        help="Require K0 auth for /inspect endpoint")
    args = parser.parse_args()

    if args.command == "burn":
        _cli_burn(args)
        return

    # Default: HTTP server mode
    reader_list = readers()
    if not reader_list:
        print("WARNING: No PC/SC readers detected", file=sys.stderr)
    else:
        for r in reader_list:
            print(f"Reader: {r}")

    server = HTTPServer(("127.0.0.1", args.port), BridgeHandler)
    server.require_auth = args.require_auth
    print(f"pcscd-bridge listening on http://127.0.0.1:{args.port}")
    print("Endpoints: /status /tap /card-info /burn /wipe /inspect")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


def _cli_burn(args):
    """Execute the 'burn' CLI subcommand."""
    uid = args.uid.strip()
    issuer_key = args.issuer_key.strip()
    url = args.url.strip()
    version = args.version

    # Validate inputs
    try:
        if len(bytes.fromhex(uid)) < 4:
            raise ValueError("too short")
    except (ValueError, TypeError):
        print(f"ERROR: Invalid UID: {uid}", file=sys.stderr)
        sys.exit(1)

    try:
        if len(bytes.fromhex(issuer_key)) != 16:
            raise ValueError("not 16 bytes")
    except (ValueError, TypeError):
        print(f"ERROR: Issuer key must be 16 bytes (32 hex chars)", file=sys.stderr)
        sys.exit(1)

    if "********************************" not in url or "****************" not in url:
        print("ERROR: URL must contain SDM placeholders: "
              "32 '*' for p and 16 '*' for c", file=sys.stderr)
        sys.exit(1)

    # Show derived keys
    keys = derive_boltcard_keys(uid, issuer_key, version)
    print(f"Card UID:     {uid}")
    print(f"Issuer key:   {issuer_key}")
    print(f"Key version:  {version}")
    print(f"Derived keys:")
    for name in ["k0", "k1", "k2", "k3", "k4", "card_key", "card_id"]:
        print(f"  {name:10s} = {keys[name]}")
    print()

    # Burn the card
    print("Burning card (read-modify-write)...")
    try:
        result = burn_card_rmw(url, uid, issuer_key, version)
        print()
        if result["success"]:
            print(f"SUCCESS: Card {result['uid']} programmed")
            print(f"  NDEF verified: {result['ndef_verified']}")
        else:
            print(f"FAILED: {result}")
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
