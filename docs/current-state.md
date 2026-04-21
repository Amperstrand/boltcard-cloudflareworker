# Current Project State: boltcard-cloudflareworker

> Last updated: 2026-04-21.

---

## Architecture

### Overview

Cloudflare Worker at `https://boltcardpoc.psbt.me` for NFC bolt card payments using NTAG 424 DNA chips. Handles LNURL-withdraw, LNURL-pay (POS), and 2FA card types. Card configs and lifecycle state stored in Durable Objects (SQLite). Landing page serves NFC login for both deployed and undeployed cards.

### Request Flow: NFC Tap to Payment

```
NFC Card Tap
    |
    | NDEF record: lnurlw://<domain>/?p=<hex>&c=<hex>
    v
Phone converts lnurlw:// -> https:// and fetches URL
    |
    v
CF Worker (index.js, itty-router)
    |
    | pathname === "/" with ?p and ?c params
    v
extractUIDAndCounter(pHex)                    [boltCardHelper.js]
    |
    | AES-ECB decrypt with K1 keys            [cryptoutils.js decryptP]
    | Returns { uidHex, ctr }
    v
getUidConfig(uidHex, env)                     [getUidConfig.js]
    |
    | 1. Try DO (card_config table)
    | 2. Fall back to getDeterministicKeys()
    v
Card lifecycle check                          [CardReplayDO via replayProtection.js]
    |
    | terminated -> 403
    | keys_delivered -> detectCardVersion, activateCard
    | active -> use active_version
    | new -> legacy-active (version 1)
    v
validate_cmac(uidBytes, ctr, cHex, k2Bytes)   [boltCardHelper.js]
    |
    v
Payment dispatch by config.payment_method
    |
    |-- "proxy"      -> handleProxy()         [handlers/proxyHandler.js]
    |-- "clnrest"    -> constructWithdrawResponse() [handlers/withdrawHandler.js]
    |-- "fakewallet" -> constructWithdrawResponse() [handlers/withdrawHandler.js]
    |-- "lnurlpay"   -> constructPayRequest()       [handlers/lnurlPayHandler.js]
    |-- "twofactor"  -> OTP codes                [handlers/twoFactorHandler.js]
```

### Request Flow: NFC Login (Landing Page)

```
NFC Card Tap
    |
    | Has NDEF URL record?
    |   YES -> extract p/c -> POST /login {p, c}
    |   NO  -> extract serialNumber -> POST /login {uid}
    v
handleLoginVerify                              [handlers/loginHandler.js]
    |
    | {p, c} path: decrypt, validate CMAC, get config, card state
    | {uid} path: derive preview keys, get card state
    v
Response determines view:
    |
    |-- deployed=false -> undeployed view (preview keys, provision button)
    |-- deployed=true, cardState=keys_delivered -> private + programming QR
    |-- deployed=true, cardState=active -> private card (wipe keys behind button)
    |-- deployed=true, cardState=wipe_requested -> private + "pending wipe" status
    |-- deployed=true, cardState=terminated -> terminated view (re-provision)
    |-- UID-only, cardState=active -> "card appears wiped" detection
    |-- UID-only, cardState=wipe_requested -> auto-confirm wipe -> terminated
    |-- compromised   -> public view (recovered keys from CSV dump)
```

### Request Flow: Identity Verification

```
User taps card on /identity page (Web NFC)
    |
    | Reads NDEF URL → extracts p and c params
    v
GET /api/verify-identity?p=XXX&c=YYY
    |
    v
extractUIDAndCounter(pHex)                    [boltCardHelper.js]
    |
    | AES-ECB decrypt with K1 keys
    v
validate_cmac(uidBytes, ctr, cHex, k2Bytes)   [boltCardHelper.js]
    |
    v
Check KV enrollment (UID_CONFIG)
    |
    |-- No KV entry (deterministic fallback card) → { verified: false, reason: "Card not enrolled" }
    |-- KV entry found → { verified: true, uid, maskedUid }
    v
Frontend shows deterministic fake profile (name, role, department, clearance)
    derived from UID hash
```

Only cards with explicit KV entries pass identity verification. Deterministic fallback cards are rejected to prevent unauthorized access.

### Wipe Detection (UID-only tap on active card)

When a card is tapped and only the UID is read (no NDEF URL record), but the card is registered as "active" in the system, it means the NDEF was erased — the card was physically wiped or factory reset outside our system.

```
NFC Tap (no NDEF, UID only)
    |
    v
POST /login {uid}
    |
    v
handleUidOnlyLogin → cardState="active", deployed=true
    |
    v
Frontend: "Card appears wiped" view
    |
    | User confirms "YES, THIS CARD HAS BEEN WIPED"
    v
POST /login {uid, action: "terminate"}
    |
    v
handleTerminateAction → terminateCard() → state="terminated"
    |
    v
Frontend: terminated view → re-provision at version N+1
```

