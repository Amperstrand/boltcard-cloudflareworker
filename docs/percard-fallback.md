# Percard K1 fallback for anonymous taps — opt-in and tradeoffs

**Status:** implemented, off by default. Enable with `ENABLE_PERCARD_FALLBACK=1`.

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

`extractUIDAndCounter` (boltCardHelper.ts) first tries the configured K1s
(env/deterministic — unchanged path). On failure, if the flag is set, it
retries `decryptP` with those K1s **plus the unique percard K1s** from
`generatedKeyData` (`getUniquePerCardK1s()`).

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
| Security | No secret exposure — percard keys are already git-tracked in `generatedKeyData.js`. No new oracle: an attacker learns only "this p decoded", which the 200/400 response already reveals. Brute-forcing is over our own published keys, not user keys. |
| False positives | A random `p=` matching requires a 16-byte block decrypting to `0xC7` + a plausible UID (≥2⁻²⁴ by structure) and then must still pass the row-K2 CMAC (2⁻⁶⁴) to do anything. Identification-only false positives are discarded at CMAC. |
| Unknown-UID taps | A percard-K1 card whose UID row was removed still fails at CMAC — same 4xx family as today, slightly later. |
| Operational | More taps resolve to `percard` provenance rows; discovery logging records the fallback (info level, `p decoded via percard K1 fallback`). |
| Blast radius | Off by default; the hot path for deterministic cards is byte-identical (single-decrypt unchanged). |

## When to enable

Venues that still have legacy percard-burned cards in circulation and want
them tappable without a re-burn. Leave off if the deployment is
deterministic-only — there is nothing to fall back to.
