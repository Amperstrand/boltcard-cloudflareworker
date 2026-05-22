# BoltCard Cloudflare Worker — Cleanup, Documentation & Refactoring

## TL;DR

> **Quick Summary**: Full audit, documentation, and refactoring of a Cloudflare Worker implementing BoltCard NFC Lightning payments. The codebase has 12+ critical bugs, massive code duplication, orphaned files, and custom crypto that should use vetted libraries. We document the current state, document the BoltCard protocol with references, then systematically fix bugs and refactor to a clean, modern Cloudflare Worker architecture.
> 
> **Deliverables**:
> - Current project state documentation (bugs, architecture, file inventory)
> - BoltCard protocol reference document with online sources
> - Bug fixes for all 12 critical issues (isolated commits)
> - Refactored codebase: itty-router v4, module worker format, consolidated crypto, no dead code
> - Green test suite + passing test vectors + clean `wrangler deploy --dry-run`
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: Task 1-4 (parallel) → Task 5 → Tasks 6-10 (parallel) → Tasks 11-15 (parallel) → Task 16 → Final Verification

---

## Context

### Original Request
"This project needs cleaning up and documenting. Document the current state of the project. Document how boltcards work with references to online sources. Make a plan to refactor the project to make it a lot cleaner. Where possible prefer popular vetted libraries to custom functions."

### Interview Summary
**Key Discussions**:
- Full codebase read-through completed (25+ files analyzed)
- 12+ critical bugs identified with file:line references
- User preference: TDD approach for refactoring
- User preference: vetted libraries over custom implementations
- Architecture assessment: Cloudflare Worker (service worker format), KV, broken Durable Objects

**Research Findings**:
- Web Crypto API lacks AES-ECB — cannot replace `aes-js` directly. Alternatives: `@noble/ciphers` (audited, pure JS) or keep `aes-js` + consolidate
- `itty-router` v4 is the standard Cloudflare Workers router
- Module worker format (`export default { fetch() {} }`) is the modern Cloudflare pattern
- `process.env` does not work in Cloudflare Workers — all env bindings must come via `env` parameter
- Durable Objects must be exported from the worker module to be instantiatable

### Metis Review
**Identified Gaps** (addressed):
- **AES-ECB requirement**: Web Crypto cannot replace aes-js. Plan specifies `@noble/ciphers` or keep `aes-js` with consolidation
- **Scope decisions needed**: Card-portal, admin panel, `src/` directory, Durable Objects — resolved as defaults below
- **Test vectors as acceptance criteria**: Three canonical test vectors must pass after every crypto change
- **Bug fix sequencing**: Must not mix bug fixes with architectural changes
- **`ISSUER_KEY` via `process.env`**: Must migrate ALL `process.env` to `env` parameter
- **Counter wraparound**: 24-bit NXP counter not handled — documented as known limitation
- **Multi-K1 key support**: Must be preserved for key rotation
- **Hex case normalization**: Must standardize throughout codebase

---

## Work Objectives

### Core Objective
Transform a buggy, duplicated, poorly-structured Cloudflare Worker into a clean, well-documented, correctly-functioning BoltCard payment processor with vetted dependencies and modern architecture.

### Concrete Deliverables
- `docs/current-state.md` — Complete project audit document
- `docs/boltcard-protocol.md` — BoltCard protocol reference with citations
- All 12 bugs fixed with isolated commits
- `index.js` rewritten as module worker with itty-router v4
- Crypto consolidated into single module using vetted library
- All `process.env` migrated to `env` parameter passing
- Dead code removed (`src/`, `totp.js`, duplicate routes, VC block, orphaned code)
- Green test suite + 3 test vectors passing

### Definition of Done
- [ ] `npm test` passes with 0 failures
- [ ] `wrangler deploy --dry-run` produces no errors
- [ ] All 3 test vectors return `{"tag":"withdrawRequest",...}`
- [ ] No `process.env` references remain in source code
- [ ] No duplicate function implementations remain
- [ ] `docs/current-state.md` and `docs/boltcard-protocol.md` exist and are complete

### Must Have
- Crypto correctness preserved (test vectors pass at every step)
- Multi-K1 key decryption capability preserved (key rotation)
- All bugs fixed before refactoring begins
- Module worker format with proper DO exports
- itty-router v4 for routing
- All env bindings via `env` parameter (no `process.env`)
- Standardized hex case (lowercase throughout)
- Single shared response helpers module

### Must NOT Have (Guardrails)
- **Do NOT implement new features** (no VC system, no lnurlp, no TOTP, no admin auth)
- **Do NOT use Web Crypto for AES-ECB** — it doesn't support ECB mode
- **Do NOT mix bug fixes with architectural changes** in the same task/commit
- **Do NOT delete `keygenerator.js computeCm`** until functional equivalence verified against test vectors
- **Do NOT touch card-portal beyond deleting orphaned code** — card-portal is OUT OF SCOPE for full implementation
- **Do NOT implement admin panel authentication** — admin cleanup is structural only
- **Do NOT add excessive JSDoc/comments** — minimal, meaningful comments only
- **Do NOT over-abstract** — prefer direct, readable code over unnecessary abstractions
- **Do NOT create new Durable Object implementations** — wire existing or replace with KV

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Jest with `--experimental-vm-modules`)
- **Automated tests**: TDD — RED (failing test) → GREEN (minimal impl) → REFACTOR
- **Framework**: Jest (existing) — evaluate migration to `vitest` or `bun test` as separate concern
- **Test vectors**: Three canonical LNURLW URLs must pass after every crypto change

### Canonical Test Vectors (CRYPTO ACCEPTANCE CRITERIA)
These MUST pass after any change to crypto, routing, or LNURLW flow:
```
Vector 1: p=4E2E289D945A66BB13377A728884E867 c=E19CCB1FED8892CE
Vector 2: p=00F48C4F8E386DED06BCDC78FA92E2FE c=66B4826EA4C155B4
Vector 3: p=0DBF3C59B59B0638D60B5842A997D4D1 c=CC61660C020B4D96
```

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Documentation**: Verify file exists, check for required sections via grep
- **Bug fixes**: `npm test` + specific curl/function call for the fixed code path
- **Refactoring**: `npm test` + `wrangler deploy --dry-run` + test vectors
- **Crypto changes**: Test vectors MUST pass before AND after

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — documentation + baseline, ALL PARALLEL):
├── Task 1: Document current project state [writing]
├── Task 2: Document BoltCard protocol reference [writing]
├── Task 3: Capture test baseline [quick]
├── Task 4: Scope decisions document [quick]
└── Task 5: Evaluate crypto library replacement [deep]

