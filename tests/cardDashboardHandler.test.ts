import { handleCardPage, handleCardInfo, handleCardLock, handleCardReactivate } from "../handlers/cardDashboardHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const UID = "ff000000000001";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeTapRequest(uid: string, issuerKey: string, counter: number) {
  const keys = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as any, 1);
  const { pHex, cHex } = virtualTap(uid, counter, keys.k1, keys.k2);
  return new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
}

function setCardState(env: Env, uid: string, overrides: Record<string, unknown>) {
  const state = (env.CARD_REPLAY as any).__cardStates.get(uid);
  Object.assign(state, overrides);
}

describe("handleCardPage", () => {
  it("renders card dashboard HTML", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card");
    const res = await handleCardPage(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("MY CARD");
    expect(html).toContain("/static/js/card-dashboard.js");
  });

  it("includes NFC scanner, manual URL input, and refresh button", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card");
    const res = await handleCardPage(req, env);
    const html = await res.text();
    expect(html).toContain("/static/js/nfc.js");
    expect(html).toContain("btn-load-url");
    expect(html).toContain("btn-refresh");
    expect(html).toContain("btn-scan-again");
    expect(html).toContain("nfc-unsupported");
  });

  it("has accessibility attributes", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card");
    const res = await handleCardPage(req, env);
    const html = await res.text();
    expect(html).toContain("aria-live");
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("<main");
  });
});

