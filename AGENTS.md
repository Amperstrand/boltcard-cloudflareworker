# Boltcard Cloudflare Worker — Agent Context

## Architecture

- **Runtime**: Cloudflare Workers (no Node.js APIs)
- **Routing**: itty-router v5
- **Storage**: KV for UID config; Durable Objects (SQLite-backed) for replay protection + balance + card state
- **Crypto**: `aes-js` for AES-ECB/CMAC, `@noble/secp256k1` + `@scure/base` + `@noble/hashes` for bolt11
- **Key derivation**: deterministic from UID + ISSUER_KEY via `keygenerator.js`

## Payment Methods

| Method | Flow | Notes |
|--------|------|-------|
| `fakewallet` | Internal accounting via DO balance | Generates fake bolt11 invoices to random nonexistent nodes |
| `clnrest` | POST to Core Lightning REST API | Requires rune auth |
| `proxy` | Relay to downstream LNBits | CMAC optionally deferred |
| `lnurlpay` | LNURL-pay flow (POS cards) | Lightning address routing |
| `twofactor` | NFC-based 2FA | OTP generation |

## Card Lifecycle States

`new` → `keys_delivered` → `active` → (`wipe_requested` → `active`) | `terminated` | `legacy`

- `getUidConfig()` falls back to deterministic key generation if no DO config exists — cards always resolve
- `new` state cards get `activeVersion=1` (legacy path)
- `wipe_requested` is a transient state; card returns to `active` after re-provisioning

## Dependencies — Known Quirks

### @noble/secp256k1 v3
- Requires explicit hash injection at module load:
  ```js
  import { sha256 } from "@noble/hashes/sha2.js";
  import { hmac } from "@noble/hashes/hmac.js";
  secp.hashes.sha256 = sha256;
  secp.hashes.hmacSha256 = (key, data) => hmac(sha256, key, data);
  ```

### @noble/hashes
- Import path MUST include `.js` extension: `"@noble/hashes/sha2.js"` (not `"@noble/hashes/sha2"`)

### @scure/base (not @scure/bech32)
- bech32 lives inside `@scure/base`: `import { bech32 } from "@scure/base"`
- `bech32.encode()` has a 90-char default limit — pass a large number as 3rd arg for bolt11: `bech32.encode(hrp, words, 1024)`

## Bolt11 Invoice Format (BOLT #11)

- HRP: `lnbc` + amount (e.g. `lnbc20u`, `lnbc500n`, `lnbc10p`) + `1` separator
- Data: 5-bit words encoding timestamp (35 bits) + tagged fields + signature (65 bytes)
- Tag types: 1=payment_hash, 13=description, 6=expiry, 19=payee, 23=purpose_hash
- Signature: r(32) || s(32) || footer(1) where footer bit 0 = recovery flag

## Fakewallet POS Flow

1. Card tap → `GET /?p=XXX&c=YYY` → `handleLnurlw()` → `constructWithdrawResponse()`
2. POS receives `{tag:"withdrawRequest", callback, k1, minWithdrawable, maxWithdrawable}`
3. POS calls `GET /api/fake-invoice?amount=XXXX` → `{pr: "lnbc..."}`
4. POS calls callback: `GET /boltcards/api/v1/lnurl/cb/PVALUE?k1=K1VALUE&pr=lnbc...&amount=XXXX`
5. Handler: decrypt p, validate CMAC, record tap, `processWithdrawalPayment()` → `debitCard()`

## Identity / Access Control Demo

1. User taps card on `/identity` page → Web NFC reads NDEF URL → extracts p and c params
2. Page calls `GET /api/verify-identity?p=XXX&c=YYY`
3. Handler: decrypt UID via `extractUIDAndCounter()`, validate CMAC, check KV enrollment
4. Returns `{ verified: true, uid, maskedUid, profile }` or `{ verified: false, reason }`
5. Page shows deterministic fake profile (name, role, department, clearance) derived from UID
6. Only cards with explicit KV entries pass identity check (deterministic fallback cards are rejected)

