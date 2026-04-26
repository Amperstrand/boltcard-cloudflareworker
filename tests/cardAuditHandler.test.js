import { handleCardAuditPage, handleCardAuditData } from "../handlers/cardAuditHandler.js";
import { buildCardTestEnv } from "./testHelpers.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

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
    Object.assign(env, TEST_OPERATOR_AUTH);

    const res = await handleCardAuditPage(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("CARD REGISTRY");
    expect(html).toContain("operator/cards/data");
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
    const store = {};
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
    Object.assign(env, TEST_OPERATOR_AUTH);
    env.UID_CONFIG = {
      get: async (key) => store[key] ?? null,
      put: async (key, val) => { store[key] = val; },
      list: async () => ({
        keys: Object.keys(store).map(k => ({ name: k })),
        list_complete: true,
      }),
    };

    const req = new Request("https://test.local/operator/cards/data", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].state).toBe("active");
  });

  it("filters by state parameter", async () => {
    const store = {};
    store["card_idx:ff000000000001"] = JSON.stringify({ uid: "ff000000000001", state: "active" });
    store["card_idx:ff000000000002"] = JSON.stringify({ uid: "ff000000000002", state: "discovered" });
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    Object.assign(env, TEST_OPERATOR_AUTH);
    env.UID_CONFIG = {
      get: async (key) => store[key] ?? null,
      put: async (key, val) => { store[key] = val; },
      list: async () => ({
        keys: Object.keys(store).map(k => ({ name: k })),
        list_complete: true,
      }),
    };

    const req = new Request("https://test.local/operator/cards/data?state=discovered", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].state).toBe("discovered");
  });

  it("returns empty list when no cards", async () => {
    const env = buildCardTestEnv({
      uid: "ff000000000001",
      issuerKey: "00000000000000000000000000000001",
      operatorAuth: true,
    });
    Object.assign(env, TEST_OPERATOR_AUTH);
    env.UID_CONFIG = {
      get: async () => null,
      put: async () => {},
      list: async () => ({ keys: [], list_complete: true }),
    };

    const req = new Request("https://test.local/operator/cards/data", {
      headers: { Cookie: "op_session=test" },
    });
    const res = await handleCardAuditData(req, env);
    const body = await res.json();
    expect(body.cards).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("rejects unauthenticated request", async () => {
    const env = buildCardTestEnv({ uid: "ff000000000001", issuerKey: "00000000000000000000000000000001" });
    const req = new Request("https://test.local/operator/cards/data");
    const res = await handleCardAuditData(req, env);
    expect(res.status).toBe(302);
  });
});