### Card Lifecycle State Machine

```
new ──→ keys_delivered ──→ active ──→ wipe_requested ──→ terminated ──→ (re-provision)
 ^                                                                       │
 │                          wipe confirmed via                           │
 │                          blank NDEF + UID                             │
 └───────────────────────────────────────────────────────────────────────┘
```

States:
- **new**: Never programmed. No DO state exists.
- **keys_delivered**: Programming endpoint called, keys generated. Awaiting physical write via Bolt Card Programmer.
- **active**: Card written and first tap verified (CMAC validated). Card is live.
- **wipe_requested**: Operator fetched wipe keys. Card is expected to be physically wiped soon. Confirmed when card seen with blank NDEF + same UID.
- **terminated**: Wipe confirmed. Card can be re-provisioned at version N+1.

Key transitions:
| From | To | Trigger | Logged |
|------|----|---------|--------|
| new | keys_delivered | `POST /api/v1/pull-payments/.../boltcards {UID}` | ✅ provisioned (keys_delivered_at) |
| keys_delivered | active | First tap with valid CMAC | ✅ activated (activated_at) |
| active | wipe_requested | Operator clicks "GET WIPE KEYS" | ✅ wipe_requested (wipe_keys_fetched_at) |
| active | wipe_requested | `boltcard://reset` deeplink from programmer app | ✅ wipe_requested (wipe_keys_fetched_at) |
| wipe_requested | terminated | Card detected with blank NDEF + same UID (auto-confirm) | ✅ terminated (terminated_at) |
| active | terminated | "Card appears wiped" confirmation on NFC login | ✅ terminated (terminated_at) |
| terminated | keys_delivered | Re-provision button clicked | ✅ provisioned (keys_delivered_at, version N+1) |

Audit trail: Every key retrieval (provisioning or wiping) and every state transition is timestamped and visible in the tap history timeline.

### Key Derivation (keygenerator.js)

```
ISSUER_KEY (16-byte secret)
    |
    v
cardKey = AES-CMAC(ISSUER_KEY, "2d003f75" || UID || version_le32)
    |
    |-- K0 = AES-CMAC(cardKey,   "2d003f76")
    |-- K1 = AES-CMAC(ISSUER_KEY,"2d003f77")   <- shared across fleet
    |-- K2 = AES-CMAC(cardKey,   "2d003f78")   <- version-dependent
    |-- K3 = AES-CMAC(cardKey,   "2d003f79")
    |-- K4 = AES-CMAC(cardKey,   "2d003f7a")
```

### Registered Routes

| Path | Method | Handler | Notes |
|------|--------|---------|-------|
| `/` | GET | `handleLoginPage` or `handleLnurlw` | Login page (no params) or LNURLw flow (with p+c) |
| `/login` | GET/POST | `handleLoginPage` / `handleLoginVerify` | NFC login page and verification |
| `/2fa` | GET | `handleTwoFactor` | 2FA OTP codes display |
| `/status` | GET | `handleStatus` | Health check; redirects to /login |
| `/api/v1/pull-payments/.../boltcards` | ALL | `fetchBoltCardKeys` | Card programming and reset |
| `/boltcards/api/v1/lnurl/cb*` | ALL | `handleLnurlpPayment` | LNURL payment callback |
| `/lnurlp/cb` | GET | `handleLnurlPayCallback` | LNURL-pay callback |
| `/api/keys` | GET/POST | `handleGetKeys` | Card key lookup API |
| `/api/bulk-wipe-keys` | GET | `handleBulkWipeKeys` | Bulk wipe keys API |
| `/experimental/activate` | GET | `handleActivatePage` | Card activation hub |
| `/experimental/activate/form` | GET/POST | Activation form | Simple activation |
| `/experimental/nfc` | GET | `handleNfc` | NFC test console |
| `/experimental/wipe` | GET | `handleReset` / `handleWipePage` | Wipe utility |
| `/experimental/bulkwipe` | GET | `handleBulkWipePage` | Bulk wipe tool |
| `/experimental/analytics` | GET | `handleAnalyticsPage` | Analytics dashboard |
| `/debug` | GET | `handleDebugPage` | Operator tools dashboard |
| `/identity` | GET | `handleIdentityPage` | Identity/access control demo |
| `/pos` | GET | `handlePosPage` | Fakewallet POS payment |
| `/api/fake-invoice` | GET | inline | Generate fake bolt11 invoice |
| `/api/verify-identity` | GET | `handleIdentityVerify` | Identity verification API |
| `/activate`, `/nfc`, `/wipe`, `/bulkwipe`, `/analytics` | GET | 301 redirect | → `/experimental/*` |

---

## Data Storage

### CardReplayDO (Durable Object, per-card instance)