## Routes

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/` | `handleLnurlw()` | Card tap entry point (LNURL-withdraw) |
| GET | `/status` | `handleStatus()` | Health check + KV connectivity |
| ALL | `/boltcards/api/v1/lnurl/cb*` | `handleLnurlpPayment()` | LNURL-pay payment callback |
| GET | `/lnurlp/cb` | `handleLnurlPayCallback()` | LNURL-pay callback (POS cards) |
| GET | `/2fa` | `handleTwoFactor()` | TOTP + HOTP one-time passwords |
| GET | `/login` | `handleLoginPage()` | Login page |
| POST | `/login` | `handleLoginVerify()` | Login verification |
| GET | `/pos` | redirect → `/operator/pos` | Fakewallet POS payment |
| GET | `/debug` | `handleDebugPage()` | Tabbed debug console (Console, Identify, Wipe, 2FA, Identity, POS) |
| GET | `/identity` | `handleIdentityPage()` | Identity/access control demo |
| GET | `/api/fake-invoice` | inline | Generate fake bolt11 for fakewallet |
| GET | `/api/verify-identity` | `handleIdentityVerify()` | Identity verification API |
| POST | `/api/identity/profile` | `handleIdentityProfileUpdate()` | Identity profile update |
| POST | `/api/identify-card` | `handleIdentifyCard()` | Operator card identification |
| POST | `/api/identify-issuer-key` | `handleIdentifyIssuerKey()` | Tap-to-detect issuer key + version |
| POST | `/api/balance-check` | `handleBalanceCheck()` | Card balance query |
| GET | `/api/pos/menu` | `handleMenuGet()` | POS menu retrieval (JSON) |
| GET | `/api/receipt/:txnId` | `handleReceipt()` | Transaction receipt |
| GET | `/api/keys` | `handleGetKeys()` | Key listing (GET) |
| POST | `/api/keys` | `handleGetKeys()` | Key listing (POST) |
| GET | `/api/bulk-wipe-keys` | `handleBulkWipeKeys()` | Bulk wipe key candidates |
| ALL | `/api/v1/pull-payments/:id/boltcards` | `fetchBoltCardKeys()` | Pull-payment boltcard keys |
| GET | `/operator/login` | `handleOperatorLoginPage()` | Operator PIN login page |
| POST | `/operator/login` | `handleOperatorLogin()` | Operator PIN verify |
| POST | `/operator/logout` | `handleOperatorLogout()` | Operator session logout |
| GET | `/operator` | redirect → `/operator/pos` | Operator dashboard |
| GET | `/operator/pos` | `handlePosPage()` | POS terminal |
| POST | `/operator/pos/charge` | `handlePosCharge()` | POS charge submit |
| GET | `/operator/pos/menu` | `handleMenuEditorPage()` | Menu editor page |
| PUT | `/operator/pos/menu` | `handleMenuPut()` | Menu update |
| GET | `/operator/topup` | `handleTopupPage()` | Card top-up page |
| POST | `/operator/topup/apply` | `handleTopupApply()` | Top-up submit |
| GET | `/operator/refund` | `handleRefundPage()` | Card refund page |
| POST | `/operator/refund/apply` | `handleRefundApply()` | Refund submit |
| GET | `/experimental/nfc` | redirect → `/debug#console` | Redirects to unified console |
| GET | `/experimental/activate` | `handleActivatePage()` | Card programming + activation |
| GET | `/experimental/activate/form` | `handleActivateForm()` | Activation form page |
| POST | `/activate/form` | `handleActivateCardSubmit()` | Card activation submit |
| GET | `/experimental/wipe` | inline | Single card wipe |
| GET | `/experimental/bulkwipe` | `handleBulkWipePage()` | Batch card operations |
| GET | `/experimental/analytics` | `handleAnalyticsPage()` | Per-card analytics |
| GET | `/experimental/analytics/data` | `handleAnalyticsData()` | Analytics data (JSON) |
| GET | `/wipe` | inline | Short → `/experimental/wipe` |
| GET | `/nfc` | redirect → `/debug#console` | Short URL redirect |
| GET | `/activate` | redirect → `/experimental/activate` | Short URL redirect |
| GET | `/activate/form` | redirect → `/experimental/activate/form` | Short URL redirect |
| GET | `/bulkwipe` | redirect → `/experimental/bulkwipe` | Short URL redirect |
| GET | `/analytics` | redirect → `/experimental/analytics` | Short URL redirect |
| GET | `/favicon.ico` | 204 | Empty favicon |

