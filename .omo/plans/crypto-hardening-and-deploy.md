# Crypto Hardening, Test Vectors & Deploy

## TL;DR

> **Quick Summary**: 6 tasks to harden the @ntag424/crypto library against NXP AN12196 spec, commit/deploy the aes-js→@noble/ciphers migration, fix the Miniflare test environment, and publish the library to npm.
>
> **Deliverables**:
> - NXP AN12196 test vectors in @ntag424/crypto (Tables 1, 2, 4)
> - Committed and deployed aes-js→@noble/ciphers migration
> - Clean dependency graph (no nested node_modules)
> - Working DO/integration tests
> - Published @ntag424/crypto package on npm
>
> **Estimated Effort**: Medium
> **Parallel Execution**: Partial (Tasks 1+2 parallel, then 3 sequential, then 4+5+6 sequential)
> **Critical Path**: Task 1 → Task 3 → Task 4 → Task 6

---

## Context

### Original Request
User asked to audit @ntag424/crypto and boltcard-cloudflareworker against NXP AN12196 and the boltcard standard, then plan next steps. Research found our crypto is correct but missing direct NXP test vector verification.

### Key Findings
- All crypto math matches NXP AN12196 and Go boltcard reference
- decryptP uses AES-ECB (mathematically equivalent to AES-CBC with IV=0 for single block per AN12196 §3.4.2.1)
- SV2 construction, session key derivation, CMAC computation, odd-byte truncation all correct
- Key derivation constants (2d003f75-2d003f7a) match Boltcard DETERMINISTIC.md
- aes-js→@noble/ciphers migration done, all 1561 tests pass
- DO/integration tests fail with pre-existing Miniflare ERR_RUNTIME_FAILURE

### aes-js Migration Assessment
Migration was **unnecessary** (aes-js was battle-tested, 3M/wk downloads) but **not harmful** now complete. @noble/ciphers is formally audited (Cure53) and actively maintained. **Do not revert** — sunk cost. **Lesson**: don't migrate working crypto deps without concrete security need.

---

## Work Objectives

### Core Objective
Harden crypto library with spec-direct test vectors, ship the migration, fix test infra, publish the library.

### Concrete Deliverables
- New test cases in @ntag424/crypto using AN12196 Tables 1, 2, 4
- Comment in decrypt.ts documenting ECB-vs-CBC equivalence
- Git commit with all working changes
- Clean npm dependency resolution
- Working `npm run test:all`
- Published npm package

### Definition of Done
- [ ] AN12196 test vectors pass
- [ ] `npm test` passes in both repos
- [ ] `npm run test:all` passes in worker
- [ ] Changes committed and deployed
- [ ] No nested node_modules in worker
- [ ] @ntag424/crypto published to npm

### Must Have
- AN12196 Table 4 test vector (full SUN MAC verification)
- AN12196 Table 2 test vector (PICCData decryption)
- AN12196 Table 1 test vector (session key generation SV1/SV2)
- ECB-vs-CBC comment in decrypt.ts
- All existing tests still passing
- Semantic commit messages

### Must NOT Have (Guardrails)
- Do NOT change CMAC truncation pattern (odd-indexed bytes)
- Do NOT change key derivation constants or SV2 construction
- Do NOT change shiftGo(), generateSubkeyGo(), or computeCm() math
- Do NOT revert to aes-js
- Do NOT add node:crypto or nodejs_compat dependency
- Do NOT commit without explicit user request
- Do NOT change function signatures or return types

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (vitest in both repos)
- **Framework**: vitest + @cloudflare/vitest-pool-workers

### QA Policy
Every task verified by `npm test` (library) and `npm test` (worker) passing.

---

## Execution Strategy

### Task Dependency Graph

```
Task 1 (AN12196 test vectors) ─────┐
Task 2 (ECB-vs-CBC comment) ────────┤  ← parallel with Task 1
                                     ├→ Task 3 (commit + deploy) → Task 4 (clean deps) → Task 5 (Miniflare fix) → Task 6 (npm publish)
                                     │
                                     └→ Task 3 depends on Task 1 + Task 2
```

### Wave 1: Parallel (Tasks 1 + 2)
### Wave 2: Sequential (Task 3)
### Wave 3: Sequential (Task 4)
### Wave 4: Sequential (Task 5)
### Wave 5: Sequential (Task 6)

---

## TODOs

