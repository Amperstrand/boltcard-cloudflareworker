# LNBits Integration Modes

This document describes the four ways our Cloudflare Worker can integrate with LNBits for BoltCard payments. Each mode trades off control, key visibility, and complexity differently.

## Mode 1: LNBits as Wallet

LNBits is a payment backend only — similar to how we use Core Lightning REST. Our worker owns the full card lifecycle.

**What our worker does:**
- Decrypt `p` with K1 to extract UID + counter
- Validate CMAC with K2
- Track counter (replay protection) via Durable Objects
- Enforce rate limits and daily spend limits
- Generate `withdrawRequest` LNURL response
- Receive wallet's invoice via LNURL callback
- Call LNBits `POST /api/v1/payments` with `{out: true, bolt11: invoice}` using wallet admin key

**What LNBits does:**
- Pays the invoice from our wallet balance
- Nothing else — no boltcard extension needed

**Key ownership:** Our worker generates and stores all keys (deterministic or random).

**Config example:**
```json
{
  "payment_method": "lnbits_wallet",
  "K2": "...",
  "tx_limit": 1000,
  "daily_limit": 10000,
  "lnbits": {
    "baseurl": "https://demo.lnbits.com",
    "admin_key": "..."
  }
}
```

**Pros:** Full control, counter tracking, rate limiting, no boltcard extension dependency.
**Cons:** Most complex to implement. Requires Durable Objects for counter storage.

**Status:** Not yet implemented.

---

## Mode 2: LNBits Passthrough (LNBits-generated keys)

LNBits owns the card and generates random keys. Our worker relays the card tap.

**What our worker does:**
- Receives `GET /?p=xxx&c=xxx`
- Forwards `?p=&c=` to LNBits `/boltcards/api/v1/scan/<external_id>`
- Relays the response back to the wallet

**What LNBits does:**
- Decrypts `p`, validates CMAC, checks counter
- Enforces rate limits and daily spend limits
- Generates `withdrawRequest` and handles the payment callback
- Pays the invoice

**Key ownership:** LNBits generates and stores all keys. Our worker doesn't know them.

**Config example:**
```json
{
  "payment_method": "proxy",
  "proxy": {
    "baseurl": "https://demo.lnbits.com/boltcards/api/v1/scan/<external_id>"
  }
}
```

**Pros:** Simplest setup. LNBits handles all security. Our worker is a thin relay.
**Cons:** No local counter tracking. No local rate limiting. Fully dependent on LNBits availability.

**Status:** Implemented. Works with optional CMAC validation (if K2 is present in config, we validate locally before forwarding).

---

## Mode 3: LNBits Passthrough (Our deterministic keys)

Same as Mode 2, but the card is provisioned with our deterministic keys instead of LNBits random keys.

**Provisioning flow:**
1. User taps blank card → NFC programmer app sends UID to our worker
2. Our worker generates deterministic K0-K4 from UID + issuer key
3. User creates a card in LNBits boltcard extension, entering our deterministic keys manually (or via API: `POST /boltcards/api/v1/cards` with k0, k1, k2)
4. NFC programmer writes the keys to the card

**What our worker does:**
- Same relay as Mode 2 — forwards `?p=&c=` to LNBits scan endpoint

**What LNBits does:**
- Same as Mode 2 — full crypto validation and payment

**Key ownership:** Our worker generates the keys. LNBits stores them for validation. Both sides can see them.

**Config example:**
```json
{
  "payment_method": "proxy",
  "proxy": {
    "baseurl": "https://demo.lnbits.com/boltcards/api/v1/scan/<external_id>"
  }
}
```

**Pros:** Deterministic keys — card can be reprovisioned without database lookups. Same relay simplicity as Mode 2.
**Cons:** Keys are visible to both our worker and LNBits. Not ideal if you want key isolation.

**Status:** Relay part implemented. Provisioning script to register deterministic keys in LNBits not yet built.

---

## Mode 4: K1-Only Decrypt Relay

We only know K1 (the PICC encryption key), not K2 (the CMAC key). We decrypt `p` to identify the card and route the request, but defer CMAC validation to LNBits.

**What our worker does:**
- Decrypts `p` with K1 to extract UID
- Looks up card config by UID to find the LNBits scan endpoint
- Does NOT validate CMAC (no K2)
- Forwards `?p=&c=` to LNBits
- Sets `X-BoltCard-CMAC-Validated: false` and `X-BoltCard-CMAC-Deferred: true` headers

**What LNBits does:**
- Validates CMAC with K2
- Checks counter, enforces limits
- Handles payment

**Key ownership:** We know K1 only (can be a shared fleet-wide key). LNBits knows K1 and K2.

**Config example:**
```json
{
  "payment_method": "proxy",
  "proxy": {
    "baseurl": "https://demo.lnbits.com/boltcards/api/v1/scan/<external_id>"
  }
}
```
Note: K2 is intentionally omitted from config.

**Pros:** Minimal key exposure. Worker can route cards without being able to forge taps. Scales well — one K1 for many cards.
**Cons:** No local replay protection. Trusts LNBits entirely for security.

**Status:** Implemented. When K2 is absent from config and `payment_method` is `proxy`, CMAC validation is deferred.

---

## Comparison Matrix

| | Mode 1: Wallet | Mode 2: LNBits Keys | Mode 3: Our Keys | Mode 4: K1-Only |
|---|---|---|---|---|
| **Key generation** | Our worker | LNBits random | Our deterministic | Our deterministic or LNBits |
| **Keys we can see** | All (K0-K4) | None | All (K0-K4) | K1 only |
| **CMAC validation** | Our worker | LNBits | LNBits | LNBits |
| **Counter tracking** | Our worker (DO) | LNBits | LNBits | LNBits |
| **Rate limiting** | Our worker | LNBits | LNBits | LNBits |
| **Payment** | LNBits API | LNBits extension | LNBits extension | LNBits extension |
| **Boltcard extension** | Not needed | Required | Required | Required |
| **Durable Objects** | Required | Not needed | Not needed | Not needed |
| **Complexity** | High | Low | Low | Low |
| **Trust model** | We're the verifier | LNBits is the verifier | LNBits is the verifier | LNBits is the verifier |

## LNBits API Reference

### Creating a card with custom keys (Modes 2 & 3)

```bash
curl -X POST https://demo.lnbits.com/boltcards/api/v1/cards \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <your_admin_key>" \
  -d '{
    "uid": "04A39493CC8680",
    "card_name": "Test Card",
    "k0": "a29119fcb48e737d1591d3489557e49b",
    "k1": "55da174c9608993dc27bb3f30a4a7314",
    "k2": "f4b404be700ab285e333e32348fa3d3b",
    "counter": 0,
    "tx_limit": 1000,
    "daily_limit": 10000
  }'
```

Response includes `external_id` which becomes part of the scan URL: `/boltcards/api/v1/scan/<external_id>`.

### Getting card auth URL (for NFC programmer app)

```bash
curl https://demo.lnbits.com/boltcards/api/v1/auth?a=<otp>
```

Returns keys + `lnurlw_base` for the NFC programmer app to write to the card.

### Paying an invoice (Mode 1)

```bash
curl -X POST https://demo.lnbits.com/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <your_admin_key>" \
  -d '{"out": true, "bolt11": "lnbc..."}'
```

### Test instance

`https://demo.lnbits.com` — public testnet LNBits with boltcard extension pre-installed. Create a wallet, get admin key from wallet settings, start testing.
