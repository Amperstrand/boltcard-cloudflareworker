# Percard K1 fallback for anonymous taps — opt-in and tradeoffs

**Status:** implemented, deployed on boltcardpoc.psbt.me. Enable with `ENABLE_PERCARD_FALLBACK=1`.

## Coverage map (as of 7c1acb1)

| Path | Site | Percard handling |
|---|---|---|
| Tap / LNURL-withdraw | `lnurlwHandler` → `validateCmacWithPercardFallback` | gated on flag |
| Top-up / POS / refund / lock | `validateCardTap` → `validateCmacWithPercardFallback` | gated on flag |
| Shared card-auth pipeline | `resolveCardIdentity` (cardAuth.ts) → same helper | gated on flag |
| Login + identify-issuer | `matchCardIssuer` (cardMatching.ts) | **always on** (diagnostic-only) |
| KEYS_DELIVERED version probe | `validateCardTap` | deterministic-only by design (percard cards never enter that state) |

## The problem

A card burned with per-card keys (the legacy k.psbt.me CSV import) is
cryptographically valid, but an **anonymous first tap** gets
`400 Unable to decode UID`: the worker needs the UID to select the percard
row, and needs the row's K1 to decrypt the UID from `p=`. Chicken-and-egg.
Deterministic-key cards never hit this because their K1 is derived from
public constants.

Proven live on 2026-08-25: a percard burn of card `04c474fa967380` produced
a tap whose `p=` decrypts to the right UID and whose CMAC verifies under the
row's K2 (checked offline), yet the worker answered 400.

## The mechanism

Two layers, both gated on the flag:

1. **Identification** — `extractUIDAndCounter` (boltCardHelper.ts) first
   tries the configured K1s (env/deterministic — unchanged path). On
   failure it retries `decryptP` with those K1s **plus the unique percard
   K1s** from `generatedKeyData` (`getUniquePerCardK1s()`).
2. **Authentication** — `validateCmac` (lnurlwHandler.ts) validates the
   CMAC against the config K2 (sourced from the card's DO row, which for
   previously-deterministic cards holds the deterministic-era K2). On
   failure it retries against the percard row's K2
   (`getPerCardKeys(uid)`), skipping the retry when it equals the config
   K2 (already tried).

Correctness rests on two invariants:

1. **The UID comes from the decrypted plaintext, not from key identity.**
   `p=` is `AES-ECB(K1, 0xC7 || UID || ctr …)` — any matching K1 yields the
   true UID regardless of which row the K1 came from. Batches that share one
   K1 across many rows are handled naturally (hence "unique" K1s — a handful
   of AES ops, not one per row).
2. **The row's K2 still gates everything.** After decoding, the UID selects
   the percard row and CMAC verification runs against that row's K2 exactly
   as before. The fallback widens *identification*, never *authentication*.

## Tradeoffs

| Dimension | Effect |
|---|---|
| Latency | Only on the fallback path: unique-K1 count (~10 for the current CSV with batch-shared K1s, ~100 worst case) × one AES-128 block ≈ well under 1 ms of CPU. Successful deterministic taps: zero change. |
| Security | No secret exposure — percard keys are already git-tracked in `generatedKeyData.js`. The K2 retry only accepts a CMAC *under that row's own key*; it cannot forge validation for any other key. No new oracle: an attacker learns only "this p decoded", which the 200/400 response already reveals. Brute-forcing is over our own published keys, not user keys. |
| False positives | A random `p=` matching requires a 16-byte block decrypting to `0xC7` + a plausible UID (≥2⁻²⁴ by structure) and then must still pass the row-K2 CMAC (2⁻⁶⁴) to do anything. Identification-only false positives are discarded at CMAC. |
| Unknown-UID taps | A percard-K1 card whose UID row was removed still fails at CMAC — same 4xx family as today, slightly later. |
| Operational | More taps resolve to `percard` provenance rows; discovery logging records the fallback (info level, `p decoded via percard K1 fallback`). |
| Blast radius | Off by default; the hot path for deterministic cards is byte-identical (single-decrypt unchanged). |

## Status: retired in production (2026-08-26)

`ENABLE_PERCARD_FALLBACK` removed from wrangler.toml and deployed. Inventory
that justified it (issue #54): 104 percard CSV cards, 4,125 active indexed
cards (90-day TTL) — intersection exactly one, `04c474fa967380`, the bench
card (blank since recovery; stale index deleted). One further CSV UID
(`04c15ffa967380`) holds an old config row whose K2 is NOT the percard K2 and
has no index entry (inactive >90 days). Zero percard cards remained active;
nothing needed a re-burn. Verified live post-deploy: a cryptographically valid
percard-keyed tap (CSV K1/K2) returns 400 "Unable to decode UID" — the
pre-fallback behavior. The CSVs stay bundled, so re-enabling is a one-line
var + deploy if a stray card ever surfaces.

## When to enable

Venues that still have legacy percard-burned cards in circulation and want
them tappable without a re-burn. Leave off if the deployment is
deterministic-only — there is nothing to fall back to.
