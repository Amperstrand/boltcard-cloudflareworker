# BoltCard Crypto Layer — 8 Security/Correctness Fixes

## TL;DR

> **Quick Summary**: 8 security and correctness fixes to the BoltCard Cloudflare Worker crypto layer, identified by cross-referencing the codebase against ntag424-js, RFC 4493, and NXP AN12196. Each fix is a separate atomic commit with verbose messages and inline spec references.
> 
> **Deliverables**:
> - 8 atomic commits (P0→P3 priority order), each with verbose commit message
> - Inline source code comments referencing RFC 4493, NXP AN12196, BoltCard DETERMINISTIC.md
> - New test cases for each fix
> - All existing tests still passing
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: NO — sequential (same files, separate commits)
> **Critical Path**: Fix 1 → Fix 2 → Fix 3 → Fix 4 → Fix 5 → Fix 6 → Fix 7 → Fix 8

---

## Context

### Original Request
User requested an audit of the Cloudflare Worker crypto layer against the ntag424-js library. The audit revealed 8 security/correctness issues. User wants each fix as a separate commit with verbose commit messages and heavily-commented source code referencing specs.

### Interview Summary
**Key Discussions**:
- ntag424-js evaluated and rejected (Node.js-only, abandoned deps, not for backend verification)
- 8 fixes identified and prioritized P0-P3
- Existing crypto math (shiftGo, computeCm, CMAC truncation) confirmed correct — must NOT change
- No new dependencies allowed
- Sequential commits required (each must pass `npm test`)

**Research Findings**:
- CMAC odd-byte truncation confirmed consistent across ntag424-js and our implementation
- KV namespace `UID_CONFIG` already available for counter storage (Fix 2)
- `aes-js` 3.1.2 `decrypt()` returns Uint8Array but may lose prototype — `Object.values()` wrapping is defensive

### Metis Review
**Identified Gaps** (addressed):
- Fix 7 depends on Fix 1 (no point constant-time comparing if expected value is leaked) — ordering enforced
- KV eventual consistency for counter replay — documented as known limitation, recommend Durable Objects for production
- `aes-js` return type must be verified before removing `Object.values()` in Fix 8

---

## Work Objectives

### Core Objective
Fix 8 security and correctness issues in the crypto layer, each as an isolated commit with verbose documentation.

### Concrete Deliverables
- 8 git commits in P0→P3 order
- Updated `cryptoutils.js`, `boltCardHelper.js`, `index.js`
- New tests in `tests/cryptoutils.test.js`

### Definition of Done
- [ ] `git log --oneline -8` shows 8 new commits
- [ ] `npm test` passes after final commit
- [ ] No changes to CMAC truncation, key derivation, SV2 construction, or shiftGo/computeCm math

### Must Have
- Each fix in its own commit with verbose commit message explaining what and why
- Inline comments referencing RFC 4493, NXP AN12196, BoltCard DETERMINISTIC.md as appropriate
- At least one new test per fix
- `npm test` green after every commit

### Must NOT Have (Guardrails)
- Do NOT change CMAC truncation pattern (odd-indexed bytes)
- Do NOT change key derivation constants or SV2 construction
- Do NOT change shiftGo(), generateSubkeyGo(), or computeCm() math
- Do NOT add new npm dependencies
- Do NOT convert to TypeScript
- Do NOT touch card-portal, admin handlers, activate/wipe/program/reset handlers
- Do NOT refactor adjacent code beyond the 8 fixes
- Do NOT change function signatures or return shapes (except xorArrays return type in Fix 8)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after — add test with each fix)
- **Framework**: vitest (via `npm test`)

### QA Policy
Every fix verified by `npm test` passing. Evidence: test output captured.
Evidence saved to `.sisyphus/evidence/task-{N}-npm-test.txt`.

---

## Execution Strategy

### Sequential Execution (Same Files)

All 8 fixes touch `cryptoutils.js`. Parallel execution would cause merge conflicts. Execute strictly in order.

