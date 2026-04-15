# Current Project State: boltcard-cloudflareworker

> Audit date: 2026-02-27. This is a read-only snapshot. No source files were modified to produce this document.

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
    | NDEF record: lnurlw://boltcardpoc.psbt.me/?p=<hex>&c=<hex>
    v
Phone converts lnurlw:// -> https:// and fetches URL
    |
    v
CF Worker (index.js handleRequest)
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
validate_cmac(uidBytes, ctrBytes, cHex, k2)   [boltCardHelper.js -> cryptoutils.js]
    |
    | Build SV2 = [0x3c,0xc3,0x00,0x01,0x00,0x80, ...UID(7), ctr[2],ctr[1],ctr[0]]
    | ks  = AES-CMAC(sv2, K2)
    | cm  = computeCm(ks)    (derives MAC via AES-ECB subkey chain)
    | ct  = odd bytes of cm: [cm[1],cm[3],cm[5],cm[7],cm[9],cm[11],cm[13],cm[15]]
    | Compare bytesToHex(ct) === cHex (case-insensitive)
    v
Counter validation (Durable Object)           [index.js:277-285, CardDO.js]
    |
    | CardDO.validateAndUpdateCounter(ctr)
    | Rejects if ctr <= stored counter (replay protection)
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

### Registered Routes (index.js)

| Path | Method | Handler | Notes |
|------|--------|---------|-------|
| `/nfc` | GET | `handleNfc()` | NFC scanner HTML page |
| `/status` | GET | `handleStatus(env)` | Health check / setup page |
| `/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards` | POST | `fetchBoltCardKeys(request)` | Card programming / reset |
| `/boltcards/api/v1/lnurl/cb` | POST/GET | `handleLnurlpPayment(request)` | LNURL callback |
| `/activate` GET | GET | `handleActivateCardPage()` | Card activation HTML page |
| `/activate` POST | POST | `handleActivateCardSubmit(request, env)` | Saves card config to KV |
| `/admin/*` | ANY | `setupAdminRoutes(url, env)` | Admin API (broken, see Bug 9) |
| `/card` | GET | `handleCardPage()` (undefined) | Missing function |
| `/card` | POST | `handleCardAuth(request, env)` | Card portal auth |
| `/card/auth` | POST | `handleCardAuth(request, env)` | Card portal auth |
| `/card/info` | GET | `handleCardInfo(request, env)` | Card info (session-protected) |
| `/` | GET | Main LNURLW flow | Requires `?p` and `?c` |

**Note:** Routes for `/admin/*`, `/card`, `/card/auth`, `/card/info` are registered three times in index.js (lines 75-93, 102-120, 218-236). The second and third registrations are unreachable.

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

| Binding Name | Class Name | Purpose | Exported from index.js? |
|---|---|---|---|
| `CARD_OBJECTS` | `CardDO` | Per-card counter and state | **NO** |
| `BACKEND_REGISTRY` | `BackendRegistryDO` | Backend credential registry | **NO** |
| `ADMIN_AUDIT` | `AdminDO` | Audit log | **NO** |

**Critical:** All three Durable Object classes are declared in `wrangler.toml` but never exported from `index.js`. Cloudflare Workers requires that Durable Object classes be exported from the worker's main module. Without those exports, the runtime cannot instantiate them and any code path that calls `env.CARD_OBJECTS.get(...)` will throw a runtime error.

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

### process.env Usage (incorrect for CF Workers)

Several files attempt to read secrets via `process.env`, which does not work in Cloudflare Workers. The CF Workers runtime does not provide `process.env`. Secrets must be passed through the `env` parameter of the module worker's `fetch` handler or as top-level global vars in the service worker format. Both `keygenerator.js` and `getUidConfig.js` have try/catch fallbacks that silently revert to hardcoded dev keys when `process.env` returns undefined.

Files using `process.env`:
- `keygenerator.js:13` (`process.env.ISSUER_KEY`)
- `getUidConfig.js:10-11` (`process.env.BOLT_CARD_K1_0`, `process.env.BOLT_CARD_K1_1`)
- `admin/handlers.js:5` (`process.env.ADMIN_KEY`)
- `utils/logger.js:97` (`process.env.NODE_ENV`)
- `card-portal/handlers.js:3` (`process.env.SESSION_TTL`)

---