Wave 2 (After Wave 1 — bug fixes, MAX PARALLEL):
├── Task 6: Fix card-portal/handlers.js syntax errors (depends: 4) [quick]
├── Task 7: Fix admin/routes.js broken interface + missing import (depends: 4) [quick]
├── Task 8: Fix index.js duplicate routes + LNURLW blocks (depends: 4) [unspecified-high]
├── Task 9: Fix missing awaits + signature mismatches (depends: 4) [quick]
└── Task 10: Fix process.env → env parameter migration (depends: 5) [unspecified-high]

Wave 3 (After Wave 2 — architectural refactoring, MAX PARALLEL):
├── Task 11: Consolidate crypto into single module (depends: 5, 9) [deep]
├── Task 12: Migrate to module worker format + export DOs (depends: 8) [unspecified-high]
├── Task 13: Migrate to itty-router v4 (depends: 8, 12) [unspecified-high]
├── Task 14: Standardize response helpers + logging (depends: 8) [quick]
└── Task 15: Delete dead code + clean up (depends: 6, 7, 8) [quick]

Wave 4 (After Wave 3 — integration + final testing):
├── Task 16: Integration testing + test vector verification (depends: 11-15) [deep]
└── Task 17: Update README + project docs (depends: 1, 16) [writing]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 4 → Task 8 → Task 12 → Task 13 → Task 16 → Final
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 17 | 1 |
| 2 | — | 11 | 1 |
| 3 | — | 8, 16 | 1 |
| 4 | — | 6, 7, 8, 9, 15 | 1 |
| 5 | — | 10, 11 | 1 |
| 6 | 4 | 15 | 2 |
| 7 | 4 | 15 | 2 |
| 8 | 4 | 12, 13, 14, 15 | 2 |
| 9 | 4 | 11 | 2 |
| 10 | 5 | 12, 13 | 2 |
| 11 | 5, 9 | 16 | 3 |
| 12 | 8, 10 | 13, 16 | 3 |
| 13 | 8, 12 | 16 | 3 |
| 14 | 8 | 16 | 3 |
| 15 | 6, 7, 8 | 16 | 3 |
| 16 | 11-15 | 17, F1-F4 | 4 |
| 17 | 1, 16 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: **5 tasks** — T1 → `writing`, T2 → `writing`, T3 → `quick`, T4 → `quick`, T5 → `deep`
- **Wave 2**: **5 tasks** — T6 → `quick`, T7 → `quick`, T8 → `unspecified-high`, T9 → `quick`, T10 → `unspecified-high`
- **Wave 3**: **5 tasks** — T11 → `deep`, T12 → `unspecified-high`, T13 → `unspecified-high`, T14 → `quick`, T15 → `quick`
- **Wave 4**: **2 tasks** — T16 → `deep`, T17 → `writing`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

### Wave 1 — Documentation + Baseline (ALL PARALLEL)

- [ ] 1. Document Current Project State

  **What to do**:
  - Create `docs/current-state.md` with complete project audit
  - Include: complete file inventory (every .js file with role description and line count)
  - Document all 12+ bugs found during analysis, each with file:line reference, severity (critical/medium/low), and impact description
  - Architecture diagram: request flow from NFC tap → Cloudflare Worker → KV lookup → crypto validation → LNURL response → payment backend
  - Environment variable table: every `process.env` and `env.` reference with description and default value
  - KV namespace bindings table (from `wrangler.toml`)
  - Durable Objects status table (declared but not exported/wired)
  - Known limitations section: counter wraparound (24-bit max), no admin auth, card-portal unfinished, DOs non-functional
  - Test coverage map: which functions have tests, which don't

  **Must NOT do**:
  - Do NOT fix any bugs — this is documentation only
  - Do NOT modify any source files
  - Do NOT make subjective quality judgments — state facts with evidence

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Task 17
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `index.js` — Main entry point, 326 lines, service worker format with `addEventListener('fetch')`
  - `cryptoutils.js` — Custom AES-CMAC implementation
  - `keygenerator.js` — Duplicate crypto functions + deterministic key generation
  - `boltCardHelper.js` — Card validation, `extractUIDAndCounter`, `validate_cmac`
  - `getUidConfig.js` — KV + static config lookup, `BOLT_CARD_K1` array
  - `handlers/` — All 9 handler files
  - `admin/routes.js` + `admin/handlers.js` — Broken admin routing
  - `card-portal/handlers.js` — Orphaned code blocks, syntax errors
  - `durableObjects/` — CardDO.js, BackendRegistryDO.js, AdminDO.js
  - `utils/logger.js` — Custom logger class
  - `src/index.js` — Orphaned alternate entry point
  - `wrangler.toml` — Cloudflare config
  - `package.json` — Dependencies and scripts

  **Bug Registry** (document ALL of these):
  - Bug 1: `index.js:172` — `ctrValue` undefined
  - Bug 2: `index.js:174` — `cardStub` undefined + wrong `validateAndUpdateCounter` signature
  - Bug 3: `handlers/lnurlHandler.js:150` — `getUidConfig(uid)` missing `await` and `env` param
  - Bug 4: `card-portal/handlers.js:302-364` — Orphaned code block (syntax error on import)
  - Bug 5: `card-portal/handlers.js:397` — Variable shadowing `const card` redeclared
  - Bug 6: `card-portal/handlers.js:251` — `extractUIDAndCounter` not implemented
  - Bug 7: `boltCardHelper.js validate_cmac` — 3-param function called with 4 args; KV K2 ignored
  - Bug 8: `src/index.js` — Dead stub referencing undefined functions
  - Bug 9: `admin/routes.js` — interface mismatch with index.js caller
  - Bug 10: `admin/routes.js:17` — `handleAdminCreateBackend` never imported
  - Bug 11: `index.js:75-93,102-120,218-236` — Routes registered THREE times
  - Bug 12: `keygenerator.js` — `process.env.ISSUER_KEY` falls back to dev key in production

  **Acceptance Criteria**:
  - [ ] `docs/current-state.md` exists
  - [ ] Contains "## File Inventory" section with ≥20 files listed
  - [ ] Contains "## Bug Registry" section with ≥12 bugs with file:line references
  - [ ] Contains "## Architecture" section
  - [ ] Contains "## Environment Variables" section
  - [ ] Contains "## Known Limitations" section

  **QA Scenarios:**

  ```
  Scenario: Documentation completeness check
    Tool: Bash (grep)
    Preconditions: Task completed, file written
    Steps:
      1. Run: grep -c '## File Inventory' docs/current-state.md → expect 1
      2. Run: grep -c '## Bug Registry' docs/current-state.md → expect 1
      3. Run: grep -c 'Bug [0-9]' docs/current-state.md → expect ≥12
      4. Run: grep -c '## Architecture' docs/current-state.md → expect 1
      5. Run: grep -c '## Environment Variables' docs/current-state.md → expect 1
    Expected Result: All grep counts match expected values
    Evidence: .sisyphus/evidence/task-1-doc-completeness.txt

  Scenario: No source files modified
    Tool: Bash (git)
    Steps:
      1. Run: git diff --name-only -- '*.js' → expect empty (no JS files changed)
    Expected Result: Only .md files in diff
    Evidence: .sisyphus/evidence/task-1-no-source-changes.txt
  ```

  **Commit**: YES
  - Message: `docs: add current project state documentation`
  - Files: `docs/current-state.md`

