# Security & spec-conformance audit — 2026-11-13

Scope: the tap/withdraw crypto and LNURL flow vs boltcard spec
(SPEC.md / DETERMINISTIC.md / CARD_PRIVACY.md), the Go reference
(boltcard/boltcard), and the Rust reference (bolty-rs bolty-core).
Method: three-way code comparison, file:line-cited; regression tests
added for both fixed findings (tests/integration/auditRegression.test.ts).

## Verdict on the crypto core

**Conformant.** `p=` decryption (AES single block, 0xC7 gate, offsets,
LE counter) and `c=` verification (SV2 layout, double CMAC, odd-byte
truncation, constant-time compare) are byte-compatible across all three
implementations and pinned to shared cross-language vectors
(tests/ntag424Vectors.test.ts vs DETERMINISTIC.md/TEST_VECTORS.md).
Deterministic key derivation (CardKey/K0-K4/ID, LE version,
issuer-global K1) is exact. The worker additionally carries a MacWindow
fallback the Go reference lacks. Worker is strictly BETTER than Go on
constant-time comparison.

## Fixed in this audit (PR same day)

| # | Finding | Fix |
|---|---|---|
| 12 | **Amount-only callbacks re-debit per replay**: `claimTap` re-claimed NULL-bolt11 tap rows unconditionally, so one sniffed tap (one counter) could drain a card's balance in repeated debits — contradicting the "double-spend is impossible" posture documented at AGENTS.md:262-269 | Atomic one-shot claim: single-statement `UPDATE … WHERE bolt11 IS NULL AND status NOT IN ('paying','completed')` — exactly one claimant flips pending→paying; SQLite-atomic inside the serialized DO |
| 9 | Non-hex 16-char `c=` answered 500 "Internal error" (uncaught hexToBytes in verifyCmac) — input-class inconsistency vs the 400 the malformed-`p=` path gives | Hex gate at resolveCardIdentity entry, same 400 bucket |

## Owner decisions requested (architecture, not bugs)

| # | Finding | Why it stands |
|---|---|---|
| 20 | **Public key-material endpoints**: `/api/v1/pull-payments/:id/boltcards` (no capability check on the id) and `/api/vc/keys?uid=` return K0-K4 / K1+K2 for any UID without proof of possession. UIDs are plaintext in anti-collision (CARD_PRIVACY.md), so anyone who ever read a UID can forge valid p/c pairs offline. Go gates new-card keys behind a one-time code. | Possibly deliberate demo/HIL posture (deterministic keys + anonymous taps); changing it may break boltcard-hce/matrix lanes. Needs an explicit accept-or-gate decision. |
| 10 | Replay rejection disabled by design at step 1 (validateCardTap.ts logs-and-ignores the verdict; machinery is race-free and correct). SPEC.md:39 "must only accept an increasing counter value". | Documented AGENTS posture for the demo; the per-counter claim (now exactly-once for both paths) contains double-spend, but per-tap analytics/notification surfaces still see replays as fresh. |
| 19 | Distinguishable failure taxonomy (400/403/404/409 + reason text + per-class timing incl. full version-scan for unknown UIDs) vs Go's uniform ERROR/bad-request — CARD_PRIVACY.md "should not be possible … to identify the card any further". | Better operator UX is a legitimate tradeoff; conscious accept recommended. |
| 18 | No host pinning: callback origin reflected from request (`url.origin`); Go rejects `req.Host != HOST_DOMAIN`. | Bounded by Cloudflare account host binding. |
| 13 | k1 carries zero entropy (`k1 = c`) and never expires; Go uses 16 random bytes + timeout. | The known boltcard-POS convention (HIL depends on it); security rests on CMAC + claim. Document-only. |
| 4 | Multi-K1 candidate selection uses 0xC7 heuristic without per-candidate CMAC on the tap path (admin path does it properly). | Contained: wrong-K1 false positive fails downstream K2 CMAC (UID-bound). |

## Confirmed clean

- No card-controlled URL injection: p/c are hex-validated query/path values;
  proxy target is operator-configured, HTTPS-enforced, header-filtered,
  `redirect: manual`; lnurlp callback uses `URLSearchParams.set`;
  MacWindow regex-escapes the c value.
- Replay storage: per-UID Durable Object, atomic conditional INSERT/UPDATE,
  no TTL/eviction forgetting counters; operator `/reset` is the only clear.
- LNURL-withdraw response shape per LUD-03 (pinLimit optional, absent).
- Version handling: downward 10-version scan + guaranteed v1 retry +
  persisted detection matches DETERMINISTIC.md re-setup semantics.