## File Inventory

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `index.js` | 326 | Main worker entry point. Service worker format (`addEventListener('fetch', ...)`). Handles routing, LNURLW verification, and payment dispatch. Contains the duplicated code block (lines 136-215 and 238-322) and triple route registration. |
| 2 | `cryptoutils.js` | 308 | Core cryptographic primitives: `hexToBytes`, `bytesToHex`, `decryptP` (AES-ECB decrypt of p param), `buildVerificationData` (SV2 construction), `verifyCmac`, `computeAesCmac`, `computeKs`, `computeCm`. Uses `aes-js` npm package for AES-ECB. |
| 3 | `keygenerator.js` | 222 | Deterministic key derivation from ISSUER_KEY. Exports `getDeterministicKeys(uidHex, version)` producing K0-K4, ID, cardKey. Reads `ISSUER_KEY` via `process.env` with fallback to `00000000000000000000000000000001`. |
| 4 | `boltCardHelper.js` | 150 | Wrapper around cryptoutils. Exports `extractUIDAndCounter(pHex)` and `validate_cmac(uidBytes, ctr, cHex)` (3-param, ignores K2), and `decodeAndValidate`. The `validate_cmac` function looks up K2 from `staticUidConfig` internally. |
| 5 | `getUidConfig.js` | 138 | Configuration source. Exports `staticUidConfig` (4 hardcoded UIDs), `BOLT_CARD_K1` array, and `getUidConfig(uidHex, env)` which tries KV, then static config, then deterministic key generation. |
| 6 | `wrangler.toml` | 34 | Cloudflare deployment config. Defines KV namespace, 3 Durable Object bindings, route, and build command. |
| 7 | `package.json` | 22 | Project metadata. Runtime dep: `aes-js@3.1.2`. Dev deps: `jest`, `miniflare`, `wrangler`, `axios`. |
| 8 | `handlers/activateCardHandler.js` | 393 | GET returns HTML activation form. POST validates UID, generates deterministic keys, saves config to KV. Includes a `testKvAccess()` helper that runs on every activation. |
| 9 | `handlers/fetchBoltCardKeys.js` | 126 | Handles card programming (`UpdateVersion`) and reset (`KeepVersion`) flows. Generates and returns K0-K4 keys for card programming. Uses dummy CMAC validation (`cmac_validated = true`). |
| 10 | `handlers/handleNfc.js` | 321 | Returns a full HTML+JS NFC scanner page. Reads NDEF records, fetches LNURLW data, supports QR scanning as fallback, processes LNURLW withdrawal flow client-side. |
| 11 | `handlers/lnurlHandler.js` | 251 | Handles LNURL payment callbacks at `/boltcards/api/v1/lnurl/cb`. GET branch triggers `processWithdrawalPayment`. POST branch only logs. `processWithdrawalPayment` calls `getUidConfig(uid)` without `env` (Bug 3). |
| 12 | `handlers/programHandler.js` | 70 | Standalone program handler for `?uid=` query param. References `privacyMode` variable that is never defined (always throws). Not wired into the main router. |
| 13 | `handlers/proxyHandler.js` | 65 | Proxies LNURLW requests to an external LNBits instance, appending `?p=` and `?c=` to the target URL. |
| 14 | `handlers/resetHandler.js` | 37 | Returns key response for a card reset flow. Takes a UID directly (not via LNURLW). Not wired into the main router. |
| 15 | `handlers/statusHandler.js` | 92 | GET `/status`. If KV is present, performs a write/read test. Otherwise returns an HTML setup page with deep links for card programming/reset. |
| 16 | `handlers/withdrawHandler.js` | 86 | `constructWithdrawResponse` builds the LNURL withdraw JSON object. Includes simulated failures if counter >= 200. Returns W3C Verifiable Credentials in the response (demo data). |
| 17 | `admin/routes.js` | 19 | `setupAdminRoutes(router)` expects a router object and calls `router.get(...)`. Called from index.js as `setupAdminRoutes(url, env)` (Bug 9). `handleAdminCreateBackend` is used but never imported (Bug 10). |
| 18 | `admin/handlers.js` | 174 | Admin CRUD handlers for cards and backends. Uses `env.CARD_OBJECTS` and `env.BACKEND_REGISTRY` (Durable Objects, not exported). Uses `process.env.ADMIN_KEY` (fails in CF Workers). |
| 19 | `card-portal/handlers.js` | 441 | Card portal flow. `handleCardPage()` returns HTML. `handleCardAuth` has an orphaned code block at lines 302-364 outside any function that causes a syntax error (Bug 4). `handleCardInfo` redeclares `const card` (Bug 5). Local `extractUIDAndCounter` always rejects (Bug 6). |
| 20 | `durableObjects/CardDO.js` | 59 | Durable Object for per-card state. `validateAndUpdateCounter(ctr)` takes 1 param. Called with 2 args at index.js:174 (Bug 2). Not exported from index.js. |
| 21 | `durableObjects/BackendRegistryDO.js` | 87 | Durable Object for backend registry. CRUD methods for backend configs. Not exported from index.js. |
| 22 | `durableObjects/AdminDO.js` | 42 | Durable Object for admin audit logging. Not exported from index.js. |
| 23 | `utils/logger.js` | 98 | Structured logger class. Level-based (`error/warn/info/debug`). Default level driven by `process.env.NODE_ENV` (fails in CF Workers, defaults to `debug`). |
| 24 | `src/index.js` | 26 | Dead stub. References `activatePage`, `handleCardProgramming`, `handleCardReset`, `handleCardProgrammingLink`, `handleCardResetLink` — none are defined or imported. Has no effect on deployment (not referenced from `wrangler.toml main`). |
| 25 | `tests/worker.test.js` | 106 | Jest tests for API endpoints. Exercises `/?p=&c=`, `/boltcards/api/v1/lnurl/cb`, and `/api/v1/pull-payments/.../boltcards` (KeepVersion). 4 tests. |
| 26 | `tests/cryptoutils.test.js` | 107 | Jest tests for cryptographic functions. Uses 1 test vector. Tests: `decryptP`, `buildVerificationData`, `computeAesCmacForVerification`, `hexToBytes`/`bytesToHex`, `xorArrays`, `shiftGo`, `computeAesCmac`. 7 tests. |
| 27 | `tests/keygenerator.test.js` | 25 | Jest tests for key derivation. 1 test: generates keys for known UID and checks all 7 output values. |