---

- [ ] 2. Document BoltCard Protocol Reference

  **What to do**:
  - Create `docs/boltcard-protocol.md` — standalone protocol reference
  - **NXP NTAG 424 DNA section**: SUN authentication, encrypted URL parameters. Cite NXP AN12196
  - **AES-CMAC section**: RFC 4493 algorithm, AES-ECB internally, subkey generation. Cite RFC 4493
  - **p parameter decryption**: AES-128-ECB with K1, byte structure: `[0xC7, UID(7), counter(3 LSB), padding(5)]`. Byte table
  - **c parameter verification**: SV2 `[0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80, UID(7), ctr(3)]`, CMAC with K2, 8-byte truncation. Byte table
  - **Key derivation**: K0-K4 roles table, formula: `CardKey = CMAC(IssuerKey, "2d003f75" || UID || Version)`
  - **LNURL-withdraw flow**: NFC tap → p/c → decrypt → validate → LNURL response → callback → payment. Cite LUD-03
  - **Counter replay protection**: 24-bit monotonic counter
  - **Multi-K1 keys**: Key rotation support
  - Citations: NXP AN12196, boltcard.org, github.com/boltcard/boltcard, LUD-03, LUD-17, RFC 4493

  **Must NOT do**:
  - Do NOT modify source files
  - Do NOT include implementation-specific file paths — this is a protocol doc

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Task 11
  - **Blocked By**: None

  **References**:

  **External References (MUST cite):**
  - NXP AN12196: https://www.nxp.com/docs/en/application-note/AN12196.pdf
  - BoltCard spec: https://github.com/boltcard/boltcard
  - boltcard.org: https://boltcard.org
  - LUD-03: https://github.com/lnurl/luds/blob/luds/03.md
  - LUD-17: https://github.com/lnurl/luds/blob/luds/17.md
  - RFC 4493: https://datatracker.ietf.org/doc/html/rfc4493

  **Codebase References (for understanding protocol):**
  - `cryptoutils.js` — AES-CMAC algorithm implementation
  - `boltCardHelper.js` — `extractUIDAndCounter` (p param byte structure), `validate_cmac` (SV2 construction)
  - `keygenerator.js` — Key derivation with "2d003f75" prefix
  - `getUidConfig.js` — `BOLT_CARD_K1` array (multi-key)
  - `handlers/withdrawHandler.js` — LNURL-withdraw response construction

  **Acceptance Criteria**:
  - [ ] `docs/boltcard-protocol.md` exists
  - [ ] Contains ≥7 sections (NTAG 424, AES-CMAC, p param, c param, key derivation, LNURL flow, replay protection)
  - [ ] Contains ≥4 external citation URLs
  - [ ] Contains byte breakdown tables for p parameter AND SV2
  - [ ] Contains K0-K4 key roles table

  **QA Scenarios:**

  ```
  Scenario: Protocol document completeness
    Tool: Bash (grep)
    Steps:
      1. grep -c 'NTAG 424' docs/boltcard-protocol.md → expect ≥3
      2. grep -c 'AES-CMAC' docs/boltcard-protocol.md → expect ≥5
      3. grep -c 'SV2' docs/boltcard-protocol.md → expect ≥2
      4. grep -c 'https://' docs/boltcard-protocol.md → expect ≥4
      5. grep -c 'LUD-03\|LUD-17' docs/boltcard-protocol.md → expect ≥2
    Expected Result: All counts meet minimums
    Evidence: .sisyphus/evidence/task-2-protocol-doc.txt
  ```

  **Commit**: YES
  - Message: `docs: add boltcard protocol reference with citations`
  - Files: `docs/boltcard-protocol.md`

---

- [ ] 3. Capture Test Baseline

  **What to do**:
  - Run `npm test` and capture full output
  - Document exact pass/fail results per test file and per test case
  - Save raw output to `.sisyphus/evidence/test-baseline.txt`
  - Note any tests that fail due to existing bugs (expected failures)
  - This becomes the regression baseline — every subsequent task must maintain or improve this

  **Must NOT do**:
  - Do NOT modify any test files or source files
  - Do NOT attempt to fix failing tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 16 (baseline for comparison)
  - **Blocked By**: None

  **References**:
  - `package.json` — `"test": "node --experimental-vm-modules ./node_modules/.bin/jest"` script
  - `jest.config.js` — Jest configuration
  - `tests/worker.test.js` — Main test suite

  **Acceptance Criteria**:
  - [ ] `.sisyphus/evidence/test-baseline.txt` exists with full `npm test` output
  - [ ] Pass/fail counts documented

  **QA Scenarios:**

  ```
  Scenario: Baseline captured
    Tool: Bash
    Steps:
      1. Run: npm test 2>&1 | tee .sisyphus/evidence/test-baseline.txt
      2. Verify file exists and is non-empty: wc -l .sisyphus/evidence/test-baseline.txt → expect > 5
    Expected Result: Test output captured, file non-empty
    Evidence: .sisyphus/evidence/task-3-baseline.txt
  ```

  **Commit**: NO (evidence file only, not committed to repo)

---

