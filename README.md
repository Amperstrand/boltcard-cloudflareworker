# Boltcard Cloudflare Worker

A Cloudflare Worker that turns NTAG424 NFC cards into a payment system. Two modes:

1. **Lightning boltcard** — standard LNURL-withdraw flow (clnrest, LNBits proxy, fakewallet)
2. **Closed-loop event payments** — cash top-up, tap-to-spend, cash-back refund for festivals and venues

## Live Demo

Deployed at **https://boltcardpoc.psbt.me**

| Page | URL |
|------|-----|
| Operator login | [/operator/login](https://boltcardpoc.psbt.me/operator/login) |
| POS terminal | [/operator/pos](https://boltcardpoc.psbt.me/operator/pos) |
| Top-up desk | [/operator/topup](https://boltcardpoc.psbt.me/operator/topup) |
| Refund desk | [/operator/refund](https://boltcardpoc.psbt.me/operator/refund) |
| Card registry | [/operator/cards](https://boltcardpoc.psbt.me/operator/cards) |
| Debug console | [/debug](https://boltcardpoc.psbt.me/debug) |
| Cardholder dashboard | [/card](https://boltcardpoc.psbt.me/card) |

**Operator PIN for demo**: `1234`

You need a physical NTAG424 card programmed for this worker's issuer key. Cards from other services won't work unless their keys are in the `keys/` directory.

## How It Works

An NTAG424 "bolt card" stores a URL and encrypted payload on its NFC chip. When tapped against a phone, the browser opens the URL with `?p=XXX&c=YYY` parameters containing the card's UID and a rolling counter, encrypted with AES and authenticated with AES-CMAC.

This worker decrypts the card, validates it, and performs the requested action — processing a Lightning payment, crediting a balance, debiting a charge, or refunding.

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
│  │  │ • card idx  │  │ • SQLite (per-card)  │  │  │
│  │  │ • menus     │  │ • balance + txns     │  │  │
│  │  │ • rate limit│  │ • replay counter     │  │  │
│  │  └─────────────┘  └──────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## Payment Methods

| Method | Flow | Required Config |
|--------|------|-----------------|
| `fakewallet` | Internal accounting via DO balance | None |
| `clnrest` | POST to Core Lightning REST API | `host`, `port`, `rune` in card config |
| `proxy` | Relay to downstream LNBits | `baseurl` in card config |
| `lnurlpay` | LNURL-pay flow (POS cards) | `lightning_address` in card config |
| `twofactor` | NFC-based 2FA | OTP generation |

## Card Lifecycle

```
(no DO row) ──────────────────────────────────────────→ legacy (fallback)
     │                                                      │
     │ key fetch (fetchBoltCardKeys)                         │ first tap with known issuer key
     ↓                                                      ↓
   pending ──────── first tap (CMAC validates) ──────→ discovered
     │                                                      │
     │ operator programs via /experimental/activate          │ treated like active for taps
     ↓                                                      ↓
   keys_delivered ──── first tap ────→ active
     │                                    │
     │                                    ├── wipe_requested → active (re-provisioned)
     │                                    ├── terminated
     │                                    └── legacy (no longer created for new cards)
     └── active_version set on activation
```

Every card DO row tracks **key provenance** — where its encryption keys came from:

| Provenance | Meaning |
|---|---|
| `public_issuer` | Key is in `generatedKeyData.js` (git-tracked dev keys, auto-generated) |
| `env_issuer` | Matches `env.ISSUER_KEY` and not public |
| `percard` | Per-card import from CSV |
| `user_provisioned` | Explicitly programmed by user |
| `unknown` | Neither public nor env key |

## Closed-Loop Event Mode

Run a cash-in / tap-to-spend / cash-out system for festivals, funfairs, and small venues.

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

## Operator Auth

All `/operator/*` and `/experimental/*` and `/debug` routes require a shared PIN and HMAC-signed session cookie (12h expiry).

- **Dev**: PIN is `1234`, session secret is built-in
- **Production**: Set `OPERATOR_PIN` and `OPERATOR_SESSION_SECRET` via `wrangler secret put`
- Login attempts are rate-limited to 5 requests per 15 minutes per IP

## Lightning Boltcard Mode

### LNURL-withdraw Flow

1. Card tap → `GET /?p=XXX&c=YYY` → worker decrypts card, returns LNURL-withdraw response
2. Wallet creates invoice, calls back → `GET /boltcards/api/v1/lnurl/cb/...?pr=INVOICE&k1=KEY`
3. Worker processes payment (via configured backend), debits card if fakewallet

### Card Configuration

Cards are configured either via:
- **Deterministic key derivation**: Set `ISSUER_KEY` → all card keys derived from UID automatically
- **Per-card KV**: Store config in KV with the card UID as key

### Key Recovery

This service helps bolt card owners recover cards from defunct services. Tap a card on [/login](https://boltcardpoc.psbt.me/login) — if we have the issuer keys, you'll see them and get a link to wipe and reprogram.

To submit keys for a service, add a CSV file to `keys/` and run `node scripts/build_keys.js`. See [docs/KEY-RECOVERY.md](docs/KEY-RECOVERY.md) for extraction guides covering BTCPayServer and LNBits.

## All Endpoints

### Operator Pages (auth required — PIN `1234` on dev)

| Route | Purpose |
|---|---|
| [/operator/login](https://boltcardpoc.psbt.me/operator/login) | PIN login page |
| [/operator/topup](https://boltcardpoc.psbt.me/operator/topup) | Top-up desk — credit balance to card |
| [/operator/pos](https://boltcardpoc.psbt.me/operator/pos) | POS terminal — free-amount or menu mode |
| [/operator/pos/menu](https://boltcardpoc.psbt.me/operator/pos/menu) | Menu editor — add/edit/remove items |
| [/operator/refund](https://boltcardpoc.psbt.me/operator/refund) | Refund desk — full or partial cash-back |
| [/operator/cards](https://boltcardpoc.psbt.me/operator/cards) | Card registry — view all indexed cards, filter by state |

### Debug & Experimental (auth required)

| Route | Purpose |
|---|---|
| [/debug](https://boltcardpoc.psbt.me/debug) | Unified debug console (Console, Identify, Wipe, 2FA, Identity, POS) |
| [/experimental/activate](https://boltcardpoc.psbt.me/experimental/activate) | Card programming + activation |
| [/experimental/wipe](https://boltcardpoc.psbt.me/experimental/wipe) | Wipe a card — reset to factory |
| [/experimental/bulkwipe](https://boltcardpoc.psbt.me/experimental/bulkwipe) | Bulk card wipe |
| [/experimental/analytics](https://boltcardpoc.psbt.me/experimental/analytics) | Per-card analytics |

### Public Pages (no auth)

| Route | Purpose |
|---|---|
| [/](https://boltcardpoc.psbt.me/) | Card tap entry point (LNURL-withdraw) or login page |
| [/login](https://boltcardpoc.psbt.me/login) | Customer NFC login — key recovery |
| [/card](https://boltcardpoc.psbt.me/card) | Cardholder dashboard — tap to see balance, state, provenance |
| [/identity](https://boltcardpoc.psbt.me/identity) | Identity demo — NFC-based access control |
| [/2fa](https://boltcardpoc.psbt.me/2fa) | 2FA demo — TOTP/HOTP codes from NFC card |

### API Endpoints

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/operator/login` | No | Submit PIN, get session cookie |
| POST | `/operator/logout` | No | Clear session cookie |
| POST | `/operator/topup/apply` | Yes | Credit balance to card |
| POST | `/operator/pos/charge` | Yes | Debit card (POS payment) |
| GET | `/api/pos/menu` | No | Get menu JSON |
| PUT | `/operator/pos/menu` | Yes | Save menu |
| POST | `/operator/refund/apply` | Yes | Refund card balance |
| POST | `/operator/cards/batch` | Yes | Batch terminate/wipe/activate/reprovision |
| POST | `/operator/cards/repair` | Yes | Sync KV card index with DO state |
| GET | `/operator/cards/data` | Yes | Card registry data (JSON, paginated) |
| GET | `/api/fake-invoice?amount=N` | No | Generate fake bolt11/SPAYD/UPI/payto invoice |
| POST | `/api/balance-check` | No | Read card balance |
| POST | `/api/identify-card` | Yes | Operator card identification |
| POST | `/api/identify-issuer-key` | Yes | Tap-to-detect issuer key + version |
| GET | `/card/info` | No | Card status JSON (balance, state, history) |
| POST | `/api/card/lock` | No | Cardholder self-service card lock (CMAC auth) |
| POST | `/api/card/reactivate` | No | Cardholder self-service re-provision |
| GET | `/api/receipt/:txnId` | No | Plain-text transaction receipt |
| GET | `/api/verify-identity?p=X&c=Y` | No | Verify card identity |
| POST | `/api/identity/profile` | No | Update identity profile |
| ALL | `/api/v1/pull-payments/:pullPaymentId/boltcards` | No | Card programming keys |
| GET/POST | `/api/keys` | Yes | Key lookup |
| GET | `/api/bulk-wipe-keys` | Yes | Bulk wipe key data |
| ALL | `/boltcards/api/v1/lnurl/cb/*` | No | LNURL-withdraw callback |
| GET | `/lnurlp/cb` | No | LNURL-pay callback |
| GET | `/experimental/analytics/data` | Yes | Analytics data (JSON) |

### Redirects

| From | To |
|---|---|
| `/pos` | `/operator/pos` |
| `/nfc` | `/debug#console` |
| `/activate` | `/experimental/activate` |
| `/wipe` | `/experimental/wipe` |
| `/bulkwipe` | `/experimental/bulkwipe` |
| `/analytics` | `/experimental/analytics` |

## Security

- **Card validation**: AES-ECB decrypt + AES-CMAC authenticate (RFC 4493) on every tap
- **Replay protection**: Durable Object with SQLite — atomic counter check, strongly consistent, fails closed
- **Double-spend prevention**: Atomic `claimTap` operation in DO — checks and sets `bolt11` in single SQL transaction
- **Operator auth**: HMAC-SHA256 signed session cookies, constant-time PIN comparison, 12h expiry
- **CSRF protection**: Double-submit cookie pattern with timing-safe comparison on all mutating operator endpoints
- **Error sanitization**: Internal error details logged server-side; generic messages returned to clients
- **Header filtering**: Proxy relay filters request/response headers to prevent credential leakage
- **Rate limiting**: IP-based fixed-window (login: 5 req/15min; default: 100 req/min)
- **Security headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy` on all responses
- **XSS prevention**: Zero innerHTML policy — all browser JS uses safe DOM APIs (`textContent`, `createElement`, `replaceChildren`); baseline = 0 (enforced by `scripts/check-innerhtml.js`)
- **No offline mode**: If the worker is unreachable, taps fail

### Production Checklist

- [ ] Set `ISSUER_KEY` via `wrangler secret put` (not the dev key)
- [ ] Set `OPERATOR_PIN` via `wrangler secret put` (not `1234`)
- [ ] Set `OPERATOR_SESSION_SECRET` via `wrangler secret put`
- [ ] Set `CURRENCY_LABEL` and `CURRENCY_DECIMALS` in `wrangler.toml`
- [ ] Set `BOLT_CARD_K1_0` / `BOLT_CARD_K1_1` if using custom decryption keys
- [ ] Test with real NFC hardware

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers enabled
- Wrangler CLI installed

### Install & Run

```bash
git clone <repository-url> && cd boltcard-cloudflareworker
npm install
npm test          # Run unit tests
npm run test:all  # Run all tests (unit + DO + integration)
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

## Testing

```bash
npm test                              # Unit + vitest E2E tests (Vitest, node env)
npm run test:do                       # DO integration tests (real SQLite)
npm run test:integration              # Integration tests (full Worker pipeline)
npm run test:all                      # All three tiers
npx playwright test                   # Playwright E2E (live production)
HEADED=1 npx playwright test          # Playwright with visible browser
npm test -- --testNamePattern="pos"   # Run specific tests
npm test -- --watch                   # Watch mode
npm run deploy                        # tests → build_keys → wrangler deploy
```
├── index.ts                     # Router + security headers + error handling
├── boltCardHelper.ts            # Card decrypt + CMAC validation
├── cryptoutils.ts               # AES-ECB + AES-CMAC primitives
├── getUidConfig.ts              # Card config lookup (DO → deterministic fallback)
├── keygenerator.ts              # Deterministic key derivation from UID + ISSUER_KEY
├── rateLimiter.ts               # IP-based fixed-window rate limiting
├── replayProtection.ts          # Replay check + balance/txn helpers → DO
├── middleware/
│   └── operatorAuth.ts          # PIN auth, session cookies, requireOperator()
├── handlers/                    # 36 route handlers
│   ├── operatorLoginHandler.ts  # PIN login/logout
│   ├── loginHandler.ts          # Customer NFC key recovery + privileged actions
│   ├── loginActions.ts          # Terminate, wipe, top-up action handlers
│   ├── topupHandler.ts          # Top-up desk (credit card)
│   ├── posChargeHandler.ts      # POS direct debit
│   ├── posHandler.ts            # POS page render
│   ├── refundHandler.ts         # Full/partial refund
│   ├── lnurlwHandler.ts         # LNURL-withdraw tap processing
│   ├── lnurlHandler.ts          # LNURL-withdraw callback (payment processing)
│   ├── lnurlPayHandler.ts       # LNURL-pay flow
│   ├── proxyHandler.ts          # Downstream LNBits relay (with header filtering)
│   ├── fetchBoltCardKeys.ts     # Card provisioning + key delivery
│   ├── withdrawHandler.ts       # Withdraw response construction
│   ├── activateCardHandler.ts   # Quick-activate UID
│   ├── activatePageHandler.ts   # Card activation page
│   ├── bolt11DecodeHandler.ts   # BOLT11 invoice decode page + API
│   ├── resetHandler.ts          # Card wipe/reset
│   ├── wipePageHandler.ts       # Wipe page
│   ├── bulkWipeHandler.ts       # Bulk wipe key candidates
│   ├── bulkWipePageHandler.ts   # Bulk wipe page
│   ├── balanceCheckHandler.ts   # Read-only balance check
│   ├── menuEditorHandler.ts     # Menu editor page + API
│   ├── menuHandler.ts           # Menu storage
│   ├── receiptHandler.ts        # Plain-text receipt
│   ├── cardAuditHandler.ts      # Card registry audit page + data API
│   ├── cardDashboardHandler.ts  # Cardholder dashboard (NFC scan)
│   ├── cardBatchHandler.ts      # Batch card operations
│   ├── debugHandler.ts          # Debug dashboard
│   ├── identityHandler.ts       # Identity/access control demo
│   ├── twoFactorHandler.ts      # 2FA TOTP/HOTP
│   ├── analyticsHandler.ts      # Per-card analytics
│   ├── getKeysHandler.ts        # Key listing + bulk wipe
│   ├── identifyCardHandler.ts   # Card identification
│   ├── identifyIssuerKeyHandler.ts # Tap-to-detect issuer key
│   ├── fakeInvoiceHandler.ts   # Fake bolt11/SPAYD/UPI/payto generation
│   └── statusHandler.ts         # Health check
├── static/js/                   # 17 browser JS files (classic scripts, no ES modules)
│   ├── registry.ts              # serveStaticJs() router for /static/js/*
│   ├── exports.ts               # All JS content as string constants with SHA-256 hashes
│   ├── nfc.js                   # Web NFC scanner helpers
│   ├── helpers.js               # Shared browser utilities (esc, data-action delegation)
│   ├── csrf.js                  # CSRF token management
│   └── ... (per-page JS files)
├── templates/                   # 18 HTML pages (Tailwind CSS, rawHtml tagged template)
│   ├── pageShell.ts             # Shared Tailwind page wrapper
│   ├── loginPage.ts             # NFC key recovery page
│   ├── operatorLoginPage.ts     # PIN login form
│   ├── posPage.ts               # POS with free-amount + menu modes
│   ├── topupPage.ts             # Top-up keypad + NFC
│   ├── refundPage.ts            # Refund desk
│   ├── menuEditorPage.ts        # Menu editor
│   ├── cardDashboardPage.ts     # Cardholder dashboard
│   ├── cardAuditPage.ts         # Card registry audit
│   ├── debugConsolePage.ts      # Debug console
│   ├── identityPage.ts          # Identity demo
│   ├── activatePage.ts          # Card activation
│   ├── analyticsPage.ts         # Analytics dashboard
│   ├── bulkWipePage.ts          # Bulk wipe
│   ├── wipePage.ts              # Card wipe
│   ├── twoFactorPage.ts         # 2FA codes display
│   ├── bolt11DecodePage.ts      # BOLT11 invoice decoder
│   └── operatorShared.ts        # Shared operator page helpers
├── utils/                       # 20 utility modules
│   ├── bolt11.ts                # BOLT11 invoice generation (@noble/secp256k1)
│   ├── cardAuth.ts              # Shared decrypt→state→config→CMAC pipeline
│   ├── cardIndex.ts             # KV-backed card registry (indexCard, listIndexedCards)
│   ├── cardMatching.ts          # Shared card issuer detection
│   ├── cmacScan.ts              # Multi-version CMAC scan engine
│   ├── constants.ts             # CARD_STATE, PAYMENT_METHOD, numeric constants
│   ├── cookies.ts               # Cookie parsing + constantTimeEqual
│   ├── currency.ts              # Currency label formatting/parsing
│   ├── escapeHtml.ts            # HTML escaping utility
│   ├── generatedKeyData.js      # Git-tracked dev key sets (auto-generated)
│   ├── history.ts               # Unified tap + transaction history
│   ├── keyLookup.ts             # Issuer key candidates + per-card key lookup
│   ├── lightningAddress.ts      # Lightning address resolution
│   ├── logger.ts                # Structured JSON logger
│   ├── otp.ts                   # HOTP/TOTP generation
│   ├── rawTemplate.ts           # Raw HTML template helper
│   ├── responses.ts             # Shared response builders (errorResponse, redirect, etc.)
│   ├── auditLog.ts              # KV-backed persistent audit log
│   ├── validateCardTap.ts       # Card tap validation for operator handlers
│   └── validation.ts            # Input validation (validateUid, getRequestOrigin)
├── durableObjects/
│   ├── CardReplayDO.ts          # Thin Durable Object shell + route dispatcher
│   └── cardReplay/              # DO schema + route handlers grouped by responsibility
│       ├── routes.ts            # Typed DO route contract map (compile-time drift detection)
│       ├── schema.ts            # SQLite table creation + idempotent migrations
│       ├── tapHandlers.ts       # Counter replay, tap recording, analytics
│       ├── cardStateHandlers.ts # Lifecycle transitions and discovery
│       ├── configHandlers.ts    # K2/payment method config
│       ├── balanceHandlers.ts   # Balance + transaction ledger
│       └── types.ts             # DO payload/row types
├── tests/                       # Unit + integration + DO tests across all tiers
│   ├── testHelpers.ts           # virtualTap, buildCardTestEnv, TEST_OPERATOR_AUTH
│   ├── replayNamespace.ts       # In-memory DO mock with balance enforcement
│   ├── adversarial.test.ts      # adversarial tests: replay, double-spend, overdraft, XSS, open redirect
│   ├── e2e/                     # End-to-end tests
│   │   ├── providers/           # CardProvider interface — virtual (browser JS hooks) and USB (pcscd bridge)
│   │   ├── helpers.ts           # Shared Playwright helpers (operatorLogin, financial API wrappers)
│   │   ├── virtual-card.test.ts # Full NFC lifecycle
│   │   ├── pages.test.ts        # Page rendering + security headers
│   │   ├── financial-flows.spec.ts  # Financial operations against live production
│   │   ├── virtual-card.spec.ts     # Virtual card simulator UI lifecycle
│   │   └── operator-ui.spec.ts      # Operator page rendering and auth flows
│   ├── integration/             # Integration tests (full Worker pipeline, miniflare)
│   │   ├── helpers.ts           # apiFetch, operatorLogin, provisionCard, etc.
│   │   ├── lifecycle.test.ts    # Card state machine transitions
│   │   ├── adversarial.test.ts  # Replay, double-spend, overdraft, wrong CMAC
│   │   ├── load.test.ts         # Concurrent POS charges, LNURL callbacks
│   │   ├── csrf.test.ts         # CSRF protection, auth, batch operations
│   │   └── nfc-flow.test.ts     # Full NFC flow simulation, card discovery
│   └── do/                      # DO integration tests (real SQLite)
│       └── cardReplayDO.real.test.ts # 52 tests via @cloudflare/vitest-pool-workers
├── keys/                        # Key recovery CSV files
├── docs/
│   ├── VENUE-DEPLOYMENT.md      # Venue setup guide
│   └── OPERATOR-GUIDE.md        # Operator quick-start
└── scripts/
    └── build_keys.js            # Compile keys/*.csv → generatedKeyData.js
```

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
| `UID_CONFIG` | KV | Card configs, menus, card index, rate limits |
| `CARD_REPLAY` | Durable Object | Per-card SQLite: balance, transactions, replay counter |
| `RATE_LIMITS` | KV (optional) | IP-based rate limit counters |

## Dependencies — Known Quirks

- `@noble/secp256k1` v3: requires explicit hash injection at module load (done in `utils/bolt11.ts`)
- `@noble/hashes`: import paths MUST include `.js` extension (e.g., `"@noble/hashes/sha2.js"`)
- `@scure/base`: bech32 lives here (not `@scure/bech32`), and `bech32.encode()` has a 90-char default limit — pass `1024` as 3rd arg for bolt11
- `aes-js`: kept intentionally — do not switch to `node:crypto`-dependent libraries
- `@cloudflare/vitest-pool-workers`: Miniflare's `sql.exec().rowsAffected` is unreliable — use `RETURNING` clause instead

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
| `wrangler kv key get` shows empty | KV cross-edge propagation delay | Use `/operator/cards` to verify instead |

## Documentation

- [Venue Deployment Guide](docs/VENUE-DEPLOYMENT.md) — full setup from zero to running event
- [Operator Quick-Start Guide](docs/OPERATOR-GUIDE.md) — day-of-event workflows
- [Agent Context](AGENTS.md) — full technical reference for AI-assisted development

## License

See [LICENSE](LICENSE) for details.