---

## Bug Registry

### Bug 1 — `ctrValue` undefined: ReferenceError

- **File:** `index.js:172`
- **Severity:** CRITICAL
- **Code:**
  ```js
  console.log("Decoded UID:", uidHex, "Counter:", ctrValue);
  ```
- **Issue:** `ctrValue` is never declared in this code block (lines 136-215). It is declared later at `index.js:278` in the second (working) copy of the LNURLW flow. This line executes before that declaration, throwing a `ReferenceError: ctrValue is not defined`.
- **Impact:** Every request to the root path `/` that reaches this line (i.e., all valid LNURLW requests with correct `p`/`c` params and successful CMAC validation) crashes with an unhandled exception before any payment response is sent.

---

### Bug 2 — `cardStub` undefined + wrong `validateAndUpdateCounter` signature

- **File:** `index.js:174`
- **Severity:** CRITICAL
- **Code:**
  ```js
  const { valid, newCounter } = await cardStub.validateAndUpdateCounter(uidHex, ctrValue);
  ```
- **Issues:**
  1. `cardStub` is never declared in the first code block (lines 136-215). It is declared at `index.js:277` in the second block. This line throws `ReferenceError: cardStub is not defined`.
  2. Even if `cardStub` were available, `CardDO.validateAndUpdateCounter` (CardDO.js:25) accepts only 1 argument (`ctr`), not 2 (`uidHex, ctrValue`). The `uidHex` argument would be silently ignored, and `ctrValue` (also undefined) would be used as the counter value.
- **Impact:** Same as Bug 1 — execution in the first LNURLW code block cannot reach counter validation.

---

### Bug 3 — `getUidConfig(uid)` missing `await` and `env` parameter

- **File:** `handlers/lnurlHandler.js:150`
- **Severity:** CRITICAL
- **Code:**
  ```js
  const config = getUidConfig(uid);
  ```
- **Issues:**
  1. Missing `await`. `getUidConfig` is an `async` function (getUidConfig.js:81). Without `await`, `config` will be a Promise object, not the resolved config. The `if (!config)` check on line 153 will always be falsy (a Promise is truthy), and `config.payment_method` will be `undefined`.
  2. Missing `env` argument. Without `env`, the KV lookup branch is skipped (getUidConfig.js:87 checks `env && env.UID_CONFIG`). Only static config and deterministic key fallback are tried.
