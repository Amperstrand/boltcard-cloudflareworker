import { generateFakeBolt11, decodeBolt11, decodeBolt11Amount } from "../utils/bolt11.js";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";
import type { Env } from "../types/core.js";

describe("decodeBolt11", () => {
  test("returns error for null input", () => {
    expect(decodeBolt11(null as any)).toEqual({ ok: false, error: "Invoice is required" });
  });

  test("returns error for empty string", () => {
    expect(decodeBolt11("")).toEqual({ ok: false, error: "Invoice is required" });
  });

  test("returns error for non-ln string", () => {
    expect(decodeBolt11("notaninvoice")).toEqual({ ok: false, error: "Not a BOLT11 invoice (must start with 'ln')" });
  });

  test("returns error for invalid bech32", () => {
    const result = decodeBolt11("lnbc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/invalid bech32/i);
  });

  test("round-trip: encode 20000 msat then decode", () => {
    const inv = generateFakeBolt11(20000);
    const result = decodeBolt11(inv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network).toBe("mainnet");
    expect(result.amountMsat).toBe(20000);
    expect(result.expiry).toBe(3600);
    expect(result.signatureValid).toBe(true);
    expect(result.payee).toBeTruthy();
    expect(result.payee).toMatch(/^[0-9a-f]{66}$/);
    expect(result.tags.payment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.tags.payment_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.tags.description).toBe("fakewallet payment");
    expect(result.tags.min_final_cltv_expiry).toBe(9);
    expect(result.tags.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bit: 0, name: "var_onion_optin" }),
        expect.objectContaining({ bit: 6, name: "payment_secret" }),
      ])
    );
    expect(result.isExpired).toBe(false);
  });

  test("round-trip: encode 1000 msat", () => {
    const inv = generateFakeBolt11(1000);
    const result = decodeBolt11(inv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountMsat).toBe(1000);
    expect(result.signatureValid).toBe(true);
  });

  test("round-trip: encode 1 msat (smallest)", () => {
    const inv = generateFakeBolt11(1);
    const result = decodeBolt11(inv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountMsat).toBe(1);
    expect(result.signatureValid).toBe(true);
  });

  test("round-trip: encode 100000000 msat (1 BTC)", () => {
    const inv = generateFakeBolt11(100000000);
    const result = decodeBolt11(inv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountMsat).toBe(100000000);
    expect(result.signatureValid).toBe(true);
  });

  test("preserves custom description", () => {
    const inv = generateFakeBolt11(50000, { description: "POS order #42" });
    const result = decodeBolt11(inv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tags.description).toBe("POS order #42");
  });

  test("preserves payment secret", () => {
    const secret = "aa".repeat(32);
    const inv = generateFakeBolt11(1000, { paymentSecret: secret });
    const result = decodeBolt11(inv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tags.payment_secret).toBe(secret);
  });

  test("recovers payee pubkey and verifies signature", () => {
    const inv = generateFakeBolt11(10000);
    const result = decodeBolt11(inv);

    if (!result.ok) return;
    expect(result.signatureValid).toBe(true);
    expect(result.payee).toBeTruthy();
    expect(result.payee).toMatch(/^(02|03)[0-9a-f]{64}$/);
  });

  test("produces unique payee pubkeys for different invoices", () => {
    const inv1 = generateFakeBolt11(1000);
    const inv2 = generateFakeBolt11(2000);
    const r1 = decodeBolt11(inv1);
    const r2 = decodeBolt11(inv2);

    if (!r1.ok || !r2.ok) return;
    expect(r1.payee).not.toBe(r2.payee);
  });

  test("amountDisplay shows human-readable string", () => {
    const inv = generateFakeBolt11(20000);
    const result = decodeBolt11(inv);

    if (!result.ok) return;
    expect(result.amountDisplay).toMatch(/200 nanoBTC/);
  });

  test("timestampISO is valid ISO date", () => {
    const inv = generateFakeBolt11(1000);
    const result = decodeBolt11(inv);

    if (!result.ok) return;
    expect(result.timestampISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(result.timestampISO).getTime()).not.toBeNaN();
  });

  test("isExpired is false for fresh invoice", () => {
    const inv = generateFakeBolt11(1000);
    const result = decodeBolt11(inv);

    if (!result.ok) return;
    expect(result.isExpired).toBe(false);
  });

  test("rawTags contains all expected tags", () => {
    const inv = generateFakeBolt11(1000);
    const result = decodeBolt11(inv);

    if (!result.ok) return;
    const codes = result.rawTags.map((t: { code: number }) => t.code);
    expect(codes).toContain(1);
    expect(codes).toContain(13);
    expect(codes).toContain(6);
    expect(codes).toContain(16);
    expect(codes).toContain(9);
    expect(codes).toContain(24);
  });

  test("features tag includes rawHex", () => {
    const inv = generateFakeBolt11(1000);
    const result = decodeBolt11(inv);

    if (!result.ok) return;
    const featuresTag = result.rawTags.find((t: { code: number }) => t.code === 9);
    expect(featuresTag).toBeDefined();
    if (!featuresTag) return;
    expect(featuresTag.rawHex).toBe("41");
    expect(featuresTag.value).toEqual(
      expect.arrayContaining(["var_onion_optin", "payment_secret"])
    );
  });

  test("amount is consistent with decodeBolt11Amount", () => {
    const amounts = [1, 100, 1000, 10000, 100000, 1000000];
    for (const amt of amounts) {
      const inv = generateFakeBolt11(amt);
      const result = decodeBolt11(inv);
      if (!result.ok) return;
      expect(result.amountMsat).toBe(decodeBolt11Amount(inv));
    }
  });
});

