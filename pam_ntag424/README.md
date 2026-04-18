# pam_ntag424 — Local NTAG424 DNA NFC Card PAM Module

A proof-of-concept PAM module that authenticates SSH (or any PAM-aware service)
using a **NXP NTAG424 DNA** NFC card read locally via **pcscd**.

No network connection is required.  All cryptographic verification happens
on-device using the card's K1 and K2 keys stored in a local config file.

---

## What it does

When a user authenticates, the module:

1. Connects to the first available PC/SC NFC reader via `pcscd`
2. Waits (configurable timeout) for the user to tap their NTAG424 card
3. Reads the NDEF URI record from the card using ISO 7816-4 APDUs
4. Parses the `?p=` and `?c=` SDM parameters from the URL
5. **Decrypts** `p` with K1 (AES-128-ECB) → extracts the 7-byte UID and
   24-bit SDMReadCtr
6. **Verifies** `c` with K2 via the BoltCard CMAC chain:
   ```
   SV2 = [3C C3 00 01 00 80] [UID 7B] [ctr_MSB ctr_mid ctr_LSB]
   ks  = AES-CMAC(K2, SV2)
   cm  = AES-CMAC(ks, empty)
   ct  = [cm[1] cm[3] cm[5] cm[7] cm[9] cm[11] cm[13] cm[15]]
   assert ct == c_param (timing-safe)
   ```
7. **Checks the counter** against the last-seen value stored in
   `state_dir/<uid>.ctr` (replay protection — each tap increments the counter)
8. **Atomically updates** the stored counter on success

The counter file is named by UID hex so multiple cards can be registered
on the same machine.

---

## Why NTAG424 is better than UID-only NFC auth

| Feature | UID-only (pam_nfc etc.) | NTAG424 DNA (this module) |
|---------|------------------------|--------------------------|
| Cloning resistance | ❌ trivially clonable | ✅ AES keys in silicon |
| Replay protection | ❌ UID never changes | ✅ monotonic counter |
| Eavesdrop resistance | ❌ UID visible on every tap | ✅ encrypted PICCData |
| Card cost | ~$0.10 | ~$1 |

---

## Cryptographic flow

Matches `cryptoutils.js` and `docs/boltcard-protocol.md` exactly:

```
p_bytes  = hexdecode(p=)                            # 16 bytes
plain    = AES-128-ECB-DECRYPT(K1, p_bytes)
assert   plain[0] == 0xC7                           # PICCDataTag
UID      = plain[1..7]                              # 7 bytes
counter  = plain[8] | (plain[9]<<8) | (plain[10]<<16)  # little-endian

SV2      = 3C C3 00 01 00 80 [UID] [ctr_MSB ctr_mid ctr_LSB]
ks       = AES-CMAC(K2, SV2)                       # 16 bytes
cm       = AES-CMAC(ks, "")                        # empty-message CMAC
ct       = cm[1,3,5,7,9,11,13,15]                  # BoltCard truncation
assert   ct == hexdecode(c=)                        # timing-safe compare
assert   counter > last_counter[UID]               # replay protection
store    last_counter[UID] = counter
```

---

## Build

### Requirements

```bash
# Debian/Ubuntu
sudo apt install libpcsclite-dev libssl-dev libpam0g-dev pcscd

# Fedora/RHEL
sudo dnf install pcsc-lite-devel openssl-devel pam-devel pcsc-lite
```

### Compile

```bash
cd pam_ntag424/
make
```

This produces `pam_ntag424.so`.

### Verify crypto (no card needed)

```bash
make test_crypto
./test_crypto
```

Expected output:
```
PASS: rfc4493_L
PASS: rfc4493_K1
PASS: rfc4493_K2
PASS: rfc4493_cmac_empty
PASS: rfc4493_cmac_1block
PASS: decrypt_p_rc
PASS: decrypt_p_uid
PASS: decrypt_p_counter
PASS: compute_ct_rc
PASS: verify_cmac_ok
PASS: verify_cmac_bad
PASS: replay_accept
PASS: replay_reject_equal
PASS: replay_reject_lower
PASS: wrong_k1_rejected
15/15 tests passed.
```

---

## Install