- [ ] 4. Document Scope Decisions

  **What to do**:
  - Create `docs/refactor-scope.md` with explicit binary decisions for 4 scope questions:
    1. **Card-portal** (`card-portal/`): OUT OF SCOPE — delete orphaned code, do not implement. Rationale: `extractUIDAndCounter` returns `reject('Not implemented')`, session tokens are unsigned (security issue), feature is incomplete
    2. **Admin panel** (`admin/`): STRUCTURAL FIX ONLY — fix the broken `setupAdminRoutes` interface so it doesn't crash, but do NOT add authentication or new admin features. Rationale: admin auth is a separate concern
    3. **`src/` directory**: DELETE — it's an abandoned refactor attempt with undefined references. Rationale: orphaned dead code
    4. **Durable Objects**: KEEP BUT PROPERLY WIRE — export DO classes from module worker, fix `validateAndUpdateCounter` signature. Do NOT redesign DO architecture. Rationale: DOs are declared in wrangler.toml and serve counter persistence
  - Also document: card-portal NFC login = defer, lnurlp = defer, TOTP = defer, VC block in withdrawHandler = delete

  **Must NOT do**:
  - Do NOT implement any scope decisions — just document them
  - Do NOT modify source files

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7, 8, 9, 15
  - **Blocked By**: None

  **References**:
  - `card-portal/handlers.js` — Read to understand scope of brokenness
  - `admin/routes.js` — Read to understand interface mismatch
  - `src/index.js` — Read to confirm it's orphaned
  - `durableObjects/CardDO.js` — Read `validateAndUpdateCounter` method signature
  - `handlers/withdrawHandler.js` — Read to find VC block to delete

  **Acceptance Criteria**:
  - [ ] `docs/refactor-scope.md` exists
  - [ ] Contains 4 binary scope decisions with rationale
  - [ ] Contains deferred features list

  **QA Scenarios:**

  ```
  Scenario: Scope decisions complete
    Tool: Bash (grep)
    Steps:
      1. grep -c 'card-portal\|Card-portal\|Card Portal' docs/refactor-scope.md → expect ≥1
      2. grep -c 'admin\|Admin' docs/refactor-scope.md → expect ≥1
      3. grep -c 'src/' docs/refactor-scope.md → expect ≥1
      4. grep -c 'Durable Object\|durable object\|DO' docs/refactor-scope.md → expect ≥1
    Expected Result: All 4 decisions documented
    Evidence: .sisyphus/evidence/task-4-scope.txt
  ```

  **Commit**: YES
  - Message: `docs: document refactoring scope decisions`
  - Files: `docs/refactor-scope.md`

---

- [ ] 5. Evaluate Crypto Library Replacement

  **What to do**:
  - Research and evaluate alternatives to the custom AES-CMAC in `cryptoutils.js`
  - **CRITICAL**: Web Crypto API does NOT support AES-ECB mode. Do not recommend it for CMAC
  - Evaluate these options:
    1. `@noble/ciphers` — audited, pure JS, supports AES-ECB via `aes` primitives. Check if CMAC is built-in or needs manual construction
    2. `@stablelib/cmac` + `@stablelib/aes` — dedicated AES-CMAC, audited
    3. Keep `aes-js` (3M weekly downloads, already works) and just consolidate the two implementations into one
  - For each option: check CF Workers compatibility, bundle size, audit status, API ergonomics
  - Verify that the chosen library produces identical output for the 3 test vectors
  - Write recommendation to `.sisyphus/evidence/crypto-evaluation.md`
  - Also check: does `keygenerator.js computeCm` produce identical output to `cryptoutils.js computeCm`? Run both with same inputs against test vectors

  **Must NOT do**:
  - Do NOT modify source files yet
  - Do NOT recommend Web Crypto for AES-ECB (it doesn't support ECB mode)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 10, 11
  - **Blocked By**: None

  **References**:
  - `cryptoutils.js` — Current AES-CMAC: `computeAesCmac`, `generateSubkeyGo`, `computeCm`, `xorArrays`
  - `keygenerator.js` — Duplicate implementations: `aesCmac`, `generateSubkey`, `computeCm`
  - `boltCardHelper.js:extractUIDAndCounter` — Uses `aes-js` AES-ECB for p parameter decryption
  - `testvectors.js` — Test vector data
  - `tests/` — Existing crypto tests to verify equivalence

  **External References:**
  - `@noble/ciphers`: https://github.com/paulmillr/noble-ciphers
  - `@stablelib/cmac`: https://github.com/nickel-org/stablelib
  - `aes-js`: https://github.com/nickel-org/aes-js

  **Acceptance Criteria**:
  - [ ] `.sisyphus/evidence/crypto-evaluation.md` exists with evaluation of ≥3 options
  - [ ] Each option assessed for: CF Workers compat, audit status, bundle size, API
  - [ ] Clear recommendation with rationale
  - [ ] `keygenerator.js computeCm` vs `cryptoutils.js computeCm` equivalence verified

  **QA Scenarios:**

  ```
  Scenario: Crypto equivalence verified
    Tool: Bash (node)
    Steps:
      1. Write a small test script that imports both computeCm functions
      2. Run both with identical inputs (from test vectors)
      3. Assert outputs are byte-identical
    Expected Result: Both implementations produce same output
    Evidence: .sisyphus/evidence/task-5-crypto-equiv.txt

  Scenario: Library recommendation documented
    Tool: Bash (grep)
    Steps:
      1. grep -c 'Recommendation' .sisyphus/evidence/crypto-evaluation.md → expect ≥1
      2. grep -c '@noble\|@stablelib\|aes-js' .sisyphus/evidence/crypto-evaluation.md → expect ≥3
    Expected Result: Evaluation document is complete
    Evidence: .sisyphus/evidence/task-5-eval-complete.txt
  ```

  **Commit**: NO (evidence/research only)

---

### Wave 2 — Bug Fixes (MAX PARALLEL)

- [ ] 6. Fix card-portal/handlers.js Syntax Errors

  **What to do**:
  - Remove the orphaned code block at lines 302-364 (copy-paste artifact after `handleCardAuth` function close)
  - Fix variable shadowing in `handleCardInfo` at line 397 — rename second `const card` to `const cardInfo`
  - Do NOT fix `extractUIDAndCounter` — card-portal is OUT OF SCOPE per Task 4
  - Run `npm test` to verify no regressions

  **Must NOT do**:
  - Do NOT implement `extractUIDAndCounter`
  - Do NOT add new card-portal features
  - Do NOT combine with other bug fixes — isolated commit

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 10)
  - **Blocks**: Task 15
  - **Blocked By**: Task 4

  **References**:
  - `card-portal/handlers.js:300` — `handleCardAuth` ends here; lines 302-364 are orphaned
  - `card-portal/handlers.js:387,397` — `const card` declared twice in `handleCardInfo`
  - `docs/refactor-scope.md` (from Task 4) — card-portal OUT OF SCOPE

  **Acceptance Criteria**:
  - [ ] `card-portal/handlers.js` imports without syntax errors
  - [ ] No orphaned code blocks (lines 302-364 removed)
  - [ ] `npm test` ≥ baseline

  **QA Scenarios:**
  ```
  Scenario: Module imports cleanly
    Tool: Bash
    Steps:
      1. node --input-type=module -e "import('./card-portal/handlers.js').then(() => console.log('OK')).catch(e => { console.error(e.message); process.exit(1) })"
      2. Expect: 'OK', exit code 0
    Expected Result: No syntax errors on import
    Evidence: .sisyphus/evidence/task-6-import-clean.txt
  ```

  **Commit**: YES
  - Message: `fix(card-portal): remove orphaned code block and fix variable shadowing`
  - Files: `card-portal/handlers.js`
  - Pre-commit: `npm test`

