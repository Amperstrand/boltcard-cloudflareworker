# Ralph Loop: Polish, Harden, and Test

## Context
- MAC window fallback deployed and working
- 2199 tests pass (2075 unit + 52 DO + 72 integration)
- Pre-commit hook active (lint + typecheck)
- Security audits completed with findings

## Security Audit Findings (from background agents)

### HIGH Priority
1. **Key retrieval endpoint unauthenticated**: `/api/v1/pull-payments/:pullPaymentId/boltcards` has NO operator auth. Anyone can enumerate card UIDs and fetch encryption keys (K0-K4). This is a card cloning vector.

### MEDIUM Priority (design decision, needs documentation)
2. **Replay enforcement disabled for operator handlers**: `validateCardTap.ts` and `lnurlwHandler.ts` log replay but continue processing. This is INTENTIONAL for operator flows (same tap → multiple operations like topup then charge). The LNURL callback path IS protected via bolt11 claim. However, card tap entry (`GET /`) also continues after replay — this means a replayed tap URL generates a new withdraw response, though the callback still rejects double-payment.

### LOW Priority
3. Various DRY improvements and code quality items

## Ralph Loop Iterations

### Iteration 1: Security — Auth on key retrieval endpoint
- Add `withOperatorAuth` to `/api/v1/pull-payments/:pullPaymentId/boltcards` route
- Add integration test: unauthenticated request → 302 redirect
- Add integration test: authenticated request → keys returned
- Deploy and verify

### Iteration 2: Document replay enforcement design
- Add clear documentation in AGENTS.md explaining WHY replay is disabled for operator handlers
- Add inline comments at each "continuing because replay enforcement is disabled" site
- Consider adding an env var flag `ENFORCE_REPLAY=true` for production deployments that want strict enforcement

### Iteration 3: Expand user story integration tests
- Card lifecycle: provision → tap → topup → charge → refund → void → terminate
- Adversarial: replayed callback (bolt11 claim prevents double-spend)
- Adversarial: wrong CMAC rejection across all endpoints
- Card lock/reactivate via cardholder dashboard
- Identity verification flow
- Concurrent operations on different cards

### Iteration 4+: Continuous improvement
- Dead code audit
- Error message consistency
- DRY refactoring
- Performance optimization
- Documentation gaps
