# Current Project State: boltcard-cloudflareworker

> Original audit date: 2026-02-27. Last updated: 2026-04-16.

---

## Update Log

| Date | Summary |
|------|---------|
| 2026-02-27 | Initial audit snapshot. Identified 12 bugs and multiple limitations. |
| 2026-04-16 | Major cleanup pass. Fixed bugs 3, 7, 11, and the CLN REST duplicate code block. Removed hardcoded domain URLs in favor of dynamic derivation from the request. Completed CMAC validation implementation. Improved NFC Programmer app compatibility (old and new versions). Fixed QR codes to use raw API URLs. Added integration test suite. Refactored routing to itty-router, removing dead route registrations. Status endpoint now redirects to /activate. All 58 tests across 4 suites pass. |

---

## Table of Contents

1. [Architecture](#architecture)
2. [Environment Variables](#environment-variables)
3. [File Inventory](#file-inventory)
4. [Bug Registry](#bug-registry)
5. [Durable Objects Status](#durable-objects-status)
6. [Test Coverage Map](#test-coverage-map)
7. [Known Limitations](#known-limitations)

---

## Architecture

### Overview

This is a Cloudflare Worker that handles LNURL-withdraw (LNURLW) payments from NFC BoltCards. Cards store an encrypted payload in their NDEF record. When tapped, the phone reads the URL containing `?p=<encrypted_payload>&c=<cmac>` and the worker validates the card, then returns a LNURL withdraw response.

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
    | Finds key that gives header byte 0xC7
    | Returns { uidHex, ctr }
    v
getUidConfig(uidHex, env)                     [getUidConfig.js]
    |
    | 1. Try KV (env.UID_CONFIG.get(uid))
    | 2. Fall back to staticUidConfig
    | 3. Fall back to getDeterministicKeys()
    v
validate_cmac(uidBytes, ctr, cHex, k2Bytes)   [boltCardHelper.js -> cryptoutils.js]
    |
    | If K2 is absent (proxy mode), skip local CMAC validation
    | If K2 is present:
    |   Build SV2 = [0x3c,0xc3,0x00,0x01,0x00,0x80, ...UID(7), ctr[2],ctr[1],ctr[0]]
    |   ks  = AES-CMAC(sv2, K2)
    |   cm  = computeCm(ks)    (derives MAC via AES-ECB subkey chain)
    |   ct  = odd bytes of cm: [cm[1],cm[3],cm[5],cm[7],cm[9],cm[11],cm[13],cm[15]]
    |   Compare bytesToHex(ct) === cHex (case-insensitive)
    v
Payment dispatch by config.payment_method
    |
    |-- "proxy"      -> handleProxy()         [handlers/proxyHandler.js]
    |                   Forwards to external LNBits with p & c params
    |
    |-- "clnrest"    -> constructWithdrawResponse() [handlers/withdrawHandler.js]
    |                   Returns LNURL withdraw object with callback URL
    |                   Wallet then calls /boltcards/api/v1/lnurl/cb/<pHex>
    |                   which calls CLN REST /v1/pay
    |
    |-- "fakewallet" -> constructWithdrawResponse() [handlers/withdrawHandler.js]
                        Returns LNURL withdraw object; callback alternates OK/ERROR
```

### Registered Routes (index.js, via itty-router)

| Path | Method | Handler | Notes |
|------|--------|---------|-------|
| `/nfc` | GET | `handleNfc()` | NFC scanner HTML page |
| `/status` | GET | `handleStatus(request, env)` | Health check; redirects (302) to /activate |
| `/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards` | ALL | `fetchBoltCardKeys(request, env)` | Card programming (UpdateVersion) and reset (KeepVersion). Supports both old NFC Programmer (sends UID) and new (sends LNURLW). |
| `/boltcards/api/v1/lnurl/cb*` | ALL | `handleLnurlpPayment(request, env)` | LNURL callback |
| `/activate` | GET | `handleActivatePage(request)` | Card activation HTML page |
| `/activate/form` | GET | `handleActivateForm()` | Activation form page |
| `/activate/form` | POST | `handleActivateCardSubmit(request, env)` | Saves card config to KV |
| `/wipe` | GET | Inline handler | Wipe endpoint (inline in index.js) |
| `/` | GET | `handleLnurlw(request, env)` | Main LNURLW flow. Requires `?p` and `?c`. Also handles `?uid=` for card reset. |

**Note:** The old service-worker format with manual route matching and triple route registration has been replaced by itty-router. Each route is registered once. The `/card`, `/card/auth`, `/card/info`, and `/admin/*` routes have been removed from the main router (their handler modules still exist but are not wired).

### Key Derivation (keygenerator.js)

```
ISSUER_KEY (16-byte secret)
    |
    v
cardKey = AES-CMAC(ISSUER_KEY, "2d003f75" || UID || version_le32)
    |
    |-- K0 = AES-CMAC(cardKey,   "2d003f76")
    |-- K1 = AES-CMAC(ISSUER_KEY,"2d003f77")   <- decryption key
    |-- K2 = AES-CMAC(cardKey,   "2d003f78")   <- CMAC validation key
    |-- K3 = AES-CMAC(cardKey,   "2d003f79")
    |-- K4 = AES-CMAC(cardKey,   "2d003f7a")
    |-- ID = AES-CMAC(ISSUER_KEY,"2d003f7b" || UID)
```

### SV2 Structure (for CMAC verification)

```
[0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80, UID[0..6] (7 bytes), ctr[2], ctr[1], ctr[0]]
 ^fixed header (6 bytes)             ^UID (7 bytes)         ^counter reversed (3 bytes)
 Total: 16 bytes
```

Counter bytes are stored in reverse (little-endian): ctr[2] at index 13, ctr[1] at index 14, ctr[0] at index 15.

---

## Environment Variables

### Cloudflare KV Namespace Bindings (wrangler.toml)

| Binding Name | KV Namespace ID | Purpose |
|---|---|---|
| `UID_CONFIG` | `7eaddc7f33d242ed94054dfb8da8fcbc` | Per-UID card configuration (K2, payment_method, etc.) |

### Cloudflare Durable Object Bindings (wrangler.toml)

> **Updated 2026-04-16:** The `durableObjects/` directory and its three files (CardDO.js, BackendRegistryDO.js, AdminDO.js) have been removed from the project. The wrangler.toml bindings and Bug 2 notes are preserved here for historical reference.

| Binding Name | Class Name | Purpose | Status |
|---|---|---|---|
| `CARD_OBJECTS` | `CardDO` | Per-card counter and state | **Removed** (file deleted) |
| `BACKEND_REGISTRY` | `BackendRegistryDO` | Backend credential registry | **Removed** (file deleted) |
| `ADMIN_AUDIT` | `AdminDO` | Audit log | **Removed** (file deleted) |

The Durable Object classes and their directory no longer exist. Counter-based replay protection (CardDO) is no longer implemented.

### Runtime Secrets (set via `wrangler secret put`)

| Secret Name | Purpose | Default if missing |
|---|---|---|
| `ISSUER_KEY` | 16-byte hex key for deterministic card key derivation | `00000000000000000000000000000001` (dev fallback in keygenerator.js) |
| `BOLT_CARD_K1_0` | First K1 decryption key | `55da174c9608993dc27bb3f30a4a7314` (dev fallback in getUidConfig.js) |
| `BOLT_CARD_K1_1` | Second K1 decryption key | `0c3b25d92b38ae443229dd59ad34b85d` (dev fallback in getUidConfig.js) |
| `ADMIN_KEY` | Admin API authentication header value | `admin-change-me-in-production` (hardcoded in admin/handlers.js:5) |

### Variables (wrangler.toml `[vars]`)

No variables are currently active. The `BOLT_CARD_K1` var line is commented out:
```toml
#BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d"
```

### process.env Usage

> **Updated 2026-04-16:** All `process.env` references have been removed from non-test source files. Files that previously used `process.env` (keygenerator.js, getUidConfig.js, admin/handlers.js, utils/logger.js, card-portal/handlers.js) no longer do so. Secrets are read from the `env` parameter passed through the request handler chain.

---

## File Inventory

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `index.js` | 201 | Main worker entry point. Module worker format (`export default { fetch() }`). Uses itty-router for all routing. Handles LNURLW verification and payment dispatch. Clean single-registration routing. |
| 2 | `cryptoutils.js` | 428 | Core cryptographic primitives: `hexToBytes`, `bytesToHex`, `decryptP` (AES-ECB decrypt of p param), `buildVerificationData` (SV2 construction), `verifyCmac`, `computeAesCmac`, `computeKs`, `computeCm`. Full AES-CMAC (RFC 4493) implementation. Uses `aes-js` npm package for AES-ECB. |
| 3 | `keygenerator.js` | 98 | Deterministic key derivation from ISSUER_KEY. Exports `getDeterministicKeys(uidHex, version)` producing K0-K4, ID, cardKey. |
| 4 | `boltCardHelper.js` | 170 | Wrapper around cryptoutils. Exports `extractUIDAndCounter(pHex)` and `validate_cmac(uidBytes, ctr, cHex, k2Bytes)` (4-param, accepts caller-supplied K2). When `k2Bytes` is absent/null, CMAC validation is skipped (proxy mode). |
| 5 | `getUidConfig.js` | 130 | Configuration source. Exports `staticUidConfig` (4 hardcoded UIDs), `BOLT_CARD_K1` array, and `getUidConfig(uidHex, env)` which tries KV, then static config, then deterministic key generation. |
| 6 | `wrangler.toml` | 20 | Cloudflare deployment config. Defines KV namespace, Durable Object bindings (stale, see above), route, and build command. |
| 7 | `package.json` | 23 | Project metadata. Runtime dep: `aes-js@3.1.2`. Dev deps: `jest`, `miniflare`, `wrangler`, `axios`. |
| 8 | `handlers/activateCardHandler.js` | 393 | GET returns HTML activation form. POST validates UID, generates deterministic keys, saves config to KV. |
| 9 | `handlers/fetchBoltCardKeys.js` | 125 | Handles card programming (`UpdateVersion`) and reset (`KeepVersion`) flows. Supports both old NFC Programmer app (sends UID for reset) and new app (sends LNURLW for reset). Derives base URL from request dynamically. |
| 10 | `handlers/handleNfc.js` | 321 | Returns a full HTML+JS NFC scanner page. Reads NDEF records, fetches LNURLW data, supports QR scanning as fallback, processes LNURLW withdrawal flow client-side. |
| 11 | `handlers/lnurlHandler.js` | 266 | Handles LNURL payment callbacks at `/boltcards/api/v1/lnurl/cb`. GET branch triggers `processWithdrawalPayment` with proper `await getUidConfig(uid, env)`. Single CLN REST handler (duplicate removed). |
| 12 | `handlers/programHandler.js` | 70 | Standalone program handler for `?uid=` query param. Not wired into the main router. |
| 13 | `handlers/proxyHandler.js` | 60 | Proxies LNURLW requests to an external LNBits instance, appending `?p=` and `?c=` to the target URL. |
| 14 | `handlers/resetHandler.js` | 38 | Returns key response for a card reset flow. Derives base URL from caller. |
| 15 | `handlers/statusHandler.js` | 27 | GET `/status`. Redirects (302) to `/activate`. |
| 16 | `handlers/withdrawHandler.js` | 20 | `constructWithdrawResponse` builds the LNURL withdraw JSON object. Accepts `baseUrl` parameter for dynamic URL construction. |
| 17 | `admin/routes.js` | 19 | `setupAdminRoutes(router)` expects a router object. Not wired into the main router. |
| 18 | `admin/handlers.js` | 174 | Admin CRUD handlers for cards and backends. Not wired into the main router. |
| 19 | `card-portal/handlers.js` | 378 | Card portal flow. Not wired into the main router. |
| 20 | `utils/logger.js` | 98 | Structured logger class. Level-based (`error/warn/info/debug`). |
| 21 | `tests/worker.test.js` | 223 | Jest tests for API endpoints. Exercises LNURLW flow, proxy relay, counter validation, CLN REST payment, card key generation, and error handling. |
| 22 | `tests/cryptoutils.test.js` | 450 | Jest tests for cryptographic functions. Tests hex conversion, AES-CMAC (RFC 4493 test vectors), decryptP with multiple K1 keys, CMAC verification, SV2 construction, odd-byte CMAC truncation. |
| 23 | `tests/keygenerator.test.js` | 25 | Jest tests for key derivation. 1 test: generates keys for known UID and checks all 7 output values. |
| 24 | `tests/integration.test.js` | 241 | Integration tests covering end-to-end payment flows, CMAC validation, and NFC Programmer app compatibility. |

---

## Bug Registry

### Bug 1 — `ctrValue` undefined: ReferenceError

- **File:** `index.js` (was line 172 in old code)
- **Severity:** CRITICAL
- **Status:** FIXED (by itty-router refactor)
- The duplicated LNURLW code block that contained this bug was removed when the routing was refactored to itty-router. The single `handleLnurlw` function no longer references `ctrValue`.

---

### Bug 2 — `cardStub` undefined + wrong `validateAndUpdateCounter` signature

- **File:** `index.js` (was line 174 in old code)
- **Severity:** CRITICAL
- **Status:** FIXED (by removal of Durable Objects)
- The `durableObjects/` directory and `CardDO.js` have been removed from the project. Counter-based replay protection is no longer implemented. This eliminates the undefined `cardStub` and signature mismatch issues.

---

### Bug 3 — `getUidConfig(uid)` missing `await` and `env` parameter

- **File:** `handlers/lnurlHandler.js`
- **Severity:** CRITICAL
- **Status:** FIXED
- `processWithdrawalPayment` now calls `await getUidConfig(uid, env)` (line 168) with both the `await` keyword and the `env` parameter. KV lookups work correctly.

---

### Bug 4 — Orphaned code block causes syntax error on import

- **File:** `card-portal/handlers.js`
- **Severity:** CRITICAL
- **Status:** NOT FIXED (module not wired)
- The orphaned code block likely still exists in `card-portal/handlers.js`, but this file is no longer imported or referenced from `index.js`. It has no runtime impact since it's dead code.

---

### Bug 5 — Variable shadowing: `const card` redeclared

- **File:** `card-portal/handlers.js`
- **Severity:** MEDIUM
- **Status:** NOT FIXED (module not wired)
- Same as Bug 4: the file exists but is not imported. No runtime impact.

---

### Bug 6 — `extractUIDAndCounter` returns `reject('Not implemented')`

- **File:** `card-portal/handlers.js`
- **Severity:** CRITICAL
- **Status:** NOT FIXED (module not wired)
- Same as Bug 4: the file exists but is not imported. No runtime impact.

---

### Bug 7 — `validate_cmac` called with 4 args; K2 silently ignored

- **File:** `boltCardHelper.js`
- **Severity:** CRITICAL
- **Status:** FIXED
- `validate_cmac` now accepts 4 parameters: `validate_cmac(uidBytes, ctr, cHex, k2Bytes)`. The caller-supplied K2 (from config) is used directly for CMAC validation. When `k2Bytes` is absent or null (proxy mode), CMAC validation is skipped and the request is relayed downstream.

---

### Bug 8 — `src/index.js` dead stub referencing undefined functions

- **File:** `src/index.js`
- **Severity:** LOW
- **Status:** STILL PRESENT (no runtime impact)
- Dead code, not referenced from `wrangler.toml main`. No runtime impact.

---

### Bug 9 — `setupAdminRoutes(router)` expects router; called with `(url, env)`

- **File:** `admin/routes.js` + `index.js`
- **Severity:** CRITICAL
- **Status:** FIXED (by removal from router)
- The admin routes are no longer registered in `index.js`. `setupAdminRoutes` is not called. No runtime impact.

---

### Bug 10 — `handleAdminCreateBackend` never imported

- **File:** `admin/routes.js`
- **Severity:** MEDIUM
- **Status:** NOT FIXED (module not wired)
- Same as Bug 9: admin routes are not wired into the main router. No runtime impact.

---

### Bug 11 — Routes registered three times; 2nd and 3rd registrations are unreachable

- **File:** `index.js`
- **Severity:** MEDIUM
- **Status:** FIXED
- The entire routing layer has been replaced with itty-router. Each route is registered exactly once in a clean, declarative style. No duplicate registrations exist.

---

### Bug 12 — `process.env.ISSUER_KEY` unavailable in CF Workers; silently falls back to dev key

- **File:** `keygenerator.js`
- **Severity:** CRITICAL
- **Status:** FIXED
- All `process.env` references have been removed from non-test source files. Key derivation no longer depends on `process.env`.

---

### Additional Fix: CLN REST duplicate code block

- **File:** `handlers/lnurlHandler.js`
- **Severity:** HIGH
- **Status:** FIXED
- The old duplicate CLN REST handler code that was at the end of `processWithdrawalPayment` has been removed. The improved version with HTTP 201 + JSON body status checking is the only one now.

---

## Durable Objects Status

> **Updated 2026-04-16:** The Durable Objects have been removed from the project. The `durableObjects/` directory no longer exists. The wrangler.toml still contains bindings for `CARD_OBJECTS`, `BACKEND_REGISTRY`, and `ADMIN_AUDIT`, but the classes they reference do not exist. Counter-based replay protection is no longer implemented.

---

## Test Coverage Map

### Test Suites (58 tests total, all passing)

| File | Tests | Framework |
|---|---|---|
| `tests/cryptoutils.test.js` | 31 | Jest |
| `tests/worker.test.js` | 19 | Jest (imports `handleRequest` directly) |
| `tests/integration.test.js` | 7 | Jest |
| `tests/keygenerator.test.js` | 1 | Jest |

### Functions Tested

| Function | File | Tested In | Coverage |
|---|---|---|---|
| `hexToBytes` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (including edge cases) |
| `bytesToHex` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `xorArrays` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (including length mismatch) |
| `shiftGo` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `computeAesCmac` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (RFC 4493 test vectors + key length validation) |
| `buildVerificationData` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `verifyCmac` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (pass, fail, wrong length cases) |
| `decryptP` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (single + multiple K1 keys) |
| `getDeterministicKeys` | `keygenerator.js` | `keygenerator.test.js` | Yes (1 UID, 7 output values) |
| `handleRequest` (full flow) | `index.js` | `worker.test.js` | Yes (LNURLW, callback, pull-payment, proxy, counter, CLN REST) |
| `fetchBoltCardKeys` | `handlers/fetchBoltCardKeys.js` | `worker.test.js` | Yes |
| `handleLnurlpPayment` | `handlers/lnurlHandler.js` | `worker.test.js` | Yes (GET and POST) |
| `validate_cmac` | `boltCardHelper.js` | `worker.test.js`, `integration.test.js` | Yes |
| `extractUIDAndCounter` | `boltCardHelper.js` | `integration.test.js` | Yes |
| `processWithdrawalPayment` | `handlers/lnurlHandler.js` | `worker.test.js` | Yes (CLN REST, fakewallet) |

### Functions NOT Tested

| Function | File | Notes |
|---|---|---|
| `computeKs` | `cryptoutils.js` | Indirectly exercised via `verifyCmac` |
| `computeCm` | `cryptoutils.js` | Indirectly exercised via `verifyCmac` |
| `generateSubkeyGo` | `cryptoutils.js` | Not tested directly |
| `bytesToDecimalString` | `cryptoutils.js` | Not tested |
| `getUidConfig` | `getUidConfig.js` | Not tested directly |
| `handleActivateCardPage` | `handlers/activateCardHandler.js` | Not tested |
| `handleActivateCardSubmit` | `handlers/activateCardHandler.js` | Not tested |
| `handleNfc` | `handlers/handleNfc.js` | Not tested |
| `handleStatus` | `handlers/statusHandler.js` | Not tested |
| `constructWithdrawResponse` | `handlers/withdrawHandler.js` | Not tested directly (exercised via withdrawal flow) |
| `handleProxy` | `handlers/proxyHandler.js` | Not tested directly |
| `handleProgram` | `handlers/programHandler.js` | Not tested |
| `handleReset` | `handlers/resetHandler.js` | Not tested directly |
| `setupAdminRoutes` | `admin/routes.js` | Not tested (not wired) |
| All admin handlers | `admin/handlers.js` | Not tested (not wired) |
| `handleCardAuth` | `card-portal/handlers.js` | Not tested (not wired) |
| `handleCardInfo` | `card-portal/handlers.js` | Not tested (not wired) |
| Logger methods | `utils/logger.js` | Not tested |

---

## Known Limitations

### Cryptographic

1. **AES-ECB only via aes-js.** The Web Crypto API (`crypto.subtle`) built into the CF Workers runtime does not support AES-ECB mode. All AES operations must use the `aes-js` npm package, which requires bundling. This is a fundamental constraint of the CF platform and cannot be changed without dropping Web Crypto.

2. **CMAC implementation is custom.** The AES-CMAC implementation in `cryptoutils.js` is hand-rolled against RFC 4493. It is validated against multiple RFC 4493 test vectors and boltcard Go reference test vectors. No independent security audit has been performed.

3. ~~**Static K2 lookup in `validate_cmac`.**~~ **REMOVED (2026-04-16).** `validate_cmac` now accepts a caller-supplied K2 parameter. It no longer reads from `staticUidConfig` internally.

4. **Proxy-side CMAC policy needs an explicit configuration model.** The worker supports two trust models: (a) full local verification when `K2` is present, and (b) decrypt-only relay for `payment_method: "proxy"` with `proxy.baseurl` but no `K2`, where downstream LNBits/BTCPay is responsible for validating `c` and enforcing replay protection. This trust policy is inferred from the presence or absence of `K2` on proxy entries rather than being an explicit configuration flag.

### No Replay Protection

Counter-based replay protection (previously via `CardDO.validateAndUpdateCounter`) has been removed along with the Durable Objects. There is currently no replay protection. Any counter value is accepted, allowing replay attacks. This is a significant security gap for production use.

### Module Worker Format

`index.js` now uses module worker format (`export default { fetch() }`) with itty-router. The Durable Object bindings in `wrangler.toml` reference classes that no longer exist. Deploying with those bindings may cause warnings or errors.

### No Authentication on `/activate`

The `/activate` endpoint accepts any UID and writes to KV without any authentication. An attacker with network access to the worker can register arbitrary UIDs with their own K2 keys, hijacking payment processing for those UIDs.

### ~~Hardcoded Production Domain~~ Dynamic URL Derivation

> **Updated 2026-04-16:** All handler files now derive the base URL dynamically from the incoming request URL (`new URL(request.url).origin` or equivalent). There are no hardcoded domains in the active code paths. A fallback to `boltcardpoc.psbt.me` exists in `constructWithdrawResponse` and `generateKeyResponse` for cases where no `baseUrl` is provided, but all callers now pass it.

### Fake Wallet Intentional Failure Pattern

`handlers/lnurlHandler.js` implements an alternating success/failure pattern (`fakewalletCounter % 2 === 0`). The counter is a module-level variable reset to 0 on every cold start. Every other fakewallet request will fail. Unsuitable for production.

### No Rate Limiting or Abuse Prevention

There is no rate limiting on any endpoint. The `/` endpoint (LNURLW verification) performs cryptographic operations on every request without any throttling. The `/activate` endpoint writes to KV on every request.

### `wrangler.toml` Has No `migrations` Block for Durable Objects

> **Note:** Durable Objects have been removed from the codebase, but the bindings still exist in `wrangler.toml`. These stale bindings should be cleaned up. If Durable Objects are re-introduced, a `[[migrations]]` block will be required.

### Unwired Modules

Several handler modules exist on disk but are not imported or registered in the main router:
- `card-portal/handlers.js` (contains Bugs 4, 5, 6)
- `admin/routes.js` and `admin/handlers.js` (contains Bug 10)
- `handlers/programHandler.js` (references undefined `privacyMode`)

These modules have no runtime impact but add confusion for anyone reading the codebase.
