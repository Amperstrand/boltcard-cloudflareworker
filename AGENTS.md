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
