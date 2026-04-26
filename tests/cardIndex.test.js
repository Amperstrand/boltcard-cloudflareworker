import { indexCard, deindexCard, getIndexedCard, listIndexedCards } from "../utils/cardIndex.js";

describe("cardIndex", () => {
  function makeKvEnv(store = {}) {
    return {
      UID_CONFIG: {
        get: async (key) => store[key] ?? null,
        put: async (key, val, opts) => { store[key] = { value: val, opts }; },
        delete: async (key) => { delete store[key]; },
        list: async ({ prefix, limit, cursor } = {}) => {
          const keys = Object.keys(store)
            .filter(k => k.startsWith(prefix || ""))
            .sort()
            .slice(0, limit || 100)
            .map(k => ({ name: k }));
          return { keys, list_complete: true, cursor: null };
        },
      },
      __store: store,
    };
  }

  describe("indexCard", () => {
    it("stores card metadata in KV", async () => {
      const env = makeKvEnv();
      await indexCard(env, "ff000000000001", {
        state: "active",
        keyProvenance: "env_issuer",
        keyLabel: "prod",
      });

      const stored = env.__store["card_idx:ff000000000001"];
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored.value);
      expect(parsed.uid).toBe("ff000000000001");
      expect(parsed.state).toBe("active");
      expect(parsed.keyProvenance).toBe("env_issuer");
      expect(parsed.updatedAt).toBeGreaterThan(0);
    });

    it("normalizes UID to lowercase", async () => {
      const env = makeKvEnv();
      await indexCard(env, "FF000000000001", { state: "active" });
      expect(env.__store["card_idx:ff000000000001"]).toBeDefined();
      expect(env.__store["card_idx:FF000000000001"]).toBeUndefined();
    });

    it("sets TTL on KV entry", async () => {
      const env = makeKvEnv();
      await indexCard(env, "ff000000000002", { state: "discovered" });
      const stored = env.__store["card_idx:ff000000000002"];
      expect(stored.opts.expirationTtl).toBe(7 * 24 * 60 * 60);
    });

    it("silently fails when UID_CONFIG is missing", async () => {
      const env = {};
      await expect(indexCard(env, "ff000000000001", { state: "active" })).resolves.toBeUndefined();
    });

    it("silently fails when uidHex is empty", async () => {
      const env = makeKvEnv();
      await expect(indexCard(env, "", { state: "active" })).resolves.toBeUndefined();
    });

    it("silently fails on KV write error", async () => {
      const env = {
        UID_CONFIG: {
          put: async () => { throw new Error("KV error"); },
        },
      };
      await expect(indexCard(env, "ff000000000001", { state: "active" })).resolves.toBeUndefined();
    });
  });

  describe("deindexCard", () => {
    it("removes card from KV", async () => {
      const env = makeKvEnv({ "card_idx:ff000000000001": '{"uid":"ff000000000001"}' });
      await deindexCard(env, "ff000000000001");
      expect(env.__store["card_idx:ff000000000001"]).toBeUndefined();
    });

    it("silently fails when UID_CONFIG is missing", async () => {
      await expect(deindexCard({}, "ff000000000001")).resolves.toBeUndefined();
    });
  });

  describe("getIndexedCard", () => {
    it("returns parsed card data", async () => {
      const env = makeKvEnv({
        "card_idx:ff000000000001": JSON.stringify({ uid: "ff000000000001", state: "active" }),
      });
      const card = await getIndexedCard(env, "ff000000000001");
      expect(card.uid).toBe("ff000000000001");
      expect(card.state).toBe("active");
    });

    it("returns null when card not found", async () => {
      const env = makeKvEnv();
      const card = await getIndexedCard(env, "ff000000000099");
      expect(card).toBeNull();
    });

    it("returns null when UID_CONFIG is missing", async () => {
      const card = await getIndexedCard({}, "ff000000000001");
      expect(card).toBeNull();
    });
  });

  describe("listIndexedCards", () => {
    it("returns all indexed cards", async () => {
      const env = makeKvEnv({
        "card_idx:ff000000000001": JSON.stringify({ uid: "ff000000000001", state: "active" }),
        "card_idx:ff000000000002": JSON.stringify({ uid: "ff000000000002", state: "discovered" }),
      });
      const result = await listIndexedCards(env);
      expect(result.cards).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by state", async () => {
      const env = makeKvEnv({
        "card_idx:ff000000000001": JSON.stringify({ uid: "ff000000000001", state: "active" }),
        "card_idx:ff000000000002": JSON.stringify({ uid: "ff000000000002", state: "discovered" }),
        "card_idx:ff000000000003": JSON.stringify({ uid: "ff000000000003", state: "active" }),
      });
      const result = await listIndexedCards(env, { state: "active" });
      expect(result.cards).toHaveLength(2);
      expect(result.cards.every(c => c.state === "active")).toBe(true);
    });

    it("returns empty array when no cards match", async () => {
      const env = makeKvEnv();
      const result = await listIndexedCards(env, { state: "terminated" });
      expect(result.cards).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("returns empty result when UID_CONFIG is missing", async () => {
      const result = await listIndexedCards({});
      expect(result.cards).toEqual([]);
    });

    it("handles corrupted entries gracefully", async () => {
      const env = makeKvEnv({
        "card_idx:ff000000000001": "not-json",
        "card_idx:ff000000000002": JSON.stringify({ uid: "ff000000000002", state: "active" }),
      });
      const result = await listIndexedCards(env);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].uid).toBe("ff000000000002");
    });
  });
});
