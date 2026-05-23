# Boltcard Cloudflare Worker — Agent Context

## Architecture

- **Runtime**: Cloudflare Workers (no Node.js APIs)
- **Routing**: itty-router v5
- **Storage**: KV for UID config; Durable Objects (SQLite-backed) for replay protection + balance + card state
- **DO concurrency**: Each card maps to a unique Durable Object instance (keyed by UID). DOs are **single-threaded** — requests to the same card are processed sequentially. There are NO race conditions within a single card DO. Do not flag "concurrent callback" issues — they cannot happen in production.
- **Crypto**: `aes-js` for AES-ECB/CMAC, `@noble/secp256k1` + `@scure/base` + `@noble/hashes` for bolt11
- **Key derivation**: deterministic from UID + ISSUER_KEY via `keygenerator.ts`

## Payment Methods

| Method | Flow | Notes |
|--------|------|-------|
| `fakewallet` | Internal accounting via DO balance | Generates fake bolt11 invoices to random nonexistent nodes |
| `clnrest` | POST to Core Lightning REST API | Requires rune auth |
| `proxy` | Relay to downstream LNBits | CMAC optionally deferred |
| `lnurlpay` | LNURL-pay flow (POS cards) | Lightning address routing |
| `twofactor` | NFC-based 2FA | OTP generation |

## Card Lifecycle States

```
(no DO row) ──────────────────────────────────────────────→ legacy (fallback)
     │                                                         │
     │ key fetch (fetchBoltCardKeys)                            │ first tap with known issuer key
     ↓                                                         ↓
   pending ──────── first tap (CMAC validates) ──────→ discovered
     │                                                         │
     │ operator programs via /experimental/activate             │ treated like active for taps
     ↓                                                         │
   keys_delivered ──── first tap ────→ active
     │                                    │
     │                                    ├── wipe_requested → active (re-provisioned)
     │                                    ├── terminated
     │                                    └── legacy (no longer created for new cards)
     └── active_version set on activation
```

- `getUidConfig()` falls back to deterministic key generation if no DO config exists — cards always resolve
- `new`/`legacy` state: no DO row, first tap triggers auto-discovery via CMAC scan
- `pending`: keys fetched but card never tapped — upgraded to `discovered` on first tap
- `discovered`: card tapped with known issuer key, not user-provisioned — treated like `active`
- `keys_delivered`: operator has programmed keys, first tap activates
- `wipe_requested` is a transient state; card returns to `active` after re-provisioning

### Key Provenance

Every card DO row tracks `key_provenance` indicating where its keys came from:

| Provenance | Meaning | `programmingRecommended` |
|---|---|---|
| `public_issuer` | Key is in `generatedKeyData.js` (git-tracked, auto-generated) | `true` |
| `env_issuer` | Matches `env.ISSUER_KEY` and not public | `false` |
| `percard` | Per-card import from CSV | `false` |
| `user_provisioned` | Explicitly programmed by user | `false` |
| `unknown` | Neither public nor env key | `false` |

- `classifyIssuerKey(env, hex)` from `utils/keyLookup.ts` — classifies any issuer key hex
- `fingerprintHex(hex)` — first 16 chars of sha256(key_hex), used as stable identifier
- Provenance stored in DO `card_state` table: `key_provenance`, `key_fingerprint`, `key_label`

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

### @cloudflare/vitest-pool-workers
- Miniflare's `sql.exec()` does NOT reliably return `rowsAffected` — use `RETURNING` clause instead
- DO integration tests use unique DO IDs per test (auto-incrementing counter) — no state leakage
- Tests run in `vitest.do.config.js` with `cloudflareTest` plugin — NOT in the main vitest config

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

### k1=c Convention

