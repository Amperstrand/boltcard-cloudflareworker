/**
 * Property-based tests for input validation and balance arithmetic invariants.
 *
 * Uses fast-check to verify:
 *   1. parsePositiveInt: positive integer parsing with optional max bound
 *   2. validateUid: 14-char hex string validation
 *   3. Balance overflow/underflow boundaries via DO mock
 *   4. Counter replay boundary properties
 */
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import { parsePositiveInt, validateUid } from "../../utils/validation.js";
import { MAX_BALANCE } from "../../utils/constants.js";
import { creditCard, debitCard } from "../../replayProtection.js";
import { makeReplayNamespace } from "../replayNamespace.js";

// ---------------------------------------------------------------------------
// Custom arbitraries
// ---------------------------------------------------------------------------

const HEX_CHARS = "0123456789abcdef".split("");

/** Generates a lowercase hex string of exactly `len` characters. */
function hexStringOfLength(len: number): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...HEX_CHARS), { minLength: len, maxLength: len }).map((arr) => arr.join(""));
}

/** Generates a lowercase hex string with length in [minLength, maxLength]. */
function hexString(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...HEX_CHARS), { minLength, maxLength }).map((arr) => arr.join(""));
}

// ---------------------------------------------------------------------------
// parsePositiveInt properties
// ---------------------------------------------------------------------------