---

- [ ] 7. Fix admin/routes.js Broken Interface + Missing Import

  **What to do**:
  - Fix `setupAdminRoutes` to match how `index.js` calls it — either:
    a. Make `setupAdminRoutes(url, env)` work with manual path matching
    b. OR: stub it to return null with TODO for itty-router migration (Task 13)
  - Fix missing import of `handleAdminCreateBackend` — import from `admin/handlers.js` or remove route
  - Run `npm test`

  **Must NOT do**:
  - Do NOT add admin authentication
  - Do NOT refactor to itty-router yet (Task 13)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 15
  - **Blocked By**: Task 4

  **References**:
  - `admin/routes.js` — `setupAdminRoutes(router)` expects router, called with `(url, env)`
  - `admin/handlers.js` — Check if `handleAdminCreateBackend` exists
  - `index.js:75-93` — How admin routes are called

  **Acceptance Criteria**:
  - [ ] `admin/routes.js` imports without errors
  - [ ] `setupAdminRoutes` callable with arguments `index.js` passes
  - [ ] `npm test` ≥ baseline

  **QA Scenarios:**
  ```
  Scenario: Admin module imports cleanly
    Tool: Bash
    Steps:
      1. node --input-type=module -e "import('./admin/routes.js').then(() => console.log('OK')).catch(e => { console.error(e.message); process.exit(1) })"
      2. Expect: exit code 0
    Expected Result: No import errors
    Evidence: .sisyphus/evidence/task-7-admin-import.txt
  ```

  **Commit**: YES
  - Message: `fix(admin): fix route setup interface and missing import`
  - Files: `admin/routes.js`, `admin/handlers.js`
  - Pre-commit: `npm test`

---

- [ ] 8. Fix index.js Duplicate Routes + LNURLW Blocks

  **What to do**:
  - Remove duplicate route registrations: keep ONE block of admin/card routes, delete the other two (lines 75-93, 102-120, 218-236 — keep first, delete others)
  - Remove duplicate LNURLW verification: first block (136-215) has bugs (`ctrValue`/`cardStub` undefined), second block (238-322) is more complete. Keep the working block, delete broken one
  - Remove dead 404 return at line 99 that makes code unreachable
  - Remove duplicate `pHex`/`cHex` null checks
  - This task ONLY removes duplicates — does NOT fix remaining bugs

  **Must NOT do**:
  - Do NOT fix crypto/await bugs — only remove duplicates
  - Do NOT refactor to itty-router (Task 13)
  - Do NOT change module format (Task 12)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 12, 13, 14, 15
  - **Blocked By**: Task 4

  **References**:
  - `index.js:75-93` — First route registration block
  - `index.js:99` — Dead 404 return making code unreachable
  - `index.js:102-120` — Second (duplicate) route registration
  - `index.js:136-215` — First LNURLW block (broken)
  - `index.js:218-236` — Third (duplicate) route registration
  - `index.js:238-322` — Second LNURLW block (more complete)

  **Acceptance Criteria**:
  - [ ] Only ONE route registration block remains
  - [ ] Only ONE LNURLW verification block remains
  - [ ] No unreachable code after 404 return
  - [ ] `npm test` ≥ baseline
  - [ ] `index.js` line count reduced by ≥50 lines

  **QA Scenarios:**
  ```
  Scenario: Duplicate code removed
    Tool: Bash (grep)
    Steps:
      1. grep -c 'setupAdminRoutes' index.js → expect 1
      2. grep -c 'handleCardPage' index.js → expect 1
      3. wc -l index.js → expect < 280
    Expected Result: Significant reduction in duplicates
    Evidence: .sisyphus/evidence/task-8-dedup.txt
  ```

  **Commit**: YES
  - Message: `fix(index): remove duplicate routes and LNURLW verification blocks`
  - Files: `index.js`
  - Pre-commit: `npm test`

---

- [ ] 9. Fix Missing Awaits + Function Signature Mismatches

  **What to do**:
  - Fix `lnurlHandler.js:150`: `const config = await getUidConfig(uid, env)` (add await + env param)
  - Fix `boltCardHelper.js validate_cmac`: accept K2 as optional 4th param for KV support
  - Fix `index.js` caller of `validate_cmac` to match updated signature
  - Add comment to `lnurlHandler.js` `fakewalletCounter` about CF Workers isolate non-persistence
  - Run `npm test`

  **Must NOT do**:
  - Do NOT change routing (Task 8/13)
  - Do NOT refactor crypto module structure (Task 11)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 11
  - **Blocked By**: Task 4

  **References**:
  - `handlers/lnurlHandler.js:150` — `getUidConfig(uid)` missing await + env
  - `getUidConfig.js` — `async function getUidConfig(uid, env)`
  - `boltCardHelper.js` — `validate_cmac(uidBytes, ctr, cHex)` 3-param
  - `index.js` — Calls `validate_cmac` with 4 args

  **Acceptance Criteria**:
  - [ ] All `getUidConfig` calls use `await` and pass `env`
  - [ ] `validate_cmac` signature matches all call sites
  - [ ] `npm test` ≥ baseline

  **QA Scenarios:**
  ```
  Scenario: No missing awaits
    Tool: Bash (grep)
    Steps:
      1. Search for getUidConfig( without preceding await in source (not tests)
      2. Expect: 0 matches
    Expected Result: All async calls awaited
    Evidence: .sisyphus/evidence/task-9-awaits.txt
  ```

  **Commit**: YES
  - Message: `fix: add missing awaits and fix function signature mismatches`
  - Files: `handlers/lnurlHandler.js`, `boltCardHelper.js`, `index.js`
  - Pre-commit: `npm test`

---

