# Boltcard Cloudflare Worker

A Cloudflare Worker that turns NTAG424 NFC cards into a payment system. Two modes:

1. **Lightning boltcard** — standard LNURL-withdraw flow (clnrest, LNBits proxy, fakewallet)
2. **Closed-loop event payments** — cash top-up, tap-to-spend, cash-back refund for festivals and venues

## What Is This?

An NTAG424 "bolt card" stores a URL and encrypted payload on its NFC chip. When tapped against a phone, the browser opens the URL with `?p=XXX&c=YYY` parameters containing the card's UID and a rolling counter, encrypted with AES and authenticated with AES-CMAC.

This worker decrypts the card, validates it, and performs the requested action — processing a Lightning payment, crediting a balance, debiting a charge, or refunding.

## Live Demo

Deployed at **https://boltcardpoc.psbt.me**

### Dev Defaults

The deployed instance uses development fallbacks for testing. **Do not use these in production.**

| Setting | Dev Fallback | Set via |
|---|---|---|
| ISSUER_KEY | `00000000000000000000000000000001` | `wrangler secret put ISSUER_KEY` |
| K1 decryption keys | Built-in dev keys | `wrangler secret put BOLT_CARD_K1_0` / `BOLT_CARD_K1_1` |
| Operator PIN | `1234` | `wrangler secret put OPERATOR_PIN` |
| Session secret | Built-in dev value | `wrangler secret put OPERATOR_SESSION_SECRET` |
| Currency | `credits` (0 decimals) | `wrangler.toml` `[vars] CURRENCY_LABEL` |

### Try It Out

