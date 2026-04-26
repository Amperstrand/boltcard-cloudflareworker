import { jest } from "@jest/globals";
import { handleLnurlw } from "../handlers/lnurlwHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv(paymentMethod = "fakewallet", extraConfig = {}) {
  return buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod, cardConfig: { payment_method: paymentMethod, ...extraConfig } });
}

function tapRequest(uid, counter, k1, k2, baseUrl = "https://test.local") {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  return new Request(`${baseUrl}/?p=${pHex}&c=${cHex}`);
}

describe("handleLnurlw", () => {
  it("returns error when p is missing", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/?c=ABCDEF0123456789");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("p and c");
  });

  it("returns error when c is missing", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/?p=4E2E289D945A66BB13377A728884E867");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
  });

  it("returns error for invalid p (decryption failure)", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/?p=0000000000&c=ABCDEF0123456789");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
  });

  it("returns fakewallet withdraw response for valid tap", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
    expect(body.callback).toContain("/boltcards/api/v1/lnurl/cb/");
    expect(body.k1).toBeDefined();
    expect(body.minWithdrawable).toBe(1);
    expect(body.maxWithdrawable).toBe(1000000);
    expect(body.defaultDescription).toContain("Boltcard payment");
  });

  it("returns clnrest withdraw response for valid tap", async () => {
    const env = buildEnv("clnrest", {
      clnrest: {
        protocol: "https",
        host: "https://cln.example.com",
        port: 3001,
        rune: "test",
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
    expect(body.minWithdrawable).toBe(1000);
    expect(body.maxWithdrawable).toBe(1000);
  });

  it("rejects replay with same counter", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req1 = tapRequest(UID, 3, keys.k1, keys.k2);
    const res1 = await handleLnurlw(req1, env);
    expect(res1.status).toBe(200);

    const req2 = tapRequest(UID, 3, keys.k1, keys.k2);
    const res2 = await handleLnurlw(req2, env);
    expect(res2.status).toBe(400);
    const body = await res2.json();
    expect(body.reason).toContain("replay");
  });

  it("rejects replay with lower counter", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req1 = tapRequest(UID, 5, keys.k1, keys.k2);
    const res1 = await handleLnurlw(req1, env);
    expect(res1.status).toBe(200);

    const req2 = tapRequest(UID, 3, keys.k1, keys.k2);
    const res2 = await handleLnurlw(req2, env);
    expect(res2.status).toBe(400);
  });

  it("rejects terminated card", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "terminated";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toContain("terminated");
  });

  it("rejects invalid CMAC", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/?p=${pHex}&c=DEADBEEFDEADBEEF`);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("CMAC");
  });

  it("returns error for unsupported payment method", async () => {
    const env = buildEnv("unknown_method");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("Unsupported payment method");
  });

  it("handles legacy new state cards with version 1", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "new";
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
  });

  it("accepts sequential taps with increasing counter", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);

    for (let counter = 2; counter <= 5; counter++) {
      const req = tapRequest(UID, counter, keys.k1, keys.k2);
      const res = await handleLnurlw(req, env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tag).toBe("withdrawRequest");
    }
  });

  it("returns lnurlpay pay request for lnurlpay payment method", async () => {
    const env = buildEnv("lnurlpay", {
      lightning_address: "test@example.com",
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("payRequest");
  });

  it("auto-activates keys_delivered card and returns withdraw response", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    env.CARD_REPLAY.__cardStates.get(UID).latest_issued_version = 1;
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
    expect(env.CARD_REPLAY.__cardStates.get(UID).state).toBe("active");
  });

  it("rejects keys_delivered card with version mismatch", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    env.CARD_REPLAY.__cardStates.get(UID).latest_issued_version = 20;
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    const keysV1 = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keysV1.k1, keysV1.k2);
    const req = new Request(`https://test.local/?p=${pHex}&c=DEADBEEFDEADBEEF`);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toContain("Version mismatch");
  });

  it("proxies to downstream backend in proxy mode", async () => {
    const env = buildEnv("proxy", {
      proxy: { baseurl: "https://backend.example.com/tap" },
    });
    delete env.CARD_REPLAY.__cardConfigs.get(UID).K2;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), { status: 200 })
    );

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    globalThis.fetch = originalFetch;
  });

  it("proxy mode with K2 validates CMAC locally and proxies", async () => {
    const env = buildEnv("proxy", {
      proxy: { baseurl: "https://backend.example.com/tap" },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), { status: 200 })
    );

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const badC = "DEADBEEFDEADBEEF";
    const req = new Request(`https://test.local/?p=${pHex}&c=${badC}`);
    const res = await handleLnurlw(req, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("CMAC");
    globalThis.fetch = originalFetch;
  });

  it("proxy mode validates CMAC locally when K2 present", async () => {
    const env = buildEnv("proxy", {
      proxy: { baseurl: "https://backend.example.com/tap" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), { status: 200 })
    );

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    await handleLnurlw(req, env);

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    expect(proxiedReq.headers.get("X-BoltCard-CMAC-Validated")).toBe("true");
    expect(proxiedReq.headers.get("X-BoltCard-CMAC-Deferred")).toBe("false");
    globalThis.fetch = originalFetch;
  });

  it("resolves config from deterministic keys when DO config has no K2", async () => {
    const env = buildEnv("fakewallet");
    delete env.CARD_REPLAY.__cardConfigs.get(UID).K2;
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
  });

  it("handles active card with active_version set", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).active_version = 1;
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
  });

  it("clnrest returns withdraw with fixed 1000 msat amounts", async () => {
    const env = buildEnv("clnrest", {
      clnrest: {
        protocol: "https",
        host: "https://cln.example.com",
        port: 3001,
        rune: "test",
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.minWithdrawable).toBe(1000);
    expect(body.maxWithdrawable).toBe(1000);
  });

  it("proxy mode rejects replayed counter", async () => {
    const env = buildEnv("proxy", {
      proxy: { baseurl: "https://backend.example.com/tap" },
    });
    delete env.CARD_REPLAY.__cardConfigs.get(UID).K2;
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req1 = tapRequest(UID, 2, keys.k1, keys.k2);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), { status: 200 })
    );
    const res1 = await handleLnurlw(req1, env);
    expect(res1.status).toBe(200);
    globalThis.fetch = originalFetch;

    const req2 = tapRequest(UID, 2, keys.k1, keys.k2);
    const res2 = await handleLnurlw(req2, env);
    expect(res2.status).toBe(400);
    const body = await res2.json();
    expect(body.reason).toMatch(/replay/i);
  });

  it("lnurlpay card does not advance counter on initial tap", async () => {
    const env = buildEnv("lnurlpay", {
      lnurlpay: {
        lightning_address: "test@example.com",
        min_sendable: 1000,
        max_sendable: 1000,
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    await handleLnurlw(req, env);
    expect(env.CARD_REPLAY.__counters.has(UID)).toBe(false);
  });

  it("returns error when p decrypts but uid is undefined", async () => {
    const env = buildEnv("fakewallet");
    const req = new Request("https://test.local/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 503 when card state check throws", async () => {
    const env = buildEnv("fakewallet");
    const origGet = env.CARD_REPLAY.get;
    env.CARD_REPLAY.get = () => ({
      fetch: async () => Response.json({ error: "broken" }, { status: 500 }),
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(503);
  });

  it("returns 500 when replay check throws for clnrest", async () => {
    const env = buildEnv("clnrest", {
      clnrest: {
        protocol: "https",
        host: "https://cln.example.com",
        port: 3001,
        rune: "test",
      },
    });
    const origGet = env.CARD_REPLAY.get;
    let callCount = 0;
    env.CARD_REPLAY.get = (id) => ({
      fetch: async (req) => {
        callCount++;
        const url = new URL(req.url);
        if (url.pathname === "/check") {
          return Response.json({ reason: "DO unavailable" }, { status: 500 });
        }
        const stub = origGet(id);
        return stub.fetch(req);
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(500);
  });

  it("returns 500 when replay check throws for proxy", async () => {
    const env = buildEnv("proxy", {
      proxy: { baseurl: "https://backend.example.com/tap" },
    });
    delete env.CARD_REPLAY.__cardConfigs.get(UID).K2;
    const origGet = env.CARD_REPLAY.get;
    env.CARD_REPLAY.get = () => ({
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/check") {
          return Response.json({ reason: "DO down" }, { status: 500 });
        }
        const stub = origGet(UID);
        return stub.fetch(req);
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(500);
  });

  it("returns 500 when card activation fails for keys_delivered card", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    env.CARD_REPLAY.__cardStates.get(UID).latest_issued_version = 1;
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => {
      const obj = origGet(id);
      return {
        fetch: async (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/activate") {
            return Response.json({ ok: false, error: "DO error" }, { status: 500 });
          }
          return obj.fetch(request);
        },
      };
    };
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(500);
  });

  describe("auto-discovery for unknown cards", () => {
    it("discovers unknown card with public issuer key on first tap", async () => {
      const discoveryUid = "ff000000000001";
      const env = buildCardTestEnv({
        uid: discoveryUid,
        issuerKey: ISSUER_KEY,
        paymentMethod: "fakewallet",
        cardState: "new",
        cardConfig: null,
      });

      const keys = getDeterministicKeys(discoveryUid, { ISSUER_KEY }, 1);
      const req = tapRequest(discoveryUid, 1, keys.k1, keys.k2);

      const res = await handleLnurlw(req, env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tag).toBe("withdrawRequest");

      const cardState = env.CARD_REPLAY.__cardStates.get(discoveryUid);
      expect(cardState).toBeDefined();
      expect(cardState.state).toBe("discovered");
      expect(cardState.key_provenance).toBe("public_issuer");
      expect(cardState.active_version).toBe(1);
    });

    it("discovers unknown card even without prior DO row", async () => {
      const discoveryUid = "ff000000000002";
      const replay = makeReplayNamespace({}, {});
      const keys = getDeterministicKeys(discoveryUid, { ISSUER_KEY }, 1);

      const env = {
        ISSUER_KEY,
        BOLT_CARD_K1: keys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 1, keys.k1, keys.k2);
      const res = await handleLnurlw(req, env);

      expect(res.status).toBe(200);
      const cardState = replay.__cardStates.get(discoveryUid);
      expect(cardState).toBeDefined();
      expect(cardState.state).toBe("discovered");
      expect(cardState.key_provenance).toBe("public_issuer");
    });

    it("handles discovered card on subsequent tap without re-discovery", async () => {
      const discoveryUid = "ff000000000003";
      const keys = getDeterministicKeys(discoveryUid, { ISSUER_KEY }, 1);
      const replay = makeReplayNamespace({}, {});

      replay.__cardStates.set(discoveryUid, {
        state: "discovered",
        latest_issued_version: 1,
        active_version: 1,
        activated_at: null,
        terminated_at: null,
        keys_delivered_at: null,
        wipe_keys_fetched_at: null,
        balance: 0,
        key_provenance: "public_issuer",
        key_fingerprint: null,
        key_label: "dev-01",
        first_seen_at: Math.floor(Date.now() / 1000),
      });
      replay.__cardConfigs.set(discoveryUid, { payment_method: "fakewallet", K2: keys.k2 });

      const env = {
        ISSUER_KEY,
        BOLT_CARD_K1: keys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 2, keys.k1, keys.k2);

      const res = await handleLnurlw(req, env);
      expect(res.status).toBe(200);
    });

    it("upgrades pending card to discovered on tap", async () => {
      const discoveryUid = "ff000000000004";
      const env = buildCardTestEnv({
        uid: discoveryUid,
        issuerKey: ISSUER_KEY,
        paymentMethod: "fakewallet",
        cardState: "new",
        cardConfig: null,
      });

      env.CARD_REPLAY.__cardStates.set(discoveryUid, {
        state: "pending",
        latest_issued_version: 0,
        active_version: null,
        activated_at: null,
        terminated_at: null,
        keys_delivered_at: null,
        wipe_keys_fetched_at: null,
        balance: 0,
        key_provenance: null,
        key_fingerprint: null,
        key_label: null,
        first_seen_at: Math.floor(Date.now() / 1000),
      });

      const keys = getDeterministicKeys(discoveryUid, { ISSUER_KEY }, 1);
      const req = tapRequest(discoveryUid, 1, keys.k1, keys.k2);

      const res = await handleLnurlw(req, env);
      expect(res.status).toBe(200);

      const cardState = env.CARD_REPLAY.__cardStates.get(discoveryUid);
      expect(cardState.state).toBe("discovered");
      expect(cardState.active_version).toBe(1);
    });

    it("discovers card with env_issuer provenance (non-public key)", async () => {
      const discoveryUid = "ff000000000005";
      const nonPublicKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const replay = makeReplayNamespace({}, {});
      const keys = getDeterministicKeys(discoveryUid, { ISSUER_KEY: nonPublicKey }, 1);

      const env = {
        ISSUER_KEY: nonPublicKey,
        BOLT_CARD_K1: keys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 1, keys.k1, keys.k2);
      const res = await handleLnurlw(req, env);

      expect(res.status).toBe(200);
      const cardState = replay.__cardStates.get(discoveryUid);
      expect(cardState.state).toBe("discovered");
      expect(cardState.key_provenance).toBe("env_issuer");
    });

    it("discovers card via RECOVERY_ISSUER_KEYS (second candidate)", async () => {
      const discoveryUid = "ff000000000006";
      const recoveryKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const recoveryKeys = getDeterministicKeys(discoveryUid, { ISSUER_KEY: recoveryKey }, 1);
      const replay = makeReplayNamespace({}, {});

      const env = {
        ISSUER_KEY: "cccccccccccccccccccccccccccccccc",
        RECOVERY_ISSUER_KEYS: recoveryKey,
        BOLT_CARD_K1: recoveryKeys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 1, recoveryKeys.k1, recoveryKeys.k2);
      const res = await handleLnurlw(req, env);

      expect(res.status).toBe(200);
      const cardState = replay.__cardStates.get(discoveryUid);
      expect(cardState).toBeDefined();
      expect(cardState.state).toBe("discovered");
      expect(cardState.key_provenance).toBe("unknown");
    });

    it("returns 403 when pending card has no matching key candidate", async () => {
      const discoveryUid = "ff000000000007";
      const wrongKey = "dddddddddddddddddddddddddddddddd";
      const wrongKeys = getDeterministicKeys(discoveryUid, { ISSUER_KEY: wrongKey }, 1);
      const replay = makeReplayNamespace({}, {});

      replay.__cardStates.set(discoveryUid, {
        state: "pending",
        latest_issued_version: 0,
        active_version: null,
        activated_at: null,
        terminated_at: null,
        keys_delivered_at: null,
        wipe_keys_fetched_at: null,
        balance: 0,
        key_provenance: null,
        key_fingerprint: null,
        key_label: null,
        first_seen_at: Math.floor(Date.now() / 1000),
      });

      const env = {
        ISSUER_KEY: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        BOLT_CARD_K1: wrongKeys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 1, wrongKeys.k1, wrongKeys.k2);
      const res = await handleLnurlw(req, env);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.reason).toContain("Unable to identify card key");
    });

    it("returns error for new card with no matching key (CMAC fails)", async () => {
      const discoveryUid = "ff000000000008";
      const unknownKey = "ffffffffffffffffffffffffffffffff";
      const unknownKeys = getDeterministicKeys(discoveryUid, { ISSUER_KEY: unknownKey }, 1);
      const replay = makeReplayNamespace({}, {});

      const env = {
        ISSUER_KEY: "11111111111111111111111111111111",
        BOLT_CARD_K1: unknownKeys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 1, unknownKeys.k1, unknownKeys.k2);
      const res = await handleLnurlw(req, env);

      expect(res.status).toBe(400);
    });

    it("discovers legacy card on first tap", async () => {
      const discoveryUid = "ff000000000009";
      const replay = makeReplayNamespace({}, {});
      const keys = getDeterministicKeys(discoveryUid, { ISSUER_KEY }, 1);

      replay.__cardStates.set(discoveryUid, {
        state: "legacy",
        latest_issued_version: 0,
        active_version: null,
        activated_at: null,
        terminated_at: null,
        keys_delivered_at: null,
        wipe_keys_fetched_at: null,
        balance: 0,
        key_provenance: null,
        key_fingerprint: null,
        key_label: null,
        first_seen_at: null,
      });

      const env = {
        ISSUER_KEY,
        BOLT_CARD_K1: keys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req = tapRequest(discoveryUid, 1, keys.k1, keys.k2);
      const res = await handleLnurlw(req, env);

      expect(res.status).toBe(200);
    });

    it("persists K2 during discovery for subsequent taps", async () => {
      const discoveryUid = "ff000000000010";
      const recoveryKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const mainKey = "cccccccccccccccccccccccccccccccc";
      const recoveryKeys = getDeterministicKeys(discoveryUid, { ISSUER_KEY: recoveryKey }, 1);
      const replay = makeReplayNamespace({}, {});

      const env = {
        ISSUER_KEY: mainKey,
        RECOVERY_ISSUER_KEYS: recoveryKey,
        BOLT_CARD_K1: recoveryKeys.k1,
        CARD_REPLAY: replay,
        UID_CONFIG: { get: async () => null, put: async () => {} },
      };

      const req1 = tapRequest(discoveryUid, 1, recoveryKeys.k1, recoveryKeys.k2);
      const res1 = await handleLnurlw(req1, env);
      expect(res1.status).toBe(200);

      const cardState = replay.__cardStates.get(discoveryUid);
      expect(cardState.state).toBe("discovered");

      const cardConfig = replay.__cardConfigs.get(discoveryUid);
      expect(cardConfig).toBeDefined();
      expect(cardConfig.K2).toBe(recoveryKeys.k2);

      const req2 = tapRequest(discoveryUid, 2, recoveryKeys.k1, recoveryKeys.k2);
      const res2 = await handleLnurlw(req2, env);
      expect(res2.status).toBe(200);
      const body = await res2.json();
      expect(body.tag).toBe("withdrawRequest");
    });
  });
});