- **Impact:** `processWithdrawalPayment` always hits the `"Unsupported payment method: undefined"` branch regardless of how the UID is configured in KV. All LNURL callback payments via GET fail silently or with a misleading error.

---

### Bug 4 — Orphaned code block causes syntax error on import

- **File:** `card-portal/handlers.js:302-364`
- **Severity:** CRITICAL
- **Code:**
  ```js
  }  // <- closes handleCardAuth function at line 300
  
      const cardStub = env.CARD_OBJECTS.get(...);  // <- line 302, no enclosing function
      const card = await cardStub.getCard();
      ...
      return new Response(...);
  } catch (e) {
      ...
  }
  }  // <- line 364, unmatched closing brace
  ```
- **Issue:** A second copy of the `handleCardAuth` body was pasted at module scope after the function's closing brace. The stray `catch` and closing braces create mismatched structure. Any JavaScript parser sees this as a top-level `try`/`catch` block without a matching `try`, which is a SyntaxError. Node.js/V8 (used by Miniflare and likely the Workers runtime during evaluation) will reject the module entirely.
- **Impact:** `card-portal/handlers.js` cannot be imported. `handleCardAuth` and `handleCardInfo` are never available, causing `index.js` to fail at module load time. The entire worker fails to start.

---

### Bug 5 — Variable shadowing: `const card` redeclared

- **File:** `card-portal/handlers.js:397`
- **Severity:** MEDIUM
- **Code:**
  ```js
  const cardData = JSON.parse(card.card);   // line 396 — card is the result of cardStub.getCard()
  const card = {                            // line 397 — re-declares const card in same scope
    uid: card.uid,                          // line 398 — uses card before it's initialized (TDZ error)
    ...
  };
  ```
- **Issue:** `card` is declared twice in the same function scope (`handleCardInfo`). The first declaration comes from `const card = await cardStub.getCard()` on line 387. Re-declaring it as `const card = { ... }` on line 397 in the same block is a `SyntaxError` (duplicate `const` binding). Even if it were a `let`, accessing `card.uid` on line 398 while `card` is in the Temporal Dead Zone would throw a `ReferenceError`.
- **Impact:** `handleCardInfo` cannot execute. All requests to `/card/info` throw a syntax/runtime error.

---

### Bug 6 — `extractUIDAndCounter` returns `reject('Not implemented')`

- **File:** `card-portal/handlers.js:251` (function at line 437)
- **Severity:** CRITICAL
- **Code:**
  ```js
  async function extractUIDAndCounter(p) {
    return new Promise((resolve, reject) => {
      reject('Not implemented - requires extraction logic');
    });
  }
  ```
- **Issue:** This local function shadows the imported `extractUIDAndCounter` from `boltCardHelper.js`. The import is missing from `card-portal/handlers.js` — it imports only `hexToBytes` and `bytesToHex` from `cryptoutils.js`. The local stub always rejects, so every call to `extractUIDAndCounter(p)` at line 251 throws an unhandled promise rejection.
- **Impact:** `handleCardAuth` always fails when it tries to decode the NFC payload. Card portal authentication is completely non-functional.

---

### Bug 7 — `validate_cmac` called with 4 args; K2 silently ignored

- **File:** `boltCardHelper.js:70` (function signature) vs. `index.js:160-165`
- **Severity:** CRITICAL
- **Code in boltCardHelper.js:**
  ```js
  export function validate_cmac(uidBytes, ctr, cHex) {  // 3 params
  ```
- **Code in index.js (both call sites):**
  ```js
  const { cmac_validated, cmac_error } = validate_cmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    cHex,
    hexToBytes(config.K2)   // 4th arg: silently ignored
  );
  ```
- **Issue:** JavaScript does not throw for extra arguments. The function signature accepts only 3 params. The K2 provided by the caller is dropped. Instead, `validate_cmac` internally looks up K2 from `staticUidConfig` (line 90), ignoring whatever K2 is in KV or the dynamic config. This means cards configured only in KV (not in `staticUidConfig`) will always fail CMAC validation with "K2 key not found for UID", even if their K2 is correct.
- **Impact:** Any card whose config lives only in KV (the intended production path) cannot complete CMAC validation. Only the 4 hardcoded UIDs in `staticUidConfig` can pass.

---

### Bug 8 — `src/index.js` dead stub referencing undefined functions

