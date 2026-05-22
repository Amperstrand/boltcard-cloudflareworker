# Browser JS Refactor Plan — DRY Shared Modules (v2, Momus-validated)

## Goal
Extract reusable UI functions from login.js (975 lines) and card-dashboard.js (461 lines) into shared modules, reducing duplication and enabling debug.js to become a thin DRY wrapper.

## Current State
- 20 browser JS files, 4,699 lines total
- login.js: 975 lines (6 features crammed together)
- debug.js: 521 lines (5 tabs with inline implementations)
- card-dashboard.js: 461 lines (re-implements some card info display)
- Zero ES module imports — all classic scripts loaded via `<script src>`
- Shared via window globals: nfc.js, helpers.js, csrf.js, nfc-gate.js, client-error.js

## Architecture Decisions
1. **Keep classic script pattern** — no ES modules. New shared modules expose functions on `window` like nfc.js already does.
2. **Per-page script loading** — shared modules loaded in page templates (after DOM, before page JS), NOT in pageShell.ts. This matches the current pattern for nfc.js and helpers.js.
3. **Prefix parameter for element IDs** — functions accept a prefix (`priv-`, `pub-`, `dash-`, `dbg-`) to avoid collisions when multiple instances exist on one page.

## Phase 1: Create Shared JS Modules + Expand Helpers

### 1a. `static/js/helpers.js` expansion (21 → ~75 lines)
Extract from login.js (these are truly reusable utilities):
- `formatDuration(ms)` — line 58
- `relativeTime(unixSeconds)` — line 66
- `formatUnits(value)` — line 75
- `statusBadge(status)` — line 80

### 1b. `static/js/card-info.js` (NEW, ~150 lines)
Extract from login.js ONLY (not card-dashboard.js — its rendering is architecturally different):
- `renderLoginTapHistory(prefix, taps)` — tap list with status badges (login.js lines 104-168)
- `renderKeyRows(prefix, k0, k1, k2, k3, k4)` — K0-K4 hex display (login.js lines 244-266)
- `fillCardInfo(prefix, data)` — fill UID, state, version, counter, CMAC, balance fields

NOTE: card-dashboard.js's `renderHistory` stays in card-dashboard.js — it uses different data shapes (unified history with amounts) and different visual style (text icons vs badges). These are NOT duplicates.

### 1c. `static/js/card-actions.js` (NEW, ~100 lines)
Extract from login.js ONLY (debug.js does NOT have these functions):
- `terminateCard(uid, version, origin)` — POST /login with action:terminate
- `requestWipeCard(uid, version, origin)` — POST /login with action:request-wipe
- `provisionCard(endpointUrl, origin)` — fetch + POST programming endpoint
- `confirmWiped(uid, version, origin)` — POST /login with action:confirm-wiped

These are login.js-specific actions that call /login. Debug.js's wipe tab calls /wipe?uid=... (different API). Card-actions.js is for /login-based workflows only.

### 1d. `static/js/programming.js` (NEW, ~60 lines)
Extract from login.js:
- `buildProgrammingEndpoint(endpointUrl)` — URL builder
- `buildProgrammingDeeplink(url)` — NFC deeplink builder
- `setCurrentProgrammingEndpoint(url)` — state management

NOTE: activate.js's "duplication" with login.js is minimal (just the `boltcard://program?url=` pattern inline). This module primarily benefits login.js. Activate.js may adopt it later but gains are small.

## Phase 2: Pipeline Update (BEFORE refactoring consumers)

### 2a. `scripts/sync-js-exports.mjs`
- Already scans all files in static/js/ — no change needed, new files auto-detected.

### 2b. `static/js/registry.ts`
- Register 3 new shared files: card-info.js, card-actions.js, programming.js

### 2c. Per-page script loading in templates
Each page template loads shared scripts BEFORE its page-specific script:
- loginPage.ts: `<script src="/static/js/nfc.js"></script>` → `<script src="/static/js/helpers.js"></script>` → `<script src="/static/js/card-info.js"></script>` → `<script src="/static/js/card-actions.js"></script>` → `<script src="/static/js/programming.js"></script>` → `<script src="/static/js/login.js"></script>`
- debugConsolePage.ts: `<script src="/static/js/nfc.js"></script>` → `<script src="/static/js/helpers.js"></script>` → `<script src="/static/js/card-info.js"></script>` → `<script src="/static/js/debug.js"></script>`
- cardDashboardPage.ts: `<script src="/static/js/nfc.js"></script>` → `<script src="/static/js/card-info.js"></script>` → `<script src="/static/js/card-dashboard.js"></script>`
- activatePage.ts: loads programming.js before activate.js (optional, small gain)

Do NOT add shared module script tags to pageShell.ts — they must load after page DOM exists.

## Phase 3: Refactor Consumers