describe("handleCardInfo", () => {
  describe("parameter validation", () => {
    it("returns error when p is missing", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      const req = new Request("https://test.local/card/info?c=ABCDEF");
      const res = await handleCardInfo(req, env);
      expect(res.status).toBe(400);
    });

    it("returns error when c is missing", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      const req = new Request("https://test.local/card/info?p=ABCDEF");
      const res = await handleCardInfo(req, env);
      expect(res.status).toBe(400);
    });

    it("returns sanitized error for invalid card data", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      const req = new Request("https://test.local/card/info?p=deadbeef&c=cafe");
      const res = await handleCardInfo(req, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, any>;
      expect(body.reason).toBe("Invalid card data");
      expect(body.reason).not.toContain("decrypt");
    });
  });

  describe("valid tap", () => {
    it("returns card info for valid tap with full response", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, { key_provenance: "public_issuer", key_label: "dev-01" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.uid).toBe(UID);
      expect(body.maskedUid).toBeDefined();
      expect(body.state).toBe("active");
      expect(body.balance).toBeDefined();
      expect(body.history).toBeDefined();
      expect(Array.isArray(body.history)).toBe(true);
      expect(body.analytics).toBeDefined();
      expect(body.programmingRecommended).toBe(true);
      expect(body.keyProvenance).toBe("public_issuer");
      expect(body.keyLabel).toBe("dev-01");
      expect(body.activeVersion).toBeDefined();
      expect(body.paymentMethod).toBe("fakewallet");
      expect(body.paymentMethodLabel).toBe("Internal Wallet");
      expect(body.firstSeenAt).toBeNull();
    });
  });

  describe("card states", () => {
    it("returns terminated state with reactivation info for valid CMAC", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, { state: "terminated", latest_issued_version: 3, active_version: 3 });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.state).toBe("terminated");
      expect(body.programmingRecommended).toBe(false);
      expect(body.history).toEqual([]);
      expect(body.analytics).toBeNull();
      expect(body.paymentMethod).toBeNull();
      expect(body.reactivationAvailable).toBe(true);
      expect(body.currentVersion).toBe(3);
      expect(body.terminatedAt).toBeDefined();
    });

    it("returns terminated state with reactivationAvailable=false for invalid CMAC", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, { state: "terminated", latest_issued_version: 1 });

      const keys = getDeterministicKeys(UID, { ISSUER_KEY } as any, 1);
      const { pHex } = virtualTap(UID, 1, keys.k1, keys.k2);
      const req = new Request(`https://test.local/card/info?p=${pHex}&c=00000000000000000000000000000000`);

      const res = await handleCardInfo(req, env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.state).toBe("terminated");
      expect(body.reactivationAvailable).toBe(false);
    });

    it("returns terminated balance from DO", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet", balance: 5000 });
      setCardState(env, UID, { state: "terminated", latest_issued_version: 1 });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.balance).toBe(5000);
    });

    it("returns info for discovered card", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, {
        state: "discovered",
        key_provenance: "public_issuer",
        active_version: 1,
        first_seen_at: 1700000000,
      });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.state).toBe("discovered");
      expect(body.firstSeenAt).toBe(1700000000);
    });

    it("returns info for wipe_requested card with CMAC validation", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, { state: "wipe_requested" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.state).toBe("wipe_requested");
    });

    it("returns partial info for card with no config/K2 (new state)", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "new" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.state).toBe("new");
      expect(body.programmingRecommended).toBe(false);
      expect(body.balance).toBe(0);
      expect(body.history).toEqual([]);
    });

    it("returns partial info for keys_delivered card with no K2 in config", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "keys_delivered" });
      (env.CARD_REPLAY as any).__cardConfigs.delete(UID);

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.state).toBe("keys_delivered");
      expect(body.balance).toBe(0);
    });
  });

  describe("CMAC validation", () => {
    it("returns 403 for invalid CMAC", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      const keys = getDeterministicKeys(UID, { ISSUER_KEY } as any, 1);
      const { pHex } = virtualTap(UID, 1, keys.k1, keys.k2);

      const req = new Request(`https://test.local/card/info?p=${pHex}&c=00000000000000000000000000000000`);
      const res = await handleCardInfo(req, env);
      expect(res.status).toBe(403);
    });

    it("accepts terminated card regardless of CMAC", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "active" });
      setCardState(env, UID, { state: "terminated" });

      const req = new Request(`https://test.local/card/info?p=deadbeef&c=badcmac`);
      const res = await handleCardInfo(req, env);
      expect(res.status).toBe(400);
    });
  });

  describe("provenance", () => {
    it("shows programmingRecommended for public_issuer provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      setCardState(env, UID, { key_provenance: "public_issuer" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      const body = (await res.json()) as Record<string, any>;
      expect(body.programmingRecommended).toBe(true);
    });

    it("does not recommend programming for env_issuer provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
      setCardState(env, UID, { key_provenance: "env_issuer" });

      const res = await handleCardInfo(makeTapRequest(UID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1), env);
      const body = (await res.json()) as Record<string, any>;
      expect(body.programmingRecommended).toBe(false);
    });

    it("does not recommend programming for unknown provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      setCardState(env, UID, { key_provenance: "unknown" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      const body = (await res.json()) as Record<string, any>;
      expect(body.programmingRecommended).toBe(false);
    });

    it("does not recommend programming for user_provisioned provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      setCardState(env, UID, { key_provenance: "user_provisioned" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      const body = (await res.json()) as Record<string, any>;
      expect(body.programmingRecommended).toBe(false);
    });
  });

  describe("graceful degradation", () => {
    function interceptDo(env: Env, uid: string, pathToBlock: string) {
      const originalGet = (env.CARD_REPLAY as any).get.bind(env.CARD_REPLAY);
      (env.CARD_REPLAY as any).get = (id: string) => {
        const stub = originalGet(id);
        const origFetch = stub.fetch.bind(stub);
        return {
          fetch: async (req: Request) => {
            const url = new URL(req.url);
            if (String(id).toLowerCase() === uid && url.pathname === pathToBlock) {
              return new Response("Internal error", { status: 500 });
            }
            return origFetch(req);
          },
        };
      };
    }

    it("returns balance 0 when getBalance fails", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet", balance: 5000 });
      (env.CARD_REPLAY as any).__cardStates.get(UID).key_provenance = "env_issuer";
      interceptDo(env, UID, "/balance");

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.balance).toBe(0);
    });

    it("returns empty history when listTaps fails", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      (env.CARD_REPLAY as any).__cardStates.get(UID).key_provenance = "env_issuer";
      interceptDo(env, UID, "/list-taps");

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, any>;
      expect(body.history).toEqual([]);
    });

    it("returns 503 when card state DO is unreachable", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      env.CARD_REPLAY = {
        idFromName: () => "test" as any,
        get: () => ({
          fetch: async () => new Response("unavailable", { status: 503 }),
        }),
      } as any;

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(503);

      const body = (await res.json()) as Record<string, any>;
      expect(body.reason).toBe("Card state unavailable");
    });
  });
});