- [ ] 10. Migrate process.env to env Parameter Passing

  **What to do**:
  - Find ALL `process.env` references in source (not tests/node_modules)
  - Known locations:
    - `keygenerator.js` — `process.env.ISSUER_KEY`
    - `getUidConfig.js` — `process.env.BOLT_CARD_K1_0`, `BOLT_CARD_K1_1`
    - `card-portal/handlers.js` — `process.env.SESSION_TTL`
  - Refactor to accept `env` parameter from CF Worker fetch handler
  - `getDeterministicKeys(uid)` → `getDeterministicKeys(uid, env)`, use `env.ISSUER_KEY`
  - Thread `env` through all callers
  - Run `npm test`

  **Must NOT do**:
  - Do NOT change `process.env` in test files
  - Do NOT change module format (Task 12)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 5

  **References**:
  - `keygenerator.js:4` — `process.env.ISSUER_KEY || '00...01'`
  - `getUidConfig.js:3-6` — `BOLT_CARD_K1` hardcoded values
  - `card-portal/handlers.js:3` — `process.env.SESSION_TTL`
  - `index.js` — `handleRequest(request, env)` has `env` available

  **Acceptance Criteria**:
  - [ ] `grep -r 'process.env' --include='*.js' . --exclude-dir=node_modules --exclude-dir=tests` → 0 matches
  - [ ] All functions needing env have it in signature
  - [ ] `npm test` ≥ baseline

  **QA Scenarios:**
  ```
  Scenario: No process.env in source
    Tool: Bash
    Steps:
      1. grep -r 'process.env' --include='*.js' . --exclude-dir=node_modules --exclude-dir=tests --exclude-dir=.sisyphus | wc -l
      2. Expect: 0
    Expected Result: Zero process.env references
    Evidence: .sisyphus/evidence/task-10-no-process-env.txt
  ```

  **Commit**: YES
  - Message: `fix(env): migrate process.env to env parameter passing`
  - Files: `keygenerator.js`, `getUidConfig.js`, `card-portal/handlers.js`, callers
  - Pre-commit: `npm test`

---

### Wave 3 — Architectural Refactoring (MAX PARALLEL)

- [ ] 11. Consolidate Crypto into Single Module

  **What to do**:
  - Based on Task 5 evaluation, either replace `aes-js` or keep and consolidate
  - Merge all crypto into `cryptoutils.js` as single source of truth:
    - `computeAesCmac`, `generateSubkey`, `computeCm`, `xorArrays`, `hexToBytes`, `bytesToHex`
  - Update `keygenerator.js` to import ALL crypto from `cryptoutils.js`
  - Remove local duplicates from `keygenerator.js` (`aesCmac`, `generateSubkey`, `computeCm`)
  - Preserve key derivation logic (`PRF`, `getDeterministicKeys`) in keygenerator.js
  - **MUST**: Run test vectors after EVERY change
  - **MUST**: Preserve multi-K1 key decryption

  **Must NOT do**:
  - Do NOT delete `keygenerator.js` entirely
  - Do NOT change SV2 byte structure
  - Do NOT use Web Crypto for AES-ECB

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 13, 14, 15)
  - **Blocks**: Task 16
  - **Blocked By**: Tasks 5, 9

  **References**:
  - `cryptoutils.js` — Canonical: `computeAesCmac`, `generateSubkeyGo`, `computeCm`
  - `keygenerator.js` — Duplicates: `aesCmac`, `generateSubkey`, `computeCm`, `PRF`
  - `boltCardHelper.js` — Uses `computeAesCmac` from cryptoutils
  - `.sisyphus/evidence/crypto-evaluation.md` (Task 5) — Library recommendation
  - `testvectors.js` — Test data

  **Acceptance Criteria**:
  - [ ] Only ONE `computeCm` function in codebase
  - [ ] Only ONE `aesCmac`/`computeAesCmac` function
  - [ ] `keygenerator.js` imports crypto from `cryptoutils.js`
  - [ ] All 3 test vectors pass
  - [ ] `npm test` passes

  **QA Scenarios:**
  ```
  Scenario: No duplicate crypto functions
    Tool: Bash
    Steps:
      1. grep -r 'function computeCm\|const computeCm\|export.*computeCm' --include='*.js' . --exclude-dir=node_modules | wc -l → expect 1
      2. grep -r 'function aesCmac\|function computeAesCmac' --include='*.js' . --exclude-dir=node_modules | wc -l → expect 1
    Expected Result: Each function defined exactly once
    Evidence: .sisyphus/evidence/task-11-no-dupes.txt
  ```

  **Commit**: YES
  - Message: `refactor(crypto): consolidate crypto into single module`
  - Files: `cryptoutils.js`, `keygenerator.js`, `boltCardHelper.js`
  - Pre-commit: `npm test`

---

- [ ] 12. Migrate to Module Worker Format + Export DOs

  **What to do**:
  - Convert `index.js` from `addEventListener('fetch', ...)` to `export default { async fetch(request, env, ctx) {} }`
  - Export DO classes: `export { CardDO } from './durableObjects/CardDO.js'` etc.
  - Remove `if (typeof addEventListener !== 'undefined')` guard
  - Update `wrangler.toml`: remove `type = "javascript"`
  - Fix `CardDO.validateAndUpdateCounter` signature to match callers
  - Test: `wrangler dev` and `wrangler deploy --dry-run`

  **Must NOT do**:
  - Do NOT redesign DO architecture
  - Do NOT change routing (Task 13)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 8)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 13, 16
  - **Blocked By**: Tasks 8, 10

  **References**:
  - `index.js` — Current `addEventListener` format
  - `wrangler.toml` — `type = "javascript"`, `main = "index.js"`, DO declarations
  - `durableObjects/CardDO.js` — `validateAndUpdateCounter` method
  - `durableObjects/BackendRegistryDO.js`, `durableObjects/AdminDO.js`

  **Acceptance Criteria**:
  - [ ] `export default { async fetch() {} }` in index.js
  - [ ] No `addEventListener('fetch')` in codebase
  - [ ] DO classes exported
  - [ ] `wrangler deploy --dry-run` succeeds

  **QA Scenarios:**
  ```
  Scenario: Module worker format verified
    Tool: Bash
    Steps:
      1. grep 'export default' index.js → expect 1
      2. grep 'addEventListener' index.js → expect 0
      3. npx wrangler deploy --dry-run 2>&1 → expect no errors
    Expected Result: Module worker format with clean bundling
    Evidence: .sisyphus/evidence/task-12-module-worker.txt
  ```

  **Commit**: YES
  - Message: `refactor: migrate to module worker format with DO exports`
  - Files: `index.js`, `wrangler.toml`
  - Pre-commit: `wrangler deploy --dry-run` + `npm test`

---

- [ ] 13. Migrate to itty-router v4

  **What to do**:
  - Install `itty-router@4.x`: `npm install itty-router`
  - Replace manual `url.pathname` matching with itty-router routes:
    - `GET /` → LNURLW handler
    - `GET /nfc` → NFC scanner page
    - `GET /status` → status handler
    - `GET|POST /activate` → activation
    - `POST /api/v1/pull-payments/:id/boltcards` → card keys
    - `POST /boltcards/api/v1/lnurl/cb` → LNURL callback
    - Admin + card-portal routes as decided in Task 4
    - `ALL *` → 404 catch-all
  - Wire router: `export default { fetch: router.fetch }`
  - Ensure `env` available to all handlers

  **Must NOT do**:
  - Do NOT change handler implementations
  - Do NOT add new routes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 16
  - **Blocked By**: Tasks 8, 12

  **References**:
  - `index.js` — Current manual path matching
  - `handlers/` — All handler files being routed to
  - itty-router v4 docs: https://itty.dev/itty-router

  **Acceptance Criteria**:
  - [ ] `itty-router` in package.json dependencies
  - [ ] No manual `url.pathname` routing in index.js
  - [ ] `npm test` passes

  **QA Scenarios:**
  ```
  Scenario: Router configured
    Tool: Bash
    Steps:
      1. grep 'itty-router' package.json → expect 1 match
      2. grep -c 'url.pathname' index.js → expect 0
    Expected Result: itty-router replaces manual routing
    Evidence: .sisyphus/evidence/task-13-router.txt
  ```

  **Commit**: YES
  - Message: `refactor(router): migrate to itty-router v4`
  - Files: `index.js`, `package.json`, `package-lock.json`
  - Pre-commit: `npm test`