### 3a. `login.js` (975 → ~600 lines, -38%)
- Replace raw NDEFReader with `createNfcScanner()` from nfc.js (saves ~30 lines of scan boilerplate; 135 lines of view-routing logic stays)
- Replace inline tap history with `window.renderLoginTapHistory()`
- Replace inline key display with `window.renderKeyRows()`
- Replace inline card info with `window.fillCardInfo()`
- Replace inline provisioning with `window.provisionCard()`
- Replace inline terminate/wipe with `window.terminateCard()` / `window.requestWipeCard()`
- Remove extracted utility functions (now in helpers.js)
- Keep: NFC URL parsing, view routing, showXxxCard orchestration, all 6 view functions

### 3b. `debug.js` (521 → ~300 lines, -42%)
- Console tab: keep as-is (unique NFC raw read functionality)
- Identify tab: keep as-is (unique card identification workflow)
- Wipe tab: this calls /wipe?uid=... (different API from card-actions.js). Keep as-is.
- 2FA tab: keep as-is (unique 2FA workflow)
- Identity tab: keep as-is (unique identity verification workflow)
- POS tab: keep as-is (unique POS inline workflow)
- Gains come from: using shared helpers (formatDuration, statusBadge), shared card-info display for the identify tab card readout, reducing NFC boilerplate if possible

NOTE: debug.js's tabs call different APIs than the dedicated pages. The "duplication" is conceptual (same feature) but not code-level (different endpoints, different workflows). DRY gains are smaller than originally estimated.

### 3c. `card-dashboard.js` (461 → ~350 lines, -24%)
- Use `window.fillCardInfo()` for basic card info fields (UID, state, version)
- Keep `renderHistory()` as-is — it's architecturally different from login.js's tap history
- Keep lock/reactivate/scan logic — page-specific

### 3d. `activate.js` (177 → ~160 lines, -9%)
- Minimal change. The `boltcard://program?url=` pattern is already inline and tiny.
- Optional: adopt `window.buildProgrammingDeeplink()` if it makes sense.

## Phase 4: Template Partials

Extract shared HTML into `templates/partials.ts`:
- `renderCardInfoFields(prefix)` — shared UID/state/version/counter/balance HTML rows
- `renderKeyTable(prefix)` — shared K0-K4 key table HTML

Consumers:
- loginPage.ts — use partials for private and public card views
- debugConsolePage.ts — use partials for identify tab card readout
- cardDashboardPage.ts — use partials for card info section

NOTE: Each page has different surrounding layout, so partials are just the shared field rows, not full panels.

## Phase 5: Login NFC Migration
- Replace raw `new NDEFReader()` in login.js with `createNfcScanner()` from nfc.js
- Saves ~30 lines of NFC scan boilerplate
- The ~135 lines of view-routing logic (which view to show based on card state) stays in login.js
- login.js already depends on nfc.js (documented in comment)

## Phase 6: Testing

### Automated
- `node scripts/sync-js-exports.mjs` — verify 23 files synced (20 old + 3 new)
- `npm test` — all 1377 unit tests must pass
- `npm run test:do` — all 52 DO tests must pass
- `tsc --noEmit` — zero type errors
- `npm run lint:innerhtml` — zero innerHTML
- `tests/jsExports.test.ts` — verify all 23 exports parse correctly

### Manual (no browser automation tests exist)
- Deploy to staging
- Test /login with card tap → verify card info renders correctly
- Test /debug with each tab → verify all 6 tabs work
- Test /card with card tap → verify dashboard renders
- Test /experimental/activate → verify programming flow
- Verify script load order in browser DevTools Network tab

## Realistic Expected Outcome
- login.js: 975 → ~600 lines (-38%)
- debug.js: 521 → ~300 lines (-42%)
- card-dashboard.js: 461 → ~350 lines (-24%)
- activate.js: 177 → ~160 lines (-9%)
- 3 NEW shared modules: ~310 lines (net new)
- helpers.js: 21 → ~75 lines
- Total browser JS: 4,699 → ~4,400 lines (-6%)
- ~600 lines of duplicated code eliminated
- Future pages that need card info display get it for free

## Risks
1. **Script load order**: Classic scripts load sequentially. Shared modules must be loaded before page-specific scripts in each template. Mitigated by following the exact pattern nfc.js already uses.
2. **Element ID collisions**: Multiple views on same page with same IDs. Mitigated by prefix parameter.
3. **Scope creep**: This is already a significant refactor. Strict scope: only extract what's truly duplicated and clearly reusable. Don't refactor for aesthetics.
4. **No browser-level automated tests**: All JS testing is server-side (parse validation only). Regression testing is manual. This is the existing state — this refactor doesn't make it worse.
5. **debug.js tabs are less DRY-able than expected**: They call different APIs than the dedicated pages. Gains are real but modest.

## Phase Execution Order (CORRECTED)
1. Phase 1: Create shared modules (new files only, no existing code breaks)
2. Phase 2: Pipeline update (register new files, add script tags to templates)
3. Phase 3: Refactor consumers (now safe — shared modules exist and are loaded)
4. Phase 4: Template partials (optional, can be done in parallel with Phase 3)
5. Phase 5: Login NFC migration (independent, can be done anytime after Phase 2)
6. Phase 6: Testing (continuous, final gate)