- **File:** `src/index.js:1-26`
- **Severity:** LOW
- **Code:**
  ```js
  router.get('/activate', async request => { return activatePage(request); });
  router.post('/card/program', async request => { return handleCardProgramming(request); });
  router.post('/card/reset', async request => { return handleCardReset(request); });
  router.post('/card/program/link', async request => { return handleCardProgrammingLink(request); });
  router.post('/card/reset/link', async request => { return handleCardResetLink(request); });
  ```
- **Issue:** `src/index.js` is not the file referenced by `wrangler.toml` (which specifies `main = "index.js"` at the root). None of the functions it calls (`activatePage`, `handleCardProgramming`, etc.) exist anywhere in the codebase. The `router` variable is also not declared here. This file has no effect on deployment but creates confusion.
- **Impact:** No runtime impact. Dead code that can mislead developers.

---

### Bug 9 — `setupAdminRoutes(router)` expects router; called with `(url, env)`

- **File:** `admin/routes.js:8` + `index.js:76`
- **Severity:** CRITICAL
- **Code in admin/routes.js:**
  ```js
  export function setupAdminRoutes(router) {
    router.get('/admin/cards', handleAdminCards);  // calls router.get(...)
    ...
  }
  ```
- **Code in index.js:**
  ```js
  return setupAdminRoutes(url, env);  // passes URL object as "router"
  ```
- **Issue:** `url` is a `URL` object. It has no `.get()`, `.post()`, or `.patch()` methods. The function will throw `TypeError: router.get is not a function` on the first `router.get(...)` call.
- **Impact:** All `/admin/*` routes throw a `TypeError` immediately. Admin functionality is completely non-functional.

---

### Bug 10 — `handleAdminCreateBackend` never imported

- **File:** `admin/routes.js:17`
- **Severity:** MEDIUM
- **Code:**
  ```js
  router.post('/admin/backends', handleAdminCreateBackend);
  ```
- **Issue:** `handleAdminCreateBackend` is never imported at the top of `admin/routes.js`. The imports include `handleAdminCards`, `handleAdminGetCard`, `handleAdminCreateCard`, `handleAdminUpdateCard`, `handleAdminBackends`, and `handleAdminUpdateBackend` from `./handlers.js`. `handleAdminCreateBackend` is absent from both the import list and `admin/handlers.js`. This will throw `ReferenceError: handleAdminCreateBackend is not defined` when the module is first evaluated.
- **Impact:** Module evaluation of `admin/routes.js` fails, preventing `setupAdminRoutes` from being callable. Admin routes break at load time (compounding Bug 9).

---

### Bug 11 — Routes registered three times; 2nd and 3rd registrations are unreachable

- **File:** `index.js:75-93`, `102-120`, `218-236`
- **Severity:** MEDIUM
- **Code:**
  ```
  Lines 75-93:   if (pathname.startsWith("/admin/")) ...
                 if (pathname === '/card') ...
                 if (pathname === '/card/auth') ...
                 if (pathname === '/card/info') ...
  
  Lines 96-99:   if (pathname !== "/") return new Response("Not found", 404);
                 // ^^^ This guard means nothing below here runs for non-"/" paths
  
  Lines 102-120: if (pathname.startsWith("/admin/")) ...   <- DEAD (guarded by 404 above)
                 if (pathname === '/card') ...              <- DEAD
                 if (pathname === '/card/auth') ...         <- DEAD
                 if (pathname === '/card/info') ...         <- DEAD
  
  Lines 218-236: if (pathname.startsWith("/admin/")) ...   <- also DEAD (inside the pHex/cHex block)
                 ...
  ```
- **Issue:** The route guards at lines 75-93 are the only ones that can execute. The `if (pathname !== "/") return 404` check at line 96-99 ensures no request ever reaches the second set (lines 102-120). The third set at lines 218-236 is inside the `if (pHex && cHex)` block, which itself returns before line 218 via one of the payment method branches.
- **Impact:** The second and third registration blocks are dead code. More critically, `handleCardPage()` at lines 82 and 109 calls a function that is never defined or imported in `index.js`, which would throw a `ReferenceError` if those lines were ever executed.

---

### Bug 12 — `process.env.ISSUER_KEY` unavailable in CF Workers; silently falls back to dev key

