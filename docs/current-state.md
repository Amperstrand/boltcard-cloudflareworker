# Current Project State: boltcard-cloudflareworker

> Last updated: 2026-04-20.

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
    |-- deployed=true, cardState=active (UID-only) -> wiped detection view
    |-- deployed=true  -> private view (keys, version, state, tap history, wipe)
    |-- deployed=false -> undeployed view (preview keys, provision button)
    |-- compromised   -> public view (recovered keys from CSV dump)
```

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
new -> keys_delivered -> active -> terminated -> (re-provision) -> keys_delivered
                         \-> (physical wipe detected) -> terminated -> re-provision at version N+1
 ^                                                                            |
 +----------------------------------------------------------------------------+
```

- **new**: Never programmed. Legacy cards (pre-lifecycle) treated as `new`.
- **keys_delivered**: Programming endpoint called, keys generated. Card needs physical write.
- **active**: First tap after programming activates the card.
- **terminated**: Card wiped. Can be re-provisioned at version N+1.

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
| `card_state` | Lifecycle state machine | `state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at` |
| `card_config` | Card configuration | `K2, payment_method, config_json, updated_at` |

**Endpoints:** `/check`, `/check-readonly`, `/record-tap`, `/record-read`, `/update-tap-status`, `/reset`, `/analytics`, `/list-taps`, `/card-state`, `/deliver-keys`, `/activate`, `/terminate`, `/get-config`, `/set-config`

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

15 suites, 203 tests, all passing. Key test files:

| File | Tests | Coverage |
|------|-------|----------|
| `tests/cryptoutils.test.js` | 31 | AES-CMAC, decrypt, SV2, verifyCmac |
| `tests/e2e/virtual-card.test.js` | 10 | Full NFC lifecycle: provision, tap, callback, wipe, re-provision |
| `tests/worker.test.js` | 19 | LNURLW flow, proxy, counter, CLN REST |
| `tests/lnurlPay.test.js` | 8 | POS card payRequest and callback |
| `tests/smoke.test.js` | 8 | Real crypto pipeline E2E |
| `tests/integration.test.js` | 9 | Payment flow, CMAC, programmer compatibility |
| `tests/tapTracking.test.js` | 12 | Counter timing, tap recording, replay protection |
| `tests/responsePatterns.test.js` | 13 | API response patterns, KV/DO config writes |
| `tests/loginHandler.test.js` | 7 | NFC login verification |
| `tests/bolt11.test.js` | 4 | BOLT11 invoice parsing |
| `tests/bulkWipe.test.js` | 3 | Bulk wipe key generation |
| `tests/twoFactorHandler.test.js` | 3 | 2FA TOTP/HOTP codes |
| `tests/analytics.test.js` | 2 | Payment analytics |
| `tests/keygenerator.test.js` | 1 | Deterministic key derivation |
| `tests/keyLookup.test.js` | 5 | CSV-based key recovery |

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

## Backups

- `keys/backups/static-uid-config-backup.csv` — Original 5 cards from staticUidConfig (UID, K2, payment_method, config)