describe("handleCardLock", () => {
  function makeLockRequest(uid: string, issuerKey: string, counter: number) {
    const keys = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as any, 1);
    const { pHex, cHex } = virtualTap(uid, counter, keys.k1, keys.k2);
    return new Request("https://test.local/api/card/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex }),
    });
  }

  it("locks an active card", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    const res = await handleCardLock(makeLockRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body.success).toBe(true);
    expect(body.state).toBe("terminated");

    const state = (env.CARD_REPLAY as any).__cardStates.get(UID);
    expect(state.state).toBe("terminated");
  });

  it("locks a discovered card", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    setCardState(env, UID, { state: "discovered" });

    const res = await handleCardLock(makeLockRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body.success).toBe(true);
  });

  it("rejects GET request", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/lock", { method: "GET" });
    const res = await handleCardLock(req, env);
    expect(res.status).toBe(405);
  });

  it("rejects missing body", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await handleCardLock(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleCardLock(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects already terminated card", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    setCardState(env, UID, { state: "terminated" });

    const res = await handleCardLock(makeLockRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, any>;
    expect(body.reason).toBe("Card is already locked");
  });

  it("rejects pending card", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    setCardState(env, UID, { state: "pending" });

    const res = await handleCardLock(makeLockRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, any>;
    expect(body.reason).toContain("pending");
  });

  it("rejects invalid CMAC", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY } as any, 1);
    const { pHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request("https://test.local/api/card/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: "00000000000000000000000000000000" }),
    });
    const res = await handleCardLock(req, env);
    expect(res.status).toBe(403);
  });

  it("rejects invalid card data", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: "deadbeef", c: "cafe" }),
    });
    const res = await handleCardLock(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 500 when DO terminate fails", async () => {
     const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    const originalGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    (env.CARD_REPLAY as any).get = (id: string) => {
      const stub = originalGet(id);
      const origFetch = stub.fetch.bind(stub);
      return {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (String(id).toLowerCase() === UID && url.pathname === "/terminate") {
            return new Response("Internal error", { status: 500 });
          }
          return origFetch(req);
        },
      };
    };

    const res = await handleCardLock(makeLockRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(500);
  });
});

describe("handleCardReactivate", () => {
  function makeReactivateRequest(uid: string, issuerKey: string, counter: number) {
    const keys = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as any, 1);
    const { pHex, cHex } = virtualTap(uid, counter, keys.k1, keys.k2);
    return new Request("https://test.local/api/card/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex }),
    });
  }

  it("re-provisions a terminated card with version advance", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    setCardState(env, UID, { state: "terminated", latest_issued_version: 3, active_version: 3 });

    const res = await handleCardReactivate(makeReactivateRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body.success).toBe(true);
    expect(body.state).toBe("keys_delivered");
    expect(body.uid).toBe(UID);
    expect(body.version).toBe(4);

    const state = (env.CARD_REPLAY as any).__cardStates.get(UID);
    expect(state.state).toBe("keys_delivered");
    expect(state.latest_issued_version).toBe(4);
  });

  it("preserves balance across re-provisioning", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet", balance: 5000 });
    setCardState(env, UID, { state: "terminated", latest_issued_version: 1 });

    const res = await handleCardReactivate(makeReactivateRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(200);

    const state2 = (env.CARD_REPLAY as any).__cardStates.get(UID);
    expect(state2.balance).toBe(5000);
  });

  it("rejects GET request", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/reactivate", { method: "GET" });
    const res = await handleCardReactivate(req, env);
    expect(res.status).toBe(405);
  });

  it("rejects missing body", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await handleCardReactivate(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects non-terminated card", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });

    const res = await handleCardReactivate(makeReactivateRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, any>;
    expect(body.reason).toContain("not terminated");
  });

  it("rejects invalid CMAC", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    setCardState(env, UID, { state: "terminated", latest_issued_version: 1 });

    const keys = getDeterministicKeys(UID, { ISSUER_KEY } as any, 1);
    const { pHex } = virtualTap(UID, 1, keys.k1, keys.k2);
    const req = new Request("https://test.local/api/card/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: "00000000000000000000000000000000" }),
    });
    const res = await handleCardReactivate(req, env);
    expect(res.status).toBe(403);
  });

  it("rejects invalid card data", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/api/card/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: "deadbeef", c: "cafe" }),
    });
    const res = await handleCardReactivate(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 500 when deliverKeys fails", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    setCardState(env, UID, { state: "terminated", latest_issued_version: 1 });
     const originalGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    (env.CARD_REPLAY as any).get = (id: string) => {
      const stub = originalGet(id);
      const origFetch = stub.fetch.bind(stub);
      return {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (String(id).toLowerCase() === UID && url.pathname === "/deliver-keys") {
            return new Response("Internal error", { status: 500 });
          }
          return origFetch(req);
        },
      };
    };

    const res = await handleCardReactivate(makeReactivateRequest(UID, ISSUER_KEY, 1), env);
    expect(res.status).toBe(500);
  });
});