```
Wave 1: Fix 1 — Remove CMAC info leak (P0-1)
Wave 2: Fix 2 — Counter replay protection (P0-2)
Wave 3: Fix 3 — Multi-K1 false positive (P1-1)
Wave 4: Fix 4 — Hex validation (P1-2)
Wave 5: Fix 5 — Key length validation (P1-3)
Wave 6: Fix 6 — Multi-block guard (P2-1)
Wave 7: Fix 7 — Constant-time compare (P2-2)
Wave 8: Fix 8 — Cleanup types (P3-1)

Critical Path: All sequential
```

### Agent Dispatch Summary

- **Wave 1**: `quick` + `git-master`
- **Wave 2**: `deep` + `git-master`
- **Wave 3**: `quick` + `git-master`
- **Wave 4**: `quick` + `git-master`
- **Wave 5**: `quick` + `git-master`
- **Wave 6**: `quick` + `git-master`
- **Wave 7**: `unspecified-low` + `git-master`
- **Wave 8**: `quick` + `git-master`
- **FINAL**: 4 parallel reviews

---

## TODOs

- [x] 1. [P0-1] Remove expected CMAC from error responses

  **What to do**:
  - In `cryptoutils.js:342`, change the error string from `` `CMAC validation failed: expected ${computedCmacHex}, received ${providedCmac}` `` to just `"CMAC validation failed"`. The expected CMAC value is cryptographic material that must never be returned to clients.
  - In `boltCardHelper.js:116`, the `console.warn` logs `verification.cmac_error` which previously contained the expected CMAC. Now that the error is generic, this is safe. But add a server-side-only debug log using `logger.js` that logs the expected vs received values for debugging — import logger if not already imported.
  - In `index.js:112-113`, `cmac_error` is logged and returned to client. Verify the generic message flows through correctly.
  - Add verbose inline comments explaining why leaking expected CMAC is dangerous (oracle attack: attacker gets the expected value and can forge valid taps).
  - Add test in `tests/cryptoutils.test.js`: call `verifyCmac()` with a wrong CMAC, assert the `cmac_error` string does NOT contain any hex substring matching the expected CMAC.

  **Must NOT do**:
  - Do NOT change the function signature or return shape of `verifyCmac()`
  - Do NOT change any CMAC computation logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single string change + test, trivial scope
  - **Skills**: [`git-master`]
    - `git-master`: Verbose atomic commit with security rationale

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: Fix 7 (constant-time compare is pointless if expected value leaks)
  - **Blocked By**: None

  **References**:
  - `cryptoutils.js:332-344` — `verifyCmac()` function, line 342 is the info leak
  - `boltCardHelper.js:102-124` — `validate_cmac()` that calls verifyCmac and logs the error at line 116
  - `index.js:111-113` — where cmac_error is logged and returned to client
  - `utils/logger.js` — server-side logging utility to use for debug-level expected/received logging
  - NXP AN12196 §5.7 — SDMMAC verification (the expected value is a session MAC key derivative, never expose)

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `verifyCmac()` error string contains no hex CMAC values
  - [ ] New test verifies error string is generic

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Error response does not leak expected CMAC
    Tool: Bash (node/bun REPL)
    Steps:
      1. Import verifyCmac, hexToBytes from cryptoutils.js
      2. Call verifyCmac(hexToBytes("04a071fa967380"), hexToBytes("000001"), "AAAAAAAAAAAAAAAA", hexToBytes("33268DEA5B5511A1B3DF961198FA46D5"))
      3. Assert result.cmac_error === "CMAC validation failed"
      4. Assert result.cmac_error does NOT match /[0-9a-f]{16}/i
    Expected Result: Generic error with no hex CMAC values
    Evidence: .sisyphus/evidence/task-1-cmac-leak.txt

  Scenario: Valid CMAC still passes
    Tool: Bash (npm test)
    Steps:
      1. Run npm test
      2. All existing CMAC validation tests still pass
    Expected Result: 0 failures
    Evidence: .sisyphus/evidence/task-1-npm-test.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P0-1] Remove expected CMAC from error responses\n\nThe verifyCmac() error message previously included the expected CMAC\nvalue ("expected X, received Y"), which was returned to the client in\nerror responses via index.js. This leaks the session MAC, enabling an\noracle attack where the attacker gets the correct CMAC without knowing\nthe key.\n\nNow returns a generic "CMAC validation failed" to clients. Server-side\nlogging retained at debug level for troubleshooting.\n\nRef: NXP AN12196 §5.7 (SDMMAC verification)\nRef: ntag424-js CMAC validation pattern (no expected value in errors)`
  - Files: `cryptoutils.js`, `boltCardHelper.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

