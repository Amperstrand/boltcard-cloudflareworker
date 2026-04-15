# BoltCard Protocol Reference

A standalone technical reference for how BoltCards work. Covers the NXP NTAG 424 DNA chip, AES-CMAC cryptography, the `p` and `c` URL parameters, key derivation, LNURL-withdraw flow, and replay protection.

---

## Table of Contents

1. [NXP NTAG 424 DNA](#1-nxp-ntag-424-dna)
2. [AES-CMAC](#2-aes-cmac)
3. [The `p` Parameter (Encrypted UID + Counter)](#3-the-p-parameter-encrypted-uid--counter)
4. [The `c` Parameter (CMAC Verification)](#4-the-c-parameter-cmac-verification)
5. [Key Derivation](#5-key-derivation)
6. [LNURL-Withdraw Flow](#6-lnurl-withdraw-flow)
7. [Counter Replay Protection](#7-counter-replay-protection)
8. [Multi-K1 Key Rotation](#8-multi-k1-key-rotation)
9. [References](#9-references)

---

## 1. NXP NTAG 424 DNA

The BoltCard uses NXP's **NTAG 424 DNA** chip, a 13.56 MHz ISO 14443A NFC tag designed for secure, tamper-evident applications. Its key feature is **Secure Dynamic Messaging (SDM)**, which the NTAG 424 DNA specification calls **SUN** (Secure Unique NFC).

When a compatible reader taps the card, the chip automatically generates a URL containing two cryptographic parameters:

```
https://example.com/?p=<encrypted-payload>&c=<cmac>
```

The card hardware handles encryption and MAC generation internally, using symmetric keys stored in the chip's protected memory. The card never exposes the raw UID or keys during a tap. Instead, each scan produces a fresh, unique `p` and `c` pair tied to the current NFC counter value.

### Chip Security Features

- **7-byte UID** burned in at manufacture, globally unique
- **24-bit monotonically incrementing read counter** stored in EEPROM
- **Five 128-bit AES keys** (K0...K4) stored in protected sectors
- **SUN message authentication** using AES-CMAC over chip UID and counter

The NTAG 424 DNA performs AES-128-ECB encryption and AES-CMAC generation in hardware. The host system (server) must reproduce the same operations to authenticate a tap.

> **Spec reference:** NXP Application Note AN12196 Rev. 2.0, "NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints"
> **See also:** `docs/ntag424_llm_context.md` — implementation-oriented distillation of AN12196

---

## 2. AES-CMAC

AES-CMAC (Cipher-based Message Authentication Code using AES) is the cryptographic primitive underlying both the `p` encryption and `c` verification in BoltCard. It is standardized in **RFC 4493**.

### Algorithm Overview

AES-CMAC takes a 128-bit key `K` and a message `M` of arbitrary length, and returns a 128-bit MAC tag `T`.

```
T := AES-CMAC(K, M)
```

Internally, AES-CMAC uses **AES-128-ECB** as its block cipher. Two subkeys (`K1` and `K2`) are derived from the main key and applied during MAC generation.

### Subkey Generation (Generate_Subkey)

```
L  := AES-128-ECB(K, 0x00...00)   // encrypt a 16-byte zero block

if MSB(L) == 0:
    K1 := L << 1
else:
    K1 := (L << 1) XOR 0x00000000000000000000000000000087

if MSB(K1) == 0:
    K2 := K1 << 1
else:
    K2 := (K1 << 1) XOR 0x00000000000000000000000000000087
```

The constant `0x87` (the `Rb` polynomial) comes from the GF(2^128) field reduction used in the OMAC1 construction.

### MAC Generation

For a 16-byte message `M` (exactly one block, the common case in BoltCard):

```
M_last := M XOR K1
T      := AES-128-ECB(K, M_last)
```

For messages that are not a multiple of 16 bytes, the last block is padded with `0x80` followed by zeros, and `K2` is used instead of `K1`.

### BoltCard's Extended CMAC Computation

The NTAG 424 DNA chip does not produce a plain AES-CMAC over SV2. It computes a **session key** `ks` first, then derives a verification tag `ct` from `ks`. The full chain:

```
ks := AES-CMAC(K2, SV2)
```

Then `ct` is derived from `ks` using an additional CMAC chain (see Section 4 for details).

> **Spec reference:** RFC 4493 "The AES-CMAC Algorithm" - https://datatracker.ietf.org/doc/html/rfc4493

---

## 3. The `p` Parameter (Encrypted UID + Counter)

The `p` parameter is a 16-byte (32 hex character) value produced by the NTAG 424 DNA chip. It encodes the card's UID and current NFC counter, encrypted with **AES-128-ECB** using the card's K1 key.

### Byte Layout of the Plaintext

Before encryption, the plaintext block has this structure:

| Offset | Length | Field       | Value         |
|--------|--------|-------------|---------------|
| 0      | 1      | PICCDataTag | `0xC7`        |
| 1      | 7      | UID         | Card UID bytes 0..6 |
| 8      | 3      | Counter     | 24-bit counter, LSB first (bytes 8,9,10) |
| 11     | 5      | Padding     | Random or zero-filled |

Total: 16 bytes.

PICCDataTag `0xC7` decoded per NXP AN12196 §5.5:
- bit 7 = 1 → UID mirroring enabled
- bit 6 = 1 → SDMReadCtr mirroring enabled
- bits 3..0 = `0111` → UID length = 7 bytes

The counter is stored in **little-endian order**: byte 8 is the least significant byte, byte 10 is the most significant.

### Decryption Procedure

The server decrypts `p` using K1 (AES-128-ECB, no IV, single block):

```
plaintext := AES-128-ECB-DECRYPT(K1, p_bytes)
```

Then validates the structure:

1. `plaintext[0] == 0xC7` (required header byte)
2. `plaintext[1..7]` = UID (7 bytes)
3. `plaintext[8..10]` = counter (LSB first)
4. `plaintext[11..15]` = padding (ignored)

If `plaintext[0] != 0xC7` (PICCDataTag mismatch), decryption failed or the wrong K1 was used.

### Example

Given `p = "4E2E289D945A66BB13377A728884E867"`:

```
decrypt(K1, p_bytes) -> [0xC7, uid[0], uid[1], ..., uid[6], ctr[0], ctr[1], ctr[2], 0x00, 0x00, 0x00, 0x00, 0x00]
```

The extracted values:
- `UID = plaintext[1..7]` (hex)
- `counter = plaintext[10] << 16 | plaintext[9] << 8 | plaintext[8]`

---

## 4. The `c` Parameter (CMAC Verification)

The `c` parameter is an 8-byte (16 hex character) truncated CMAC that proves the tap came from a genuine card holding K2. It's computed by the NTAG 424 DNA chip over a structured session value called **SV2**.

### SV2 Construction

SV2 is a 16-byte block assembled from fixed magic bytes, the UID, and the counter:

| Offset | Length | Field          | Value              |
|--------|--------|----------------|--------------------|
| 0      | 1      | Magic byte 1   | `0x3C`             |
| 1      | 1      | Magic byte 2   | `0xC3`             |
| 2      | 1      | Fixed          | `0x00`             |
| 3      | 1      | Fixed          | `0x01`             |
| 4      | 1      | Fixed          | `0x00`             |
| 5      | 1      | Fixed          | `0x80`             |
| 6      | 7      | UID            | UID bytes 0..6     |
| 13     | 1      | Counter MSB    | `ctr[2]`           |
| 14     | 1      | Counter mid    | `ctr[1]`           |
| 15     | 1      | Counter LSB    | `ctr[0]`           |

Total: 16 bytes.

The counter in SV2 is placed in the same little-endian order as in the `p` plaintext: the code extracts `[decrypted[10], decrypted[9], decrypted[8]]` (big-endian) then places `ctr[2]` at offset 13 (LSB) and `ctr[0]` at offset 15 (MSB), yielding little-endian at positions 13-15. This matches the NXP AN12196 §5.4 SV2 construction where SDMReadCtr bytes are arranged as `[ctr_LSB, ctr_mid, ctr_MSB]`.

### Verification Tag Derivation

The chip computes:

```
ks := AES-CMAC(K2, SV2)          // session key, 16 bytes
```

Then derives `cm` from `ks` using a second CMAC pass over an empty message (per the OMAC1 empty-message path):

```
cm := AES-CMAC(ks, empty_message)
```

This is equivalent to: derive subkeys K1' and K2' from `ks`, pad the empty message as `[0x80, 0x00, ...]`, XOR with K2', encrypt with `ks`.

The final 8-byte verification tag `ct` is extracted from **odd-indexed bytes** of `cm`:

```
ct = [cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]
```

**IMPORTANT — BoltCard truncation differs from NTAG424 standard MACt:**
The standard NTAG424 SDM MACt uses `S14 || S12 || S10 || S8 || S6 || S4 || S2 || S0` (even-indexed bytes, reverse order). The BoltCard protocol uses `[cm[1], cm[3], ..., cm[15]]` (odd-indexed bytes, forward order). Do NOT change this to match the NXP spec — all deployed cards use the BoltCard truncation.

The server independently recomputes this same `ct` from the decrypted UID and counter. If the recomputed `ct` matches the `c` parameter from the URL, the tap is authentic.

---

## 5. Key Derivation

BoltCards use **five 128-bit AES keys** (K0 through K4). These are either generated deterministically from a master IssuerKey, or assigned manually when programming the card.

### K0-K4 Key Roles

| Key | Derivation Base | Role |
|-----|----------------|------|
| K0  | CardKey        | Card master key (NXP file access control) |
| K1  | IssuerKey      | Encrypts the `p` parameter (UID + counter) |
| K2  | CardKey        | Computes the `c` parameter (AES-CMAC verification) |
| K3  | CardKey        | Reserved (NXP SDM read access key) |
| K4  | CardKey        | Reserved (NXP SDM read/write access key) |

K1 is derived directly from the IssuerKey (not from CardKey), which means all cards issued under the same IssuerKey share the same K1. This design allows a single K1 to decrypt the `p` parameter for any card in the fleet without knowing the specific card's UID in advance.

### Key Derivation Formula

```
CardKey := CMAC(IssuerKey, "2d003f75" || UID || version_bytes)

K0 := CMAC(CardKey,  "2d003f76")
K1 := CMAC(IssuerKey, "2d003f77")          // note: uses IssuerKey, not CardKey
K2 := CMAC(CardKey,  "2d003f78")
K3 := CMAC(CardKey,  "2d003f79")
K4 := CMAC(CardKey,  "2d003f7a")
ID := CMAC(IssuerKey, "2d003f7b" || UID)
```

Where:
- `"2d003f75"` etc. are fixed 4-byte hex constants (domain separation tags)
- `UID` is the 7-byte card UID
- `version_bytes` is a 4-byte little-endian version number (default: `1`)
- `CMAC` here means AES-CMAC with a 128-bit key

### Security Properties

Knowing K1 does not reveal K2, and vice versa. Compromising a single card's CardKey exposes K0, K2, K3, K4 for that card only. K1 being shared across cards is intentional but means a leaked K1 allows decrypting `p` from any card, so K1 must be treated as fleet-sensitive.

---

## 6. LNURL-Withdraw Flow

BoltCards implement **LNURL-withdraw** (LUD-03) with the card-specific extensions from **LUD-17**. The full payment flow from tap to settlement:

### Step-by-Step Flow

```
1. NFC Tap
   Card generates URL:
   https://server.example.com/nfc?p=<16-byte-hex>&c=<8-byte-hex>

2. POS App or Wallet reads the URL and makes a GET request to it.

3. Server receives GET /nfc?p=...&c=...
   a. Decode p: AES-128-ECB decrypt with K1 -> extract UID + counter
   b. Validate c: compute SV2, compute CMAC chain with K2, compare ct to c param
   c. Check counter > last_seen_counter (replay protection)
   d. Look up card config by UID (K2, payment limits, etc.)

4. Server responds with LNURL-withdraw JSON (LUD-03):
   {
     "tag": "withdrawRequest",
     "callback": "https://server.example.com/lnurl/cb/<token>",
     "k1": "<c_param_hex>",
     "minWithdrawable": 1000,
     "maxWithdrawable": 10000,
     "defaultDescription": "BoltCard payment"
   }

5. Wallet presents withdrawal dialog to user.
   User confirms amount.

6. Wallet generates a BOLT-11 Lightning invoice and sends:
   GET <callback>?k1=<k1>&pr=<bolt11-invoice>

7. Server validates k1, looks up the pending session, pays the invoice
   via configured Lightning node (CLN, LNbits, etc.).

8. Server responds: {"status": "OK"}

9. Wallet waits for incoming Lightning payment and notifies user.
```

### LNURL-Withdraw JSON Fields

| Field | Type | Description |
|-------|------|-------------|
| `tag` | string | Always `"withdrawRequest"` |
| `callback` | string | URL the wallet POSTs the invoice to |
| `k1` | string | Session token (often the `c` param) |
| `minWithdrawable` | number | Minimum amount in millisatoshis |
| `maxWithdrawable` | number | Maximum amount in millisatoshis |
| `defaultDescription` | string | Pre-filled invoice description |

### LUD-17 URL Scheme

LUD-17 defines the `lnurlw://` scheme as a replacement for `lightning:LNURL...` for LNURL-withdraw. When a POS app or wallet sees:

```
lnurlw://server.example.com/nfc?p=...&c=...
```

It makes a `GET` request to `https://server.example.com/nfc?p=...&c=...`. The `lnurlw://` prefix replaces both the `https://` scheme and the bech32 encoding requirement.

---

## 7. Counter Replay Protection

Each NTAG 424 DNA chip contains a **24-bit read counter** stored in protected EEPROM. The counter:

- Starts at 0 when the card is first programmed
- Increments by 1 on every successful NFC read
- Cannot be reset or decremented (hardware enforced)
- Has a maximum value of 16,777,215 (2^24 - 1)

The counter is embedded in both the `p` payload and the SV2 MAC input, so any replay of a previous tap would fail `c` verification (the counter value would mismatch).

### Server-Side Counter Validation

After successful `p` decryption and `c` verification, the server must:

1. Extract the 24-bit counter from the decrypted `p` payload
2. Look up the last accepted counter for this UID
3. Reject the request if `counter <= last_accepted_counter`
4. Update `last_accepted_counter` to the new counter value on success

This prevents an attacker who captures a valid `?p=...&c=...` URL from replaying it. The NTAG 424 DNA hardware guarantees the counter only moves forward, so a valid signature on counter `N` cannot be forged for counter `N+1` without the K2 key.

### Counter Encoding Details

The 24-bit counter appears in two different byte orders within the protocol:

- In the `p` plaintext (bytes 8-10): **little-endian** (LSB at byte 8)
- In the SV2 block (bytes 13-15): **big-endian** (MSB at byte 13)

The server must handle this correctly when building SV2 from the extracted counter bytes.

---

## 8. Multi-K1 Key Rotation

Since K1 is shared across all cards from the same IssuerKey (rather than being per-card), there are scenarios where a server needs to support multiple K1 values simultaneously:

- **Key rotation**: transitioning from an old IssuerKey to a new one without taking all cards offline
- **Multi-tenant**: serving cards programmed under different IssuerKeys
- **Migration**: gradually re-keying cards as they're tapped

### Multi-K1 Decryption Algorithm

The server maintains an ordered list of K1 candidates. When decrypting `p`:

```
for each K1_candidate in K1_list:
    plaintext := AES-128-ECB-DECRYPT(K1_candidate, p_bytes)
    if plaintext[0] == 0xC7:
        // Found the right K1
        uid     := plaintext[1..7]
        counter := plaintext[8..10]  // LSB first
        return (uid, counter, K1_candidate)

return ERROR  // no K1 produced a valid 0xC7 header
```

The `0xC7` header byte acts as a discriminator. Because the plaintext is AES-encrypted, a wrong K1 will produce pseudorandom garbage where byte 0 is only `0xC7` with probability 1/256. In practice, iterating through a short list of 2-4 candidates is reliable and fast.

### Practical Considerations

- Keep the K1 list short (2-4 entries maximum) to bound decryption latency
- The matching K1 can be recorded per-tap to identify which generation a card belongs to
- K2 is per-card (derived from CardKey), so it changes automatically when the UID-specific CardKey changes

---

## 9. References

The following external specifications define or inform the BoltCard protocol:

| Reference | URL | Description |
|-----------|-----|-------------|
| NXP AN12196 | https://www.nxp.com/docs/en/application-note/AN12196.pdf | NTAG 424 DNA features and SUN message authentication |
| BoltCard spec | https://github.com/boltcard/boltcard | BoltCard server implementation and protocol documentation |
| boltcard.org | https://boltcard.org | BoltCard overview, compatible wallets, and setup guides |
| LUD-03 | https://github.com/lnurl/luds/blob/luds/03.md | LNURL-withdraw base specification (withdrawRequest) |
| LUD-17 | https://github.com/lnurl/luds/blob/luds/17.md | Protocol schemes: lnurlw://, lnurlp://, lnurlc:// |
| RFC 4493 | https://datatracker.ietf.org/doc/html/rfc4493 | The AES-CMAC Algorithm |

---

## Appendix: Quick Reference

### p Parameter Validation Checklist

- [ ] Decode `p` from hex to 16 bytes
- [ ] Decrypt with AES-128-ECB using K1 (try each candidate if using multi-K1)
- [ ] Assert `plaintext[0] == 0xC7`
- [ ] Extract `UID = plaintext[1..7]`
- [ ] Extract `counter = plaintext[8] | (plaintext[9] << 8) | (plaintext[10] << 16)`

### c Parameter Validation Checklist

- [ ] Build SV2: `[0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80, UID[0..6], ctr[2], ctr[1], ctr[0]]`
- [ ] Compute `ks = AES-CMAC(K2, SV2)`
- [ ] Compute `cm = AES-CMAC(ks, empty_message)`
- [ ] Extract `ct` as odd-indexed bytes: `[cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]`
- [ ] Assert `hex(ct) == c_param.toLowerCase()`

### Counter Validation Checklist

- [ ] Extract 24-bit counter from decrypted `p`
- [ ] Look up `last_counter` for this UID
- [ ] Assert `counter > last_counter`
- [ ] Store new `counter` as `last_counter`