---

- [ ] 14. Standardize Response Helpers + Logging

  **What to do**:
  - Create `utils/response.js` with shared `jsonResponse(data, status)` and `errorResponse(message, status)`
  - Replace ALL duplicate definitions in: `index.js`, `handlers/fetchBoltCardKeys.js`, `admin/handlers.js`
  - Strip bare `console.log` debug statements from production code OR replace with `utils/logger.js`
  - Remove hardcoded Verifiable Credentials block from `handlers/withdrawHandler.js` ("Lightning Music Fest" concert ticket)

  **Must NOT do**:
  - Do NOT create complex logging framework
  - Do NOT add excessive JSDoc

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 16
  - **Blocked By**: Task 8

  **References**:
  - `index.js` — Inline `jsonResponse`
  - `handlers/fetchBoltCardKeys.js` — Local `jsonResponse`
  - `admin/handlers.js` — Local response helper
  - `utils/logger.js` — Existing Logger class
  - `handlers/withdrawHandler.js` — Hardcoded VC block

  **Acceptance Criteria**:
  - [ ] `utils/response.js` exists
  - [ ] No duplicate `jsonResponse` definitions outside `utils/response.js`
  - [ ] VC block removed from `withdrawHandler.js`
  - [ ] `npm test` passes

  **QA Scenarios:**
  ```
  Scenario: No duplicate response helpers
    Tool: Bash
    Steps:
      1. grep -r 'function jsonResponse\|const jsonResponse' --include='*.js' . --exclude-dir=node_modules | wc -l → expect 1
      2. grep 'Lightning Music Fest\|verifiableCredential' handlers/withdrawHandler.js → expect 0
    Expected Result: Single helper, no VC block
    Evidence: .sisyphus/evidence/task-14-helpers.txt
  ```

  **Commit**: YES
  - Message: `refactor: standardize response helpers and remove VC block`
  - Files: `utils/response.js` (new), `index.js`, `handlers/fetchBoltCardKeys.js`, `admin/handlers.js`, `handlers/withdrawHandler.js`
  - Pre-commit: `npm test`

---

- [ ] 15. Delete Dead Code + Clean Up

  **What to do**:
  - Delete `src/index.js` and `src/` directory
  - Delete `totp.js` (verify not imported first)
  - Delete orphaned POC files: `audit-uids.js`, `dump-config.js`, `generate-production-keys.js`, `secure-deploy.js`, `kv-migration-helper.js`, `config-audit-*.json`
  - Delete superseded reports: `audit-report.md`, `comparison-investigation.md`, `comparison-report.md`, `INVESTIGATION-REPORT.md`, `hardcoded-value-inventory.md`, `workers.md`
  - Remove random error injection from `handlers/withdrawHandler.js` (line 15, counters ≥ 200)
  - Remove `fakewalletCounter` module-level state from `lnurlHandler.js`
  - Remove commented-out code throughout codebase
  - Verify each deletion with grep first

  **Must NOT do**:
  - Do NOT delete imported files without checking
  - Do NOT delete test files
  - Do NOT delete `keygenerator.js`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 16
  - **Blocked By**: Tasks 6, 7, 8

  **References**:
  - `src/index.js` — Orphaned (wrangler.toml `main` = root `index.js`)
  - `totp.js` — Search imports before deleting
  - `handlers/withdrawHandler.js:15` — Random error injection
  - `handlers/lnurlHandler.js` — `fakewalletCounter` state

  **Acceptance Criteria**:
  - [ ] `src/` deleted
  - [ ] `totp.js` deleted (if unused)
  - [ ] No random error injection in production code
  - [ ] `npm test` passes
  - [ ] `wrangler deploy --dry-run` succeeds

  **QA Scenarios:**
  ```
  Scenario: Dead code removed
    Tool: Bash
    Steps:
      1. test ! -f src/index.js && echo 'deleted'
      2. grep -r 'Math.random.*< 0.5' handlers/withdrawHandler.js → expect 0
      3. npm test 2>&1 && npx wrangler deploy --dry-run 2>&1
    Expected Result: Dead code gone, project still builds
    Evidence: .sisyphus/evidence/task-15-cleanup.txt
  ```

  **Commit**: YES
  - Message: `chore: delete dead code and orphaned files`
  - Files: Multiple deletions
  - Pre-commit: `npm test` + `wrangler deploy --dry-run`

---

### Wave 4 — Integration + Final Testing

- [ ] 16. Integration Testing + Test Vector Verification

  **What to do**:
  - Run full test suite — verify ALL tests pass
  - Write integration tests (TDD) for complete LNURLW flow:
    - Valid p/c → `{"tag":"withdrawRequest",...}`
    - Invalid p (bad hex) → error
    - Valid p + invalid c (CMAC mismatch) → error
    - Missing p or c → error
    - Counter replay (same counter twice) → error (if DO wired)
  - Verify ALL 3 canonical test vectors:
    - `p=4E2E289D945A66BB13377A728884E867 c=E19CCB1FED8892CE`
    - `p=00F48C4F8E386DED06BCDC78FA92E2FE c=66B4826EA4C155B4`
    - `p=0DBF3C59B59B0638D60B5842A997D4D1 c=CC61660C020B4D96`
  - Verify `wrangler deploy --dry-run` clean
  - Verify no `process.env` in source files
  - Verify hex case normalization (lowercase UIDs)

  **Must NOT do**:
  - Do NOT change source code — write tests only

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO — depends on all Wave 3
  - **Parallel Group**: Wave 4 (with Task 17)
  - **Blocks**: Final verification
  - **Blocked By**: Tasks 11, 12, 13, 14, 15

  **References**:
  - `tests/worker.test.js` — Existing test patterns
  - `testvectors.js` — Test vector data
  - `.sisyphus/evidence/test-baseline.txt` (Task 3) — Baseline
  - `boltCardHelper.js` — `extractUIDAndCounter`, `validate_cmac`

  **Acceptance Criteria**:
  - [ ] `npm test` → 0 failures
  - [ ] All 3 test vectors verified
  - [ ] `wrangler deploy --dry-run` clean
  - [ ] No `process.env` in source
  - [ ] Integration tests cover: valid, invalid p, invalid c, missing params

  **QA Scenarios:**
  ```
  Scenario: Full test suite green
    Tool: Bash
    Steps:
      1. npm test 2>&1
      2. Expect: 0 failures, more passes than baseline
    Expected Result: All green
    Evidence: .sisyphus/evidence/task-16-full-tests.txt

  Scenario: Test vectors pass
    Tool: Bash (node)
    Steps:
      1. Run test script importing extractUIDAndCounter + validate_cmac
      2. For each vector: decrypt p, extract UID, verify c
    Expected Result: All 3 vectors pass
    Evidence: .sisyphus/evidence/task-16-test-vectors.txt

  Scenario: No process.env leaks
    Tool: Bash
    Steps:
      1. grep -r 'process.env' --include='*.js' . --exclude-dir=node_modules --exclude-dir=tests --exclude-dir=.sisyphus | wc -l → expect 0
    Expected Result: Zero
    Evidence: .sisyphus/evidence/task-16-no-process-env.txt
  ```

  **Commit**: YES
  - Message: `test: add integration tests and verify test vectors`
  - Files: `tests/integration.test.js` (new)
  - Pre-commit: `npm test`