- [x] 2. [P0-2] Implement counter replay protection

  **What to do**:
  - In `index.js` `handleLnurlw()` (line ~116, after CMAC validation succeeds), add counter replay protection:
    1. Parse the counter from `ctr` hex string: `const counterValue = parseInt(ctr, 16)`
    2. Read last stored counter from KV: `const lastCtr = await env.UID_CONFIG.get(\`counter:\${uidHex}\`)`
    3. If `lastCtr !== null && counterValue <= parseInt(lastCtr, 10)`, return error "Counter replay detected"
    4. Write new counter: `await env.UID_CONFIG.put(\`counter:\${uidHex}\`, String(counterValue))`
  - Handle first-tap case: if `lastCtr === null`, accept any counter value (first use)
  - Add verbose inline comments explaining:
    - NXP AN12196 §5.8 step 9: "The backend SHALL check that the SDMReadCtr is strictly increasing"
    - KV eventual consistency limitation: within ~60s a replay could succeed on a different edge node
    - Counter is 3-byte big-endian from extractUIDAndCounter(), hex-encoded
  - Add test in `tests/cryptoutils.test.js` or `tests/integration.test.js`: mock KV, verify second tap with same counter is rejected, verify first tap succeeds, verify incrementing counter succeeds
  - Also apply to LNURL callback: the `k1` token in `constructWithdrawResponse()` should encode the counter to bind the callback to a specific tap

  **Must NOT do**:
  - Do NOT use Durable Objects (KV is sufficient for this POC)
  - Do NOT change the CMAC validation flow
  - Do NOT change extractUIDAndCounter() or decryptP()

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires understanding KV patterns, stateless worker constraints, counter semantics, and the LNURL withdraw flow
  - **Skills**: [`git-master`]
    - `git-master`: Verbose atomic commit

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (solo)
  - **Blocks**: Fix 3
  - **Blocked By**: Fix 1

  **References**:
  - `index.js:50-133` — `handleLnurlw()` function, counter check goes after line 114 (after CMAC validation)
  - `index.js:70` — `const { uidHex, ctr } = decryption;` — ctr is hex string from extractUIDAndCounter
  - `boltCardHelper.js:37-81` — `extractUIDAndCounter()` returns `{ uidHex, ctr }` where ctr is 3-byte big-endian hex
  - `getUidConfig.js` — shows KV access pattern: `env.UID_CONFIG.get(uidHex)` — use same namespace for counter
  - `handlers/lnurlHandler.js` — `constructWithdrawResponse()` generates k1 token for callback
  - NXP AN12196 §5.8 step 9 — "Verify SDMReadCtr > stored counter"
  - BoltCard DETERMINISTIC.md — counter is part of the encrypted PICCData

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] Second tap with same counter returns error
  - [ ] First tap (no stored counter) succeeds
  - [ ] Incrementing counter succeeds

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Replay with same counter is rejected
    Tool: Bash (npm test)
    Steps:
      1. Mock KV with stored counter value "5"
      2. Call handleLnurlw with counter = 5
      3. Assert response is 400 with "Counter replay" error
    Expected Result: HTTP 400, body contains "replay" or "counter"
    Evidence: .sisyphus/evidence/task-2-replay-reject.txt

  Scenario: First tap with no stored counter succeeds
    Tool: Bash (npm test)
    Steps:
      1. Mock KV with no stored counter (get returns null)
      2. Call handleLnurlw with valid p, c, counter = 1
      3. Assert response is 200
    Expected Result: HTTP 200 with LNURL withdraw response
    Evidence: .sisyphus/evidence/task-2-first-tap.txt

  Scenario: Incrementing counter succeeds
    Tool: Bash (npm test)
    Steps:
      1. Mock KV with stored counter "5"
      2. Call handleLnurlw with counter = 6
      3. Assert response is 200
    Expected Result: HTTP 200, KV updated to "6"
    Evidence: .sisyphus/evidence/task-2-increment.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P0-2] Implement counter replay protection\n\nWithout counter state, the same valid NFC tap could be replayed\nindefinitely to drain the victim's wallet. The NTAG424 SDMReadCtr\n(3-byte monotonic counter) is now persisted in KV and enforced as\nstrictly increasing per NXP AN12196 §5.8 step 9.\n\nStorage: counter:{uidHex} in UID_CONFIG KV namespace.\nFirst-tap: accepted (no stored counter yet).\nLimitation: KV eventual consistency means a replay within ~60s on a\ndifferent edge node could theoretically succeed. For production,\nconsider Durable Objects for strong consistency.\n\nRef: NXP AN12196 §5.8 step 9 ("SDMReadCtr SHALL be strictly increasing")\nRef: BoltCard DETERMINISTIC.md (counter in PICCData)`
  - Files: `index.js`, `tests/integration.test.js`
  - Pre-commit: `npm test`