describe("parsePositiveInt properties", () => {
  test("returns the number for any positive integer string", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (n) => {
        expect(parsePositiveInt(String(n))).toBe(n);
      }),
    );
  });

  test("returns null for zero string", () => {
    expect(parsePositiveInt("0")).toBeNull();
  });

  test("returns null for negative integer strings", () => {
    fc.assert(
      fc.property(fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: -1 }), (n) => {
        expect(parsePositiveInt(String(n))).toBeNull();
      }),
    );
  });

  test("returns null for non-parseable strings (parseInt yields NaN or non-positive)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => {
          const parsed = parseInt(s, 10);
          return isNaN(parsed) || parsed <= 0;
        }),
        (s) => {
          expect(parsePositiveInt(s)).toBeNull();
        },
      ),
    );
  });

  test("returns null for empty string", () => {
    expect(parsePositiveInt("")).toBeNull();
  });

  test("respects max bound: result is never greater than max", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (value, max) => {
          const result = parsePositiveInt(String(value), max);
          if (result !== null) {
            expect(result).toBeLessThanOrEqual(max);
          }
          if (value > max) {
            expect(result).toBeNull();
          }
        },
      ),
    );
  });

  test("when max is provided and value <= max, returns the value", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000000 }), (value) => {
        expect(parsePositiveInt(String(value), 1000000)).toBe(value);
      }),
    );
  });

  test("returns null for null and undefined inputs", () => {
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
  });

  test("returns null for boolean inputs", () => {
    expect(parsePositiveInt(true)).toBeNull();
    expect(parsePositiveInt(false)).toBeNull();
  });

  test("returns null for object inputs", () => {
    expect(parsePositiveInt({})).toBeNull();
    expect(parsePositiveInt([])).toBeNull();
  });

  test("handles strings with + prefix by parsing the number", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (n) => {
        expect(parsePositiveInt(`+${n}`)).toBe(n);
      }),
    );
  });

  test("returns null for strings that parseInt cannot turn into a positive integer", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("abc", "x1", "e10", "#42", "0x1", "--5", "", "NaN", "Infinity"),
        (s) => {
          expect(parsePositiveInt(s)).toBeNull();
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// validateUid properties
// ---------------------------------------------------------------------------

describe("validateUid properties", () => {
  test("valid 14-char lowercase hex strings always pass", () => {
    fc.assert(
      fc.property(hexStringOfLength(14), (uid) => {
        const result = validateUid(uid);
        expect(result).toBe(uid);
      }),
    );
  });

  test("valid 14-char uppercase hex strings pass and are normalized to lowercase", () => {
    fc.assert(
      fc.property(hexStringOfLength(14).map((s) => s.toUpperCase()), (uid) => {
        const result = validateUid(uid);
        expect(result).toBe(uid.toLowerCase());
      }),
    );
  });

  test("mixed-case 14-char hex strings pass and normalize to lowercase", () => {
    fc.assert(
      fc.property(
        hexStringOfLength(14).map((s) => {
          const chars = s.split("");
          for (let i = 0; i < chars.length; i++) {
            if (Math.random() < 0.5) {
              chars[i] = chars[i]!.toUpperCase();
            }
          }
          return chars.join("");
        }),
        (uid) => {
          const result = validateUid(uid);
          expect(result).toBe(uid.toLowerCase());
        },
      ),
    );
  });

  test("strings shorter than 14 hex chars fail", () => {
    fc.assert(
      fc.property(hexString(0, 13), (s) => {
        expect(validateUid(s)).toBeNull();
      }),
    );
  });

  test("strings longer than 14 hex chars fail", () => {
    fc.assert(
      fc.property(hexString(15, 50), (s) => {
        expect(validateUid(s)).toBeNull();
      }),
    );
  });

  test("14-char strings with at least one non-hex character fail", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 14, maxLength: 14 }).filter((s) => !/^[0-9a-fA-F]{14}$/.test(s)),
        (s) => {
          expect(validateUid(s)).toBeNull();
        },
      ),
    );
  });

  test("empty string fails", () => {
    expect(validateUid("")).toBeNull();
  });

  test("null input fails", () => {
    expect(validateUid(null)).toBeNull();
  });

  test("undefined input fails", () => {
    expect(validateUid(undefined)).toBeNull();
  });

  test("non-string types always fail", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.float(), fc.constant(null), fc.constant(undefined)),
        (val) => {
          expect(validateUid(val)).toBeNull();
        },
      ),
    );
  });

  test("14-char hex with leading whitespace fails", () => {
    fc.assert(
      fc.property(hexStringOfLength(14), (uid) => {
        expect(validateUid(" " + uid)).toBeNull();
      }),
    );
  });

  test("14-char hex with trailing whitespace fails", () => {
    fc.assert(
      fc.property(hexStringOfLength(14), (uid) => {
        expect(validateUid(uid + " ")).toBeNull();
      }),
    );
  });

  test("14-char hex with surrounding whitespace fails", () => {
    fc.assert(
      fc.property(hexStringOfLength(14), (uid) => {
        expect(validateUid(" " + uid + " ")).toBeNull();
      }),
    );
  });

  test("result is always lowercase when valid", () => {
    fc.assert(
      fc.property(hexStringOfLength(14).map((s) => s.toUpperCase()), (uid) => {
        const result = validateUid(uid);
        if (result !== null) {
          expect(result).toBe(result.toLowerCase());
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Balance arithmetic boundary properties (via DO mock)
// ---------------------------------------------------------------------------

const UID = "04aabbccdd7788";

function buildTestEnv() {
  const ns = makeReplayNamespace();
  ns.__activate(UID, 1);
  return { ns, env: { CARD_REPLAY: ns } as unknown as import("../../types/core.js").Env };
}

async function getBalance(ns: ReturnType<typeof makeReplayNamespace>, uid: string): Promise<number> {
  const id = ns.idFromName(uid);
  const stub = ns.get(id);
  const resp = await stub.fetch(new Request("http://do/balance"));
  const data = (await resp.json()) as { balance: number };
  return data.balance;
}

describe("Balance arithmetic boundary properties", () => {
  test("credit with valid positive amount always succeeds for active card", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: MAX_BALANCE }),
        async (amount) => {
          const { env } = buildTestEnv();
          const result = await creditCard(env, UID, amount, "test topup");
          expect(result.ok).toBe(true);
          expect(result.balance).toBe(amount);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("debit succeeds when amount equals current balance (exact drain)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100000 }),
        async (amount) => {
          const { env, ns } = buildTestEnv();
          await creditCard(env, UID, amount, "topup");
          const result = await debitCard(env, UID, 1, amount, "charge");
          expect(result.ok).toBe(true);
          expect(await getBalance(ns, UID)).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("debit fails when amount exceeds current balance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        async (creditAmount, extraDebit) => {
          const { env, ns } = buildTestEnv();
          await creditCard(env, UID, creditAmount, "topup");
          const debitAmount = creditAmount + extraDebit;
          const result = await debitCard(env, UID, 1, debitAmount, "charge");
          expect(result.ok).toBe(false);
          expect(await getBalance(ns, UID)).toBe(creditAmount);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("balance never goes negative after arbitrary credit/debit sequence", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.integer({ min: 1, max: 10000 }).map((amount) => ({ kind: "credit" as const, amount })),
            fc.integer({ min: 1, max: 5000 }).map((amount) => ({ kind: "debit" as const, amount })),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        async (ops) => {
          const { env, ns } = buildTestEnv();
          let modelBalance = 0;
          let counter = 0;

          for (const op of ops) {
            if (op.kind === "credit") {
              const result = await creditCard(env, UID, op.amount, "test");
              if (result.ok) {
                modelBalance += op.amount;
              }
            } else {
              counter++;
              if (op.amount <= modelBalance) {
                const result = await debitCard(env, UID, counter, op.amount, "test");
                expect(result.ok).toBe(true);
                modelBalance -= op.amount;
              } else {
                const result = await debitCard(env, UID, counter, op.amount, "test");
                expect(result.ok).toBe(false);
              }
            }
          }

          const realBalance = await getBalance(ns, UID);
          expect(realBalance).toBeGreaterThanOrEqual(0);
          expect(realBalance).toBe(modelBalance);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("sum of any two values within MAX_BALANCE stays within Number safe range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_BALANCE }),
        fc.integer({ min: 1, max: MAX_BALANCE }),
        (balance, amount) => {
          const sum = balance + amount;
          expect(Number.isSafeInteger(sum)).toBe(true);
          expect(sum).toBeLessThanOrEqual(2 * MAX_BALANCE);
        },
      ),
    );
  });

  test("MAX_BALANCE is exactly 2^31 - 1 (fits in 32-bit signed integer)", () => {
    expect(MAX_BALANCE).toBe(2147483647);
    expect(MAX_BALANCE).toBe(Math.pow(2, 31) - 1);
    expect(MAX_BALANCE).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  test("debit of zero amount fails", async () => {
    const { env } = buildTestEnv();
    await creditCard(env, UID, 1000, "topup");
    const result = await debitCard(env, UID, 1, 0, "charge");
    expect(result.ok).toBe(false);
  });

  test("credit of zero amount fails", async () => {
    const { env } = buildTestEnv();
    const result = await creditCard(env, UID, 0, "topup");
    expect(result.ok).toBe(false);
  });

  test("debit of negative amount fails", async () => {
    const { env } = buildTestEnv();
    const result = await debitCard(env, UID, 1, -100, "charge");
    expect(result.ok).toBe(false);
  });

  test("credit of negative amount fails", async () => {
    const { env } = buildTestEnv();
    const result = await creditCard(env, UID, -100, "topup");
    expect(result.ok).toBe(false);
  });

  test("repeated credits sum correctly", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        async (creditAmount, numCredits) => {
          const { env, ns } = buildTestEnv();
          for (let i = 0; i < numCredits; i++) {
            const result = await creditCard(env, UID, creditAmount, "topup");
            expect(result.ok).toBe(true);
          }

          const expectedBalance = creditAmount * numCredits;
          expect(await getBalance(ns, UID)).toBe(expectedBalance);
        },
      ),
      { numRuns: 30 },
    );
  });

  test("credit then debit of same amount returns to zero", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: MAX_BALANCE }),
        async (amount) => {
          const { env, ns } = buildTestEnv();
          await creditCard(env, UID, amount, "topup");
          const debitResult = await debitCard(env, UID, 1, amount, "charge");
          expect(debitResult.ok).toBe(true);
          expect(await getBalance(ns, UID)).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Counter boundary properties
// ---------------------------------------------------------------------------

describe("Counter boundary properties", () => {
  test("stale counter (lower than last accepted) is always rejected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (counter1, offset) => {
          const { ns } = buildTestEnv();
          const id = ns.idFromName(UID);
          const stub = ns.get(id);

          const resp1 = await stub.fetch(
            new Request("http://do/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ counterValue: counter1 }),
            }),
          );
          expect(resp1.status).toBe(200);

          const staleCounter = counter1 - offset;
          if (staleCounter < 1) return;
          const resp2 = await stub.fetch(
            new Request("http://do/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ counterValue: staleCounter }),
            }),
          );
          expect(resp2.status).toBe(409);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("repeating the same counter is rejected (replay)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        async (counter) => {
          const { ns } = buildTestEnv();
          const id = ns.idFromName(UID);
          const stub = ns.get(id);

          const resp1 = await stub.fetch(
            new Request("http://do/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ counterValue: counter }),
            }),
          );
          expect(resp1.status).toBe(200);

          const resp2 = await stub.fetch(
            new Request("http://do/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ counterValue: counter }),
            }),
          );
          expect(resp2.status).toBe(409);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("monotonically increasing counter sequence is always accepted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 10000 }), { minLength: 2, maxLength: 10 }).map((arr) =>
          arr.sort((a, b) => a - b),
        ),
        async (counters) => {
          const { ns } = buildTestEnv();
          const id = ns.idFromName(UID);
          const stub = ns.get(id);

          for (const counter of counters) {
            const resp = await stub.fetch(
              new Request("http://do/check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ counterValue: counter }),
              }),
            );
            expect(resp.status).toBe(200);
            const data = (await resp.json()) as { accepted: boolean };
            expect(data.accepted).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