The LNURL-withdraw response sets `k1` to the card's CMAC value (`c` parameter), not a random challenge. This is a boltcard convention: the callback includes `k1` which the server matches against the original `c` to verify the callback is for the correct card tap. See `constructWithdrawResponse()` in `handlers/withdrawHandler.ts`.

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
| GET | `/card` | `handleCardPage()` | Cardholder dashboard (NFC scan) |
| GET | `/card/info` | `handleCardInfo()` | Card status API (JSON) — returns unified history, analytics, payment method |
| GET | `/decode` | `handleDecodePage()` | BOLT11 invoice decoder page |
| POST | `/api/card/lock` | `handleCardLock()` | Cardholder self-service card lock (CMAC auth) |
| POST | `/api/card/reactivate` | `handleCardReactivate()` | Cardholder self-service re-provision (NFC tap, version advance) |
| GET | `/api/fake-invoice` | `handleFakeInvoice()` | Generate fake bolt11/SPAYD/UPI/payto for fakewallet |
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
| GET | `/api/decode` | `handleDecodeApi()` | BOLT11 invoice decode (JSON) |
| ALL | `/api/v1/pull-payments/:pullPaymentId/boltcards` | `fetchBoltCardKeys()` | Pull-payment boltcard keys |
| GET | `/operator/login` | `handleOperatorLoginPage()` | Operator PIN login page |
| POST | `/operator/login` | `handleOperatorLogin()` | Operator PIN verify |
| POST | `/operator/logout` | `handleOperatorLogout()` | Operator session logout |
| GET | `/operator` | redirect → `/operator/pos` | Operator dashboard |
| GET | `/operator/cards` | `handleCardAuditPage()` | Card registry audit page |
| GET | `/operator/cards/data` | `handleCardAuditData()` | Card registry data (JSON) |
| POST | `/operator/cards/batch` | `handleCardBatchAction()` | Batch card operations (terminate/wipe/activate/reprovision) |
| POST | `/operator/cards/repair` | `handleIndexRepair()` | Card index repair (sync KV with DO state) |
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