describe("GET /decode", () => {
  function makeEnv(): Env {
    return {
      BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
      CARD_REPLAY: makeReplayNamespace() as any,
      UID_CONFIG: { get: async () => null, put: async () => {} } as any,
    } as unknown as Env;
  }

  async function makeRequest(path: string, env: Env) {
    return handleRequest(new Request("https://test.local" + path), env);
  }

  test("returns HTML page", async () => {
    const resp = await makeRequest("/decode", makeEnv());
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/html");
    const body = await resp.text();
    expect(body).toContain("BOLT11 DECODER");
    expect(body).toContain("invoice-input");
  });

  test("has security headers", async () => {
    const worker = await import("../index.js");
    const resp = await worker.default.fetch(
      new Request("https://test.local/decode"),
      makeEnv(),
      {} as any,
    );
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("GET /api/decode", () => {
  function makeEnv(): Env {
    return {
      BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
      CARD_REPLAY: makeReplayNamespace() as any,
      UID_CONFIG: { get: async () => null, put: async () => {} } as any,
    } as unknown as Env;
  }

  async function makeRequest(path: string, env: Env) {
    return handleRequest(new Request("https://test.local" + path), env);
  }

  test("decodes a generated invoice", async () => {
    const inv = generateFakeBolt11(20000);
    const resp = await makeRequest("/api/decode?invoice=" + encodeURIComponent(inv), makeEnv());
    expect(resp.status).toBe(200);

    const data = await resp.json() as any;
    expect(data.ok).toBe(true);
    expect(data.amountMsat).toBe(20000);
    expect(data.signatureValid).toBe(true);
    expect(data.tags.description).toBe("fakewallet payment");
  });

  test("returns 400 for missing invoice param", async () => {
    const resp = await makeRequest("/api/decode", makeEnv());
    expect(resp.status).toBe(400);
    const json = await resp.json() as any;
    expect(json.reason).toMatch(/missing.*invoice/i);
  });

  test("returns error for invalid invoice", async () => {
    const resp = await makeRequest("/api/decode?invoice=garbage", makeEnv());
    expect(resp.status).toBe(200);
    const json = await resp.json() as any;
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
  });

  test("accepts 'q' as alias for 'invoice'", async () => {
    const inv = generateFakeBolt11(5000);
    const resp = await makeRequest("/api/decode?q=" + encodeURIComponent(inv), makeEnv());
    expect(resp.status).toBe(200);
    const data = await resp.json() as any;
    expect(data.ok).toBe(true);
    expect(data.amountMsat).toBe(5000);
  });

  test("decodes invoice with custom description", async () => {
    const inv = generateFakeBolt11(30000, { description: "Coffee payment" });
    const resp = await makeRequest("/api/decode?invoice=" + encodeURIComponent(inv), makeEnv());
    const data = await resp.json() as any;
    expect(data.tags.description).toBe("Coffee payment");
  });

  test("response includes all expected fields", async () => {
    const inv = generateFakeBolt11(10000);
    const resp = await makeRequest("/api/decode?invoice=" + encodeURIComponent(inv), makeEnv());
    const data = await resp.json() as any;

    expect(data).toHaveProperty("ok", true);
    expect(data).toHaveProperty("network");
    expect(data).toHaveProperty("hrp");
    expect(data).toHaveProperty("amountMsat");
    expect(data).toHaveProperty("amountDisplay");
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("timestampISO");
    expect(data).toHaveProperty("expiry");
    expect(data).toHaveProperty("expiresAt");
    expect(data).toHaveProperty("isExpired");
    expect(data).toHaveProperty("signatureValid");
    expect(data).toHaveProperty("payee");
    expect(data).toHaveProperty("tags");
    expect(data).toHaveProperty("rawTags");
  });
});
