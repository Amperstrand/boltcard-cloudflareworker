import { jest } from "@jest/globals";
import { handleLnurlpPayment } from "../handlers/lnurlHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv(balance = 0) {
  return buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, balance });
}

function callbackUrl(pHex, cHex, params = {}) {
  const url = new URL(`https://test.local/boltcards/api/v1/lnurl/cb/${pHex}`);
  url.searchParams.set("k1", cHex);
  if (params.pr) url.searchParams.set("pr", params.pr);
  if (params.amount) url.searchParams.set("amount", String(params.amount));
  return url.toString();
}

describe("handleLnurlpPayment", () => {
  it("rejects POST method with 405", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/boltcards/api/v1/lnurl/cb/test", {
      method: "POST",
    });
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(405);
  });

  it("rejects missing k1 parameter", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/boltcards/api/v1/lnurl/cb/${pHex}`);
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("k1");
  });

  it("rejects missing pr and amount", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("pr");
  });

  it("rejects invalid p (decryption failure)", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/boltcards/api/v1/lnurl/cb/0000000000?k1=ABCDEF0123456789&pr=lnbc10n1test");
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects invalid CMAC", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, "DEADBEEFDEADBEEF", { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("CMAC");
  });

  it("processes fakewallet payment with pr", async () => {
    const env = buildEnv(10000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("OK");
    expect(body.balance).toBeLessThan(10000);
  });

  it("processes fakewallet payment with explicit amount", async () => {
    const env = buildEnv(10000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { amount: 1000 }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("OK");
    expect(body.balance).toBe(9000);
  });

  it("rejects replay with same counter and bolt11", async () => {
    const env = buildEnv(10000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const url = callbackUrl(pHex, cHex, { pr: "lnbc10n1test" });
    const res1 = await handleLnurlpPayment(new Request(url), env);
    expect(res1.status).toBe(200);

    const res2 = await handleLnurlpPayment(new Request(url), env);
    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.reason).toContain("replay");
  });

  it("accepts k1 with embedded p and c", async () => {
    const env = buildEnv(10000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 5, keys.k1, keys.k2);
    const k1 = `p=${pHex}&c=${cHex}`;
    const url = `https://test.local/boltcards/api/v1/lnurl/cb?k1=${encodeURIComponent(k1)}&amount=500`;
    const req = new Request(url);
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("OK");
  });

  it("handles clnrest payment method", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "clnrest",
      clnrest: {
        protocol: "https",
        host: "https://cln.example.com",
        port: 3001,
        rune: "test-rune",
      },
    });

    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "complete" }), { status: 201 })
    );

    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("OK");
    expect(globalThis.fetch).toHaveBeenCalled();
    globalThis.fetch.mockRestore();
  });

  it("handles clnrest error response", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "clnrest",
      clnrest: {
        host: "https://cln.example.com",
        rune: "test-rune",
      },
    });

    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "insufficient balance" }), { status: 500 })
    );

    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(500);
    globalThis.fetch.mockRestore();
  });

  it("handles clnrest network error", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "clnrest",
      clnrest: {
        host: "https://cln.example.com",
        rune: "test-rune",
      },
    });

    globalThis.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(500);
    globalThis.fetch.mockRestore();
  });

  it("handles missing clnrest config", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "clnrest",
    });

    const { pHex, cHex } = virtualTap(UID, 5, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("CLN REST");
  });

  it("rejects unsupported payment method in withdrawal", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "unknown",
    });

    const { pHex, cHex } = virtualTap(UID, 6, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("Unsupported");
  });

  it("marks tap completed on success", async () => {
    const env = buildEnv(10000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 7, keys.k1, keys.k2);
    await handleLnurlpPayment(new Request(callbackUrl(pHex, cHex, { amount: 500 })), env);

    const tap = env.CARD_REPLAY.__taps.get(`${UID}:7`);
    expect(tap).toBeDefined();
    expect(tap.status).toBe("completed");
  });

  it("marks tap failed on payment error", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "unknown_method",
    });

    const { pHex, cHex } = virtualTap(UID, 8, keys.k1, keys.k2);
    await handleLnurlpPayment(new Request(callbackUrl(pHex, cHex, { amount: 500 })), env);

    const tap = env.CARD_REPLAY.__taps.get(`${UID}:8`);
    expect(tap).toBeDefined();
    expect(tap.status).toBe("failed");
  });

  it("rejects k1 with invalid format (missing p and c)", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/boltcards/api/v1/lnurl/cb?k1=invaliddata&pr=lnbc10n1test");
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("Invalid k1");
  });

  it("handles CLN 201 with non-complete status (pending)", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, {
      K2: keys.k2,
      payment_method: "clnrest",
      clnrest: { host: "https://cln.example.com", rune: "test-rune" },
    });

    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "pending" }), { status: 201 })
    );

    const { pHex, cHex } = virtualTap(UID, 9, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { pr: "lnbc10n1test" }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.reason).toContain("not completed");
    globalThis.fetch.mockRestore();
  });

  it("handles outer catch error", async () => {
    const env = buildEnv();
    const brokenEnv = new Proxy(env, {
      get(target, prop) {
        if (prop === "BOLT_CARD_K1") throw new Error("env broken");
        return Reflect.get(target, prop);
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 10, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { amount: 500 }));
    const res = await handleLnurlpPayment(req, brokenEnv);
    expect(res.status).toBe(500);
  });

  it("processes two-step callback: read then callback upgrade", async () => {
    const env = buildEnv(10000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);

    const counter = 11;
    const { pHex, cHex } = virtualTap(UID, counter, keys.k1, keys.k2);

    const stub = env.CARD_REPLAY.get(env.CARD_REPLAY.idFromName(UID));
    await stub.fetch(new Request("https://card-replay.internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue: counter }),
    }));

    const req = new Request(callbackUrl(pHex, cHex, { amount: 1000 }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("OK");
  });

  it("returns config not found when uid has no config", async () => {
    const env = buildEnv();
    env.CARD_REPLAY.__cardConfigs.delete(UID);
    env.UID_CONFIG = {
      get: async () => null,
      put: async () => {},
    };

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 12, keys.k1, keys.k2);
    const req = new Request(callbackUrl(pHex, cHex, { amount: 500 }));
    const res = await handleLnurlpPayment(req, env);
    expect(res.status).toBe(200);
  });
});