- `errorResponse()` from `utils/responses.ts` for all error paths
- `redirect()` from `utils/responses.ts` for all HTTP redirects
- `renderTailwindPage()` + `rawHtml` tagged template for all HTML pages (auto-escapes interpolations; use `safe()` for known-safe HTML, `jsString()` for JS contexts)
- `validateCardTap()` from `utils/validateCardTap.ts` for card-tap validation in operator handlers
- Static JS files served from `/static/js/:file` via `serveStaticJs()` from `static/js/registry.ts` — shared browser helpers (`nfc.js`, `helpers.js`, `csrf.js`) + per-page JS files; all templates load via `<script src>` tags (see `static/js/exports.ts` for content)
- `replayProtection.ts` uses generic DO facade helpers (`doCounterPost`, `doRequiredPost`, `doOptionalGet`, `doOptionalPost`, `doSafeGet`, `doOptionalVoidPost`) — avoids repetitive getStub→doPost→parseJSON
- All NFC pages auto-start scanning on page load; `/operator/pos` auto-starts after amount is entered (debounced 1s)
- CSRF: double-submit cookie (`op_csrf`) on operator pages; `withOperatorAuth` validates on mutating methods; test bypass via `__TEST_OPERATOR_SESSION`
- `POST /login` privileged actions (top-up, terminate, request-wipe) require operator auth via `requireOperator()`
- LNURLW replay: Step 1 (`GET /`) atomically advances counter via `checkAndAdvanceCounter`; callback detects replay via `listTaps` bolt11 check
- `matchCardIssuer()` from `utils/cardMatching.ts` for shared card issuer detection across loginHandler and identifyIssuerKeyHandler
- `CARD_STATE` and `PAYMENT_METHOD` enums from `utils/constants.ts` — use instead of raw strings
- Card state predicates from `utils/constants.ts`: `isCardUsable()`, `isCardTerminated()`, `canAutoActivate()`, `isCardNew()`, `canTransact()` — use instead of raw `=== CARD_STATE.X` comparisons
- `UID_VALIDATION_MSG` from `utils/constants.ts` — shared error message for all UID validation failures
- `parseJsonBody()` from `utils/responses.ts` for JSON request body parsing (returns null on failure, no need for `.catch()`)
- `parsePositiveInt(raw, max)` from `utils/validation.ts` for positive integer validation with optional max
- `resolveCardIdentity()` from `utils/cardAuth.ts` — shared decrypt→state→config→CMAC pipeline with `skipCmac`/`requireState`/`forcedVersion`/`context` options
- `constantTimeEqual()` from `utils/cookies.ts` for timing-safe string comparison (CSRF tokens, PINs)
- `checkReplayAndRecordTap()` from `handlers/lnurlwHandler.ts` for replay check + tap recording (shared by proxy and fakewallet/clnrest paths)
- `discoverUnknownCard()` from `handlers/lnurlwHandler.ts` for auto-discovery of unknown cards via CMAC scan across all issuer key candidates
- `setCardK2()` from `replayProtection.ts` for targeted K2-only update in DO card_config (used during discovery to persist correct K2 without overwriting payment_method)
- `markPending()` and `discoverCard()` from `replayProtection.ts` for DO row creation during key fetch and first tap
- DO `handleDiscover` upgrades `pending`, `new`, and `legacy` states to `discovered`; `new`/`legacy` with no DO row take the INSERT path instead
- DO `/set-k2` endpoint for targeted K2-only update (preserves existing `payment_method` and `config_json`); called via `setCardK2()` during card discovery
- `indexCard()`, `deindexCard()`, `getIndexedCard()`, `listIndexedCards()`, `repairCardIndex()` from `utils/cardIndex.ts` for KV-backed card registry (prefix `card_idx:`, TTL 7 days)
- `replayProtection.ts` calls `await indexCard()` on all 6 state transitions: `markPending`, `discoverCard`, `deliverKeys`, `activateCard`, `terminateCard`, `requestWipe`
- `recordAuditEvent()` from `utils/auditLog.ts` for persistent operator action log (prefix `audit_log:`, TTL 90 days). Called from topup, refund, POS charge, batch operations.
- `getCardProgrammingEndpoint()` from `handlers/loginActions.ts` for card config → pull payment → programming endpoint lookup (shared by 4 call sites)
- `safeGetBalance()` exported from `replayProtection.ts` — graceful balance fetch fallback (used by `loginHandler.ts` and `cardDashboardHandler.ts`)
- `durableObjects/CardReplayDO.ts` is a thin Durable Object shell/dispatcher; SQL schema and route handlers live under `durableObjects/cardReplay/` grouped by responsibility (schema, tap/replay, card state, config, balance/transactions)
- All DO callers must wrap in try/catch with specific error messages (see #10 audit)
- `processWithdrawalPayment` uses `normalizedUid` local variable — never mutate parameters
- Tests use `makeReplayNamespace()` (in-memory DO mock) from `tests/replayNamespace.ts`
- Commit style: semantic (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`)
- Never commit without explicit user request
- Keep `aes-js` — do not switch to `node:crypto`-dependent libraries

## Test Baseline

- Run: `npm test` (Vitest, node environment)
- Run DO tests: `npm run test:do` (Vitest, `@cloudflare/vitest-pool-workers` with real SQLite)
- Run all: `npm run test:all`
- Deploy: `npm run deploy` (unit tests → DO tests → build_keys → wrangler deploy → live smoke test)
- Lint: `npm run lint:innerhtml` (zero innerHTML tolerance, enforced by `scripts/check-innerhtml.js`)
- Sync JS exports: `node scripts/sync-js-exports.mjs` (auto-regenerates `static/js/exports.ts` with SHA-256 hashes)
- **1377 unit tests** across 76 test suites + **52 DO integration tests** = 1429 total
- TypeScript: `tsc --noEmit` passes with `strict: true`, 0 errors (source + tests)
- Source `: any` count: 0; source `as any` count: 0; `// @ts-nocheck` only in `tests/do/cardReplayDO.real.test.ts` and `tests/testHelpers.ts`

## Next Steps

### Polish & Cleanup

| Task | Priority | Notes |
|------|----------|-------|
| Dead exports cleanup | Done | Prefixed with `_`: `_deindexCard`, `_getIndexedCard`, `_listAuditEvents`, `_mergeHistory` |
| Missing handler tests | Medium | `debugHandler.ts`, `statusHandler.ts`, `posHandler.ts` lack dedicated test files (partially covered by `smoke.test.ts`, `pos.test.ts`, `e2e/pages.test.ts`) |
| Deduplicate `VERSION_SCAN_RANGE` | Done | Already imported from `utils/constants.ts` in all consumers |
| Extract `MAX_CANDIDATES` to constants | Done | Already `MAX_ISSUER_CANDIDATES` in `utils/constants.ts` |
| Extract KV list limits to constants | Done | `KV_LIST_LIMIT`, `CARD_AUDIT_DEFAULT_LIMIT`, `CARD_AUDIT_MAX_LIMIT`, `AUDIT_LIST_DEFAULT_LIMIT` in `utils/constants.ts` |
| UID validation messages normalized | Done | All handlers use `UID_VALIDATION_MSG` from `utils/constants.ts` |
| Redundant `.catch(() => null)` removed | Done | `parseJsonBody()` already returns null on failure |
| Redundant ALTER TABLE removed | Done | `pull_payment_id` already in CREATE TABLE |
| Card state predicates extracted | Done | `isCardUsable`, `isCardTerminated`, etc. in `utils/constants.ts` |
| `parsePositiveInt()` extracted | Done | Shared positive int validator in `utils/validation.ts` |
| `resolveCardIdentity()` shared pipeline | Done | `utils/cardAuth.ts` — decrypt→state→config→CMAC across 5 handlers |
| TypeScript type tightening | Done | Source `: any` 318→0; source `as any` count: 0; `// @ts-nocheck` only in `tests/do/cardReplayDO.real.test.ts` and `tests/testHelpers.ts`; `types/core.ts` centralizes shared types; `catch(e: unknown)` + `getErrorMessage()` throughout |
| Shared `Env` type | Done | `types/core.ts` → `worker-configuration.d.ts` — eliminated 9 duplicate `EnvLike` interfaces |
| Inline JS → static files | Done | 17 static JS files in `static/js/`, zero inline `<script>` blocks, `serveStaticJs()` in `static/js/registry.ts` |
| Dead code cleanup | Done | Deleted `templates/browserNfc.ts` (all 9 exports unused after static JS extraction) |
| Router cleanup | Done | `index.ts` 372→249 lines: fake-invoice handler extracted to `handlers/fakeInvoiceHandler.ts`, static JS registry extracted |
| replayProtection DRY | Done | 334→288 lines: 6 generic DO facade helpers, 16 exports rewritten to 1-3 lines |
| Test `: any` reduction | Done | 67 `: any` annotations replaced with proper types across 17 test files |
| CardReplayDO split | Done | 933-line god object split into dispatcher + `durableObjects/cardReplay/` modules while preserving all DO route contracts |

### Feature Development

| Task | Priority | Notes |
|------|----------|-------|
| Real Lightning integration | High | Currently all fakewallet; wire up `clnrest` or LND for real Bitcoin payments |
| Multi-venue / multi-tenant | Medium | Namespace cards per venue, operator-scoped access |
| Cardholder PWA | Medium | Rich dashboard with push notifications, spending history, QR top-up |
| GitHub #5: verifiable credentials | Low | Embed VC in payment JSON |
| GitHub #3: SSH 2FA via NTAG424 | Low | NFC-based SSH authentication |

## Test-Only Exports

The following exports are prefixed with `_` and only used in tests:
- `cryptoutils.ts`: `_bytesToDecimalString`, `_xorArrays`, `_shiftGo`, `_generateSubkeyGo`, `_computeKs`, `_computeCm`, `_computeAesCmacForVerification`
- `utils/keyLookup.ts`: `_getIssuerKeysForDomain`, `_getPerCardDomains`
- `utils/currency.ts`: `_parseAmount`
- `utils/responses.ts`: `_buildErrorPayload`

## Security

- **TypeScript strict mode**: `strict: true` enforced; source `: any` = 0; source `as any` = 0; `@ts-ignore`/`@ts-expect-error` = 0. Maximum compile-time type safety achieved.
- Security headers applied to all responses via `withSecurityHeaders()` in `index.ts`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`
- All error responses sanitized — internal error details logged server-side, generic `"Internal error"` returned to client
- `POST /login` privileged actions (top-up, terminate, request-wipe) require operator session auth
- **Zero innerHTML policy**: all browser JS uses safe DOM APIs (`textContent`, `createElement`, `replaceChildren`); `esc()` removed; baseline = 0 (enforced by `scripts/check-innerhtml.js`)
- `/2fa` endpoint supports JSON response mode via `Accept: application/json` header (prevents raw HTML injection in debug console)
- Proxy handler filters request/response headers via allow-list (`proxyHandler.ts`)
- CSRF: double-submit cookie pattern with timing-safe comparison
- All replayProtection callers wrap DO calls in try/catch with appropriate error responses

## Error Handling Policy

- **Handlers**: All async handler functions wrap DO calls in try/catch, log via `logger.error()`, and return `errorResponse("Internal error", 500)` or a specific error
- **Fire-and-forget**: `recordTapRead()` uses `.catch()` with `logger.warn()` — tap recording never blocks the response
- **Graceful degradation**: `safeGetBalance()` returns `{balance: 0}` on failure; `getUidConfig()` falls back to deterministic keys; `history.ts` returns empty arrays
- **Never expose**: Raw `err.message`, DO internals, CLN REST response bodies, or KV error details to clients
