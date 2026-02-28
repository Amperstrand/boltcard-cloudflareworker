# BoltCard Worker — Refactoring Scope Decisions

Four explicit binary decisions for the refactoring effort. Each component is either IN SCOPE (fix/wire) or OUT OF SCOPE (delete orphaned code only). No ambiguity.

---

## 1. `card-portal/` — OUT OF SCOPE

**Decision**: Remove orphaned/broken code only. Do not implement features.

**Specific actions**:
- Remove orphaned code block at lines 302–364 of `card-portal/handlers.js` (copy-paste artifact after `handleCardAuth` closes — causes a syntax error on module import)
- Fix variable shadowing in `handleCardInfo`: rename second `const card` (line 397) to `const cardInfo`
- Leave `extractUIDAndCounter` stub returning `reject('Not implemented')` — do not implement

**Rationale**:
- `extractUIDAndCounter` in `card-portal/handlers.js` is explicitly `reject('Not implemented')` — no working code path exists
- Session tokens are generated with `generateSessionToken` but never signed or validated — security hole
- Card-portal NFC login is an incomplete feature that requires its own auth story
- Fixing syntax errors is necessary to prevent module import failure; implementing the feature is not

**Deferred**: card-portal NFC login, card-portal session management

---

## 2. `admin/` — STRUCTURAL FIX ONLY

**Decision**: Fix the interface mismatch so admin routes don't crash. No new features.

**Specific actions**:
- `admin/routes.js` exports `setupAdminRoutes(router)` but `index.js` calls it with `(url, env)` — fix to accept `(url, env)` with manual path matching, OR stub all admin routes to return a 501 response
- `admin/routes.js` references `handleAdminCreateBackend` which is never imported — add the missing import from `admin/handlers.js` or remove the route if the handler doesn't exist
- Do NOT add authentication, do NOT add new admin endpoints

**Rationale**:
- The interface mismatch causes a runtime crash when any admin route is hit
- Admin authentication is a separate product decision (JWT, API keys, session auth) — out of scope for this cleanup
- Structural fix prevents the crash; full admin implementation is a separate project

**Deferred**: admin panel authentication, admin UI, new admin endpoints

---

## 3. `src/` directory — DELETE

**Decision**: Delete `src/index.js` and the `src/` directory entirely.

**Specific actions**:
- Delete `src/index.js`
- Delete `src/` directory

**Rationale**:
- `wrangler.toml` `main` points to root `index.js`, making `src/index.js` completely unreachable
- `src/index.js` references `activatePage` and `handleCardProgramming` which are undefined in its scope — it cannot run even if imported
- It is an abandoned refactoring attempt from a prior session
- No code in the project imports from `src/`

---

## 4. Durable Objects — KEEP, PROPERLY WIRE

**Decision**: Keep existing DO classes, export them from module worker, fix `validateAndUpdateCounter` signature. No redesign.

**Specific actions**:
- Add `export { CardDO } from './durableObjects/CardDO.js'` (and BackendRegistryDO, AdminDO) to `index.js` after migrating to module worker format
- Fix `CardDO.validateAndUpdateCounter(ctr)` signature to accept whatever `index.js` callers pass (currently callers pass `ctrValue` which is `undefined` — fix the caller)
- Update `wrangler.toml` to remove `type = "javascript"` (required for module worker format)
- Do NOT redesign DO storage schema, do NOT add new DO methods

**Rationale**:
- DO classes are declared in `wrangler.toml` but never exported from `index.js` — Cloudflare cannot instantiate them without exports
- The existing `CardDO.validateAndUpdateCounter` implementation is correct — it just needs to be wired properly
- Redesigning DO architecture is a separate project; the current schema is sufficient for counter persistence

---

## Deferred Features

The following are explicitly deferred and must NOT be implemented during this refactoring:

| Feature | Location | Status |
|---------|----------|--------|
| Card-portal NFC login | `card-portal/handlers.js` | Deferred — incomplete auth story |
| LNURL-pay (lnurlp) endpoint | `handlers/lnurlHandler.js` | Deferred — stub only |
| TOTP | `totp.js` | Deferred — delete unused file |
| Verifiable Credentials (VC) block | `handlers/withdrawHandler.js:28-83` | Delete — hardcoded "Lightning Music Fest" event ticket is dead code |
| Admin panel authentication | `admin/` | Deferred — separate product decision |
| Card-portal session management | `card-portal/handlers.js` | Deferred — unsigned tokens are a security issue |

---

## Also Delete (Not Features — Just Junk)

These are POC/debug scripts that should be deleted during cleanup:

- `audit-uids.js`, `dump-config.js`, `generate-production-keys.js`, `secure-deploy.js`, `kv-migration-helper.js` — one-off scripts
- `config-audit-*.json` — output artifacts
- `audit-report.md`, `comparison-investigation.md`, `comparison-report.md`, `INVESTIGATION-REPORT.md`, `hardcoded-value-inventory.md`, `workers.md` — stale reports
- Random error injection in `handlers/withdrawHandler.js:15` (`counterValue >= 200 && Math.random() < 0.5`) — this is a development debug artifact
- `fakewalletCounter` module-level state in `handlers/lnurlHandler.js` — module-level state doesn't persist across Cloudflare Worker invocations
