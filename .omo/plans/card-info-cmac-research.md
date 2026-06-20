# Research: /card/info CMAC validation after lock/reactivate

## Status: Needs Investigation

## Problem

After `POST /api/card/lock` (terminates card) + `POST /api/card/reactivate` (calls `deliverKeys`, increments version), the card is in `keys_delivered` state with a new version. The physical card still has the old version's keys.

When `/card/info?p=...&c=...` is called:
1. `resolveCardIdentity` with `skipCmac: true` — CMAC is computed but failure doesn't reject
2. `cmac_validated` reflects actual result (false — card has old keys, server derived new version K2)
3. Handler line 80: `if (!cmac_validated) return errorResponse("CMAC validation failed", 403)`
4. Response has no `state` field → test fails with `undefined`

## Why `skipCmac: true` doesn't help

`resolveCardIdentity` always computes CMAC. The `skipCmac` flag only prevents early rejection inside `resolveCardIdentity` itself (line 89 of cardAuth.ts). The handler then independently checks `cmac_validated` and rejects.

## Affected flow

1. Card is active (version N)
2. `POST /api/card/lock` → card terminated
3. `POST /api/card/reactivate` → `deliverKeys` → state `keys_delivered`, version N+1
4. Card physically still has version N keys
5. `GET /card/info` → CMAC fails → 403 error

## Workaround in tests

`ensureCardActiveState` in `hardware-selfservice.spec.ts` taps via `GET /` (LNURL entry point) which triggers `detectCardVersion` version scanning → finds physical card at version N → activates → sets K2 for version N. After this, `/card/info` works.

But this workaround is fragile with USB readers (timing/counter issues).

## Virtual card tests pass

All 12 virtual card self-service tests pass because the virtual card generates correct CMAC for each version on the fly.

## Possible fixes (need research)

1. **Remove the `cmac_validated` check in `/card/info`** — if `skipCmac` was requested, honor it fully. `/card/info` is informational, not security-critical.
2. **Add `detectCardVersion` fallback to `/card/info`** — complex, adds latency to informational endpoint
3. **Use `resolveActiveVersion` instead of `latest_issued_version` for CMAC** — for `keys_delivered` state, try `active_version` (old) instead of `latest_issued_version` (new)
4. **Return card info without CMAC-protected fields** — partial response when CMAC fails, omitting sensitive data

## Priority: Medium

Not a production blocker — the flow only affects the cardholder dashboard after self-service reactivation. The card works correctly for payments via the LNURL handler which has version scanning.

## Files

- `handlers/cardDashboardHandler.ts:38-82` — `/card/info` handler
- `utils/cardAuth.ts:80-92` — `resolveCardIdentity` CMAC logic
- `tests/e2e/hardware-selfservice.spec.ts:135-151` — failing test