---

- [ ] 17. Update README + Project Documentation

  **What to do**:
  - Update `readme.md` for refactored architecture:
    - Updated project structure (new files, deleted files)
    - Updated API endpoints if routes changed
    - Remove `type = "javascript"` references
    - Update deployment for module worker format
    - Link to `docs/current-state.md` and `docs/boltcard-protocol.md`
  - Remove outdated security warnings
  - Update ISSUER_KEY instructions to reference `env` not `process.env`
  - Keep test vectors section

  **Must NOT do**:
  - Do NOT add emoji-heavy sections
  - Do NOT write excessive docs

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 16)
  - **Parallel Group**: Wave 4
  - **Blocks**: Final verification
  - **Blocked By**: Tasks 1, 16

  **References**:
  - `readme.md` — Current README
  - `docs/current-state.md` (Task 1) — Link from README
  - `docs/boltcard-protocol.md` (Task 2) — Link from README
  - `index.js` — Post-refactor state
  - `package.json`, `wrangler.toml` — Current config

  **Acceptance Criteria**:
  - [ ] `readme.md` updated with current project structure
  - [ ] No references to `addEventListener` or `type = "javascript"`
  - [ ] Links to `docs/` files
  - [ ] Test vectors preserved

  **QA Scenarios:**
  ```
  Scenario: README accuracy
    Tool: Bash
    Steps:
      1. grep 'addEventListener' readme.md → expect 0
      2. grep 'type = .javascript.' readme.md → expect 0
      3. grep 'docs/current-state.md' readme.md → expect ≥1
      4. grep '4E2E289D945A66BB13377A728884E867' readme.md → expect ≥1
    Expected Result: README reflects refactored codebase
    Evidence: .sisyphus/evidence/task-17-readme.txt
  ```

  **Commit**: YES
  - Message: `docs: update README for refactored architecture`
  - Files: `readme.md`

---
## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm test` + linter. Review all changed files for: `as any`, empty catches, console.log in prod code, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify no `process.env` references remain. Verify no duplicate function implementations.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if needed)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test the three canonical test vectors. Test edge cases: empty p/c params, invalid hex, malformed URLs. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Test Vectors [3/3] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance: no new features implemented, no Web Crypto for AES-ECB, no mixed bug-fix/refactor commits. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Task | Commit Message | Files | Pre-commit Check |
|------|---------------|-------|-----------------|
| 1 | `docs: add current project state documentation` | `docs/current-state.md` | File exists, has required sections |
| 2 | `docs: add boltcard protocol reference` | `docs/boltcard-protocol.md` | File exists, has required sections |
| 3 | `docs: capture test baseline` | `.sisyphus/evidence/test-baseline.txt` | `npm test` output captured |
| 4 | `docs: document refactoring scope decisions` | `docs/refactor-scope.md` | File exists with 4 decisions |
| 5 | NO COMMIT (research only) | — | — |
| 6 | `fix(card-portal): remove orphaned code block and fix variable shadowing` | `card-portal/handlers.js` | `npm test` |
| 7 | `fix(admin): fix route setup interface and missing import` | `admin/routes.js`, `admin/handlers.js` | `npm test` |
| 8 | `fix(index): remove duplicate routes and LNURLW blocks` | `index.js` | `npm test` |
| 9 | `fix: add missing awaits and fix function signature mismatches` | `lnurlHandler.js`, `boltCardHelper.js`, `index.js` | `npm test` |
| 10 | `fix(env): migrate process.env to env parameter passing` | Multiple files | `npm test` |
| 11 | `refactor(crypto): consolidate crypto into single module` | `cryptoutils.js`, `keygenerator.js`, `boltCardHelper.js` | `npm test` + test vectors |
| 12 | `refactor: migrate to module worker format with DO exports` | `index.js`, `wrangler.toml` | `wrangler deploy --dry-run` |
| 13 | `refactor(router): migrate to itty-router v4` | `index.js`, `package.json` | `npm test` |
| 14 | `refactor: standardize response helpers and logging` | `utils/response.js`, `utils/logger.js`, multiple handlers | `npm test` |
| 15 | `chore: delete dead code and orphaned files` | Multiple deletions | `npm test` |
| 16 | `test: add integration tests and verify test vectors` | `tests/` | `npm test` (all green) |
| 17 | `docs: update README and project documentation` | `readme.md`, `docs/` | Files exist |

---

## Success Criteria

### Verification Commands
```bash
npm test                           # Expected: 0 failures
wrangler deploy --dry-run          # Expected: no errors
grep -r "process.env" --include="*.js" . --exclude-dir=node_modules  # Expected: no matches
# Test vector 1:
node -e "const {extractUIDAndCounter}=require('./boltCardHelper');console.log(extractUIDAndCounter('4E2E289D945A66BB13377A728884E867'))"
# Expected: valid UID + counter extraction
```

### Final Checklist
- [ ] All "Must Have" items verified present
- [ ] All "Must NOT Have" items verified absent
- [ ] All 17 tasks completed with evidence
- [ ] All 3 test vectors pass
- [ ] `npm test` green
- [ ] `wrangler deploy --dry-run` clean
- [ ] No `process.env` in source
- [ ] No duplicate crypto functions
- [ ] `docs/current-state.md` complete
- [ ] `docs/boltcard-protocol.md` complete
