# Decisions — boltcard-cleanup

## [2026-02-27] Session Start

### Architecture Decisions
- Module worker format (export default) over service worker (addEventListener)
- itty-router v4 for routing (over manual pathname matching)
- Keep aes-js OR migrate to @noble/ciphers — pending Task 5 evaluation
- Single `cryptoutils.js` as canonical crypto source of truth

### Scope Decisions
- card-portal: OUT OF SCOPE (delete orphaned code only, no implementation)
- admin: STRUCTURAL FIX ONLY (no auth, no new features)
- `src/` directory: DELETE (orphaned)
- Durable Objects: KEEP + properly wire exports (do NOT redesign)
- Dead features to delete: TOTP, VC block, fakewalletCounter, random error injection

### Testing Decisions
- TDD approach: RED → GREEN → REFACTOR
- Jest (existing) — evaluate vitest/bun as separate concern
- Three canonical test vectors as crypto acceptance criteria
- All QA is agent-executed, zero human intervention

### Commit Strategy
- Isolated commits per task (bug fixes separate from refactoring)
- Pre-commit: npm test always
- Critical path commits also require wrangler deploy --dry-run
