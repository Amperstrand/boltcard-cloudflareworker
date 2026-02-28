# Learnings — boltcard-cleanup

## [2026-02-27] Session Start

### Critical Technical Facts
- **Web Crypto API does NOT support AES-ECB** — cannot replace `aes-js` directly for CMAC
- **`process.env` does not work in Cloudflare Workers** — use `env` parameter from fetch handler
- **Durable Objects must be exported** from the worker module to be instantiatable
- **Module worker format**: `export default { async fetch(request, env, ctx) {} }` (not `addEventListener`)
- **itty-router v4** is the standard Cloudflare Workers router

### Canonical Test Vectors (CRYPTO ACCEPTANCE CRITERIA)
These MUST pass after any crypto change:
- Vector 1: `p=4E2E289D945A66BB13377A728884E867 c=E19CCB1FED8892CE`
- Vector 2: `p=00F48C4F8E386DED06BCDC78FA92E2FE c=66B4826EA4C155B4`
- Vector 3: `p=0DBF3C59B59B0638D60B5842A997D4D1 c=CC61660C020B4D96`

### SV2 Construction
`[0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80, ...UID(7 bytes), ctr[2], ctr[1], ctr[0]]`

### Key Derivation
`CardKey = CMAC(IssuerKey, "2d003f75" || UID || Version)`
Dev ISSUER_KEY: `00000000000000000000000000000001`

### File Architecture
- `index.js` — main entry (service worker format, 326 lines, massive duplication)
- `cryptoutils.js` — AES-CMAC (computeAesCmac, generateSubkeyGo, computeCm, xorArrays)
- `keygenerator.js` — DUPLICATES crypto functions + key derivation (PRF, getDeterministicKeys)
- `boltCardHelper.js` — card validation, extractUIDAndCounter, validate_cmac
- `getUidConfig.js` — KV + static config lookup, BOLT_CARD_K1 array
- `handlers/` — 9 handler files
- `admin/routes.js` + `admin/handlers.js` — broken admin routing
- `card-portal/handlers.js` — orphaned code, syntax errors
- `durableObjects/` — CardDO.js, BackendRegistryDO.js, AdminDO.js (not exported)
- `utils/logger.js` — Custom logger
- `src/index.js` — ORPHANED alternate entry point

### 12 Critical Bugs
1. `index.js:172` — `ctrValue` undefined (ReferenceError)
2. `index.js:174` — `cardStub` undefined + wrong `validateAndUpdateCounter` signature
3. `handlers/lnurlHandler.js:150` — `getUidConfig(uid)` missing `await` and `env` param
4. `card-portal/handlers.js:302-364` — Orphaned code block (syntax error on import)
5. `card-portal/handlers.js:397` — Variable shadowing `const card` redeclared
6. `card-portal/handlers.js:251` — `extractUIDAndCounter` not implemented
7. `boltCardHelper.js validate_cmac` — 3-param function called with 4 args; KV K2 silently ignored
8. `src/index.js` — Dead stub referencing undefined functions
9. `admin/routes.js` — interface mismatch with index.js caller
10. `admin/routes.js:17` — `handleAdminCreateBackend` never imported
11. `index.js:75-93,102-120,218-236` — Routes registered THREE times
12. `keygenerator.js` — `process.env.ISSUER_KEY` falls back to dev key in production

### Scope Decisions
- card-portal: OUT OF SCOPE (delete orphaned code only)
- admin: STRUCTURAL FIX ONLY (no new features/auth)
- `src/` directory: DELETE
- Durable Objects: KEEP + properly wire exports
- lnurlp, TOTP, VC, admin auth: DEFER

## [2026-02-27] Task: 2 — Protocol Documentation

**What worked well:**
- Reading `cryptoutils.js` directly revealed the exact SV2 byte layout and the `ct` extraction (even-indexed bytes of `cm`). The code comments matched the NXP spec precisely.
- The `keygenerator.js` `getDeterministicKeys` function made the derivation chain completely explicit: CardKey uses prefix `2d003f75`, K0 uses `2d003f76`, K1 uses `2d003f77`, etc.
- K1 is derived from IssuerKey (not CardKey) — this is the crucial fleet-sharing detail. All cards under one IssuerKey share K1.

**Key protocol facts confirmed from codebase:**
- `p` plaintext byte 0 = `0xC7` is the discriminator for multi-K1 candidate trying
- Counter in `p` is LSB-first (bytes 8,9,10); in SV2 it's MSB-first (bytes 13,14,15 = ctr[2],ctr[1],ctr[0])
- `ct` extraction: odd bytes from `cm` array: `[cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]`
- The SV2 derivation uses a two-level CMAC: `ks = CMAC(K2, SV2)`, then `cm` derived from `ks` via empty-message OMAC1 path

**Citations fetched and verified:**
- RFC 4493 content was fully accessible and matches the implementation
- LUD-03 raw markdown confirmed the `withdrawRequest` JSON shape
- LUD-17 raw markdown confirmed `lnurlw://` scheme meaning
- boltcard/boltcard GitHub repo confirmed the system structure

**Document structure:**
- 8 sections (required 7), 421 lines
- All required byte tables included
- K0-K4 roles table included
- 6 citation URLs (required 4)

## [2026-02-27] Task: 1 — Document Current State

**What worked well:**
- Reading all 27 source files in a single pass before writing the document kept the audit comprehensive and consistent.
- Identifying the orphaned code block in `card-portal/handlers.js` (lines 302-364) was key — it creates a syntax error that prevents the entire module from loading.
- Discovering the triple-route registration pattern in `index.js` (routes registered at lines 75-93, 102-120, AND 218-236) revealed that only the first registration is ever reachable.

**Pitfalls found:**
- The `git diff -- '*.js'` check in the task spec was intended to verify *we* didn't modify JS files; it doesn't mean there can be zero dirty JS files in the repo. Pre-existing uncommitted changes in `index.js` and `wrangler.toml` from prior sessions were already present.
- `validate_cmac` in `boltCardHelper.js` appears to accept 4 parameters but only uses 3 — the K2 argument is silently dropped. This is subtle and easy to miss at a glance.
- `process.env` returning `undefined` in CF Workers is a silent failure mode; there is no error, just wrong key material used.

**Key architectural facts:**
- `src/index.js` is a dead orphan — `wrangler.toml` points to root `index.js`, making `src/index.js` unreachable.
- All three Durable Object classes (`CardDO`, `BackendRegistryDO`, `AdminDO`) are declared in `wrangler.toml` but never exported from `index.js`, so they cannot instantiate.
- The LNURLW verification logic is duplicated twice in `index.js` (lines 136-215 and 238-322); the second copy is the one that actually runs (it's after the `pathname !== "/"` guard).