- [ ] 1. Add AN12196 test vectors to @ntag424/crypto

  **What to do**:
  Add three new test suites to `/Users/macbook/src/ntag424-crypto/test/aes-cmac.test.ts` (or a new `ntag424-an12196.test.ts` file):

  **Test Suite A — AN12196 Table 1: SDM Session Key Generation** (§3.3)
  ```
  K_SDMFileRead = 5ACE7E50AB65D5D51FD5BF5A16B8205B
  UID = 04C767F2066180
  SDMReadCtr = 00100007
  SV1 = C33C0001008004C767F20661800100007
  SV2 = 3CC30001008004C767F20661800100008
  KSesSDMFileReadENC = CMAC(K_SDMFileRead, SV1) = 66DA61797E23DECA5D8ECA13BBADF7A9
  KSesSDMFileReadMAC = CMAC(K_SDMFileRead, SV2) = 3A3E8110E05311F7A3FCF0D969BF2B48
  ```
  - Test that `computeAesCmac(SV1_bytes, K_SDMFileRead)` equals expected ENC session key
  - Test that `computeAesCmac(SV2_bytes, K_SDMFileRead)` equals expected MAC session key

  **Test Suite B — AN12196 Table 2: PICCData Decryption** (§3.4.2.1)
  ```
  K_SDMMetaRead = 00000000000000000000000000000000
  PICCENCData = EF963FF7828658A599F3041510671E88
  Expected PICCData = C704DE5F1EACC0403D0000DA5CF60941
  PICCDataTag = C7
  UID = 04DE5F1EACC040
  SDMReadCtr = 3D0000
  ```
  - Test that `decryptP(PICCENCData, [K_SDMMetaRead])` returns success with correct UID and counter
  - Verify PICCDataTag byte is 0xC7

  **Test Suite C — AN12196 Table 4: Full SUN MAC Verification** (§3.4.4.2.1)
  ```
  K_SDMFileRead = 00000000000000000000000000000000
  UID = 04DE5F1EACC040
  SDMReadCtr = 3D0000
  SV2 = 3CC30001008004DE5F1EACC0403D0000
  KSesSDMFileReadMAC = 3FB5F6E3A807A03D5E3570ACE393776F
  SDMMAC_full = 94EED9EE653370860000000000000000 (16 bytes, odd bytes = MACt)
  ```
  - Test that `buildVerificationData(uidBytes, ctrBytes, K_SDMFileRead)` produces correct sv2, ks
  - Test that ks matches expected session key
  - Test `verifyCmac()` with the correct MACt (truncated to 8 odd bytes)
  - This is the FULL end-to-end SUN verification from the NXP spec

  **Agent**: `deep` — needs to understand AN12196 spec details and construct precise byte arrays

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] All AN12196 Table 1 tests pass
  - [ ] All AN12196 Table 2 tests pass
  - [ ] All AN12196 Table 4 tests pass
  - [ ] Existing 35 tests still pass
  - [ ] `npm test` in ntag424-crypto passes clean

- [ ] 2. Document ECB-vs-CBC equivalence in decrypt.ts

  **What to do**:
  In `/Users/macbook/src/ntag424-crypto/src/decrypt.ts`, add a comment near the `ecb()` call explaining:

  The NXP AN12196 §3.4.2.1 specifies AES-128-CBC with IV=0 for PICCENCData decryption. For a single 16-byte block, AES-CBC(IV=0) is mathematically identical to AES-ECB. We use ECB because it avoids constructing a zero IV and is the primitive operation. The Go boltcard reference (`crypto.go`) uses `cipher.NewCBCDecrypter(c1, iv)` with `iv = make([]byte, 16)` — functionally equivalent.

  **Agent**: `quick` — single comment addition

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] Comment added to decrypt.ts
  - [ ] `npm test` passes

- [ ] 3. Commit and deploy current changes

  **What to do**:
  Commit the working uncommitted changes:
  - `cryptoutils.ts` — pure re-export barrel (helpers moved to test file)
  - `package.json` / `package-lock.json` — aes-js→devDeps, @noble/ciphers added
  - `tests/cryptoutils.test.ts` — helpers moved here + subkey test fix

  **Pre-commit checks**:
  1. `npm test` passes (1561 tests)
  2. `npx tsc --noEmit` passes clean
  3. Verify no unintended changes

  **Commit message**: `refactor(crypto): migrate from aes-js to @noble/ciphers\n\n- Replace aes-js with @noble/ciphers (Cure53-audited, actively maintained)\n- Move test-only helpers from cryptoutils.ts to tests/cryptoutils.test.ts\n- Fix RFC 4493 subkey test: use raw AES-ECB for L computation, not CMAC\n- aes-js retained as devDependency for backward compatibility\n\nRefs: RFC 4493, NXP AN12196, @noble/ciphers Cure53 audit`

  After commit, also rebuild library dist and deploy worker:
  1. `cd /Users/macbook/src/ntag424-crypto && npm run build`
  2. `cd /Users/macbook/src/boltcard-cloudflareworker && npm run deploy`

  **Agent**: `quick` + `git-master`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1, Task 2

  **Acceptance Criteria**:
  - [ ] `git status` clean after commit
  - [ ] Worker deployed to production
  - [ ] Live smoke test passes