```bash
sudo make install          # copies pam_ntag424.so → /lib/security/
sudo make install-config   # copies example config → /etc/security/pam_ntag424.conf
```

---

## Configure

Edit `/etc/security/pam_ntag424.conf`:

```ini
# AES-128 key to decrypt p= (PICCData); shared across all cards from this IssuerKey
k1 = 55da174c9608993dc27bb3f30a4a7314

# AES-128 key to verify c= (SDM MAC); per-card
k2 = f4b404be700ab285e333e32348fa3d3b

# Where per-UID counter state files are stored
state_dir = /var/lib/pam_ntag424

# Optional: substring to select reader by name (blank = first available)
# reader = ACR122U

# Seconds to wait for card tap (default 15)
timeout = 15
```

### Getting K1 and K2 for your card

If your card was programmed with a BoltCard-compatible tool you can derive
K1 and K2 from the IssuerKey and card UID using the key derivation formula
in `docs/boltcard-protocol.md §5`, or use the existing `keygenerator.js` in
this repository:

```bash
node keygenerator.js --issuerKey <hex> --uid <card_uid_hex>
```

---

## PAM configuration

### SSH (keyboard-interactive)

Add to `/etc/pam.d/sshd`:

```
# Require NFC card tap in addition to other factors
auth required pam_ntag424.so
```

And in `/etc/ssh/sshd_config`:

```
UsePAM yes
AuthenticationMethods keyboard-interactive
ChallengeResponseAuthentication yes
```

Restart `sshd`:

```bash
sudo systemctl restart sshd
```

### SSH (optional second factor with password)

```
# /etc/pam.d/sshd
auth required pam_unix.so     # password
auth required pam_ntag424.so  # NFC card
```

This requires both a valid password **and** a valid card tap.

### sudo

```
# /etc/pam.d/sudo
auth required pam_unix.so
auth required pam_ntag424.so
```

---

## Custom config path

Pass `conf=` as a PAM module argument:

```
auth required pam_ntag424.so conf=/home/alice/.config/ntag424.conf
```

---

## State directory

The module stores one small file per card UID:

```
/var/lib/pam_ntag424/
  04a39493cc8680.ctr    ← last accepted counter for this UID
  04e8f2a1bb3344.ctr
```

The directory is created automatically.  Counter files are updated
atomically via `rename(2)` to prevent partial writes.

---

## Security considerations

| Concern | Mitigation |
|---------|-----------|
| Key storage | `/etc/security/pam_ntag424.conf` is `root:root 0640` by default |
| Timing oracle | CMAC comparison uses XOR accumulate (constant-time) |
| Replay attack | Monotonic counter checked; counter file updated atomically |
| Cloning | K1/K2 stored in NTAG424 silicon; cannot be extracted from the card |
| Counter rollover | 24-bit counter = 16M taps per card; no wrap-around risk in practice |
| State file tampering | If `state_dir` is writable by attacker, counter could be reset — secure it with `chmod 700` owned by root |

---

## Hardware requirements

- Any **NXP NTAG424 DNA** card (not NTAG213/215/216 — those lack SDM)
- Any **ISO 14443-4 compatible PC/SC reader** (ACR122U, ACR1252U, SCM SCL3711, etc.)
- The card must be pre-programmed with SDM enabled and K1/K2 set to known values

### Programming the card

Use the companion `boltcard-cloudflareworker` tools, [BoltCardTools](https://github.com/btcpayserver/BTCPayServer.BoltCardTools), or NXP's TagWriter app to program the NTAG424 with:
- SDM enabled on the NDEF file
- PICCData and MAC mirroring enabled
- K1 (encryption) and K2 (MAC) set to your chosen keys
- SDM URL template: `https://<your-host>/auth?p=%PICC%&c=%SDMMAC%`

---

## File overview

| File | Description |
|------|-------------|
| `pam_ntag424.c` | PAM module source (PC/SC + crypto + PAM interface) |
| `test_crypto.c` | Standalone crypto unit tests (RFC 4493 vectors + BoltCard vectors) |
| `Makefile` | Build rules |
| `pam_ntag424.conf.example` | Example configuration file |
| `README.md` | This file |
