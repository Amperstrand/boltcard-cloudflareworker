# Full-Project Review Pass

## TL;DR

> **Quick Summary**: Direct audit of the boltcard Cloudflare Worker repo found 16 concrete issues (1 critical, 2 high, 6 medium, 6 low, 1 logging stray). Plan ships 13 quick-fix TODOs in 3 parallel waves + a final review wave; 3 larger items become GitHub issues filed as part of the plan.
>
> **Deliverables**:
> - 1 critical security fix (DO error handling fail-closed)
> - 2 high-severity fixes (duplicate route, dev-key prod guard)
> - 9 medium/low fixes (dead code, header hygiene, docs drift, stale files, /2fa polling, terminate SQL, logger consistency)
> - 3 GitHub issues filed (proxy header policy, DO error policy, docs overhaul)
> - README test counts corrected; AGENTS.md test count corrected
>
> **Estimated Effort**: Medium (13 atomic tasks, each ≤3 files, 264-test green baseline maintained)
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: T1 (DO fail-closed) → T3 (prod K1 guard) → Final Verification

---

## Context

### Original Request
"pull, fix push and deploy. what should we do next? also make the 2fa stuff also work for withdraw cards by having 2 or 3 different login pages. one to log in like today and one to log in to 2fa etc. go through the entire project and come up with improvements. also review that everything works as intended and that there are no logical issues"

User then chose: Full-project review pass → Deep audit + prioritized backlog → One plan, fixes + GitHub issues for larger items → Truly everything → High accuracy (Momus loop until OKAY).

### Interview Summary

