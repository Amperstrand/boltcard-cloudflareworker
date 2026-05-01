import { indexCard, _deindexCard as _deindexCard, _getIndexedCard as _getIndexedCard, listIndexedCards, repairCardIndex } from "../utils/cardIndex.js";

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

  describe("_deindexCard", () => {
    it("removes card from KV", async () => {
      const env = makeKvEnv({ "card_idx:ff000000000001": '{"uid":"ff000000000001"}' });
      await _deindexCard(env, "ff000000000001");
      expect(env.__store["card_idx:ff000000000001"]).toBeUndefined();
    });

    it("silently fails when UID_CONFIG is missing", async () => {
      await expect(_deindexCard({}, "ff000000000001")).resolves.toBeUndefined();
    });
  });

  describe("_getIndexedCard", () => {
    it("returns parsed card data", async () => {
      const env = makeKvEnv({
        "card_idx:ff000000000001": JSON.stringify({ uid: "ff000000000001", state: "active" }),
      });
      const card = await _getIndexedCard(env, "ff000000000001");
      expect(card.uid).toBe("ff000000000001");
      expect(card.state).toBe("active");
    });

    it("returns null when card not found", async () => {
      const env = makeKvEnv();
      const card = await _getIndexedCard(env, "ff000000000099");
      expect(card).toBeNull();
    });

    it("returns null when UID_CONFIG is missing", async () => {
      const card = await _getIndexedCard({}, "ff000000000001");
      expect(card).toBeNull();
    });
  });

  describe("listIndexedCards", () => {
    it("returns total as KV key count (pre-filter)", async () => {
      const env = makeKvEnv({
        "card_idx:ff000000000001": JSON.stringify({ uid: "ff000000000001", state: "active" }),
        "card_idx:ff000000000002": JSON.stringify({ uid: "ff000000000002", state: "discovered" }),
        "card_idx:ff000000000003": JSON.stringify({ uid: "ff000000000003", state: "active" }),
      });
      const result = await listIndexedCards(env, { state: "active" });
      expect(result.cards).toHaveLength(2);
      expect(result.total).toBe(3);
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

    it("passes cursor through and returns next cursor when list incomplete", async () => {
      const store = {};
      for (let i = 1; i <= 5; i++) {
        const uid = `ff00000000000${i}`;
        store[`card_idx:${uid}`] = JSON.stringify({ uid, state: "active" });
      }
      const env = {
        UID_CONFIG: {
          list: async ({ prefix, limit, cursor }) => {
            const allKeys = Object.keys(store).filter(k => k.startsWith(prefix)).sort();
            const startIdx = cursor ? allKeys.indexOf(cursor) + 1 : 0;
            const batch = allKeys.slice(startIdx, startIdx + limit);
            const listComplete = startIdx + limit >= allKeys.length;
            return {
              keys: batch.map(k => ({ name: k })),
              list_complete: listComplete,
              cursor: listComplete ? null : batch[batch.length - 1],
            };
          },
          get: async (key) => store[key] ?? null,
        },
      };

      const page1 = await listIndexedCards(env, { limit: 2 });
      expect(page1.cards).toHaveLength(2);
      expect(page1.cursor).not.toBeNull();

      const page2 = await listIndexedCards(env, { limit: 2, cursor: page1.cursor });
      expect(page2.cards).toHaveLength(2);
      expect(page2.cursor).not.toBeNull();

      const page3 = await listIndexedCards(env, { limit: 2, cursor: page2.cursor });
      expect(page3.cards).toHaveLength(1);
      expect(page3.cursor).toBeNull();
    });

    it("fetches cards in parallel", async () => {
      const getCallOrder = [];
      const env = {
        UID_CONFIG: {
          list: async () => ({
            keys: [
              { name: "card_idx:ff000000000001" },
              { name: "card_idx:ff000000000002" },
            ],
            list_complete: true,
            cursor: null,
          }),
          get: async (key) => {
            getCallOrder.push(key);
            await new Promise((r) => setTimeout(r, 10));
            return JSON.stringify({ uid: key.split(":")[1], state: "active" });
          },
        },
      };
      const result = await listIndexedCards(env);
      expect(result.cards).toHaveLength(2);
      expect(getCallOrder).toHaveLength(2);
    });
  });

  describe("repairCardIndex", () => {
    it("repairs cards with stale KV state", async () => {
      const store = {};
      store["card_idx:ff000000000001"] = JSON.stringify({ uid: "ff000000000001", state: "wipe_requested", updatedAt: Date.now() });
      store["card_idx:ff000000000002"] = JSON.stringify({ uid: "ff000000000002", state: "active", updatedAt: Date.now() });

      const env = {
        UID_CONFIG: {
          get: async (key) => store[key] ?? null,
          put: async (key, val, opts) => { store[key] = { value: val, opts }; },
          delete: async (key) => { delete store[key]; },
          list: async ({ prefix, limit }) => {
            const keys = Object.keys(store).filter(k => k.startsWith(prefix)).slice(0, limit).map(k => ({ name: k }));
            return { keys, list_complete: true, cursor: null };
          },
        },
        CARD_REPLAY: {},
      };

      const getCardStateFn = async (_env, uid) => {
        if (uid === "ff000000000001") return { state: "active" };
        return { state: "active" };
      };

      const result = await repairCardIndex(env, getCardStateFn);
      expect(result.scanned).toBe(2);
      expect(result.repaired).toBe(1);
      expect(result.errors).toHaveLength(0);

      const repaired = JSON.parse(store["card_idx:ff000000000001"].value);
      expect(repaired.state).toBe("active");
    });

    it("returns zero repaired when all states match", async () => {
      const store = {};
      store["card_idx:ff000000000001"] = JSON.stringify({ uid: "ff000000000001", state: "active" });

      const env = {
        UID_CONFIG: {
          get: async (key) => store[key] ?? null,
          put: async (key, val) => { store[key] = val; },
          list: async ({ prefix }) => ({
            keys: Object.keys(store).filter(k => k.startsWith(prefix)).map(k => ({ name: k })),
            list_complete: true,
          }),
        },
        CARD_REPLAY: {},
      };

      const result = await repairCardIndex(env, async () => ({ state: "active" }));
      expect(result.scanned).toBe(1);
      expect(result.repaired).toBe(0);
    });

    it("handles empty index", async () => {
      const env = {
        UID_CONFIG: {
          get: async () => null,
          put: async () => {},
          list: async () => ({ keys: [], list_complete: true }),
        },
        CARD_REPLAY: {},
      };

      const result = await repairCardIndex(env, async () => ({ state: "active" }));
      expect(result.scanned).toBe(0);
      expect(result.repaired).toBe(0);
    });

    it("returns zeros when UID_CONFIG missing", async () => {
      const result = await repairCardIndex({}, async () => ({ state: "active" }));
      expect(result.scanned).toBe(0);
      expect(result.repaired).toBe(0);
    });

    it("returns zeros when CARD_REPLAY missing", async () => {
      const result = await repairCardIndex({ UID_CONFIG: {} }, async () => ({ state: "active" }));
      expect(result.scanned).toBe(0);
      expect(result.repaired).toBe(0);
    });

    it("collects errors from getCardState failures", async () => {
      const store = {};
      store["card_idx:ff000000000001"] = JSON.stringify({ uid: "ff000000000001", state: "active" });

      const env = {
        UID_CONFIG: {
          get: async (key) => store[key] ?? null,
          put: async (key, val) => { store[key] = val; },
          list: async ({ prefix }) => ({
            keys: Object.keys(store).filter(k => k.startsWith(prefix)).map(k => ({ name: k })),
            list_complete: true,
          }),
        },
        CARD_REPLAY: {},
      };

      const getCardStateFn = async () => { throw new Error("DO unavailable"); };
      const result = await repairCardIndex(env, getCardStateFn);
      expect(result.scanned).toBe(1);
      expect(result.repaired).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].uid).toBe("ff000000000001");
    });

    it("paginates through KV entries", async () => {
      const store = {};
      for (let i = 1; i <= 5; i++) {
        const uid = `ff00000000000${i}`;
        store[`card_idx:${uid}`] = JSON.stringify({ uid, state: "wipe_requested" });
      }

      let listCallCount = 0;
      const PAGE_SIZE = 2;
      const env = {
        UID_CONFIG: {
          get: async (key) => store[key] ?? null,
          put: async (key, val) => { store[key] = val; },
          list: async ({ prefix, limit, cursor }) => {
            listCallCount++;
            const allKeys = Object.keys(store).filter(k => k.startsWith(prefix)).sort();
            const effectiveLimit = Math.min(limit, PAGE_SIZE);
            const startIdx = cursor ? allKeys.indexOf(cursor) + 1 : 0;
            const batch = allKeys.slice(startIdx, startIdx + effectiveLimit);
            const isComplete = startIdx + effectiveLimit >= allKeys.length;
            return {
              keys: batch.map(k => ({ name: k })),
              list_complete: isComplete,
              cursor: isComplete ? null : batch[batch.length - 1],
            };
          },
        },
        CARD_REPLAY: {},
      };

      const result = await repairCardIndex(env, async () => ({ state: "active" }));
      expect(result.scanned).toBe(5);
      expect(result.repaired).toBe(5);
      expect(listCallCount).toBe(3);
    });

    it("preserves metadata when repairing", async () => {
      const store = {};
      store["card_idx:ff000000000001"] = JSON.stringify({
        uid: "ff000000000001",
        state: "wipe_requested",
        keyProvenance: "env_issuer",
        keyLabel: "prod-key",
        keyFingerprint: "abc123",
        paymentMethod: "fakewallet",
        balance: 5000,
        updatedAt: Date.now(),
      });

      const env = {
        UID_CONFIG: {
          get: async (key) => store[key] ?? null,
          put: async (key, val, opts) => { store[key] = { value: val, opts }; },
          list: async ({ prefix }) => ({
            keys: Object.keys(store).filter(k => k.startsWith(prefix)).map(k => ({ name: k })),
            list_complete: true,
          }),
        },
        CARD_REPLAY: {},
      };

      await repairCardIndex(env, async () => ({ state: "active" }));
      const repaired = JSON.parse(store["card_idx:ff000000000001"].value);
      expect(repaired.state).toBe("active");
      expect(repaired.keyProvenance).toBe("env_issuer");
      expect(repaired.keyLabel).toBe("prod-key");
      expect(repaired.keyFingerprint).toBe("abc123");
      expect(repaired.paymentMethod).toBe("fakewallet");
      expect(repaired.balance).toBe(5000);
    });
  });
});