- [x] 3. [P1-1] Fix multi-K1 false positive handling in decryptP()

  **What to do**:
  - In `cryptoutils.js` `decryptP()` (lines 300-322), change the loop to NOT return immediately on first `0xC7` match. Instead:
    1. When first `0xC7` match found, save it as `bestMatch = { uidBytes, ctr, usedK1 }`
    2. Continue iterating remaining keys
    3. If another key also produces `0xC7`, log `console.warn("Multiple K1 keys matched PICCDataTag 0xC7 — possible false positive. Keys at indices [i, j]")`
    4. Return `bestMatch` (first match wins, but warn about ambiguity)
  - Add verbose inline comments explaining:
    - 1/256 false positive probability per wrong key (only checking 1 byte)
    - ntag424-js also only checks the header byte, but with single key
    - BoltCard uses multiple K1 candidates for key rotation
  - Add test: create scenario where two different keys both produce `0xC7` header (may need crafted test data)

  **Must NOT do**:
  - Do NOT change the return signature `{ success, uidBytes, ctr, usedK1 }`
  - Do NOT change the decryption logic or AES-ECB usage
  - Do NOT change how `0xC7` check works (just add exhaustive search)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small loop logic change + warning
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Fix 4
  - **Blocked By**: Fix 2

  **References**:
  - `cryptoutils.js:300-322` — `decryptP()` function, the early-return at line 317 is the issue
  - `getUidConfig.js:1-8` — `BOLT_CARD_K1` array showing multiple K1 candidates
  - NXP AN12196 §5.5 — PICCDataTag 0xC7 meaning (UID mirrored + counter mirrored)
  - `docs/boltcard-protocol.md` §8 — false positive probability discussion

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `decryptP()` checks ALL keys, not just first match
  - [ ] Warning logged when multiple keys match

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Single matching key works as before
    Tool: Bash (npm test)
    Steps:
      1. Call decryptP with known-good p and k1 keys
      2. Assert success === true, correct UID extracted
    Expected Result: Same behavior as before
    Evidence: .sisyphus/evidence/task-3-single-match.txt

  Scenario: Multiple matching keys produces warning
    Tool: Bash (npm test)
    Steps:
      1. Craft two keys where both decrypt to 0xC7 header (or mock)
      2. Call decryptP
      3. Assert success === true, first match returned
      4. Assert console.warn was called with "Multiple K1" message
    Expected Result: Returns first match + warning
    Evidence: .sisyphus/evidence/task-3-multi-match.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P1-1] Fix multi-K1 false positive handling\n\nPreviously decryptP() returned immediately on the first K1 key that\nproduced a 0xC7 header byte. Since only 1 byte is checked, each wrong\nkey has a 1/256 chance of false positive. With multiple K1 candidates\n(for key rotation), a wrong key could win over the correct one.\n\nNow exhaustively checks ALL K1 candidates and warns if multiple match.\nStill returns the first match (consistent behavior), but the warning\nenables detection of potential false positives in logs.\n\nRef: NXP AN12196 §5.5 (PICCDataTag 0xC7)\nRef: boltcard-protocol.md §8 (false positive probability)`
  - Files: `cryptoutils.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