Each UID gets its own DO instance (`idFromName(uidHex.toLowerCase())`).

**Tables:**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `replay_state` | Counter-based replay protection | `last_counter` |
| `taps` | Tap history with payment status | `counter, bolt11, status, amount_msat, created_at` |
| `card_state` | Lifecycle state machine | `state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at` |
| `card_config` | Card configuration | `K2, payment_method, config_json, updated_at` |

**Endpoints:** `/check`, `/check-readonly`, `/record-tap`, `/record-read`, `/update-tap-status`, `/reset`, `/analytics`, `/list-taps`, `/card-state`, `/deliver-keys`, `/activate`, `/terminate`, `/request-wipe`, `/get-config`, `/set-config`

### Config Resolution (getUidConfig.js)

1. **DO** (`card_config` table) — primary source
2. **Deterministic fallback** — generates `{payment_method: "fakewallet", K2: derived}` for any unknown UID

No static config, no KV reads. All writes go to DO via `setCardConfig()`.

---

## Environment

### Secrets (wrangler secret put)

| Secret | Purpose |
|--------|---------|
| `ISSUER_KEY` | 16-byte hex key for deterministic card key derivation |
| `BOLT_CARD_K1_0` | First K1 decryption key |
| `BOLT_CARD_K1_1` | Second K1 decryption key |

### Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `CARD_REPLAY` | Durable Object | Card state, config, replay protection, tap history |
| `UID_CONFIG` | KV Namespace | Legacy (no longer read, kept for migration safety) |

---

## Test Coverage

19 suites, 262 tests, all passing. Key test files:

| File | Tests | Coverage |
|------|-------|----------|
| `tests/bolt11.test.js` | 39 | BOLT11 invoice generation, Schnorr signatures, encoding |
| `tests/cryptoutils.test.js` | 37 | AES-CMAC, decrypt, SV2, verifyCmac |
| `tests/responsePatterns.test.js` | 26 | API response patterns, KV/DO config writes |
| `tests/loginHandler.test.js` | 21 | NFC login verification, card state views |
| `tests/lnurlPay.test.js` | 13 | POS card payRequest and callback |
| `tests/tapTracking.test.js` | 12 | Counter timing, tap recording, replay protection |
| `tests/worker.test.js` | 11 | LNURLW flow, proxy, counter, CLN REST |
| `tests/keyLookup.test.js` | 11 | CSV-based key recovery |
| `tests/integration.test.js` | 11 | Payment flow, CMAC, programmer compatibility |
| `tests/getKeysHandler.test.js` | 11 | Key lookup API handler |
| `tests/e2e/virtual-card.test.js` | 10 | Full NFC lifecycle: provision, tap, callback, wipe, re-provision |
| `tests/bulkWipe.test.js` | 10 | Bulk wipe key generation |
| `tests/templateHelpers.test.js` | 9 | HTML template rendering helpers |
| `tests/smoke.test.js` | 8 | Real crypto pipeline E2E |
| `tests/pos.test.js` | 8 | Fakewallet POS payment flow |
| `tests/logging.test.js` | 8 | Structured logging |
| `tests/debugIdentity.test.js` | 8 | Debug dashboard and identity page rendering |
| `tests/twoFactorHandler.test.js` | 6 | 2FA TOTP/HOTP codes |
| `tests/keygenerator.test.js` | 3 | Deterministic key derivation |

---

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Main router, LNURLW handler, card version detection |
| `durableObjects/CardReplayDO.js` | Per-card DO with SQLite (replay, taps, state, config) |
| `replayProtection.js` | DO helper functions (checkReplay, recordTap, getCardState, etc.) |
| `getUidConfig.js` | Config resolution: DO → deterministic fallback |
| `keygenerator.js` | Deterministic key derivation K0-K4 with version support |
| `handlers/loginHandler.js` | NFC login page (HTML/JS) + verify endpoint |
| `handlers/fetchBoltCardKeys.js` | Card programming and reset flows |
| `handlers/resetHandler.js` | Card wipe with lifecycle enforcement |
| `boltCardHelper.js` | PICCData extraction and CMAC validation |
| `cryptoutils.js` | AES-CMAC, AES-ECB decrypt, hex utils |
| `utils/bolt11.js` | BOLT11 invoice generation with Schnorr signatures (@noble/secp256k1) |
| `handlers/identityHandler.js` | Identity/access control verification API |
| `handlers/debugHandler.js` | Operator debug dashboard page |
| `handlers/posHandler.js` | Fakewallet POS payment page |
| `templates/identityPage.js` | Identity demo HTML template |
| `templates/debugPage.js` | Debug dashboard HTML template |
| `templates/pageShell.js` | Shared Tailwind page wrapper for all HTML pages |

## Backups

- `keys/backups/static-uid-config-backup.csv` — Original 5 cards from staticUidConfig (UID, K2, payment_method, config)
