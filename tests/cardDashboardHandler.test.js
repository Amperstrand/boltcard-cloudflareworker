import { handleCardPage, handleCardInfo } from "../handlers/cardDashboardHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";

const UID = "ff000000000001";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeTapRequest(uid, issuerKey, counter) {
  const keys = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey }, 1);
  const { pHex, cHex } = virtualTap(uid, counter, keys.k1, keys.k2);
  return new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
}

function setCardState(env, uid, overrides) {
  const state = env.CARD_REPLAY.__cardStates.get(uid);
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
    expect(html).toContain("/card/info");
  });

  it("includes NFC scanner, manual URL input, and refresh button", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card");
    const res = await handleCardPage(req, env);
    const html = await res.text();
    expect(html).toContain("createNfcScanner");
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
      const body = await res.json();
      expect(body.reason).toBe("Invalid card data");
      expect(body.reason).not.toContain("decrypt");
    });
  });

  describe("valid tap", () => {
    it("returns card info for valid tap with full response", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, { key_provenance: "public_issuer", key_label: "dev-01", key_fingerprint: "abc123" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.uid).toBe(UID);
      expect(body.maskedUid).toBeDefined();
      expect(body.state).toBe("active");
      expect(body.balance).toBeDefined();
      expect(body.recentTaps).toBeDefined();
      expect(body.programmingRecommended).toBe(true);
      expect(body.keyProvenance).toBe("public_issuer");
      expect(body.keyLabel).toBe("dev-01");
      expect(body.keyFingerprint).toBe("abc123");
      expect(body.activeVersion).toBeDefined();
      expect(body.firstSeenAt).toBeNull();
    });
  });

  describe("card states", () => {
    it("returns terminated state without CMAC check", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "active" });
      setCardState(env, UID, { state: "terminated", key_provenance: null });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.state).toBe("terminated");
      expect(body.programmingRecommended).toBe(false);
      expect(body.balance).toBe(0);
      expect(body.recentTaps).toEqual([]);
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

      const body = await res.json();
      expect(body.state).toBe("discovered");
      expect(body.firstSeenAt).toBe(1700000000);
    });

    it("returns info for wipe_requested card with CMAC validation", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      setCardState(env, UID, { state: "wipe_requested" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.state).toBe("wipe_requested");
    });

    it("returns partial info for card with no config/K2 (new state)", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "new" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.state).toBe("new");
      expect(body.programmingRecommended).toBe(false);
      expect(body.balance).toBe(0);
      expect(body.recentTaps).toEqual([]);
    });

    it("returns partial info for keys_delivered card with no K2 in config", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "keys_delivered" });
      env.CARD_REPLAY.__cardConfigs.delete(UID);

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.state).toBe("keys_delivered");
      expect(body.balance).toBe(0);
    });
  });

  describe("CMAC validation", () => {
    it("returns 403 for invalid CMAC", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
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
      const body = await res.json();
      expect(body.programmingRecommended).toBe(true);
    });

    it("does not recommend programming for env_issuer provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
      setCardState(env, UID, { key_provenance: "env_issuer" });

      const res = await handleCardInfo(makeTapRequest(UID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1), env);
      const body = await res.json();
      expect(body.programmingRecommended).toBe(false);
    });

    it("does not recommend programming for unknown provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      setCardState(env, UID, { key_provenance: "unknown" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      const body = await res.json();
      expect(body.programmingRecommended).toBe(false);
    });

    it("does not recommend programming for user_provisioned provenance", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      setCardState(env, UID, { key_provenance: "user_provisioned" });

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      const body = await res.json();
      expect(body.programmingRecommended).toBe(false);
    });
  });

  describe("graceful degradation", () => {
    it("returns balance 0 when getBalance fails", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      env.CARD_REPLAY.__cardStates.get(UID).key_provenance = "env_issuer";

      const originalFetch = env.CARD_REPLAY.get(env.CARD_REPLAY.idFromName(UID)).fetch;
      env.CARD_REPLAY.get(env.CARD_REPLAY.idFromName(UID)).fetch = async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/balance") {
          return new Response("Internal error", { status: 500 });
        }
        return originalFetch(req);
      };

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.balance).toBe(0);
    });

    it("returns empty taps when listTaps fails", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
      env.CARD_REPLAY.__cardStates.get(UID).key_provenance = "env_issuer";

      const originalFetch = env.CARD_REPLAY.get(env.CARD_REPLAY.idFromName(UID)).fetch;
      env.CARD_REPLAY.get(env.CARD_REPLAY.idFromName(UID)).fetch = async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/list-taps") {
          return new Response("Internal error", { status: 500 });
        }
        return originalFetch(req);
      };

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.recentTaps).toEqual([]);
    });

    it("returns 500 when card state DO is unreachable", async () => {
      const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
      env.CARD_REPLAY = {
        idFromName: () => "test",
        get: () => ({
          fetch: async () => new Response("unavailable", { status: 503 }),
        }),
      };

      const res = await handleCardInfo(makeTapRequest(UID, ISSUER_KEY, 1), env);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.reason).toBe("Card state unavailable");
    });
  });
});