- **File:** `keygenerator.js:10-22`
- **Severity:** CRITICAL
- **Code:**
  ```js
  const getIssuerKey = () => {
    try {
      if (typeof process !== 'undefined' && process.env && process.env.ISSUER_KEY) {
        return process.env.ISSUER_KEY;
      }
    } catch (e) {}
    return "00000000000000000000000000000001";  // dev fallback
  };
  const ISSUER_KEY = hexToBytes(getIssuerKey());
  ```
- **Issue:** Cloudflare Workers do not provide a `process.env` object with secrets. Secrets set via `wrangler secret put ISSUER_KEY` are injected as global variables in the worker environment, not via `process.env`. The `try` block quietly catches or bypasses this, and `getIssuerKey()` always returns the dev fallback `00000000000000000000000000000001`. This constant is initialized at module load time (top-level), so it cannot be changed at runtime.
- **Impact:** In production, all card keys are derived from a publicly known dev key. Any attacker knowing a card's UID can reproduce all its keys (K0-K4) and perform unauthorized withdrawals. This is a critical security vulnerability for any live deployment.

---

## Durable Objects Status

Three Durable Object classes are defined and declared in `wrangler.toml`, but none are exported from `index.js`.

Cloudflare Workers requires that the class be exported from the worker script:

```js
// Required in index.js (missing):
export { CardDO } from './durableObjects/CardDO.js';
export { BackendRegistryDO } from './durableObjects/BackendRegistryDO.js';
export { AdminDO } from './durableObjects/AdminDO.js';
```

Without these exports, `wrangler deploy` will fail or the runtime will be unable to instantiate the objects. Any code path accessing `env.CARD_OBJECTS`, `env.BACKEND_REGISTRY`, or `env.ADMIN_AUDIT` will fail at runtime.

### Durable Object Implementations

| Class | File | Lines | Methods |
|---|---|---|---|
| `CardDO` | `durableObjects/CardDO.js` | 59 | `getCard()`, `validateAndUpdateCounter(ctr)` (1 param), `updateCard(updates)`, `getCounter()` |
| `BackendRegistryDO` | `durableObjects/BackendRegistryDO.js` | 87 | `getBackend(id)`, `listBackends()`, `createBackend(backend)`, `updateBackend(id, updates)`, `deleteBackend(id)`, `checkAccess(cardUid, backendId)` |
| `AdminDO` | `durableObjects/AdminDO.js` | 42 | `logAction(action, details)`, `getAuditLog(limit)` |

---

## Test Coverage Map

### Test Files

| File | Tests | Framework |
|---|---|---|
| `tests/cryptoutils.test.js` | 7 | Jest |
| `tests/keygenerator.test.js` | 1 | Jest |
| `tests/worker.test.js` | 4 | Jest (imports `handleRequest` directly) |

### Functions Tested

| Function | File | Tested In | Coverage |
|---|---|---|---|
| `hexToBytes` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `bytesToHex` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `xorArrays` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `shiftGo` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `computeAesCmac` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (length only) |
| `buildVerificationData` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `computeAesCmacForVerification` | `cryptoutils.js` | `cryptoutils.test.js` | Yes |
| `decryptP` | `cryptoutils.js` | `cryptoutils.test.js` | Yes (via test vector) |
| `getDeterministicKeys` | `keygenerator.js` | `keygenerator.test.js` | Yes (1 UID) |
| `handleRequest` (full flow) | `index.js` | `worker.test.js` | Partial (4 paths) |
| `fetchBoltCardKeys` | `handlers/fetchBoltCardKeys.js` | `worker.test.js` | Yes (KeepVersion) |
| `handleLnurlpPayment` | `handlers/lnurlHandler.js` | `worker.test.js` | Yes (POST only) |

### Functions NOT Tested