- [x] 4. [P1-2] Add hex character validation to hexToBytes()

  **What to do**:
  - In `cryptoutils.js` `hexToBytes()` (lines 32-39), after the existing `!hex || hex.length % 2 !== 0` check, add:
    ```js
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error("Invalid hex string: contains non-hex characters");
    }
    ```
  - Add verbose inline comment: `// Validate hex characters before parsing. Without this, parseInt("GZ", 16) returns NaN, which gets silently cast to 0x00 by Uint8Array constructor, causing silent data corruption in cryptographic operations.`
  - Add tests in `tests/cryptoutils.test.js`:
    - `hexToBytes("ZZZZ")` throws
    - `hexToBytes("0g1h")` throws
    - `hexToBytes("abCD12")` succeeds
    - `hexToBytes("ABCDEF")` succeeds

  **Must NOT do**:
  - Do NOT change the existing empty/odd-length check
  - Do NOT change the parseInt parsing logic for valid hex

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: One regex line + tests
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: Fix 5
  - **Blocked By**: Fix 3

  **References**:
  - `cryptoutils.js:32-39` — `hexToBytes()` function
  - `cryptoutils.js:36-37` — `parseInt(byte, 16)` that produces NaN on invalid hex
  - RFC 4648 §8 — hex encoding alphabet

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `hexToBytes("ZZZZ")` throws Error
  - [ ] `hexToBytes("abCD12")` succeeds

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Invalid hex rejected
    Tool: Bash (npm test)
    Steps:
      1. Call hexToBytes("ZZZZ") — assert throws "non-hex characters"
      2. Call hexToBytes("0g1h") — assert throws
      3. Call hexToBytes("abCD12") — assert returns Uint8Array([0xab, 0xcd, 0x12])
    Expected Result: Invalid hex throws, valid hex succeeds
    Evidence: .sisyphus/evidence/task-4-hex-validation.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P1-2] Add hex character validation to hexToBytes()\n\nWithout validation, parseInt("GZ", 16) returns NaN, which the\nUint8Array constructor silently casts to 0x00. This causes silent\ndata corruption in cryptographic operations — a wrong key or wrong\nUID would be used without any error, potentially validating invalid\ntaps or generating wrong session keys.\n\nAdds regex validation /^[0-9a-fA-F]+$/ before parsing.\n\nRef: Multiple callers pass user-supplied hex (p, c URL params via\nindex.js:52-53), making this an input validation security fix.`
  - Files: `cryptoutils.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

- [x] 5. [P1-3] Add key length validation to computeAesCmac()

  **What to do**:
  - At top of `computeAesCmac()` (line 110), add:
    ```js
    // RFC 4493 §2.3: AES-CMAC is defined for AES-128 (16-byte key).
    // aes-js silently accepts wrong-length keys and produces garbage output,
    // which would cause CMAC validation to always fail without any error —
    // extremely difficult to debug. Fail fast with a clear message.
    if (!(key instanceof Uint8Array) || key.length !== 16) {
      throw new Error("AES-CMAC requires a 16-byte key (AES-128), per RFC 4493 §2.3");
    }
    ```
  - Also add the same check at top of `decryptP()` for each k1 key:
    ```js
    // Validate key length before AES-ECB decryption.
    // NXP AN12196 §5.5: PICCENCData uses AES-128-ECB with K1.
    ```
  - Add tests: 15-byte key throws, 17-byte key throws, 16-byte key succeeds

  **Must NOT do**:
  - Do NOT change the AES-ECB or CMAC computation logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5
  - **Blocks**: Fix 6
  - **Blocked By**: Fix 4

  **References**:
  - `cryptoutils.js:110-156` — `computeAesCmac()` function
  - `cryptoutils.js:300-322` — `decryptP()` uses AES-ECB with K1
  - RFC 4493 §2.3 — AES-CMAC key size requirement

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `computeAesCmac(msg, new Uint8Array(15))` throws
  - [ ] `computeAesCmac(msg, new Uint8Array(17))` throws

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Wrong key length rejected
    Tool: Bash (npm test)
    Steps:
      1. computeAesCmac(new Uint8Array(16), new Uint8Array(15)) — throws "16-byte key"
      2. computeAesCmac(new Uint8Array(16), new Uint8Array(17)) — throws
      3. computeAesCmac(new Uint8Array(0), validKey) — succeeds (empty message)
    Expected Result: Wrong length throws, correct length works
    Evidence: .sisyphus/evidence/task-5-key-length.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P1-3] Add key length validation\n\naes-js silently accepts keys of any length and produces garbage\noutput. A misconfigured 15 or 17-byte key would cause all CMAC\nvalidations to silently fail, accepting or rejecting all taps\nwithout any error message. Adds explicit length check.\n\nRef: RFC 4493 §2.3 (AES-128 key requirement)\nRef: NXP AN12196 §5.5 (AES-128-ECB for PICCENCData)`
  - Files: `cryptoutils.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