- [ ] 4. Clean up nested node_modules from file: link

  **What to do**:
  The worker's `node_modules/@ntag424/crypto/node_modules/` contains devDependencies (aes-js, vitest, typescript, etc.) installed by npm when resolving the `file:../ntag424-crypto` link. These are unnecessary and confusing.

  **Approach options** (pick one):
  A. **Best**: After Task 6 (npm publish), change `file:../ntag424-crypto` to a versioned npm dependency — eliminates nested node_modules entirely
  B. **Quick fix**: Delete the nested node_modules: `rm -rf node_modules/@ntag424/crypto/node_modules/`
  C. **Prevent recurrence**: Add `files` field to ntag424-crypto/package.json to only include `dist/` (not `src/`, not dev dependency triggers)

  Recommended: Option C now + Option A when Task 6 is done.

  **Agent**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] `node_modules/@ntag424/crypto/node_modules/` removed
  - [ ] `npm test` still passes
  - [ ] `files` field added to ntag424-crypto/package.json if chosen

- [ ] 5. Investigate and fix Miniflare ERR_RUNTIME_FAILURE

  **What to do**:
  DO tests (`npm run test:do`) and integration tests (`npm run test:integration`) fail with:
  ```
  MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
  ```
  This is PRE-EXISTING — same error on clean `main` branch. Likely causes:
  - Stale/missing Workerd binary
  - `@cloudflare/vitest-pool-workers` version incompatibility
  - Missing native dependencies for the runtime

  **Debugging steps**:
  1. Check Node.js version (`node -v`) — needs 18+
  2. Check `@cloudflare/vitest-pool-workers` version and changelog
  3. Try `rm -rf node_modules/.vitest` cache
  4. Try `npm ci` clean install
  5. Check if `workerd` binary exists in node_modules
  6. Try running with `--verbose` for more error detail
  7. Check if `wrangler dev` works (uses same runtime)
  8. Search GitHub issues for `@cloudflare/vitest-pool-workers` ERR_RUNTIME_FAILURE

  **Agent**: `deep`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 6 (need test:all passing before publishing)
  - **Blocked By**: Task 4

  **Acceptance Criteria**:
  - [ ] `npm run test:do` passes
  - [ ] `npm run test:integration` passes
  - [ ] `npm run test:all` passes

- [ ] 6. Publish @ntag424/crypto to npm

  **What to do**:
  Publish the library to npm to eliminate the `file:` link and enable proper versioning.

  **Pre-publish checklist**:
  1. Verify `package.json` has correct `name`, `version`, `description`, `license`, `repository`
  2. Verify `files` field only includes `dist/` (no `src/`, no `test/`)
  3. Verify `exports` field correctly maps to `dist/`
  4. Verify `npm run build` produces clean dist
  5. Verify `npm test` passes
  6. Run `npm pack --dry-run` to inspect tarball contents
  7. Check if `@ntag424` org exists on npm or use a scoped name

  **In worker**:
  1. Change `"@ntag424/crypto": "file:../ntag424-crypto"` to `"@ntag424/crypto": "^1.0.0"`
  2. `npm install`
  3. Verify `npm test` passes
  4. Verify no nested node_modules

  **Agent**: `unspecified-high`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Task 5 (prefer test:all green first)

  **Acceptance Criteria**:
  - [ ] Package published on npm
  - [ ] Worker uses npm version (no file: link)
  - [ ] `npm test` passes
  - [ ] No nested node_modules

---

## Final Verification

After all tasks:
```bash
# Library
cd /Users/macbook/src/ntag424-crypto
npm test          # All tests pass including AN12196 vectors

# Worker
cd /Users/macbook/src/boltcard-cloudflareworker
npm run test:all  # Unit + DO + Integration all pass
npm run lint      # Clean
npx tsc --noEmit  # Clean
```

---

## Risk Assessment

| Task | Risk | Mitigation |
|------|------|-----------|
| Task 1 (test vectors) | Low — adding tests only, no code changes | Existing tests unaffected |
| Task 2 (ECB comment) | Minimal — comment only | N/A |
| Task 3 (commit) | Low — all tests already passing | Pre-commit verification |
| Task 4 (clean deps) | Low — removing unnecessary files | Verify tests after cleanup |
| Task 5 (Miniflare) | Medium — environment-specific, may need package downgrades | Stash changes, test on clean tree first |
| Task 6 (npm publish) | Low — standard npm workflow | `npm pack --dry-run` first, semver |