| Function | File | Notes |
|---|---|---|
| `verifyCmac` | `cryptoutils.js` | Indirectly exercised via `buildVerificationData` but no dedicated test |
| `computeKs` | `cryptoutils.js` | Not tested directly |
| `computeCm` | `cryptoutils.js` | Not tested directly |
| `generateSubkeyGo` | `cryptoutils.js` | Not tested directly |
| `bytesToDecimalString` | `cryptoutils.js` | Not tested |
| `extractUIDAndCounter` | `boltCardHelper.js` | Not tested directly |
| `validate_cmac` | `boltCardHelper.js` | Not tested |
| `decodeAndValidate` | `boltCardHelper.js` | Not tested |
| `getUidConfig` | `getUidConfig.js` | Not tested |
| `handleActivateCardPage` | `handlers/activateCardHandler.js` | Not tested |
| `handleActivateCardSubmit` | `handlers/activateCardHandler.js` | Not tested |
| `handleNfc` | `handlers/handleNfc.js` | Not tested |
| `handleStatus` | `handlers/statusHandler.js` | Not tested |
| `constructWithdrawResponse` | `handlers/withdrawHandler.js` | Not tested |
| `handleProxy` | `handlers/proxyHandler.js` | Not tested |
| `handleProgram` | `handlers/programHandler.js` | Not tested |
| `handleReset` | `handlers/resetHandler.js` | Not tested |
| `processWithdrawalPayment` | `handlers/lnurlHandler.js` | Not tested |
| `setupAdminRoutes` | `admin/routes.js` | Not tested |
| All admin handlers | `admin/handlers.js` | Not tested |
| `handleCardAuth` | `card-portal/handlers.js` | Not tested |
| `handleCardInfo` | `card-portal/handlers.js` | Not tested |
| All Durable Object methods | `durableObjects/*.js` | Not tested |
| Logger methods | `utils/logger.js` | Not tested |

---

## Known Limitations

### Cryptographic

1. **AES-ECB only via aes-js.** The Web Crypto API (`crypto.subtle`) built into the CF Workers runtime does not support AES-ECB mode. All AES operations must use the `aes-js` npm package, which requires bundling. This is a fundamental constraint of the CF platform and cannot be changed without dropping Web Crypto.

2. **CMAC implementation is custom.** The AES-CMAC implementation in `cryptoutils.js` is hand-rolled against RFC 4493. It has been validated against 1 test vector. No independent audit has been performed.

3. **Static K2 lookup in `validate_cmac`.** `boltCardHelper.js validate_cmac` ignores its caller-supplied K2 and reads from `staticUidConfig` instead. This means CMAC validation only works for the 4 UIDs hardcoded in `getUidConfig.js`. Cards configured via KV always fail validation (see Bug 7).

4. **Proxy-side CMAC policy needs an explicit configuration model.** The worker now supports two trust models: (a) full local verification when `K2` is present, and (b) decrypt-only relay for `payment_method: "proxy"` with `proxy.baseurl` but no `K2`, where downstream LNBits/BTCPay is responsible for validating `c` and enforcing replay protection. Follow-up issue: make this trust policy explicit in config/docs instead of inferring it from the presence or absence of `K2` on proxy entries.

### Service Worker vs. Module Worker Format

`index.js` uses the service worker format (`addEventListener('fetch', ...)`) with a manual `export { handleRequest }` for testing. The Durable Object bindings require module worker format (`export default { fetch() {} }`) to work correctly. The current format may not support Durable Object exports properly.

### Replay Protection Depends on Durable Objects

Counter-based replay protection (via `CardDO.validateAndUpdateCounter`) depends on Durable Objects being operational. Since Durable Object classes are not exported from `index.js`, replay protection is non-functional. Any counter value is accepted, allowing replay attacks.

### No Authentication on `/activate`

The `/activate` endpoint accepts any UID and writes to KV without any authentication. An attacker with network access to the worker can register arbitrary UIDs with their own K2 keys, hijacking payment processing for those UIDs.

### Hardcoded Production Domain

`handlers/statusHandler.js:35` and `handlers/withdrawHandler.js:77` hardcode `boltcardpoc.psbt.me` as the worker domain. Deploying to a different domain requires manual find-and-replace in multiple files.

### Fake Wallet Intentional Failure Pattern

`handlers/lnurlHandler.js:164` implements an alternating success/failure pattern (`fakewalletCounter % 2 === 0`). The counter is a module-level variable reset to 0 on every cold start. This is not a bug per se, but callers must be aware that every other request will fail. This is unsuitable for production.

### No Rate Limiting or Abuse Prevention

There is no rate limiting on any endpoint. The `/` endpoint (LNURLW verification) performs cryptographic operations on every request without any throttling. The `/activate` endpoint writes to KV on every request.

### `wrangler.toml` Has No `migrations` Block for Durable Objects

Durable Object deployments require a `[[migrations]]` block in `wrangler.toml` for the initial creation. Without it, deploying Durable Objects may fail or require manual intervention.