- [x] 6. [P2-1] Add multi-block guard to computeAesCmac()

  **What to do**:
  - In `computeAesCmac()`, after the key validation (added in Fix 5), add:
    ```js
    // Guard: this implementation only handles 0 or 1 block messages (≤16 bytes).
    // RFC 4493 §2.4 defines multi-block CMAC with CBC chaining, but all BoltCard
    // protocol messages (SV2, empty-message ks derivation) are single-block.
    // Rather than silently producing wrong output for >16 byte messages,
    // fail explicitly. If multi-block is ever needed, implement full CBC chain
    // per RFC 4493 Algorithm 3 steps 5-6.
    if (message.length > BLOCK_SIZE) {
      throw new Error(
        `computeAesCmac: message length ${message.length} exceeds single-block limit (${BLOCK_SIZE}). ` +
        "Multi-block CBC-MAC chaining not implemented. See RFC 4493 §2.4."
      );
    }
    ```
  - Add test: 17-byte message throws, 16-byte message succeeds, 0-byte message succeeds

  **Must NOT do**:
  - Do NOT implement multi-block CBC chaining (not needed, adds attack surface)
  - Do NOT change the existing single-block logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 6
  - **Blocks**: Fix 7
  - **Blocked By**: Fix 5

  **References**:
  - `cryptoutils.js:110-156` — `computeAesCmac()`, line 136 `padded.set(message)` would RangeError on >16 bytes
  - RFC 4493 §2.4 — multi-block algorithm (Algorithm 3, steps 5-6)
  - All callers in codebase use ≤16 byte messages (verify via grep)

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `computeAesCmac(new Uint8Array(17), key)` throws with "multi-block" message

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Multi-block message rejected
    Tool: Bash (npm test)
    Steps:
      1. computeAesCmac(new Uint8Array(17), validKey) — throws "multi-block"
      2. computeAesCmac(new Uint8Array(16), validKey) — succeeds
      3. computeAesCmac(new Uint8Array(0), validKey) — succeeds
    Expected Result: >16 bytes throws, ≤16 bytes works
    Evidence: .sisyphus/evidence/task-6-multiblock.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P2-1] Add multi-block guard to computeAesCmac()\n\nThe CMAC implementation only handles single-block messages (≤16 bytes)\nbut the function name suggests general-purpose use. Without this guard,\na >16 byte message would either RangeError (padded.set) or silently\nproduce a wrong CMAC (only processing the last block, skipping CBC\nchaining from RFC 4493 §2.4).\n\nAll BoltCard protocol messages are single-block (SV2 = 16 bytes,\nempty-message ks derivation = 0 bytes), so this is a safety net\nagainst future misuse.\n\nRef: RFC 4493 §2.4 Algorithm 3 (multi-block requires CBC chain)`
  - Files: `cryptoutils.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