**Key Decisions**:
- Quick-fix threshold: ≤3 files OR <2h → TODO; otherwise GitHub issue
- Test framework unchanged: jest with `--experimental-vm-modules`
- Tests-after strategy per TODO (each behavior change adds focused tests)
- Commits: semantic, atomic, with Sisyphus footer + co-author trailer
- Scope: every file in repo except `.sisyphus/`, `node_modules/`, `dist/`
- Excluded from this plan: implementing W3C VC (issue #5), implementing withdraw-card 2FA login pages (separate plan)

**Audit Strategy**:
- Background explore agents (4 parallel) timed out at 30 min idle window — **abandoned**
- Direct Grep/Read/LSP audit performed instead — **20+ files read end-to-end**
- Metis consultation also timed out — self-performed gap analysis substituted

### Audit Findings (16 total)

**CRITICAL (1)**:
1. `getCardState()` swallows DO errors as `state:"new"` — `replayProtection.js:172-174`. Causes `index.js:182-199` to bypass `terminated`/`active` checks on DO outage. Security bypass.

**HIGH (2)**:
2. Duplicate `POST /activate/form` route — `index.js:59` (real) and `index.js:87` (dead, inside 301-redirect block). Misleading.
3. Dev fallback K1 keys leak between environments — `getUidConfig.js:28-33` returns publicly-known dev keys with no production guard.

**MEDIUM (6)**:
4. Dead string-handling branch in `extractUIDAndCounter` — `boltCardHelper.js:50-56`. `getBoltCardK1` always returns Array.
5. Dead no-K2 fallback branch in `validate_cmac` — `boltCardHelper.js:124-127`. Unreachable in current flow.
6. `proxyHandler` forwards request headers verbatim including `Cookie`/`Authorization` — `proxyHandler.js:31`.
7. `proxyHandler` forwards downstream response headers verbatim including `Set-Cookie` — `proxyHandler.js:53-56`.
8. `loginHandler` uses `env.BOLT_CARD_K1?.split(",")[0]` as ISSUER_KEY fallback — `loginHandler.js:264, 266`. K1 ≠ ISSUER_KEY; derivation is wrong.
9. `POS_ADDRESS_POOL` hardcodes 3 third-party Lightning Addresses (walletofsatoshi/zbd/bitrefill) — `lnurlPayHandler.js:9-13`. Sends real funds to third parties in fakewallet/POS demos.

**LOW (6)**:
10. `lnurlHandler.js:17-52` POST branch is a stub returning 200 — comment admits it.
11. `withdrawHandler.js:14-15` clnrest path produces `min===max===1000` — confusing without docs.
12. README test count drift — claims 262 tests; actual 264/19 suites. Lists nonexistent test files.
13. Stale repo-root artifacts — `audit-report.md`, `config-audit-20260121-133006.json`, `hardcoded-value-inventory.md`, `ntag424_llm_context_bundle.zip`.
14. `/2fa` page sets `meta http-equiv="refresh" content="5"` — `twoFactorHandler.js:71`. Wasteful CMAC + replay re-runs.
15. `terminate` SQL inconsistency — `CardReplayDO.js:507-521` resets `latest_issued_version` to 0 on INSERT but ON CONFLICT clause doesn't touch it.

**STRAY (1)**:
16. `CardReplayDO.js:539` server-side `console.warn` — should route through `utils/logger.js`.

### Self-Performed Gap Analysis (Metis substitute)

Metis agent timed out (consistent with explore agent timeouts). Self-performed:

- **Wave ordering risk**: T1 (fail-closed) MUST ship before T3 (prod guard) because T1 fixes a real bug, T3 is hardening
- **Test isolation**: every TODO must keep `npm test` green (264 baseline)
- **No-regression guardrails**: do not change test framework, do not switch from `aes-js`, do not import `node:crypto`, do not break LNURL-withdraw protocol shape
- **Commit batching**: 13 TODOs = 13 atomic commits, all signed
- **Deploy gate**: final wave runs `npm run deploy` only after all tests green AND user explicit approval
- **Re-verification**: file:line refs verified at plan-write time (see Re-Verification section below)

### Re-Verification (file:line refs confirmed at plan-write time)

- ✅ `replayProtection.js:172-174` → `getCardState` fail-open at lines 159, 173, 273 (3 spots)
- ✅ `index.js:59` → `router.post("/activate/form", ...)` real handler
- ✅ `index.js:87` → `router.post("/activate/form", ...)` duplicate inside 301 redirect block
- ✅ `loginHandler.js:264, 266` → `env.BOLT_CARD_K1?.split(",")[0]` as ISSUER_KEY fallback (2 occurrences)

### Open GitHub Issues (referenced)

- #5 — W3C Verifiable Credentials (out of scope this plan; T13 docs may cross-reference)
- #3 — SSH 2FA via NTAG424 (out of scope; finding #14 /2fa polling cleanup may help)
- #2 — Dynamically add cards (out of scope; finding #3 prod-key guard may help)

---

## Work Objectives

### Core Objective
Land all 13 quick-fix TODOs and file 3 GitHub issues for larger items, keeping the 264/19 test baseline green throughout, then deploy to production after explicit user approval.

### Concrete Deliverables
- 13 atomic commits (one per TODO), each with passing tests
- 3 GitHub issues filed via `gh issue create` (proxy header policy, DO error policy, docs overhaul)
- README updated with correct test counts (264/19) and accurate file list
- `audit-report.md`, `config-audit-20260121-133006.json`, `hardcoded-value-inventory.md`, `ntag424_llm_context_bundle.zip` removed from repo root
- `/2fa` page no longer self-refreshes
- Production deploy via `npm run deploy` after final approval

### Definition of Done
- [ ] `npm test` passes (≥264 tests, 19 suites, 0 failures)
- [ ] `git status` clean (all 13 commits landed)
- [ ] `gh issue list --state open` includes 3 new issues with this plan's TODO numbers cross-referenced
- [ ] `grep -rn "console\." --include="*.js" -- index.js handlers/ durableObjects/ utils/ replayProtection.js cryptoutils.js boltCardHelper.js getUidConfig.js | grep -v "utils/logger.js"` returns 0 server-side hits
- [ ] `npm run deploy` completes successfully (after user okay)

### Must Have
- All 13 TODOs land as separate atomic commits
- All 3 issues filed before plan completion
- 264-test baseline preserved at every commit
- Production deploy gated on user explicit approval

### Must NOT Have (Guardrails)
- NO change to test framework (jest + experimental-vm-modules)
- NO switch from `aes-js` to `node:crypto`-dependent libraries
- NO import of `@noble/hashes` without `.js` extension
- NO `bech32.encode()` without 1024 size arg (would break bolt11)
- NO removal of dev fallback keys (only guard them; tests rely on them)
- NO breaking of LNURL-withdraw response shape
- NO implementing VC (#5) — out of scope
- NO implementing withdraw-card 2FA login pages — separate plan
- NO scope creep into docs JSDoc audit (becomes I3, not a TODO)
- NO over-abstraction: if a fix is 3 lines, it stays 3 lines
- NO new dependencies without explicit user approval
- NO commits without semantic prefix + Sisyphus footer + co-author

---

## Verification Strategy

> ZERO HUMAN INTERVENTION. All verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (jest 29 + `--experimental-vm-modules`)
- **Automated tests**: YES (tests-after) — each TODO that changes behavior adds focused tests
- **Framework**: jest (unchanged)
- **Approach**: write the fix, then write/extend tests in the same commit; baseline 264 tests must stay green

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module fixes**: `bun` or `node` REPL invocation + `npm test -- --testPathPattern=...`
- **Route fixes**: Bash `curl` against `wrangler dev` or unit test via worker.test.js patterns
- **Static checks**: `grep -rn` for forbidden patterns
- **Build/deploy**: `npm test && node scripts/build_keys.js && wrangler deploy --dry-run`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — independent fixes, MAX PARALLEL):
├── T1: getCardState fail-closed (CRITICAL)            [quick]
├── T2: Remove duplicate POST /activate/form           [quick]
├── T3: Production guard for dev K1 fallback           [quick]
├── T4: Remove dead branches in boltCardHelper          [quick]
├── T5: Fix loginHandler ISSUER_KEY fallback            [quick]
└── T6: Make POS_ADDRESS_POOL opt-in                   [quick]

Wave 2 (After Wave 1 — independent low-risk):
├── T7:  lnurlHandler POST: implement 405               [quick]
├── T8:  Document withdrawHandler clnrest min/max       [quick]
├── T9:  Fix README test counts + file list             [quick]
├── T10: Delete/move stale repo-root artifacts          [quick]
├── T11: Remove /2fa meta-refresh                       [quick]
├── T12: Fix terminate SQL latest_issued_version       [quick]
└── T13: Route CardReplayDO console.warn through logger [quick]

Wave 3 (After Wave 2 — file GitHub issues):
├── I1: File issue: proxy header allow/deny-list policy [quick]
├── I2: File issue: DO error-handling consistency       [quick]
└── I3: File issue: documentation overhaul              [quick]

Wave FINAL (After ALL — verification + deploy gate):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay → npm run deploy

Critical Path: T1 → T3 → F1-F4 → user okay → deploy
Parallel Speedup: ~70% faster than sequential
Max Concurrent: 6 (Wave 1)
```

### Dependency Matrix

- **T1-T6**: independent, all blocked by NOTHING, all blocking → F1-F4
- **T7-T13**: independent, blocked by → Wave 1 complete, blocking → F1-F4
- **I1-I3**: blocked by → Wave 2 complete, blocking → F1-F4
- **F1-F4**: blocked by → ALL TODOs + issues filed
- **Deploy**: blocked by → F1-F4 APPROVE + user okay

### Agent Dispatch Summary

- **Wave 1**: 6 tasks → all `quick` (small, focused, single-file changes)
- **Wave 2**: 7 tasks → all `quick`
- **Wave 3**: 3 tasks → all `quick` (`gh issue create` invocations)
- **Wave FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. **fix(replay): fail closed when DO unreachable in getCardState** [CRITICAL]

  **What to do**:
  - In `replayProtection.js` change `getCardState()` to NOT return `{state:"new"}` on DO failure
  - Instead, throw an error that callers must explicitly handle
  - Update `index.js:182-199` (where `getCardState` is called for terminated/active gating) to catch the error and return HTTP 503 with `errorResponse("Card state unavailable")` — fail-closed
  - Update existing tests that depend on silent fallback (search `tests/` for `getCardState`)
  - Add new test: simulate DO throw → assert HTTP 503, NOT a successful LNURL response

  **Must NOT do**:
  - Do not silently log and continue (defeats the fix)
  - Do not change the success path shape
  - Do not modify `replayProtection.js:159` (the genuine "no row → new card" path is correct)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file logic change with focused test additions
  - **Skills**: none required
  - **Skills Evaluated but Omitted**: `oracle` (not needed — fix is mechanical)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2-T6)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: None

  **References**:
  - `replayProtection.js:157-177` — `getCardState` function with fail-open at line 173
  - `index.js:182-199` — caller that bypasses checks when state is "new"
  - `tests/tapTracking.test.js` — existing replay tests for pattern
  - `utils/responses.js` — `errorResponse()` helper

  **WHY references matter**:
  - `replayProtection.js:172-174` is the bug location; `:159` and `:273` are similar but legitimate ("no row found" + getCardConfig "no row" — keep these)
  - `index.js:182-199` is the only caller whose behavior changes; other callers (analytics) tolerate stale data

  **Acceptance Criteria**:
  - [ ] `npm test` passes (≥264 tests)
  - [ ] New test: DO error → HTTP 503 from `index.js` LNURL handler
  - [ ] grep: `grep -n 'return { state: "new"' replayProtection.js` shows ≤2 lines (159, 273), NOT 173
  - [ ] No silent error swallow remaining in `getCardState`

  **QA Scenarios**:

  ```
  Scenario: DO throws → fail-closed 503
    Tool: Bash (npm test)
    Preconditions: New unit test mocks DO to throw
    Steps:
      1. npm test -- --testPathPattern=tapTracking
      2. Assert new test "getCardState throws on DO failure" passes
      3. Assert no regressions in 19 suites
    Expected Result: All tests green, new test asserts thrown error
    Failure Indicators: Test still expects {state:"new"} on error
    Evidence: .sisyphus/evidence/task-1-do-fail-closed.txt

  Scenario: Legitimate "new card" path still works
    Tool: Bash (npm test)
    Steps:
      1. Run existing virtual-card.test.js E2E
      2. Assert new card still hits {state:"new"} via line 159 (no row), not via error path
    Expected Result: E2E green
    Evidence: .sisyphus/evidence/task-1-new-card-path.txt
  ```

  **Commit**: YES
  - Message: `fix(replay): fail closed when DO unreachable in getCardState`
  - Files: `replayProtection.js`, `index.js`, `tests/tapTracking.test.js`
  - Pre-commit: `npm test`

- [x] 2. **fix(routes): remove duplicate POST /activate/form**

  **What to do**:
  - Delete `index.js:87` (the duplicate `router.post("/activate/form", ...)` inside the 301-redirect block)
  - Verify `index.js:59` (the real handler) remains
  - No test changes required (route behavior unchanged; itty-router uses first match)

  **Must NOT do**:
  - Do not remove the GET 301 redirect on the same path
  - Do not change handler behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-line deletion
  - **Skills**: none

  **Parallelization**:
  - Wave 1, parallel with T1, T3-T6
  - Blocks: F1, F4

  **References**:
  - `index.js:59` — real handler: `router.post("/activate/form", (request, env) => handleActivateCardSubmit(request, env));`
  - `index.js:87` — dead duplicate inside 301-redirect block

  **Acceptance Criteria**:
  - [ ] `grep -c 'router\.post.*"/activate/form"' index.js` returns `1`
  - [ ] `npm test` green

  **QA Scenarios**:
  ```
  Scenario: Route still functional
    Tool: Bash (npm test)
    Steps: npm test -- --testPathPattern=worker
    Expected Result: All worker tests green
    Evidence: .sisyphus/evidence/task-2-route-test.txt
  ```

  **Commit**: YES
  - Message: `fix(routes): remove duplicate POST /activate/form`
  - Files: `index.js`
  - Pre-commit: `npm test`

- [x] 3. **feat(security): guard dev K1 fallback in production**

  **What to do**:
  - In `getUidConfig.js` `getBoltCardK1()` (lines 9-34), add explicit production guard:
    - If `env.WORKER_ENV === "production"` (or `env.ENVIRONMENT === "production"`) AND no K1 secret is set → throw `new Error("Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1")`
  - Add log line via `utils/logger.js` warning when dev fallback is used in non-production
  - Update README "Production Checklist" to reference this behavior
  - Add unit test: production env without K1 → throws; dev env without K1 → returns dev keys with warn

  **Must NOT do**:
  - Do not remove the dev fallback (tests rely on it)
  - Do not require a specific env name; accept `WORKER_ENV` OR `ENVIRONMENT`
  - Do not break existing tests that don't set the env

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: none

  **Parallelization**:
  - Wave 1, parallel with T1, T2, T4-T6
  - Blocks: F1, F2

  **References**:
  - `getUidConfig.js:9-34` — `getBoltCardK1()` function
  - `utils/logger.js` — for warn output
  - `README.md` "Production Checklist" section

  **Acceptance Criteria**:
  - [ ] `npm test` green
  - [ ] New test: production env throws when no K1 set
  - [ ] New test: dev env returns dev keys + logs warn
  - [ ] README mentions the new guard

  **QA Scenarios**:
  ```
  Scenario: Production without K1 throws
    Tool: Bash (npm test)
    Steps: npm test -- --testPathPattern=getUidConfig
    Expected Result: New test passes
    Evidence: .sisyphus/evidence/task-3-prod-guard.txt

  Scenario: Existing tests unaffected
    Tool: Bash (npm test)
    Steps: npm test
    Expected Result: 264+ tests green
    Evidence: .sisyphus/evidence/task-3-baseline.txt
  ```

  **Commit**: YES
  - Message: `feat(security): guard dev K1 fallback in production`
  - Files: `getUidConfig.js`, `README.md`, new `tests/getUidConfig.test.js` (if absent, otherwise extend)
  - Pre-commit: `npm test`

- [x] 4. **refactor(boltcard): remove unreachable extractUIDAndCounter and validate_cmac branches**

  **What to do**:
  - In `boltCardHelper.js:50-56`, remove the `typeof BOLT_CARD_K1 === "string"` branch. `getBoltCardK1` always returns Array
  - In `boltCardHelper.js:124-127`, remove the no-K2 fallback branch (unreachable in current call sites)
  - Verify all 264 tests still green; if any test relied on dead code, update the test (but expect none did, since branches are unreachable)

  **Must NOT do**:
  - Do not remove reachable branches
  - Do not change function signatures
  - Do not introduce new abstractions

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**: Wave 1, parallel with T1-T3, T5-T6. Blocks F1, F4.

  **References**:
  - `boltCardHelper.js:50-56` — dead string branch
  - `boltCardHelper.js:124-127` — dead no-K2 branch
  - `getUidConfig.js` `getBoltCardK1()` — always returns Array (verifies branch is dead)

  **Acceptance Criteria**:
  - [ ] `npm test` green (264+)
  - [ ] grep: `grep -n 'typeof.*BOLT_CARD_K1.*string' boltCardHelper.js` returns 0 hits

  **QA Scenarios**:
  ```
  Scenario: No regression in CMAC validation
    Tool: Bash (npm test)
    Steps: npm test -- --testPathPattern=cryptoutils
    Expected Result: All 37 cryptoutils tests pass
    Evidence: .sisyphus/evidence/task-4-cmac.txt
  ```

  **Commit**: YES
  - Message: `refactor(boltcard): remove unreachable extractUIDAndCounter and validate_cmac branches`
  - Files: `boltCardHelper.js`
  - Pre-commit: `npm test`

- [x] 5. **fix(login): use ISSUER_KEY for derivation, never K1 fallback**

  **What to do**:
  - In `handlers/loginHandler.js:264, 266`, remove the `|| env.BOLT_CARD_K1?.split(",")[0]` fallback
  - If `env.ISSUER_KEY` is missing, throw or return errorResponse — do NOT silently use K1 (semantically wrong, K1 is decryption key, ISSUER_KEY is derivation seed)
  - Verify deterministic key recovery still works for cards listed in `keys/` CSVs
  - Update test if any test relied on the wrong fallback

  **Must NOT do**:
  - Do not break key recovery flow for legitimately enrolled cards
  - Do not remove the `keys_delivered` lookup path

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**: Wave 1. Blocks F1, F2, F3.

  **References**:
  - `handlers/loginHandler.js:264, 266` — wrong fallback (2 occurrences)
  - `keygenerator.js` `deriveKeysFromHex()` — what it expects (ISSUER_KEY, not K1)
  - `tests/loginHandler.test.js` — 21 tests for login flow

  **Acceptance Criteria**:
  - [ ] `npm test` green
  - [ ] grep: `grep -n "BOLT_CARD_K1?.split" handlers/loginHandler.js` returns 0 hits
  - [ ] Login flow with valid ISSUER_KEY still derives keys correctly

  **QA Scenarios**:
  ```
  Scenario: Valid ISSUER_KEY derives keys
    Tool: Bash (npm test)
    Steps: npm test -- --testPathPattern=loginHandler
    Expected Result: 21+ tests pass
    Evidence: .sisyphus/evidence/task-5-login.txt

  Scenario: Missing ISSUER_KEY fails gracefully
    Tool: Bash (unit test)
    Steps: New test: env without ISSUER_KEY → errorResponse
    Expected Result: Test asserts error path, not silent K1 substitution
    Evidence: .sisyphus/evidence/task-5-no-issuer.txt
  ```

  **Commit**: YES
  - Message: `fix(login): use ISSUER_KEY for derivation, never K1 fallback`
  - Files: `handlers/loginHandler.js`, `tests/loginHandler.test.js`
  - Pre-commit: `npm test`

- [x] 6. **feat(lnurlpay): make third-party POS_ADDRESS_POOL opt-in**

  **What to do**:
  - In `handlers/lnurlPayHandler.js:9-13`, change `POS_ADDRESS_POOL` from a hardcoded constant `["roastedoats19@walletofsatoshi.com", "...@zbd.gg", "...@bitrefill.me"]` to:
    - Read from `env.POS_ADDRESS_POOL` (comma-separated) if set
    - Otherwise empty array `[]`
  - When pool is empty AND no `lightning_address` is configured, return `errorResponse("No Lightning Address configured for this card", 503)`
  - Update tests in `tests/lnurlPay.test.js` to provide pool via env in tests that need it
  - Update README "Configuration Options" section noting this is now opt-in

  **Must NOT do**:
  - Do not delete the existing tests; update them to set the env explicitly
  - Do not break cards that have `lightning_address` configured (those bypass the pool entirely)

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**: Wave 1. Blocks F1, F3.

  **References**:
  - `handlers/lnurlPayHandler.js:9-13` — current hardcoded pool
  - `tests/lnurlPay.test.js` — 13 tests
  - `README.md` Configuration Options section

  **Acceptance Criteria**:
  - [ ] `npm test` green
  - [ ] grep: `grep -n "walletofsatoshi.com\|zbd.gg\|bitrefill.me" handlers/lnurlPayHandler.js` returns 0 hits
  - [ ] Test: card without lightning_address AND no pool env → 503
  - [ ] Test: card without lightning_address AND pool env set → uses pool
  - [ ] README mentions opt-in behavior

  **QA Scenarios**:
  ```
  Scenario: No pool, no address → 503
    Tool: Bash (npm test)
    Steps: New test asserts 503 returned
    Expected Result: Test green
    Evidence: .sisyphus/evidence/task-6-no-pool.txt

  Scenario: Pool via env works
    Tool: Bash (npm test)
    Steps: Existing tests with env override
    Expected Result: 13+ lnurlPay tests pass
    Evidence: .sisyphus/evidence/task-6-pool-env.txt
  ```

  **Commit**: YES
  - Message: `feat(lnurlpay): make third-party POS_ADDRESS_POOL opt-in`
  - Files: `handlers/lnurlPayHandler.js`, `tests/lnurlPay.test.js`, `README.md`
  - Pre-commit: `npm test`

- [ ] 7. **fix(lnurl): return 405 for unimplemented POST branch**

  **What to do**:
  - In `handlers/lnurlHandler.js:17-52`, replace the stub POST branch (which logs and returns 200) with `return new Response("Method Not Allowed", { status: 405 });`
  - Remove the misleading comment admitting it's a stub
  - Add a test asserting 405

  **Must NOT do**:
  - Do not delete the GET branch
  - Do not break the existing LNURL-withdraw flow on GET

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1, F3.

  **References**:
  - `handlers/lnurlHandler.js:17-52` — current POST stub

  **Acceptance Criteria**:
  - [ ] `npm test` green
  - [ ] New test: POST to LNURL endpoint → 405
  - [ ] grep: `grep -n "stub\|TODO" handlers/lnurlHandler.js` returns 0 hits

  **QA Scenarios**:
  ```
  Scenario: POST returns 405
    Tool: Bash (npm test)
    Steps: New test in worker.test.js or smoke.test.js
    Expected Result: 405 status
    Evidence: .sisyphus/evidence/task-7-405.txt
  ```

  **Commit**: YES
  - Message: `fix(lnurl): return 405 for unimplemented POST branch`
  - Files: `handlers/lnurlHandler.js`, `tests/worker.test.js` (or smoke.test.js)
  - Pre-commit: `npm test`

- [ ] 8. **docs(withdraw): document clnrest fixed-amount behavior**

  **What to do**:
  - In `handlers/withdrawHandler.js:14-15` (clnrest path producing min===max===1000), add JSDoc above the `constructWithdrawResponse` clnrest case explaining: "clnrest currently uses fixed 1000 msat for both min and max because the downstream CLN node creates the invoice with this amount; future work could parameterize via UID config"
  - No behavior change

  **Must NOT do**:
  - Do not change the actual values
  - Do not remove the clnrest path

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1.

  **References**:
  - `handlers/withdrawHandler.js:14-15`

  **Acceptance Criteria**:
  - [ ] `npm test` green
  - [ ] grep: `grep -A3 "clnrest" handlers/withdrawHandler.js | head -10` shows the new comment

  **QA Scenarios**:
  ```
  Scenario: No regression
    Tool: Bash (npm test)
    Steps: npm test
    Expected Result: 264+ green
    Evidence: .sisyphus/evidence/task-8-baseline.txt
  ```

  **Commit**: YES
  - Message: `docs(withdraw): document clnrest fixed-amount behavior`
  - Files: `handlers/withdrawHandler.js`
  - Pre-commit: `npm test`

- [ ] 9. **docs(readme): correct test counts and file list**

  **What to do**:
  - In `README.md`:
    - Update "Tested" line: "Comprehensive test suite with 262 tests across 19 test suites" → "264 tests across 19 test suites" (re-verify with `npm test` at edit time)
    - Update "Total: 262 tests across 19 test suites" similarly
    - Remove `linkHandler.test.js` and `loading.test.js` from the test coverage list (these files do not exist)
    - Verify each test file in the list exists in `tests/`
  - In `AGENTS.md`:
    - Update "262 tests across 19 suites" reference if present

  **Must NOT do**:
  - Do not invent new test counts; run `npm test` to get the actual current count
  - Do not remove test files that exist

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1.

  **References**:
  - `README.md` Test Coverage section
  - `AGENTS.md` Test Baseline section
  - `tests/` directory listing

  **Acceptance Criteria**:
  - [ ] grep: `grep -c "linkHandler.test.js\|loading.test.js" README.md` returns 0
  - [ ] README test count matches `npm test` output
  - [ ] AGENTS.md test count matches

  **QA Scenarios**:
  ```
  Scenario: Test count matches reality
    Tool: Bash
    Steps:
      1. npm test 2>&1 | tail -20 > /tmp/test-output.txt
      2. Parse "Tests: N passed"
      3. Verify README.md mentions same N
    Expected Result: Match
    Evidence: .sisyphus/evidence/task-9-counts.txt
  ```

  **Commit**: YES
  - Message: `docs(readme): correct test counts and file list`
  - Files: `README.md`, `AGENTS.md`
  - Pre-commit: `npm test`

- [ ] 10. **chore(repo): remove stale audit artifacts**

  **What to do**:
  - Delete from repo root: `audit-report.md`, `config-audit-20260121-133006.json`, `hardcoded-value-inventory.md`, `ntag424_llm_context_bundle.zip`
  - Verify nothing in source code references them: `grep -rn "audit-report\|config-audit\|hardcoded-value\|ntag424_llm_context_bundle" --include="*.js" --include="*.md" --include="*.toml" -- . | grep -v ".sisyphus/" | grep -v "node_modules/"`

  **Must NOT do**:
  - Do not delete `docs/ntag424_llm_context.{md,txt,json}` (these are different, kept)
  - Do not delete files referenced by build/test scripts

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1.

  **References**:
  - Repo root: `audit-report.md`, `config-audit-20260121-133006.json`, `hardcoded-value-inventory.md`, `ntag424_llm_context_bundle.zip`

  **Acceptance Criteria**:
  - [ ] `ls audit-report.md config-audit-*.json hardcoded-value-inventory.md ntag424_llm_context_bundle.zip 2>&1` returns "No such file" for all
  - [ ] `npm test` green
  - [ ] No source references to deleted files

  **QA Scenarios**:
  ```
  Scenario: Files removed
    Tool: Bash
    Steps: ls of the 4 files
    Expected Result: All "No such file or directory"
    Evidence: .sisyphus/evidence/task-10-cleanup.txt
  ```

  **Commit**: YES
  - Message: `chore(repo): remove stale audit artifacts`
  - Files: 4 deletions
  - Pre-commit: `npm test`

- [ ] 11. **fix(2fa): remove wasteful 5s meta-refresh**

  **What to do**:
  - In `handlers/twoFactorHandler.js:71`, remove the `<meta http-equiv="refresh" content="5">` tag
  - If TOTP code rotation visualization is needed, add a client-side JS countdown that just updates the displayed code's remaining-seconds (no server roundtrip), OR show a static "Tap card again to refresh" message
  - Update `tests/twoFactorHandler.test.js` to assert the meta-refresh is absent

  **Must NOT do**:
  - Do not break OTP generation
  - Do not add new dependencies

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1, F3.

  **References**:
  - `handlers/twoFactorHandler.js:71` — meta-refresh
  - `tests/twoFactorHandler.test.js` — 6 existing tests

  **Acceptance Criteria**:
  - [ ] grep: `grep -c "http-equiv=\"refresh\"" handlers/twoFactorHandler.js` returns 0
  - [ ] `npm test` green
  - [ ] New test asserts no meta-refresh in response

  **QA Scenarios**:
  ```
  Scenario: No meta-refresh
    Tool: Bash (npm test)
    Steps: npm test -- --testPathPattern=twoFactorHandler
    Expected Result: All 6+ tests pass
    Evidence: .sisyphus/evidence/task-11-2fa.txt
  ```

  **Commit**: YES
  - Message: `fix(2fa): remove wasteful 5s meta-refresh`
  - Files: `handlers/twoFactorHandler.js`, `tests/twoFactorHandler.test.js`
  - Pre-commit: `npm test`

- [ ] 12. **fix(do): also reset latest_issued_version on re-terminate**

  **What to do**:
  - In `durableObjects/CardReplayDO.js:507-521` (terminate), update the SQL `ON CONFLICT` clause to also set `latest_issued_version = 0` (matching the INSERT VALUES)
  - Currently: `INSERT VALUES (..., 0, ...) ON CONFLICT DO UPDATE SET state = 'terminated', terminated_at = ?, active_version = NULL` — missing `latest_issued_version = 0`
  - Add a test: terminate a card with `latest_issued_version = 5` → verify it becomes 0 after terminate

  **Must NOT do**:
  - Do not change first-terminate behavior (already 0)
  - Do not change `state` or `terminated_at` semantics

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1, F3.

  **References**:
  - `durableObjects/CardReplayDO.js:507-521` — terminate SQL
  - `tests/tapTracking.test.js` — patterns for DO tests

  **Acceptance Criteria**:
  - [ ] `npm test` green
  - [ ] New test asserts re-terminate resets `latest_issued_version` to 0
  - [ ] First-terminate behavior unchanged

  **QA Scenarios**:
  ```
  Scenario: Re-terminate resets version
    Tool: Bash (npm test)
    Steps: New unit test in tapTracking.test.js or new file
    Expected Result: Test green
    Evidence: .sisyphus/evidence/task-12-terminate.txt
  ```

  **Commit**: YES
  - Message: `fix(do): also reset latest_issued_version on re-terminate`
  - Files: `durableObjects/CardReplayDO.js`, `tests/tapTracking.test.js`
  - Pre-commit: `npm test`

- [ ] 13. **refactor(do): route console.warn through logger**

  **What to do**:
  - In `durableObjects/CardReplayDO.js:539`, replace the `console.warn(...)` call with a call to `logger.warn(...)` from `utils/logger.js`
  - Import logger at top of file if not present
  - Verify `npm test` still green

  **Must NOT do**:
  - Do not introduce a circular dependency
  - Do not change the warn message text (preserves log searches)

  **Recommended Agent Profile**: `quick`. Wave 2. Blocks F1, F2.

  **References**:
  - `durableObjects/CardReplayDO.js:539` — current `console.warn`
  - `utils/logger.js` — structured logger

  **Acceptance Criteria**:
  - [ ] grep: `grep -n "console\." durableObjects/CardReplayDO.js` returns 0 hits
  - [ ] `npm test` green

  **QA Scenarios**:
  ```
  Scenario: No console.* in DO
    Tool: Bash (grep)
    Steps: grep -n "console\." durableObjects/CardReplayDO.js
    Expected Result: 0 hits
    Evidence: .sisyphus/evidence/task-13-logger.txt
  ```

  **Commit**: YES
  - Message: `refactor(do): route console.warn through logger`
  - Files: `durableObjects/CardReplayDO.js`
  - Pre-commit: `npm test`

- [ ] I1. **gh issue: proxy header allow/deny-list policy**

  **What to do**:
  - Run:
    ```bash
    gh issue create --title "security(proxy): add request/response header allow-list" --body "$(cat <<'EOF'
    Currently \`handlers/proxyHandler.js:31\` forwards request headers verbatim (including \`Cookie\`, \`Authorization\`) and \`:53-56\` forwards downstream response headers verbatim (including \`Set-Cookie\`).

    ### Risk
    - Operator credentials/cookies could leak to downstream LNBits instance
    - Downstream Set-Cookie could be set on our origin

    ### Proposal
    - Define explicit request header allow-list (e.g. \`Accept\`, \`Content-Type\`, \`User-Agent\`, \`X-Boltcard-*\`)
    - Define explicit response header allow-list (or deny-list with \`Set-Cookie\`, \`Authorization\`, etc.)
    - Add tests asserting denied headers are stripped

    ### Files
    - \`handlers/proxyHandler.js\`
    - new tests in \`tests/proxyHandler.test.js\`

    ### Discovered by
    Plan: \`.sisyphus/plans/full-project-review.md\` findings #6, #7
    EOF
    )"
    ```
  - Note the issue number in the plan after filing

  **Must NOT do**:
  - Do not implement the fix (this is for a future plan)

  **Recommended Agent Profile**: `quick`. Wave 3.

  **Acceptance Criteria**:
  - [ ] `gh issue list --state open --search "header allow-list in:title"` returns 1 result

  **QA Scenarios**:
  ```
  Scenario: Issue filed
    Tool: Bash (gh issue list)
    Steps: gh issue list with title filter
    Expected Result: 1 issue with title "security(proxy): ..."
    Evidence: .sisyphus/evidence/task-i1-issue.txt
  ```

  **Commit**: NO (not a code change)

- [ ] I2. **gh issue: DO error-handling consistency policy**

  **What to do**:
  - Run:
    ```bash
    gh issue create --title "arch(do): consistent error-handling policy across replayProtection callers" --body "$(cat <<'EOF'
    \`replayProtection.js\` callers are split between fail-closed (throw) and silent-fallback (return defaults). This is the root cause of finding #1 (fixed by T1 in plan) but the broader inconsistency remains.

    ### Fail-closed callers
    - \`checkReplayOnly\`, \`recordTap\`, \`deliverKeys\`, \`activateCard\`, \`terminateCard\`, \`requestWipe\`, \`resetReplayProtection\`

    ### Silent-fallback callers
    - \`getCardState\` (now fixed via T1), \`listTaps\`, \`getAnalytics\`, \`getCardConfig\`, \`setCardConfig\`, \`debitCard\`, \`creditCard\`, \`getBalance\`, \`listTransactions\`

    ### Proposal
    - Document explicit policy: security-critical reads = fail-closed; analytics/UI reads where stale = acceptable = silent-fallback
    - Audit each call site and tag in code with \`// fail-closed: <reason>\` or \`// silent-ok: <reason>\`
    - Add ESLint custom rule or test that asserts no unannotated try/catch in replayProtection.js

    ### Files
    - \`replayProtection.js\` (12 functions)
    - \`docs/error-handling-policy.md\` (new)
    - tests for each call site

    ### Discovered by
    Plan: \`.sisyphus/plans/full-project-review.md\` finding #1 architectural note
    EOF
    )"
    ```

  **Recommended Agent Profile**: `quick`. Wave 3.

  **Acceptance Criteria**:
  - [ ] `gh issue list --state open --search "error-handling policy in:title"` returns 1 result

  **QA Scenarios**:
  ```
  Scenario: Issue filed
    Tool: Bash (gh issue list)
    Steps: search by title
    Evidence: .sisyphus/evidence/task-i2-issue.txt
  ```

  **Commit**: NO

- [ ] I3. **gh issue: documentation overhaul (README + AGENTS.md + JSDoc)**

  **What to do**:
  - Run:
    ```bash
    gh issue create --title "docs: comprehensive overhaul of README, AGENTS.md, and JSDoc" --body "$(cat <<'EOF'
    T9 in the plan fixes README test counts but a fuller documentation pass is warranted:

    ### Scope
    - **README.md**: full re-read for accuracy (architecture diagram, endpoint table, security notes)
    - **AGENTS.md**: sync with actual route table, dependency quirks, current test count
    - **JSDoc audit**: 30+ source files, many lack \`@param\`/\`@returns\`; some have stale signatures
    - **docs/**: 10 files in \`docs/\` — \`current-state.md\`, \`refactor-scope.md\` are likely stale; \`ntag424_llm_context.{md,txt,json}\` may be redundant
    - **guide.md** (referenced by README): verify exists and is current

    ### Effort
    Estimated 4-8 hours of focused writing across 30+ files. Beyond plan TODO threshold (≤3 files / <2h).

    ### Discovered by
    Plan: \`.sisyphus/plans/full-project-review.md\` finding #12
    EOF
    )"
    ```

  **Recommended Agent Profile**: `quick`. Wave 3.

  **Acceptance Criteria**:
  - [ ] `gh issue list --state open --search "documentation overhaul in:title"` returns 1 result

  **QA Scenarios**:
  ```
  Scenario: Issue filed
    Tool: Bash (gh issue list)
    Evidence: .sisyphus/evidence/task-i3-issue.txt
  ```

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.
> Never mark F1-F4 as checked before getting user's okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read this plan end-to-end. For each "Must Have": verify implementation exists (read file, grep code, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [13/13] | Issues [3/3] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm test`. Review all changed files for: `as any`, `@ts-ignore` (N/A — JS project), empty catches, server-side `console.log`, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute every QA scenario from every task — follow exact steps, capture evidence. Test cross-task integration (T1 fail-closed + T3 prod-guard together; T2 route removal + T7 405 together). Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git log --oneline` + `git diff` per commit). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance per task. Detect cross-task contamination: task N touching task M's files. Flag unaccounted changes.
  Output: `Tasks [13/13 compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

- [ ] **Deploy Gate** — after F1-F4 ALL APPROVE and user explicit "okay":
  ```
  npm run deploy
  ```
  Verify worker version updated, smoke-test production endpoint.

---

## Commit Strategy

Each TODO = 1 atomic commit, semantic prefix, Sisyphus footer + co-author:

```
type(scope): subject

body explaining the why

🤖 Generated by Sisyphus
Co-Authored-By: Sisyphus <noreply@anthropic.com>
```

- T1: `fix(replay): fail closed when DO unreachable in getCardState`
- T2: `fix(routes): remove duplicate POST /activate/form`
- T3: `feat(security): guard dev K1 fallback in production`
- T4: `refactor(boltcard): remove unreachable extractUIDAndCounter branch`
- T5: `fix(login): use ISSUER_KEY for derivation, never K1 fallback`
- T6: `feat(lnurlpay): make third-party POS_ADDRESS_POOL opt-in`
- T7: `fix(lnurl): return 405 for unimplemented POST branch`
- T8: `docs(withdraw): document clnrest fixed-amount behavior`
- T9: `docs(readme): correct test counts and file list`
- T10: `chore(repo): remove stale audit artifacts`
- T11: `fix(2fa): remove wasteful 5s meta-refresh`
- T12: `fix(do): also reset latest_issued_version on re-terminate`
- T13: `refactor(do): route console.warn through logger`

---

## Success Criteria

### Verification Commands
```bash
# All tests pass
npm test
# Expected: 264+ passing, 19 suites, 0 failures

# No server-side console.* outside logger
grep -rn "console\." --include="*.js" -- index.js handlers/ durableObjects/ utils/ replayProtection.js cryptoutils.js boltCardHelper.js getUidConfig.js | grep -v "utils/logger.js" | grep -v "// "
# Expected: 0 hits

# No duplicate routes
grep -n 'router\.post.*"/activate/form"' index.js
# Expected: exactly 1 line

# No dev K1 fallback without guard
grep -n "BOLT_CARD_K1?.split" handlers/loginHandler.js
# Expected: 0 hits

# Stale artifacts removed
ls audit-report.md config-audit-*.json hardcoded-value-inventory.md ntag424_llm_context_bundle.zip 2>&1
# Expected: "No such file or directory" for all 4

# 3 issues filed
gh issue list --state open --search "proxy header policy in:title OR DO error in:title OR documentation overhaul in:title"
# Expected: 3 results

# Deploy succeeds
npm run deploy
# Expected: "Uploaded" + new worker version ID
```

### Final Checklist
- [ ] All 13 TODOs landed as atomic commits
- [ ] All 3 GitHub issues filed and referenced from plan
- [ ] `npm test` green (264+/19/0)
- [ ] All "Must NOT Have" guardrails respected
- [ ] F1-F4 all APPROVE
- [ ] User explicit okay received
- [ ] Production deploy successful
- [ ] Draft `.sisyphus/drafts/full-project-review.md` deleted