1. **Log in**: Go to [/operator/login](https://boltcardpoc.psbt.me/operator/login), enter PIN `1234`
2. **Top-up a card**: [/operator/topup](https://boltcardpoc.psbt.me/operator/topup) — tap a programmed NTAG424 card
3. **Charge at POS**: [/operator/pos](https://boltcardpoc.psbt.me/operator/pos) — tap the same card to debit
4. **Refund**: [/operator/refund](https://boltcardpoc.psbt.me/operator/refund) — tap to see balance, refund

You need a physical NTAG424 card programmed for this worker's issuer key. Cards from other LNBits/boltcard services won't work unless their keys are in the `keys/` directory.

## All Endpoints

### Operator Pages (auth required — PIN `1234` on dev)

| Route | Purpose |
|---|---|
| [/operator/login](https://boltcardpoc.psbt.me/operator/login) | PIN login page |
| [/operator/topup](https://boltcardpoc.psbt.me/operator/topup) | Top-up desk — credit balance to card |
| [/operator/pos](https://boltcardpoc.psbt.me/operator/pos) | POS terminal — free-amount or menu mode |
| [/operator/pos/menu](https://boltcardpoc.psbt.me/operator/pos/menu) | Menu editor — add/edit/remove items per terminal |
| [/operator/refund](https://boltcardpoc.psbt.me/operator/refund) | Refund desk — full or partial cash-back |
| [/operator](https://boltcardpoc.psbt.me/operator) | Redirects to POS |

### Debug & Experimental Tools (auth required)

| Route | Purpose |
|---|---|
| [/debug](https://boltcardpoc.psbt.me/debug) | Card debug dashboard — inspect state, taps, config |
| [/experimental/nfc](https://boltcardpoc.psbt.me/experimental/nfc) | NFC test console — raw card communication |
| [/experimental/activate](https://boltcardpoc.psbt.me/experimental/activate) | Card programming — enter UID, get keys + QR |
| [/experimental/wipe](https://boltcardpoc.psbt.me/experimental/wipe) | Wipe a card — reset to factory for reprogramming |
| [/experimental/bulkwipe](https://boltcardpoc.psbt.me/experimental/bulkwipe) | Bulk card wipe — wipe multiple cards at once |
| [/experimental/analytics](https://boltcardpoc.psbt.me/experimental/analytics) | Per-card analytics — transaction history, balance |

### Public Pages (no auth)

| Route | Purpose |
|---|---|
| [/](https://boltcardpoc.psbt.me/) | Card tap entry point — LNURL-withdraw step 1 (or login page if no params) |
| [/login](https://boltcardpoc.psbt.me/login) | Customer NFC login — key recovery for bolt card owners |
| [/identity](https://boltcardpoc.psbt.me/identity) | Identity demo — NFC-based access control with fake profiles |
| [/2fa](https://boltcardpoc.psbt.me/2fa) | 2FA demo — TOTP/HOTP codes from NFC card |

### API Endpoints

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/operator/login` | No | Submit PIN, get session cookie |
| POST | `/operator/logout` | No | Clear session cookie |
| POST | `/operator/topup/apply` | Yes | Credit balance to card |
| POST | `/operator/pos/charge` | Yes | Debit card (POS payment) |
| GET | `/operator/pos/menu` | Yes | Menu editor page |
| PUT | `/operator/pos/menu` | Yes | Save menu |
| GET | `/api/pos/menu` | Yes | Get menu JSON |
| POST | `/operator/refund/apply` | Yes | Refund card balance |
| POST | `/api/balance-check` | No | Read card balance without auth |
| POST | `/api/identify-card` | Yes | Operator card identification |
| POST | `/api/identify-issuer-key` | Yes | Tap-to-detect issuer key + version |
| GET | `/api/receipt/:txnId` | Yes | Plain-text receipt for a transaction |
| GET | `/api/fake-invoice?amount=N` | No | Generate fake BOLT11 invoice |
| GET | `/api/verify-identity?p=X&c=Y` | No | Verify card identity |
| POST | `/api/identity/profile` | No | Update identity profile |
| POST | `/api/v1/pull-payments/:id/boltcards` | Yes | Card programming keys |
| GET | `/api/keys` | Yes | Key lookup |
| POST | `/api/keys` | Yes | Key lookup |
| GET | `/api/bulk-wipe-keys` | Yes | Bulk key wipe data |
| GET | `/boltcards/api/v1/lnurl/cb/*` | No | LNURL-withdraw callback (step 2) |
| GET | `/lnurlp/cb` | No | LNURL-pay callback |

### Redirects

| From | To | Type |
|---|---|---|
| `/pos` | `/operator/pos` | 302 |
| `/nfc` | `/experimental/nfc` | 301 |
| `/activate` | `/experimental/activate` | 301 |
| `/activate/form` | `/experimental/activate/form` | 301 |
| `/wipe` | `/experimental/wipe` | 301 |
| `/bulkwipe` | `/experimental/bulkwipe` | 301 |
| `/analytics` | `/experimental/analytics` | 301 |

## Closed-Loop Event Mode

Run a cash-in / tap-to-spend / cash-out system for festivals, funfairs, and small venues. No real fiat rails, no KYC, no compliance — just an internal ledger with configurable denomination labels.

### How It Works

```
Attendee arrives with cash
        │
        ▼
  ┌─────────────┐
  │  Top-Up Desk │  Credit balance to card via NFC tap
  │ /operator/   │
  │   topup      │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ POS Terminal │  Debit balance via NFC tap
  │ /operator/   │  Free-amount mode or menu mode
  │   pos        │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ Refund Desk  │  Cash out remaining balance
  │ /operator/   │  Full or partial refund
  │   refund     │
  └─────────────┘
```

All three desks use the same card validation: decrypt payload → validate CMAC → check replay counter → credit/debit Durable Object.

### Currency Config

Set in `wrangler.toml` `[vars]`:

```toml
CURRENCY_LABEL = "GBP"       # Display name: "GBP", "tokens", "EUR", "credits"
CURRENCY_DECIMALS = "2"      # 0 = whole numbers, 2 = cents/pence
MAX_TOPUP_AMOUNT = "50000"   # Optional cap per top-up (in minor units)
```

Examples:
- Festival tokens: `CURRENCY_LABEL = "tokens"`, `CURRENCY_DECIMALS = "0"` → top up 50 tokens, send amount `50`
- UK Pounds: `CURRENCY_LABEL = "GBP"`, `CURRENCY_DECIMALS = "2"` → top up £10.00, send amount `1000`

### Operator Auth

All `/operator/*` and `/experimental/*` and `/debug` routes require a shared PIN and HMAC-signed session cookie (12h expiry).

- **Dev**: PIN is `1234`, session secret is built-in
- **Production**: Set `OPERATOR_PIN` and `OPERATOR_SESSION_SECRET` via `wrangler secret put`
- Login attempts are rate-limited to 10/minute per IP

### Documentation

- [Venue Deployment Guide](docs/VENUE-DEPLOYMENT.md) — full setup from zero to running event
- [Operator Quick-Start Guide](docs/OPERATOR-GUIDE.md) — day-of-event workflows

## Lightning Boltcard Mode

The original boltcard LNURL-withdraw flow. Supports three payment backends:

### Payment Methods

| Method | Description | Required Config |
|---|---|---|
| `fakewallet` | Internal accounting, no external node needed | None |
| `clnrest` | Core Lightning REST API | `host`, `port`, `rune` in card config |
| `proxy` | Relay to downstream LNBits | `baseurl` in card config |
| `lnurlpay` | LNURL-pay to a Lightning address | `lightning_address` in card config |

### LNURL-withdraw Flow

1. Card tap → `GET /?p=XXX&c=YYY` → worker decrypts card, returns LNURL-withdraw response
2. Wallet creates invoice, calls back → `GET /boltcards/api/v1/lnurl/cb/...?pr=INVOICE&k1=KEY`
3. Worker processes payment (via configured backend), debits card if fakewallet

### Card Configuration

Cards are configured either via:
- **Deterministic key derivation**: Set `ISSUER_KEY` → all card keys derived from UID automatically
- **Per-card KV**: Store config in KV with the card UID as key
- **Static config**: Hardcoded in `getUidConfig.js` (dev/testing)

Config example:
```javascript
{
  "04aabbccdd7788": {
    K2: "EFCF2DD0528E57FF2E674E76DFC6B3B1",
    payment_method: "fakewallet"
  }
}
```

## Card Lifecycle

```
new → keys_delivered → active → (wipe_requested → active) | terminated
```

- `new` cards auto-activate on first tap (get `activeVersion=1`)
- Cards can be wiped via `/experimental/wipe` and reprogrammed
- Replay counters reset on wipe

## Key Recovery

This service helps bolt card owners recover cards from defunct services. Tap a card on [/login](https://boltcardpoc.psbt.me/login) — if we have the issuer keys, you'll see them and get a link to wipe and reprogram.

To submit keys for a service, add a CSV file to `keys/` and run `node scripts/build_keys.js`. See [VENUE-DEPLOYMENT.md](docs/VENUE-DEPLOYMENT.md) or [guide.md](guide.md) for details.

## Architecture

```
                    ┌─────────────────────┐
                    │   NTAG424 NFC Card  │
                    │  (URL + AES payload)│
                    └──────────┬──────────┘
                               │ tap
                               ▼
┌──────────────────────────────────────────────────┐
│              Cloudflare Worker                    │
│                                                    │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   itty-router │  │  middleware/operatorAuth  │  │
│  │   (routing)   │→│  (PIN + session cookie)  │  │
│  └──────┬───────┘  └──────────────────────────┘  │
│         │                                          │
│  ┌──────▼──────────────────────────────────────┐  │
│  │              Route Handlers                  │  │
│  │  topup · posCharge · refund · balanceCheck  │  │
│  │  lnurlw · lnurlp · identity · 2fa · debug   │  │
│  └──────┬──────────────────────────────────────┘  │
│         │                                          │
│  ┌──────▼───────┐  ┌──────────────┐               │
│  │ cryptoutils  │  │ keygenerator  │               │
│  │ (AES + CMAC) │  │ (deterministic│               │
│  │              │  │  key deriv.)  │               │
│  └──────────────┘  └──────────────┘               │
│         │                                          │
│  ┌──────▼──────────────────────────────────────┐  │
│  │          Storage Layer                       │  │
│  │  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │ KV          │  │ Durable Object       │  │  │
│  │  │ • card cfg  │  │ CardReplayDO         │  │  │
│  │  │ • menus     │  │ • SQLite (per-card)  │  │  │
│  │  │ • rate limit│  │ • balance + txns     │  │  │
│  │  └─────────────┘  │ • replay counter     │  │  │
│  │                   └──────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers enabled
- Wrangler CLI installed

### Install & Run

```bash
git clone <repository-url> && cd boltcard-cloudflareworker
npm install
npm test          # Run tests
npm run deploy    # tests → build_keys → wrangler deploy
```

### Deploy to a New Venue

1. Fork the repo
2. Edit `wrangler.toml`: change `name`, set `routes`, configure `CURRENCY_LABEL`/`CURRENCY_DECIMALS`
3. Create KV namespace: `wrangler kv:namespace create "UID_CONFIG"`, put the ID in `wrangler.toml`
4. Set secrets: `wrangler secret put ISSUER_KEY` and `wrangler secret put OPERATOR_PIN`
5. Program NTAG424 cards with the card URL (e.g., `https://pay.yourvenue.com/`)
6. Deploy: `npm run deploy`

See [docs/VENUE-DEPLOYMENT.md](docs/VENUE-DEPLOYMENT.md) for the full guide.

## Security

- **Card validation**: AES-ECB decrypt + AES-CMAC authenticate (RFC 4493) on every tap
- **Replay protection**: Durable Object with SQLite — atomic counter check, strongly consistent, fails closed
- **Operator auth**: HMAC-SHA256 signed session cookies, constant-time PIN comparison, 12h expiry
- **Rate limiting**: IP-based fixed-window (login: 5 req/15min; default: 100 req/min; optional via KV)
- **No offline mode**: If the worker is unreachable, taps fail

### Production Checklist

- [ ] Set `ISSUER_KEY` via `wrangler secret put` (not the dev key)
- [ ] Set `OPERATOR_PIN` via `wrangler secret put` (not `1234`)
- [ ] Set `OPERATOR_SESSION_SECRET` via `wrangler secret put`
- [ ] Set `CURRENCY_LABEL` and `CURRENCY_DECIMALS` in `wrangler.toml`
- [ ] Set `BOLT_CARD_K1_0` / `BOLT_CARD_K1_1` if using custom decryption keys
- [ ] Test with real NFC hardware
- [ ] Enable rate limiting KV namespace (optional)

## Environment Variables

### Secrets (set via `wrangler secret put`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `ISSUER_KEY` | No | `00000000000000000000000000000001` | 16-byte hex master key for deterministic card key derivation |
| `OPERATOR_PIN` | No | `1234` | Shared operator PIN (min 4 chars) |
| `OPERATOR_SESSION_SECRET` | No | Built-in dev value | HMAC key for signing session cookies |
| `BOLT_CARD_K1_0` | No | Dev key | First K1 decryption key |
| `BOLT_CARD_K1_1` | No | Dev key | Second K1 decryption key |

### Config (set in `wrangler.toml` `[vars]`)

| Variable | Default | Description |
|---|---|---|
| `CURRENCY_LABEL` | `credits` | Display name for amounts |
| `CURRENCY_DECIMALS` | `0` | Decimal places (0 = whole numbers, 2 = cents) |
| `MAX_TOPUP_AMOUNT` | unlimited | Max single top-up in minor units |

### Bindings (set in `wrangler.toml`)

| Binding | Type | Description |
|---|---|---|
| `UID_CONFIG` | KV | Card configs, menus, rate limits |
| `CARD_REPLAY` | Durable Object | Per-card SQLite: balance, transactions, replay counter |
| `RATE_LIMITS` | KV (optional) | IP-based rate limit counters |

## Testing

```bash
npm test                              # Run all tests
npm test -- --testNamePattern="pos"   # Run specific test pattern
npm test -- --watch                   # Watch mode
```

## Project Structure

```
├── index.js                     # Router + LNURL-withdraw handler
├── boltCardHelper.js            # Card decrypt + CMAC validation
├── cryptoutils.js               # AES-ECB + AES-CMAC primitives
├── getUidConfig.js              # Card config lookup (DO → deterministic fallback)
├── keygenerator.js              # Deterministic key derivation from UID + ISSUER_KEY
├── rateLimiter.js               # IP-based fixed-window rate limiting
├── replayProtection.js          # Replay check + balance/txn helpers → DO
├── middleware/
│   └── operatorAuth.js          # PIN auth, session cookies, requireOperator()
├── handlers/
│   ├── operatorLoginHandler.js  # PIN login/logout
│   ├── topupHandler.js          # Top-up desk (credit card)
│   ├── posChargeHandler.js      # POS direct debit
│   ├── posHandler.js            # POS page render
│   ├── refundHandler.js         # Full/partial refund
│   ├── balanceCheckHandler.js   # Read-only balance check
│   ├── menuHandler.js           # KV-backed menu CRUD
│   ├── menuEditorHandler.js     # Menu editor page + API
│   ├── receiptHandler.js        # Plain-text receipt
│   ├── debugHandler.js          # Debug dashboard
│   ├── identityHandler.js       # Identity demo
│   ├── twoFactorHandler.js      # 2FA TOTP/HOTP
│   ├── loginHandler.js          # Customer NFC key recovery
│   ├── lnurlHandler.js          # LNURL-withdraw callback
│   ├── lnurlPayHandler.js       # LNURL-pay flow
│   └── ...
├── templates/                   # HTML pages (Tailwind CSS)
│   ├── topupPage.js             # Top-up keypad + NFC
│   ├── posPage.js               # POS with free-amount + menu modes
│   ├── refundPage.js            # Refund desk
│   ├── menuEditorPage.js        # Menu editor
│   ├── operatorLoginPage.js     # PIN login form
│   ├── debugPage.js             # Debug dashboard
│   └── ...
├── utils/
│   ├── bolt11.js                # BOLT11 invoice generation (@noble/secp256k1)
│   ├── currency.js              # Currency label formatting/parsing
│   └── ...
├── durableObjects/
│   └── CardReplayDO.js          # Per-card SQLite DO (balance, txns, counter)
├── tests/                       # Tests across 25+ suites
├── keys/                        # Key recovery CSV files
├── docs/
│   ├── VENUE-DEPLOYMENT.md      # Venue setup guide
│   └── OPERATOR-GUIDE.md        # Operator quick-start
└── guide.md                     # Card programming instructions
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| "Could not read card" | Card not programmed or wrong ISSUER_KEY | Reprogram card with correct key |
| "CMAC validation failed" | Card keys don't match | Wipe and reprogram |
| "Replay detected" | Counter already used (normal) | Tap again — counter auto-increments |
| "Insufficient balance" (402) | Not enough funds | Top up first |
| "Rate limited" on login | Too many failed PIN attempts | Wait 15 minutes |
| Operator pages redirect to login | Session expired (12h) | Re-enter PIN |
| Web NFC not working | Browser/device unsupported | Use Chrome on Android, or USB reader on desktop |
| USB reader not working | Not in keyboard-wedge mode | Check reader docs, install drivers |

## Dependencies — Known Quirks

- `@noble/secp256k1` v3: requires explicit hash injection at module load (done in `utils/bolt11.js`)
- `@noble/hashes`: import paths MUST include `.js` extension (e.g., `"@noble/hashes/sha2.js"`)
- `@scure/base`: bech32 lives here (not `@scure/bech32`), and `bech32.encode()` has a 90-char default limit — pass `1024` as 3rd arg for bolt11
- `aes-js`: kept intentionally — do not switch to `node:crypto`-dependent libraries

## License

See [LICENSE](LICENSE) for details.