- [x] 7. [P2-2] Constant-time CMAC comparison

  **What to do**:
  - In `cryptoutils.js` `verifyCmac()` (lines 332-344), replace the string `===` comparison with a constant-time byte comparison:
    ```js
    // Timing-safe comparison: string === short-circuits on first mismatch byte,
    // leaking information about how many leading bytes match via response timing.
    // An attacker can brute-force the CMAC one byte at a time (timing oracle).
    // XOR accumulator runs in constant time regardless of where bytes differ.
    // Ref: https://codahale.com/a-lesson-in-timing-attacks/
    const computedBytes = ct; // already Uint8Array from buildVerificationData
    const providedBytes = hexToBytes(cHex);
    if (computedBytes.length !== providedBytes.length) {
      return { cmac_validated: false, cmac_error: "CMAC validation failed" };
    }
    let diff = 0;
    for (let i = 0; i < computedBytes.length; i++) {
      diff |= computedBytes[i] ^ providedBytes[i];
    }
    const cmac_validated = diff === 0;
    ```
  - Also validate that `cHex` is exactly 16 hex chars (8 bytes, truncated CMAC) before converting
  - Remove the old `computedCmacHex` and `providedCmac` string comparison
  - Add test: verify matching CMAC returns `cmac_validated: true`, non-matching returns false

  **Must NOT do**:
  - Do NOT use any external timing-safe library (no new deps)
  - Do NOT change buildVerificationData() or CMAC computation
  - Do NOT change the return shape `{ cmac_validated, cmac_error }`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Needs care to implement constant-time correctly, but small scope
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 7
  - **Blocks**: Fix 8
  - **Blocked By**: Fix 1 (must remove leaked expected value first), Fix 6

  **References**:
  - `cryptoutils.js:332-344` — `verifyCmac()` function, the `===` at line 337
  - `cryptoutils.js:265-289` — `buildVerificationData()` returns `{ ct }` as Uint8Array
  - https://codahale.com/a-lesson-in-timing-attacks/ — classic timing attack reference
  - RFC 4493 — CMAC output is compared against received tag

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `verifyCmac()` uses XOR accumulator, not `===`
  - [ ] Invalid length `cHex` returns validation failure

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Constant-time compare produces correct results
    Tool: Bash (npm test)
    Steps:
      1. Call verifyCmac with correct CMAC — assert cmac_validated === true
      2. Call verifyCmac with wrong CMAC — assert cmac_validated === false
      3. Call verifyCmac with wrong-length cHex (e.g., "AABB") — assert cmac_validated === false
    Expected Result: Same boolean results as before, but using XOR comparison
    Evidence: .sisyphus/evidence/task-7-constant-time.txt

  Scenario: No string === used for CMAC comparison
    Tool: Bash (grep)
    Steps:
      1. grep for "===" in verifyCmac function body
      2. Should only find diff === 0, not computedCmacHex === providedCmac
    Expected Result: No string comparison in CMAC check
    Evidence: .sisyphus/evidence/task-7-no-string-compare.txt
  ```

  **Commit**: YES
  - Message: `security(crypto): [P2-2] Constant-time CMAC comparison\n\nThe previous string === comparison short-circuits on the first\nmismatched character, creating a timing oracle. An attacker could\nmeasure response time differences to brute-force the truncated\nCMAC one byte at a time (8 bytes = 8 * 256 = 2048 attempts max\ninstead of 2^64 brute force).\n\nReplaced with XOR accumulator that always compares all bytes in\nconstant time. Also validates cHex length before conversion.\n\nRef: https://codahale.com/a-lesson-in-timing-attacks/\nRef: NXP AN12196 §5.7 (SDMMAC verification)`
  - Files: `cryptoutils.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

- [x] 8. [P3-1] Clean up Object.values() wrapping and xorArrays return type

  **What to do**:
  - In `cryptoutils.js` `xorArrays()` (lines 67-72), change return to `Uint8Array`:
    ```js
    // Return Uint8Array for type consistency with the rest of the crypto layer.
    // Array.prototype.map on a Uint8Array returns a plain Array, so we must
    // explicitly wrap the result.
    return new Uint8Array(a.map((val, i) => val ^ b[i]));
    ```
  - In `boltCardHelper.js:73-74`, remove the `Object.values()` wrapping:
    ```js
    // Before: const uidBytes = new Uint8Array(Object.values(result.uidBytes));
    // After:  const uidBytes = new Uint8Array(result.uidBytes);
    //
    // Object.values() was a defensive wrapper in case aes-js returned a plain
    // object instead of array-like. aes-js 3.1.2 ModeOfOperation.ecb.decrypt()
    // returns a Uint8Array, and decryptP() .slice() also returns Uint8Array.
    // Object.values() on a Uint8Array works but is unnecessary overhead.
    ```
  - **FIRST**: Verify aes-js return type by checking `node_modules/aes-js/index.js` decrypt method. If it returns something other than Uint8Array, keep the wrapper and document why.
  - Update JSDoc for `xorArrays()`: change `@returns {number[]}` to `@returns {Uint8Array}`
  - Update/verify existing test: `expect(xorArrays(a, b)).toEqual(new Uint8Array([5, 7, 5]))` should still pass with structural equality

  **Must NOT do**:
  - Do NOT change any crypto computation logic
  - Do NOT change function signatures beyond xorArrays return type

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type cleanup, minimal logic change
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 8
  - **Blocks**: None
  - **Blocked By**: Fix 7

  **References**:
  - `cryptoutils.js:60-72` — `xorArrays()` function, returns `number[]` instead of `Uint8Array`
  - `boltCardHelper.js:72-74` — `Object.values()` wrapping on decryptP() results
  - `cryptoutils.js:300-322` — `decryptP()` uses `.slice()` which returns same type as source
  - `node_modules/aes-js/index.js` — verify decrypt() return type
  - `tests/cryptoutils.test.js` — existing xorArrays test to verify still passes

  **Acceptance Criteria**:
  - [ ] `npm test` passes
  - [ ] `xorArrays()` returns `Uint8Array`
  - [ ] No `Object.values()` in `boltCardHelper.js`

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: xorArrays returns Uint8Array
    Tool: Bash (npm test)
    Steps:
      1. Call xorArrays(new Uint8Array([1,2,3]), new Uint8Array([4,5,6]))
      2. Assert result instanceof Uint8Array
      3. Assert result equals Uint8Array([5,7,5])
    Expected Result: Returns Uint8Array, not plain Array
    Evidence: .sisyphus/evidence/task-8-xorArrays.txt

  Scenario: No Object.values in boltCardHelper
    Tool: Bash (grep)
    Steps:
      1. grep "Object.values" boltCardHelper.js
      2. Assert 0 matches
    Expected Result: No Object.values wrapping
    Evidence: .sisyphus/evidence/task-8-no-objectvalues.txt
  ```

  **Commit**: YES
  - Message: `chore(crypto): [P3-1] Clean up Object.values() and xorArrays return type\n\nxorArrays() returned a plain Array (from Uint8Array.map), inconsistent\nwith the rest of the crypto layer which uses Uint8Array throughout.\nNow explicitly returns new Uint8Array(...).\n\nboltCardHelper.js used Object.values() as a defensive wrapper around\naes-js decrypt output. Verified aes-js 3.1.2 decrypt() returns\nUint8Array, making Object.values() unnecessary overhead. Removed.\n\nRef: aes-js 3.1.2 source (ModeOfOperation.ecb.decrypt returns Uint8Array)`
  - Files: `cryptoutils.js`, `boltCardHelper.js`, `tests/cryptoutils.test.js`
  - Pre-commit: `npm test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check `git log --oneline -8` shows 8 commits. Verify `npm test` passes.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm test`. Review all changed files for: `as any`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments beyond what was requested, over-abstraction, generic variable names.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Run the 3 test vectors from README against the worker code (via test harness or curl against `wrangler dev`). Verify CMAC validation, counter handling, and error responses don't leak crypto material.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each commit: read the diff. Verify only the intended fix was applied — no scope creep. Check "Must NOT Have" compliance. Flag any changes to shiftGo, computeCm, CMAC truncation, key derivation.
  Output: `Commits [N/N compliant] | VERDICT`

---

## Commit Strategy

8 sequential commits, each following this format:
```
security(crypto): [PX-Y] Title

Detailed explanation of what was changed and why.
References to specs and other implementations.
```

Pre-commit check for each: `npm test`

---

## Success Criteria

### Verification Commands
```bash
npm test          # Expected: all tests pass
git log --oneline -8  # Expected: 8 new commits in P0→P3 order
```

### Final Checklist
- [ ] All 8 fixes committed
- [ ] All "Must Have" present (verbose commits, inline comments, tests)
- [ ] All "Must NOT Have" absent (no changed crypto math, no new deps)
- [ ] All tests pass
