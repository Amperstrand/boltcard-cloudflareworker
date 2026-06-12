import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { TestCard } from "@ntag424/crypto/test";
import {
  verifyCmac,
  decryptP,
  buildVerificationData,
  hexToBytes,
  bytesToHex,
  computeAesCmac,
} from "@ntag424/crypto";
import { getDeterministicKeys } from "../keygenerator.js";
import {
  checkAndAdvanceCounter,
  debitCard,
  creditCard,
  getBalance,
  recordTap,
} from "../replayProtection.js";
import { buildCardTestEnv } from "./testHelpers.js";
import type { Env } from "../types/core.js";
import type { ReplayNamespace } from "./replayNamespace.js";

// Reduce default runs so the full suite completes within vitest timeouts
fc.configureGlobal({ numRuns: 40 });

// ── Arbiters ─────────────────────────────────────────────────────────────────

function hexStringArb(length: number) {
  return fc
    .array(fc.integer({ min: 0, max: 15 }), { minLength: length, maxLength: length })
    .map((digits) => digits.map((d) => d.toString(16)).join(""));
}

const uidArb = hexStringArb(12).map((s) => "04" + s);

// Non-zero key arb to avoid degenerate all-zero key edge cases
const keyArb = hexStringArb(32).filter((k) => k !== "00000000000000000000000000000000");

const counterArb = fc.integer({ min: 0, max: 0xffffff });

const amountArb = fc.integer({ min: 1, max: 1_000_000 });

const versionArb = fc.integer({ min: 1, max: 255 });

const increasingCountersArb = fc
  .array(counterArb, { minLength: 3, maxLength: 5 })
  .map((arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const unique: number[] = [sorted[0]!];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! > unique[unique.length - 1]!) {
        unique.push(sorted[i]!);
      }
    }
    return unique;
  })
  .filter((arr) => arr.length >= 2);

