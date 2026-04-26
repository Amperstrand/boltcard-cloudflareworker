import { describe, it, expect } from "@jest/globals";
import { mergeHistory, getUnifiedHistory } from "../utils/history.js";
import { buildCardTestEnv } from "./testHelpers.js";

describe("mergeHistory", () => {
  it("returns empty array for null taps and null transactions", () => {
    const result = mergeHistory(null, null);
    expect(result).toEqual([]);
  });

  it("returns empty array for undefined taps and transactions", () => {
    const result = mergeHistory(undefined, undefined);
    expect(result).toEqual([]);
  });

  it("maps positive amount transactions to topup status", () => {
    const result = mergeHistory([], [{ amount: 1000, created_at: 100, balance_after: 1000 }]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("topup");
    expect(result[0].amount_msat).toBe(1000);
  });

  it("maps negative amount transactions to payment status", () => {
    const result = mergeHistory([], [{ amount: -500, created_at: 200, balance_after: 500 }]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("payment");
    expect(result[0].amount_msat).toBe(500);
  });

  it("preserves note when present", () => {
    const result = mergeHistory([], [{ amount: 100, created_at: 100, balance_after: 100, note: "Manual top-up" }]);
    expect(result[0].note).toBe("Manual top-up");
  });

  it("sets note to null when absent", () => {
    const result = mergeHistory([], [{ amount: 100, created_at: 100, balance_after: 100 }]);
    expect(result[0].note).toBeNull();
  });

  it("sorts by created_at descending", () => {
    const taps = [
      { counter: 1, created_at: 100 },
      { counter: 2, created_at: 300 },
    ];
    const txs = [
      { amount: 100, created_at: 200, balance_after: 100 },
    ];
    const result = mergeHistory(taps, txs);
    expect(result[0].created_at).toBe(300);
    expect(result[1].created_at).toBe(200);
    expect(result[2].created_at).toBe(100);
  });

  it("sorts by counter descending when created_at is equal", () => {
    const taps = [
      { counter: 5, created_at: 100 },
      { counter: 10, created_at: 100 },
    ];
    const result = mergeHistory(taps, []);
    expect(result[0].counter).toBe(10);
    expect(result[1].counter).toBe(5);
  });

  it("handles entries with missing created_at (sorts as 0)", () => {
    const taps = [{ counter: 1 }];
    const txs = [{ amount: 50, created_at: 50, balance_after: 50 }];
    const result = mergeHistory(taps, txs);
    expect(result[0].created_at).toBe(50);
    expect(result[1].created_at).toBeUndefined();
  });

  it("handles entries with missing counter (sorts as 0)", () => {
    const taps = [{ created_at: 100 }];
    const result = mergeHistory(taps, []);
    expect(result[0].counter).toBeUndefined();
  });

  it("limits to 25 entries", () => {
    const taps = Array.from({ length: 30 }, (_, i) => ({ counter: i, created_at: i }));
    const result = mergeHistory(taps, []);
    expect(result).toHaveLength(25);
  });

  it("merges taps and transactions together", () => {
    const taps = [{ counter: 1, created_at: 100, bolt11: "lnbc1" }];
    const txs = [{ amount: -200, created_at: 150, balance_after: 800 }];
    const result = mergeHistory(taps, txs);
    expect(result).toHaveLength(2);
    expect(result[0].created_at).toBe(150);
    expect(result[0].status).toBe("payment");
    expect(result[1].created_at).toBe(100);
  });
});

describe("getUnifiedHistory", () => {
  it("returns merged history from DO", async () => {
    const env = buildCardTestEnv({ uid: "04a39493cc8680", issuerKey: "00000000000000000000000000000001" });
    const uid = "04a39493cc8680";
    env.CARD_REPLAY.__activate(uid, 1);

    const id = env.CARD_REPLAY.idFromName(uid);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://card-replay.internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue: 2, bolt11: "lnbc1test", amountMsat: 1000 }),
    }));

    const result = await getUnifiedHistory(env, uid);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].counter).toBe(2);
  });

  it("returns empty when DO has no data", async () => {
    const env = buildCardTestEnv({ uid: "04a39493cc8680", issuerKey: "00000000000000000000000000000001" });
    const result = await getUnifiedHistory(env, "04a39493cc8680");
    expect(result).toEqual([]);
  });

  it("handles listTaps throwing", async () => {
    const env = buildCardTestEnv({ uid: "04a39493cc8680" });
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => ({
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/list-taps") throw new Error("DO unavailable");
        return origGet(id).fetch(req);
      },
    });
    const result = await getUnifiedHistory(env, "04a39493cc8680");
    expect(result).toEqual([]);
  });

  it("handles listTransactions throwing", async () => {
    const env = buildCardTestEnv({ uid: "04a39493cc8680" });
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => ({
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/transactions") throw new Error("DO unavailable");
        return origGet(id).fetch(req);
      },
    });
    const result = await getUnifiedHistory(env, "04a39493cc8680");
    expect(result).toEqual([]);
  });

  it("handles listTaps returning no taps property", async () => {
    const env = buildCardTestEnv({ uid: "04a39493cc8680" });
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => ({
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/list-taps") return Response.json({});
        return origGet(id).fetch(req);
      },
    });
    const result = await getUnifiedHistory(env, "04a39493cc8680");
    expect(result).toEqual([]);
  });

  it("handles listTransactions returning no transactions property", async () => {
    const env = buildCardTestEnv({ uid: "04a39493cc8680" });
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => ({
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/transactions") return Response.json({});
        return origGet(id).fetch(req);
      },
    });
    const result = await getUnifiedHistory(env, "04a39493cc8680");
    expect(result).toEqual([]);
  });
});
