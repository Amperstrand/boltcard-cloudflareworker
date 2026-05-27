#!/usr/bin/env python3
"""pcscd bridge — HTTP API for reading NTAG424 bolt cards via PC/SC reader.

Usage:
  python3 scripts/pcscd-bridge.py [--port 4321]

Requirements:
  pip install pyscard ndeflib

Endpoints:
  GET /status     — reader and card status
  GET /tap        — wait for card tap, return {p, c, uid}
  GET /card-info  — return cached card info {uid, k1, k2, version}
"""

import sys
import json
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

CLA_ISO = 0x00
INS_SELECT = 0xA4
INS_READ_BINARY = 0xB0
MAX_APDU = 255

cached_card_info = {}


def _check(sw1, sw2, label):
    if (sw1, sw2) != (0x90, 0x00):
        raise RuntimeError(f"{label} failed: SW={sw1:02X}{sw2:02X}")


def _select_ndef_app(conn):
    apdu = [CLA_ISO, INS_SELECT, 0x04, 0x00, 0x07,
            0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]
    _, sw1, sw2 = conn.transmit(apdu)
    _check(sw1, sw2, "Select NDEF application")


def _select_file(conn, file_id):
    apdu = [CLA_ISO, INS_SELECT, 0x00, 0x0C, 0x02,
            (file_id >> 8) & 0xFF, file_id & 0xFF]
    _, sw1, sw2 = conn.transmit(apdu)
    _check(sw1, sw2, f"Select file {file_id:04X}")


def _read_binary(conn, offset, length):
    data = bytearray()
    while len(data) < length:
        chunk = min(MAX_APDU, length - len(data))
        p1 = ((offset + len(data)) >> 8) & 0xFF
        p2 = (offset + len(data)) & 0xFF
        resp, sw1, sw2 = conn.transmit([CLA_ISO, INS_READ_BINARY, p1, p2, chunk])
        _check(sw1, sw2, f"Read binary at offset {offset + len(data)}")
        data.extend(resp)
    return bytes(data)


def _read_cc_get_ndef_file_id(conn):
    _select_file(conn, 0xE103)
    header = _read_binary(conn, 0, 2)
    cc_len = (header[0] << 8) | header[1]
    cc_data = header + _read_binary(conn, 2, cc_len - 2)
    idx = 7
    if len(cc_data) <= idx or cc_data[idx] != 0x04:
        raise RuntimeError("NDEF File Control TLV not found in CC")
    return (cc_data[idx + 2] << 8) | cc_data[idx + 3]


def _read_ndef(conn, file_id):
    _select_file(conn, file_id)
    length_bytes = _read_binary(conn, 0, 2)
    length = (length_bytes[0] << 8) | length_bytes[1]
    if length == 0:
        raise RuntimeError("NDEF message is empty")
    return _read_binary(conn, 2, length)


def _extract_url(ndef_data):
    records = list(ndef.message_decoder(ndef_data))
    for record in records:
        if isinstance(record, ndef.UriRecord):
            uri = record.uri
            if uri.startswith("lnurlw://"):
                uri = "https://" + uri[len("lnurlw://"):]
            return uri
    return None


def read_card():
    reader_list = readers()
    if not reader_list:
        raise RuntimeError("No PC/SC readers found")

    reader = reader_list[0]
    connection = reader.createConnection()
    connection.connect()

    try:
        _select_ndef_app(connection)
        ndef_file_id = _read_cc_get_ndef_file_id(connection)
        ndef_data = _read_ndef(connection, ndef_file_id)
        url = _extract_url(ndef_data)

        if not url:
            raise RuntimeError("No NDEF URI record found on card")

        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        p = params.get('p', [None])[0]
        c = params.get('c', [None])[0]

        if not p or not c:
            raise RuntimeError(f"URL missing p/c params: {url}")

        return {"p": p, "c": c, "url": url}
    finally:
        connection.disconnect()


class BridgeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
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
        else:
            self._json(404, {"error": "Not found"})

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[pcscd-bridge] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="pcscd bridge for NTAG424 card reading")
    parser.add_argument("--port", type=int, default=4321)
    args = parser.parse_args()

    reader_list = readers()
    if not reader_list:
        print("WARNING: No PC/SC readers detected", file=sys.stderr)
    else:
        for r in reader_list:
            print(f"Reader: {r}")

    server = HTTPServer(("127.0.0.1", args.port), BridgeHandler)
    print(f"pcscd-bridge listening on http://127.0.0.1:{args.port}")
    print("Endpoints: /status /tap /card-info")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
