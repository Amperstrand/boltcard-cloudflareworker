import { handleCardAuditPage, handleCardAuditData, handleIndexRepair } from "../handlers/cardAuditHandler.js";
import { buildCardTestEnv, TEST_OPERATOR_AUTH } from "./testHelpers.js";

describe("handleCardAuditPage", () => {
  it("renders card audit page for authenticated operator", async () => {
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    const req = new Request("https://test.local/operator/cards", {
      headers: { Cookie: "op_session=test" },
    });

    const res = await handleCardAuditPage(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("CARD REGISTRY");
    expect(html).toContain("card-audit.js");
  });

  it("rejects unauthenticated request", async () => {
    const env = buildCardTestEnv({ uid: "ff000000000001", issuerKey: "00000000000000000000000000000001" });
    const req = new Request("https://test.local/operator/cards");
    const res = await handleCardAuditPage(req, env);
    expect(res.status).toBe(302);
  });
});

describe("handleCardAuditData", () => {
  it("returns card list for authenticated operator", async () => {
    const store: Record<string, string> = {};
    store["card_idx:ff000000000001"] = JSON.stringify({
      uid: "ff000000000001",
      state: "active",
      keyProvenance: "env_issuer",
      updatedAt: Date.now(),
    });
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
      exposeKvStore: true,
    });
    env.UID_CONFIG = {
      get: async (key: string) => store[key] ?? null,
      put: async (key: string, val: string) => { store[key] = val; },
      list: async () => ({
        keys: Object.keys(store).map(k => ({ name: k })),
        list_complete: true,
      }),
    } as any;

    const req = new Request("https://test.local/operator/cards/data", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].state).toBe("active");
  });

  it("filters by state parameter", async () => {
    const store: Record<string, string> = {};
    store["card_idx:ff000000000001"] = JSON.stringify({ uid: "ff000000000001", state: "active" });
    store["card_idx:ff000000000002"] = JSON.stringify({ uid: "ff000000000002", state: "discovered" });
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    env.UID_CONFIG = {
      get: async (key: string) => store[key] ?? null,
      put: async (key: string, val: string) => { store[key] = val; },
      list: async () => ({
        keys: Object.keys(store).map(k => ({ name: k })),
        list_complete: true,
      }),
    } as any;

    const req = new Request("https://test.local/operator/cards/data?state=discovered", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    const body = await res.json() as Record<string, any>;
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].state).toBe("discovered");
  });

  it("returns empty list when no cards", async () => {
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    env.UID_CONFIG = {
      get: async () => null,
      put: async () => {},
      list: async () => ({ keys: [], list_complete: true }),
    } as any;

    const req = new Request("https://test.local/operator/cards/data", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    const body = await res.json() as Record<string, any>;
    expect(body.cards).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("rejects unauthenticated request", async () => {
    const env = buildCardTestEnv({ uid: "ff000000000001", issuerKey: "00000000000000000000000000000001" });
    const req = new Request("https://test.local/operator/cards/data");
    const res = await handleCardAuditData(req, env);
    expect(res.status).toBe(302);
  });

  it("passes cursor parameter to listIndexedCards", async () => {
    const store: Record<string, string> = {};
    store["card_idx:ff000000000001"] = JSON.stringify({ uid: "ff000000000001", state: "active" });
    let capturedCursor: string | undefined = "UNSET";
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    env.UID_CONFIG = {
      get: async (key: string) => store[key] ?? null,
      put: async (key: string, val: string) => { store[key] = val; },
      list: async (opts?: any) => {
        capturedCursor = opts?.cursor;
        return {
          keys: Object.keys(store).map(k => ({ name: k })),
          list_complete: true,
        };
      },
    } as any;

    const req = new Request("https://test.local/operator/cards/data?cursor=abc123", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    expect(res.status).toBe(200);
    expect(capturedCursor).toBe("abc123");
  });
});

describe("handleIndexRepair", () => {
  function makeRepairEnv(cards: Array<{ uid: string; state: string; updatedAt?: number }> = [], doStates: Record<string, string> = {}) {
    const store: Record<string, string> = {};
    for (const card of cards) {
      store[`card_idx:${card.uid}`] = JSON.stringify(card);
    }
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    env.UID_CONFIG = {
      get: async (key: string) => store[key] ?? null,
      put: async (key: string, val: string) => { store[key] = val; },
      list: async (opts?: any) => ({
        keys: Object.keys(store).filter(k => k.startsWith(opts?.prefix ?? "")).map(k => ({ name: k })),
        list_complete: true,
      }),
    } as any;
    env.CARD_REPLAY = {
      idFromName: (name: string) => name as any,
      get: (id: any) => ({
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === "/card-state") {
            const idStr = String(id);
            const state = doStates[idStr];
            if (state) {
              return new Response(JSON.stringify({ state }), { headers: { "Content-Type": "application/json" } });
            }
            return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
          }
          return new Response("not found", { status: 404 });
        },
      }) as any,
    } as any;
    (env as any).__store = store;
    return env;
  }

  it("rejects unauthenticated request", async () => {
    const env = buildCardTestEnv({ uid: "ff000000000001", issuerKey: "00000000000000000000000000000001" });
    const req = new Request("https://test.local/operator/cards/repair", { method: "POST" });
    const res = await handleIndexRepair(req, env);
    expect(res.status).toBe(302);
  });

  it("repairs stale wipe_requested entries", async () => {
    const env = makeRepairEnv(
      [
        { uid: "ff000000000001", state: "wipe_requested", updatedAt: Date.now() },
        { uid: "ff000000000002", state: "active", updatedAt: Date.now() },
      ],
      { ff000000000001: "active", ff000000000002: "active" }
    );
    const req = new Request("https://test.local/operator/cards/repair", {
      method: "POST",
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleIndexRepair(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.scanned).toBe(2);
    expect(body.repaired).toBe(1);

    const repaired = JSON.parse((env as any).__store["card_idx:ff000000000001"]);
    expect(repaired.state).toBe("active");
  });

  it("returns zeros when no cards indexed", async () => {
    const env = makeRepairEnv([], {});
    const req = new Request("https://test.local/operator/cards/repair", {
      method: "POST",
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleIndexRepair(req, env);
    const body = await res.json() as Record<string, any>;
    expect(body.scanned).toBe(0);
    expect(body.repaired).toBe(0);
  });

  it("returns 500 when repair throws", async () => {
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    env.UID_CONFIG = {
      list: async () => { throw new Error("KV exploded"); },
      get: async () => null,
      put: async () => {},
    } as any;
    env.CARD_REPLAY = {} as any;
    const req = new Request("https://test.local/operator/cards/repair", {
      method: "POST",
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleIndexRepair(req, env);
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, any>;
    expect(body.error).toBe("Index repair failed");
  });
});