function makeEnv(uid: string, balance: number = 0): Env {
  return buildCardTestEnv({ uid, balance, operatorAuth: true });
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. CRYPTO INVARIANTS (synchronous)
// ════════════════════════════════════════════════════════════════════════════════

describe("Property: Crypto Invariants", () => {
  it("verifyCmac is deterministic: same inputs always produce same result", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const ctr = new Uint8Array([
          (counter >> 16) & 0xff,
          (counter >> 8) & 0xff,
          counter & 0xff,
        ]);
        const r1 = verifyCmac(tc.uidBytes, ctr, tap.c, tc.k2Bytes);
        const r2 = verifyCmac(tc.uidBytes, ctr, tap.c, tc.k2Bytes);
        expect(r1).toEqual(r2);
      })
    );
  });

  it("different counters produce different p values for same (uid, issuerKey)", () => {
    fc.assert(
      fc.property(
        uidArb,
        keyArb,
        counterArb,
        counterArb,
        (uid, issuerKey, c1, c2) => {
          fc.pre(c1 !== c2);
          const tc = new TestCard(uid, issuerKey);
          expect(tc.tap(c1).p).not.toBe(tc.tap(c2).p);
        }
      )
    );
  });

  it("different counters produce different c values for same (uid, issuerKey)", () => {
    fc.assert(
      fc.property(
        uidArb,
        keyArb,
        counterArb,
        counterArb,
        (uid, issuerKey, c1, c2) => {
          fc.pre(c1 !== c2);
          const tc = new TestCard(uid, issuerKey);
          expect(tc.tap(c1).c).not.toBe(tc.tap(c2).c);
        }
      )
    );
  });

  it("CMAC validation succeeds for correctly generated tap parameters", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const ctr = new Uint8Array([
          (counter >> 16) & 0xff,
          (counter >> 8) & 0xff,
          counter & 0xff,
        ]);
        const result = verifyCmac(tc.uidBytes, ctr, tap.c, tc.k2Bytes);
        expect(result.cmac_validated).toBe(true);
        expect(result.cmac_error).toBeNull();
      })
    );
  });

  it("CMAC validation fails for any single-bit flip in c parameter", () => {
    fc.assert(
      fc.property(
        uidArb,
        keyArb,
        counterArb,
        fc.integer({ min: 0, max: 15 }),
        (uid, issuerKey, counter, bitPos) => {
          const tc = new TestCard(uid, issuerKey);
          const tap = tc.tap(counter);
          const cBytes = hexToBytes(tap.c);
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = bitPos % 8;
          const flipped = new Uint8Array(cBytes);
          flipped[byteIdx]! ^= 1 << bitIdx;
          const ctr = new Uint8Array([
            (counter >> 16) & 0xff,
            (counter >> 8) & 0xff,
            counter & 0xff,
          ]);
          const result = verifyCmac(tc.uidBytes, ctr, bytesToHex(flipped), tc.k2Bytes);
          expect(result.cmac_validated).toBe(false);
        }
      )
    );
  });

  it("decryptP succeeds for correctly encrypted p values", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const result = decryptP(tap.p, [tc.k1Bytes]);
        expect(result.success).toBe(true);
      })
    );
  });

  it("decryptP returns correct UID bytes matching input UID", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const result = decryptP(tap.p, [tc.k1Bytes]);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(bytesToHex(result.uidBytes)).toBe(uid.toLowerCase());
        }
      })
    );
  });

  it("decryptP returns correct counter matching input counter", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const result = decryptP(tap.p, [tc.k1Bytes]);
        expect(result.success).toBe(true);
        if (result.success) {
          const recovered =
            (result.ctr[0]! << 16) | (result.ctr[1]! << 8) | result.ctr[2]!;
          expect(recovered).toBe(counter);
        }
      })
    );
  });

  it("buildVerificationData produces consistent SV2 for same (uid, ctr, key)", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, k2hex, counter) => {
        const uidBytes = hexToBytes(uid);
        const k2Bytes = hexToBytes(k2hex);
        const ctr = new Uint8Array([
          (counter >> 16) & 0xff,
          (counter >> 8) & 0xff,
          counter & 0xff,
        ]);
        const vd1 = buildVerificationData(uidBytes, ctr, k2Bytes);
        const vd2 = buildVerificationData(uidBytes, ctr, k2Bytes);
        expect(bytesToHex(vd1.sv2)).toBe(bytesToHex(vd2.sv2));
        expect(bytesToHex(vd1.ct)).toBe(bytesToHex(vd2.ct));
        expect(bytesToHex(vd1.ks)).toBe(bytesToHex(vd2.ks));
      })
    );
  });

  it("buildVerificationData produces different ct for different counters", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, counterArb, (uid, k2, c1, c2) => {
        fc.pre(c1 !== c2);
        const uidBytes = hexToBytes(uid);
        const k2Bytes = hexToBytes(k2);
        const mkCtr = (v: number) =>
          new Uint8Array([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
        const vd1 = buildVerificationData(uidBytes, mkCtr(c1), k2Bytes);
        const vd2 = buildVerificationData(uidBytes, mkCtr(c2), k2Bytes);
        expect(bytesToHex(vd1.ct)).not.toBe(bytesToHex(vd2.ct));
      })
    );
  });

  it("computeAesCmac is deterministic for same inputs", () => {
    fc.assert(
      fc.property(
        keyArb,
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        (keyHex, data) => {
          const keyBytes = hexToBytes(keyHex);
          expect(bytesToHex(computeAesCmac(data, keyBytes))).toBe(
            bytesToHex(computeAesCmac(data, keyBytes))
          );
        }
      )
    );
  });

  it("CMAC validation fails with wrong k2 key", () => {
    fc.assert(
      fc.property(
        uidArb,
        keyArb,
        keyArb.filter((k) => k !== "00000000000000000000000000000000"),
        counterArb,
        (uid, issuerKey, wrongKey, counter) => {
          fc.pre(issuerKey !== wrongKey);
          const tc = new TestCard(uid, issuerKey);
          const tap = tc.tap(counter);
          const ctr = new Uint8Array([
            (counter >> 16) & 0xff,
            (counter >> 8) & 0xff,
            counter & 0xff,
          ]);
          const result = verifyCmac(tc.uidBytes, ctr, tap.c, hexToBytes(wrongKey));
          expect(result.cmac_validated).toBe(false);
        }
      )
    );
  });

  it("decryptP returns failure or wrong UID for wrong k1 key", () => {
    fc.assert(
      fc.property(
        uidArb,
        keyArb,
        keyArb.filter((k) => k !== "00000000000000000000000000000000"),
        counterArb,
        (uid, issuerKey, wrongKey, counter) => {
          fc.pre(issuerKey !== wrongKey);
          const tc = new TestCard(uid, issuerKey);
          const tap = tc.tap(counter);
          const result = decryptP(tap.p, [hexToBytes(wrongKey)]);
          if (result.success) {
            expect(bytesToHex(result.uidBytes)).not.toBe(uid.toLowerCase());
          } else {
            expect(result.success).toBe(false);
          }
        }
      )
    );
  });

  it("TestCard.tap() is deterministic: same counter produces same p and c", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap1 = tc.tap(counter);
        const tap2 = tc.tap(counter);
        expect(tap1.p).toBe(tap2.p);
        expect(tap1.c).toBe(tap2.c);
      })
    );
  });

  it("hexToBytes and bytesToHex are inverse operations", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), (bytes) => {
        expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. COUNTER / REPLAY INVARIANTS (async — use fc.asyncProperty)
// ════════════════════════════════════════════════════════════════════════════════

describe("Property: Counter/Replay Invariants", () => {
  it("all counters in a monotonically increasing sequence are accepted", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, increasingCountersArb, async (uid, counters) => {
        const env = makeEnv(uid);
        for (const ctr of counters) {
          const r = await checkAndAdvanceCounter(env, uid, ctr);
          expect(r.accepted).toBe(true);
        }
      })
    );
  });

  it("replayed counter after advance is always rejected", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, counterArb, async (uid, counter) => {
        const env = makeEnv(uid);
        const r1 = await checkAndAdvanceCounter(env, uid, counter);
        expect(r1.accepted).toBe(true);
        const r2 = await checkAndAdvanceCounter(env, uid, counter);
        expect(r2.accepted).toBe(false);
      })
    );
  });

  it("counters with gaps are accepted (non-sequential is fine)", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1001, max: 0xffffff }),
        async (uid, low, high) => {
          const env = makeEnv(uid);
          const r1 = await checkAndAdvanceCounter(env, uid, low);
          expect(r1.accepted).toBe(true);
          const r2 = await checkAndAdvanceCounter(env, uid, high);
          expect(r2.accepted).toBe(true);
        }
      )
    );
  });

  it("counter=0 is accepted on first use", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, async (uid) => {
        const env = makeEnv(uid);
        const r = await checkAndAdvanceCounter(env, uid, 0);
        expect(r.accepted).toBe(true);
      })
    );
  });

  it("counter=0xFFFFFF (16777215) is accepted", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, async (uid) => {
        const env = makeEnv(uid);
        const r = await checkAndAdvanceCounter(env, uid, 0xffffff);
        expect(r.accepted).toBe(true);
      })
    );
  });

  it("any counter lower than or equal to last seen is rejected", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 100, max: 0xffffff }),
        fc.integer({ min: 0, max: 99 }),
        async (uid, highCtr, lowCtr) => {
          const env = makeEnv(uid);
          const r1 = await checkAndAdvanceCounter(env, uid, highCtr);
          expect(r1.accepted).toBe(true);
          const r2 = await checkAndAdvanceCounter(env, uid, lowCtr);
          expect(r2.accepted).toBe(false);
        }
      )
    );
  });

  it("recordTap rejects counter already consumed by checkAndAdvanceCounter", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, counterArb, async (uid, counter) => {
        const env = makeEnv(uid);
        const r1 = await checkAndAdvanceCounter(env, uid, counter);
        expect(r1.accepted).toBe(true);
        const r2 = await recordTap(env, uid, counter, { bolt11: "lnbc1test" });
        expect(r2.accepted).toBe(false);
      })
    );
  });

  it("recordTap accepts a fresh counter not yet seen", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, counterArb, async (uid, counter) => {
        const env = makeEnv(uid);
        const r = await recordTap(env, uid, counter, { bolt11: "lnbc1test" });
        expect(r.accepted).toBe(true);
      })
    );
  });

  it("counters are tracked independently per UID", () => {
    const distinctUids = fc.tuple(uidArb, uidArb).filter(([a, b]) => a !== b);
    return fc.assert(
      fc.asyncProperty(distinctUids, counterArb, async ([uid1, uid2], counter) => {
        const env = makeEnv(uid1);
        (env.CARD_REPLAY as ReplayNamespace).__activate(uid2, 1);
        const r1 = await checkAndAdvanceCounter(env, uid1, counter);
        expect(r1.accepted).toBe(true);
        const r2 = await checkAndAdvanceCounter(env, uid2, counter);
        expect(r2.accepted).toBe(true);
      })
    );
  });

  it("sequential counters 1..N all succeed", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, fc.integer({ min: 3, max: 20 }), async (uid, n) => {
        const env = makeEnv(uid);
        for (let i = 1; i <= n; i++) {
          const r = await checkAndAdvanceCounter(env, uid, i);
          expect(r.accepted).toBe(true);
        }
        const replay = await checkAndAdvanceCounter(env, uid, Math.floor(n / 2));
        expect(replay.accepted).toBe(false);
      })
    );
  });

  it("rejected counter response includes informative reason", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, counterArb, async (uid, counter) => {
        const env = makeEnv(uid);
        await checkAndAdvanceCounter(env, uid, counter);
        const r = await checkAndAdvanceCounter(env, uid, counter);
        expect(r.accepted).toBe(false);
        if (r.reason) {
          const lower = r.reason.toLowerCase();
          expect(lower.includes("replay") || lower.includes("counter")).toBe(true);
        }
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. BALANCE INVARIANTS (async)
// ════════════════════════════════════════════════════════════════════════════════

describe("Property: Balance Invariants", () => {
  it("debitCard with amount > balance always fails", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 0, max: 999_999 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        async (uid, balance, extra) => {
          const env = makeEnv(uid, balance);
          const result = await debitCard(env, uid, 1, balance + extra, "overdraft");
          expect(result.ok).toBe(false);
        }
      )
    );
  });

  it("debitCard with amount ≤ balance always succeeds", () => {
    const debitWithinBalance = fc
      .tuple(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 0, max: 100 }))
      .map(([bal, reduction]) => ({ balance: bal, debit: Math.max(1, bal - reduction) }))
      .filter(({ debit, balance }) => debit > 0 && debit <= balance);

    return fc.assert(
      fc.asyncProperty(uidArb, debitWithinBalance, async (uid, { balance, debit: amount }) => {
        const env = makeEnv(uid, balance);
        const result = await debitCard(env, uid, 1, amount, "valid debit");
        expect(result.ok).toBe(true);
      })
    );
  });

  it("balance is never negative after any credit/debit sequence", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.array(
          fc.oneof(
            { depthSize: "small" },
            { arbitrary: amountArb, weight: 1, depthSize: "small" },
            { arbitrary: fc.integer({ min: 1, max: 100 }).map((n) => -n), weight: 1, depthSize: "small" }
          ),
          { minLength: 1, maxLength: 10 }
        ),
        async (uid, operations) => {
          const env = makeEnv(uid, 0);
          for (const op of operations) {
            if (op > 0) {
              await creditCard(env, uid, op, "credit");
            } else {
              await debitCard(env, uid, 1, Math.abs(op), "debit").catch(() => {});
            }
          }
          const bal = await getBalance(env, uid);
          expect(bal.balance).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  it("credit(1000) + debit(500) nets +500 from starting balance", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 0, max: 500_000 }),
        async (uid, startingBalance) => {
          const env = makeEnv(uid, startingBalance);
          await creditCard(env, uid, 1000, "topup");
          const debitResult = await debitCard(env, uid, 1, 500, "spend");
          expect(debitResult.ok).toBe(true);
          const bal = await getBalance(env, uid);
          expect(bal.balance).toBe(startingBalance + 500);
        }
      )
    );
  });

  it("debit of exact balance succeeds and leaves balance = 0", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 1, max: 1_000_000 }),
        async (uid, balance) => {
          const env = makeEnv(uid, balance);
          const result = await debitCard(env, uid, 1, balance, "exact drain");
          expect(result.ok).toBe(true);
          expect(result.balance).toBe(0);
          const bal = await getBalance(env, uid);
          expect(bal.balance).toBe(0);
        }
      )
    );
  });

  it("creditCard always succeeds with positive integer amounts", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, amountArb, async (uid, amount) => {
        const env = makeEnv(uid, 0);
        const result = await creditCard(env, uid, amount, "topup");
        expect(result.ok).toBe(true);
        expect(result.balance).toBe(amount);
      })
    );
  });

  it("multiple credits accumulate to correct total", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.array(amountArb, { minLength: 1, maxLength: 5 }),
        async (uid, amounts) => {
          const env = makeEnv(uid, 0);
          for (const amt of amounts) {
            await creditCard(env, uid, amt, "topup");
          }
          const bal = await getBalance(env, uid);
          expect(bal.balance).toBe(amounts.reduce((sum, a) => sum + a, 0));
        }
      )
    );
  });

  it("sequential debits that stay within balance all succeed", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 100, max: 1_000 }),
        async (uid, totalBalance) => {
          const env = makeEnv(uid, totalBalance);
          const chunkSize = 10;
          let remaining = totalBalance;
          let counter = 1;
          while (remaining >= chunkSize) {
            const r = await debitCard(env, uid, counter++, chunkSize, "chunk");
            expect(r.ok).toBe(true);
            remaining -= chunkSize;
          }
          const bal = await getBalance(env, uid);
          expect(bal.balance).toBe(remaining);
        }
      )
    );
  });

  it("getBalance returns 0 for fresh card", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, async (uid) => {
        const env = makeEnv(uid, 0);
        const bal = await getBalance(env, uid);
        expect(bal.balance).toBe(0);
      })
    );
  });

  it("debit of balance + 1 always fails", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 0, max: 999_999 }),
        async (uid, balance) => {
          const env = makeEnv(uid, balance);
          const result = await debitCard(env, uid, 1, balance + 1, "overdraft");
          expect(result.ok).toBe(false);
        }
      )
    );
  });

  it("failed debit does not change balance", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        fc.integer({ min: 10, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        async (uid, balance, excess) => {
          const env = makeEnv(uid, balance);
          const balBefore = await getBalance(env, uid);
          await debitCard(env, uid, 1, balance + excess, "overdraft");
          const balAfter = await getBalance(env, uid);
          expect(balAfter.balance).toBe(balBefore.balance);
        }
      )
    );
  });

  it("debit response includes correct remaining balance", () => {
    const balDebit = fc
      .tuple(fc.integer({ min: 100, max: 1_000_000 }), fc.integer({ min: 1, max: 99 }))
      .filter(([bal, deb]) => deb <= bal);

    return fc.assert(
      fc.asyncProperty(uidArb, balDebit, async (uid, [balance, debitAmount]) => {
        const env = makeEnv(uid, balance);
        const result = await debitCard(env, uid, 1, debitAmount, "partial");
        expect(result.ok).toBe(true);
        expect(result.balance).toBe(balance - debitAmount);
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. KEY DERIVATION INVARIANTS (synchronous)
// ════════════════════════════════════════════════════════════════════════════════

describe("Property: Key Derivation Invariants", () => {
  it("same (uid, env, version) always produces same keys", () => {
    fc.assert(
      fc.property(uidArb, keyArb, versionArb, (uid, issuerKey, version) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys1 = getDeterministicKeys(uid, env, version);
        const keys2 = getDeterministicKeys(uid, env, version);
        expect(keys1.k0).toBe(keys2.k0);
        expect(keys1.k1).toBe(keys2.k1);
        expect(keys1.k2).toBe(keys2.k2);
        expect(keys1.k3).toBe(keys2.k3);
        expect(keys1.k4).toBe(keys2.k4);
        expect(keys1.id).toBe(keys2.id);
      })
    );
  });

  it("different UIDs produce different keys for same env and version", () => {
    const distinctUids = fc.tuple(uidArb, uidArb).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(distinctUids, keyArb, versionArb, ([uid1, uid2], issuerKey, version) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys1 = getDeterministicKeys(uid1, env, version);
        const keys2 = getDeterministicKeys(uid2, env, version);
        const allSame =
          keys1.k0 === keys2.k0 && keys1.k1 === keys2.k1 && keys1.k2 === keys2.k2 &&
          keys1.k3 === keys2.k3 && keys1.k4 === keys2.k4;
        expect(allSame).toBe(false);
      })
    );
  });

  it("different versions produce different keys for same uid and env", () => {
    const distinctVersions = fc.tuple(versionArb, versionArb).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(uidArb, keyArb, distinctVersions, (uid, issuerKey, [v1, v2]) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys1 = getDeterministicKeys(uid, env, v1);
        const keys2 = getDeterministicKeys(uid, env, v2);
        const allSame =
          keys1.k0 === keys2.k0 && keys1.k1 === keys2.k1 && keys1.k2 === keys2.k2 &&
          keys1.k3 === keys2.k3 && keys1.k4 === keys2.k4;
        expect(allSame).toBe(false);
      })
    );
  });

  it("all 5 derived keys (k0-k4) are distinct for any valid input", () => {
    fc.assert(
      fc.property(uidArb, keyArb, versionArb, (uid, issuerKey, version) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys = getDeterministicKeys(uid, env, version);
        expect(new Set([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]).size).toBe(5);
      })
    );
  });

  it("all derived keys are exactly 32 hex characters", () => {
    fc.assert(
      fc.property(uidArb, keyArb, versionArb, (uid, issuerKey, version) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys = getDeterministicKeys(uid, env, version);
        for (const k of [keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]) {
          expect(k.length).toBe(32);
          expect(/^[0-9a-f]{32}$/.test(k)).toBe(true);
        }
      })
    );
  });

  it("id field is deterministic for same (uid, issuerKey)", () => {
    fc.assert(
      fc.property(uidArb, keyArb, (uid, issuerKey) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        expect(getDeterministicKeys(uid, env, 1).id).toBe(
          getDeterministicKeys(uid, env, 1).id
        );
      })
    );
  });

  it("different UIDs produce different id values", () => {
    const distinctUids = fc.tuple(uidArb, uidArb).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(distinctUids, keyArb, ([uid1, uid2], issuerKey) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        expect(getDeterministicKeys(uid1, env, 1).id).not.toBe(
          getDeterministicKeys(uid2, env, 1).id
        );
      })
    );
  });

  it("getDeterministicKeys k2 matches TestCard k2 for same (uid, issuerKey)", () => {
    fc.assert(
      fc.property(uidArb, keyArb, (uid, issuerKey) => {
        const tc = new TestCard(uid, issuerKey);
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys = getDeterministicKeys(uid, env, 1);
        expect(keys.k2).toBe(tc.keys.k2);
        expect(keys.k1).toBe(tc.keys.k1);
      })
    );
  });

  it("different issuer keys produce different derived keys for same uid", () => {
    const distinctKeys = fc.tuple(keyArb, keyArb).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(uidArb, distinctKeys, (uid, [key1, key2]) => {
        const dk1 = getDeterministicKeys(uid, { ISSUER_KEY: key1 } as Env, 1);
        const dk2 = getDeterministicKeys(uid, { ISSUER_KEY: key2 } as Env, 1);
        expect(dk1.k0 === dk2.k0 && dk1.k1 === dk2.k1 && dk1.k2 === dk2.k2).toBe(false);
      })
    );
  });

  it("version 1 and version 2 produce different key sets for any input", () => {
    fc.assert(
      fc.property(uidArb, keyArb, (uid, issuerKey) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const v1 = getDeterministicKeys(uid, env, 1);
        const v2 = getDeterministicKeys(uid, env, 2);
        const allSame =
          v1.k0 === v2.k0 &&
          v1.k1 === v2.k1 &&
          v1.k2 === v2.k2 &&
          v1.k3 === v2.k3 &&
          v1.k4 === v2.k4;
        expect(allSame).toBe(false);
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. CROSS-DOMAIN INVARIANTS
// ════════════════════════════════════════════════════════════════════════════════

describe("Property: Cross-Domain Invariants", () => {
  it("full round-trip: generate tap → verify CMAC → decrypt → match uid/ctr", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const ctr = new Uint8Array([
          (counter >> 16) & 0xff,
          (counter >> 8) & 0xff,
          counter & 0xff,
        ]);
        expect(verifyCmac(tc.uidBytes, ctr, tap.c, tc.k2Bytes).cmac_validated).toBe(true);
        const dec = decryptP(tap.p, [tc.k1Bytes]);
        expect(dec.success).toBe(true);
        if (dec.success) {
          expect(bytesToHex(dec.uidBytes)).toBe(uid.toLowerCase());
          expect((dec.ctr[0]! << 16) | (dec.ctr[1]! << 8) | dec.ctr[2]!).toBe(counter);
        }
      })
    );
  });

  it("virtualTap and TestCard produce mutually-verifiable results", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const ctr = new Uint8Array([
          (counter >> 16) & 0xff,
          (counter >> 8) & 0xff,
          counter & 0xff,
        ]);
        const vd = buildVerificationData(tc.uidBytes, ctr, tc.k2Bytes);
        expect(bytesToHex(vd.ct)).toBe(tap.c);
      })
    );
  });

  it("balance operations do not affect counter tracking", () => {
    return fc.assert(
      fc.asyncProperty(
        uidArb,
        counterArb,
        fc.integer({ min: 100, max: 100_000 }),
        async (uid, counter, amount) => {
          const env = makeEnv(uid, 0);
          await creditCard(env, uid, amount, "topup");
          await debitCard(env, uid, 1, amount, "spend");
          const r = await checkAndAdvanceCounter(env, uid, counter);
          expect(r.accepted).toBe(true);
          const r2 = await checkAndAdvanceCounter(env, uid, counter);
          expect(r2.accepted).toBe(false);
        }
      )
    );
  });

  it("CMAC from deterministic k2 validates for any valid tap", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys = getDeterministicKeys(uid, env, 1);
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const ctr = new Uint8Array([
          (counter >> 16) & 0xff,
          (counter >> 8) & 0xff,
          counter & 0xff,
        ]);
        expect(verifyCmac(hexToBytes(uid), ctr, tap.c, hexToBytes(keys.k2)).cmac_validated).toBe(true);
      })
    );
  });

  it("decryptP with deterministic k1 recovers UID and counter", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, issuerKey, counter) => {
        const env = { ISSUER_KEY: issuerKey } as Env;
        const keys = getDeterministicKeys(uid, env, 1);
        const tc = new TestCard(uid, issuerKey);
        const tap = tc.tap(counter);
        const result = decryptP(tap.p, [hexToBytes(keys.k1)]);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(bytesToHex(result.uidBytes)).toBe(uid.toLowerCase());
          expect((result.ctr[0]! << 16) | (result.ctr[1]! << 8) | result.ctr[2]!).toBe(counter);
        }
      })
    );
  });

  it("different (uid, issuerKey) pairs produce different k2 values", () => {
    const distinctPair = fc
      .tuple(uidArb, uidArb, keyArb, keyArb)
      .filter(([u1, u2, k1, k2]) => u1 !== u2 || k1 !== k2);
    fc.assert(
      fc.property(distinctPair, ([uid1, uid2, key1, key2]) => {
        const k2_1 = getDeterministicKeys(uid1, { ISSUER_KEY: key1 } as Env, 1).k2;
        const k2_2 = getDeterministicKeys(uid2, { ISSUER_KEY: key2 } as Env, 1).k2;
        expect(k2_1).not.toBe(k2_2);
      })
    );
  });

  it("counter boundary: 0 followed by 0xFFFFFF is accepted", () => {
    return fc.assert(
      fc.asyncProperty(uidArb, async (uid) => {
        const env = makeEnv(uid);
        const r1 = await checkAndAdvanceCounter(env, uid, 0);
        expect(r1.accepted).toBe(true);
        const r2 = await checkAndAdvanceCounter(env, uid, 0xffffff);
        expect(r2.accepted).toBe(true);
      })
    );
  });

  it("balance arithmetic is exact — no floating point drift", () => {
    const safeTriple = fc
      .tuple(
        fc.integer({ min: 1, max: 333_333 }),
        fc.integer({ min: 1, max: 333_333 }),
        fc.integer({ min: 1, max: 333_333 })
      )
      .filter(([a, b, c]) => a + b + c <= 1_000_000);

    return fc.assert(
      fc.asyncProperty(uidArb, safeTriple, async (uid, [a, b, c]) => {
        const total = a + b + c;
        const env = makeEnv(uid, 0);
        await creditCard(env, uid, a, "a");
        await creditCard(env, uid, b, "b");
        await creditCard(env, uid, c, "c");
        const bal = await getBalance(env, uid);
        expect(bal.balance).toBe(total);
        if (total % 2 === 0) {
          const dr = await debitCard(env, uid, 1, total / 2, "half");
          expect(dr.ok).toBe(true);
          expect(dr.balance).toBe(total / 2);
        }
      })
    );
  });

  it("SV2 structure: first 2 bytes are always 0x3c 0xc3", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, k2, counter) => {
        const ctr = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
        const vd = buildVerificationData(hexToBytes(uid), ctr, hexToBytes(k2));
        expect(vd.sv2[0]).toBe(0x3c);
        expect(vd.sv2[1]).toBe(0xc3);
      })
    );
  });

  it("SV2 embeds UID bytes at positions 6 through 12", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, k2, counter) => {
        const uidBytes = hexToBytes(uid);
        const ctr = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
        const vd = buildVerificationData(uidBytes, ctr, hexToBytes(k2));
        for (let i = 0; i < 7; i++) {
          expect(vd.sv2[6 + i]).toBe(uidBytes[i]);
        }
      })
    );
  });

  it("SV2 embeds counter bytes at positions 13-15", () => {
    fc.assert(
      fc.property(uidArb, keyArb, counterArb, (uid, k2, counter) => {
        const ctr = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
        const vd = buildVerificationData(hexToBytes(uid), ctr, hexToBytes(k2));
        expect(vd.sv2[13]).toBe(ctr[2]);
        expect(vd.sv2[14]).toBe(ctr[1]);
        expect(vd.sv2[15]).toBe(ctr[0]);
      })
    );
  });
});