## Conventions

- `errorResponse()` from `utils/responses.js` for all error paths
- `renderTailwindPage()` + `rawHtml` tagged template for all HTML pages (auto-escapes interpolations; use `safe()` for known-safe HTML, `jsString()` for JS contexts)
- `validateCardTap()` from `utils/validateCardTap.js` for card-tap validation in operator handlers
- `BROWSER_NFC_HELPERS` + `BROWSER_VALIDATE_UID_HELPER` from `templates/browserNfc.js` for NFC pages (includes `CSRF_FETCH_HELPER` for automatic CSRF token injection, `createNfcScanner()` for shared scan-loop wrapper)
- All NFC pages auto-start scanning on page load; `/operator/pos` auto-starts after amount is entered (debounced 1s)
- CSRF: double-submit cookie (`op_csrf`) on operator pages; `withOperatorAuth` validates on mutating methods; test bypass via `__TEST_OPERATOR_SESSION`
- LNURLW replay: Step 1 (`GET /`) atomically advances counter via `checkAndAdvanceCounter`; callback detects replay via `listTaps` bolt11 check
- Tests use `makeReplayNamespace()` (in-memory DO mock) from `tests/replayNamespace.js`
- Commit style: semantic (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`)
- Never commit without explicit user request
- Keep `aes-js` — do not switch to `node:crypto`-dependent libraries

## Test Baseline

- Run: `npm test` (uses Jest with `--experimental-vm-modules`)
- Deploy: `npm run deploy` (tests → build_keys → wrangler deploy)
- **788 tests** across 51 test suites (as of 2026-04-25)

## Test Inventory

| File | Tests | Coverage |
|------|-------|----------|
| `tests/cryptoutils.test.js` | AES-CMAC, hex utils, XOR, subkey generation | |
| `tests/keygenerator.test.js` | Deterministic key derivation | |
| `tests/bolt11.test.js` | Fake bolt11 invoice generation | |
| `tests/otp.test.js` | HOTP/TOTP generation (RFC 4226 vectors) | |
| `tests/responses.test.js` | All `utils/responses.js` exports | |
| `tests/validation.test.js` | `validateUid`, `getRequestOrigin` | |
| `tests/rateLimiter.test.js` | IP-based rate limiting with KV mock | |
| `tests/boltCardHelper.test.js` | `decodeAndValidate` with virtual tap helper | |
| `tests/currency.test.js` | `formatAmount`, `parseAmount`, `getCurrencyDecimals` | |
| `tests/lightningAddress.test.js` | `resolveLightningAddress` with mocked fetch | |
| `tests/cmacScan.test.js` | `cmacScanVersions` multi-version scan | |
| `tests/keyLookup.test.js` | `fingerprintHex`, `getPerCardDomains`, `getIssuerKeysForDomain` | |
| `tests/operatorAuth.test.js` | Session create/verify, PIN check, CSRF | |
| `tests/logging.test.js` | Structured JSON logger | |
| `tests/loginHandler.test.js` | NFC login, wipe, terminate, top-up via `/login` | |
| `tests/getUidConfig.test.js` | Config lookup with DO mock | |
| `tests/getKeysHandler.test.js` | Key listing handler | |
| `tests/identifyIssuerKey.test.js` | Tap-to-detect issuer key | |
| `tests/twoFactorHandler.test.js` | TOTP/HOTP code generation | |
| `tests/validateCardTap.test.js` | Card tap validation (replay, CMAC, state, auto-activate) | |
| `tests/balanceCheckHandler.test.js` | Balance query with valid/invalid taps | |
| `tests/analyticsHandler.test.js` | Analytics page + data endpoint | |
| `tests/menuEditorHandler.test.js` | Menu GET/PUT/Editor with auth | |
| `tests/receiptHandler.test.js` | Plain-text transaction receipts | |
| `tests/identifyCardHandler.test.js` | Card identification (config + deterministic match) | |
| `tests/operatorLoginHandler.test.js` | PIN login, rate limiting, session, logout | |
| `tests/securityHeaders.test.js` | X-Content-Type-Options, X-Frame-Options, etc. | |
| `tests/bulkWipe.test.js` | Bulk wipe key candidates | |
| `tests/operatorFlows.test.js` | Top-up, refund, POS charge (full lifecycle) | |
| `tests/pos.test.js` | POS page rendering | |
| `tests/smoke.test.js` | Basic route smoke tests | |
| `tests/integration.test.js` | LNURLW flow, status, 404 handling | |
| `tests/templateHelpers.test.js` | Template rendering, error payloads | |
| `tests/templateIntegrity.test.js` | Page shell consistency | |
| `tests/responsePatterns.test.js` | Response format consistency | |
| `tests/debugIdentity.test.js` | Identity verification via debug console | |
| `tests/lnurlPay.test.js` | LNURL-pay flow with Lightning address | |
| `tests/lnurlwHandler.test.js` | LNURLW tap processing: fakewallet, clnrest, proxy, lnurlpay, replay, CMAC, card lifecycle | |
| `tests/lnurlHandler.test.js` | LNURL callback: fakewallet debit, clnrest (success/error/network), replay, tap status | |
| `tests/replayProtection.test.js` | All replayProtection.js exports: counter checks, tap recording, card state, config, balance, analytics | |
| `tests/proxyHandler.test.js` | Proxy relay: headers, CMAC validation/deferred, POST body, error handling | |
| `tests/refundTopupPos.test.js` | Refund (full/partial/zero), top-up (amount/MAX), POS charge (balance/items) | |
| `tests/wipeResetHandler.test.js` | Wipe page, card reset (active/terminated/new/keys_delivered) | |
| `tests/fetchBoltCardKeys.test.js` | Card provisioning, POS/2FA programming, reset flow | |
| `tests/activateCardHandler.test.js` | Quick-activate UID, validation, key consistency | |
| `tests/tapTracking.test.js` | Two-step tap flow: read → callback → completed, tap history | |
| `tests/e2e/virtual-card.test.js` | Full E2E lifecycle: provision → tap → pay → replay | |
| `tests/identityHandler.test.js` | Identity verification, profile update, CMAC, enrollment | |
| `tests/bulkWipePageHandler.test.js` | Bulk wipe page rendering with key fingerprints | |
| `tests/withdrawHandler.test.js` | Withdraw response: CMAC-failed, fakewallet/clnrest amounts | |

## Test-Only Exports

The following exports are prefixed with `_` and only used in tests:
- `cryptoutils.js`: `_bytesToDecimalString`, `_xorArrays`, `_shiftGo`, `_generateSubkeyGo`, `_computeKs`, `_computeCm`, `_computeAesCmacForVerification`
- `utils/keyLookup.js`: `_getIssuerKeysForDomain`, `_getPerCardDomains`
- `utils/currency.js`: `_parseAmount`
- `utils/responses.js`: `_buildErrorPayload`

## Security

- Security headers applied to all responses via `withSecurityHeaders()` in `index.js`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- All innerHTML assignments use `esc()` for dynamic data (41 assignments audited)
- `/2fa` endpoint supports JSON response mode via `Accept: application/json` header (prevents raw HTML injection in debug console)
