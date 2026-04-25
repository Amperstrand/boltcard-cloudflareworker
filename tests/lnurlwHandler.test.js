import { jest } from "@jest/globals";
import { handleLnurlw } from "../handlers/lnurlwHandler.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import aesjs from "aes-js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function virtualTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
  const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(k2Hex));
  const cHex = bytesToHex(vd.ct);
  return { pHex, cHex };
}

function buildEnv(paymentMethod = "fakewallet", extraConfig = {}) {
  const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
  const replay = makeReplayNamespace();
  replay.__activate(UID, 1);
  const config = {
    K2: keys.k2,
    payment_method: paymentMethod,
    ...extraConfig,
  };
  replay.__cardConfigs.set(UID, config);

  return {
    ISSUER_KEY,
    BOLT_CARD_K1: keys.k1,
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async () => null,
      put: async () => {},
    },
  };
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
});
