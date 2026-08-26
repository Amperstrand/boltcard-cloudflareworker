import { describe, it, expect } from "vitest";
import { handleHealthData } from "../handlers/healthHandler.js";
import type { Env, SessionPayload } from "../types/core.js";
import { createMockKV } from "./testHelpers.js";

const HOUR = 60 * 60 * 1000;

const session: SessionPayload = {
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 43200,
  shiftId: "test-shift-health",
};

function seededEnv(): Env {
  const now = Date.now();
  const cards: Record<string, string> = {
    "card_idx:04aaaaaaaaaaaa": JSON.stringify({ uid: "04aaaaaaaaaaaa", state: "active", balance: 500, updatedAt: now - 10 * 60 * 1000 }),
    "card_idx:04bbbbbbbbbbbb": JSON.stringify({ uid: "04bbbbbbbbbbbb", state: "active", balance: 100, updatedAt: now - 2 * HOUR }),
    "card_idx:04cccccccccccc": JSON.stringify({ uid: "04cccccccccccc", state: "terminated", balance: 9000, updatedAt: now - 10 * 24 * HOUR }),
  };
  for (let i = 0; i < 12; i++) {
    cards[`card_idx:04dd0000000${i.toString().padStart(2, "0")}`] = JSON.stringify({
      uid: `04dd0000000${i.toString().padStart(2, "0")}`,
      state: "active",
      balance: 50 + i,
      updatedAt: now - 3 * HOUR,
    });
  }
  cards["unrelated:noise"] = JSON.stringify({ foo: 1 });

  return {
    UID_CONFIG: createMockKV(cards),
    CARD_REPLAY: {} as DurableObjectNamespace,
    __TEST_OPERATOR_SESSION: session,
    WORKER_ENV: "test",
  } satisfies Env;
}

function authedRequest(): Request {
  return new Request("https://boltcardpoc.psbt.me/operator/health/data");
}

describe("handleHealthData", () => {
  it("rejects unauthenticated access", async () => {
    const env = {
      UID_CONFIG: createMockKV(),
      CARD_REPLAY: {} as DurableObjectNamespace,
      WORKER_ENV: "test",
    } satisfies Env;
    const resp = await handleHealthData(authedRequest(), env);
    expect([401, 302]).toContain(resp.status);
  });

  it("reports latency, seen buckets, and capped sorted top balances", async () => {
    const resp = await handleHealthData(authedRequest(), seededEnv());
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      system: { kv: string; durableObject: string; overall: string };
      latency: { kvMs: number; doMs: number | null };
      seen: { last1h: number; last24h: number; last7d: number };
      topBalances: { uid: string; balance: number; state: string }[];
      cards: Record<string, number>;
    };

    expect(data.system.kv).toBe("ok");
    expect(data.system.durableObject).toBe("error");
    expect(data.system.overall).toBe("degraded");
    expect(typeof data.latency.kvMs).toBe("number");
    expect(data.latency.kvMs).toBeGreaterThanOrEqual(0);

    expect(data.seen).toEqual({ last1h: 1, last24h: 14, last7d: 14 });

    expect(data.topBalances).toHaveLength(10);
    const balances = data.topBalances.map((c) => c.balance);
    expect(balances).toEqual([...balances].sort((a, b) => b - a));
    expect(balances[0]).toBe(9000);

    expect(data.cards.total).toBe(15);
    expect(data.cards.active).toBe(14);
    expect(data.cards.terminated).toBe(1);
  });
});
