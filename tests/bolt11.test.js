import { decodeBolt11Amount, generateFakeBolt11 } from "../utils/bolt11.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { handleRequest } from "../index.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

describe("decodeBolt11Amount", () => {
  test("returns null for null input", () => {
    expect(decodeBolt11Amount(null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(decodeBolt11Amount("")).toBeNull();
  });

  test("returns null for non-lnbc string", () => {
    expect(decodeBolt11Amount("lntb1000n1test")).toBeNull();
  });

  test("returns null for amountless invoice (lnbc1...)", () => {
    expect(decodeBolt11Amount("lnbc1qtest")).toBeNull();
  });

  test("parses nano-bitcoin amount (lnbc10n1...)", () => {
    const msat = decodeBolt11Amount("lnbc10n1qkp3rk2qpp5sx604dy3f");
    expect(msat).toBe(1000);
  });

  test("parses 1 nano-bitcoin (lnbc1n1...)", () => {
    const msat = decodeBolt11Amount("lnbc1n1qtest");
    expect(msat).toBe(100);
  });

  test("parses milli-bitcoin amount (lnbc1m1...)", () => {
    const msat = decodeBolt11Amount("lnbc1m1qtest");
    expect(msat).toBe(100000000);
  });

  test("parses micro-bitcoin amount (lnbc1000u1...)", () => {
    const msat = decodeBolt11Amount("lnbc1000u1qtest");
    expect(msat).toBe(100000000);
  });

  test("parses pico-bitcoin amount (lnbc10000000p1...)", () => {
    const msat = decodeBolt11Amount("lnbc10000000p1qtest");
    expect(msat).toBe(1000000);
  });

  test("parses whole bitcoin (lnbc11...)", () => {
    const msat = decodeBolt11Amount("lnbc11qtest");
    expect(msat).toBe(100000000000);
  });

  test("parses 10 bitcoin (lnbc101...)", () => {
    const msat = decodeBolt11Amount("lnbc101qtest");
    expect(msat).toBe(1000000000000);
  });

  test("handles uppercase invoice", () => {
    const msat = decodeBolt11Amount("LNBC10N1QTEST");
    expect(msat).toBe(1000);
  });

  test("handles mixed case invoice", () => {
    const msat = decodeBolt11Amount("LNBC10n1Qtest");
    expect(msat).toBe(1000);
  });

  test("returns null for short hrp with no amount digits", () => {
    expect(decodeBolt11Amount("lnbcm1")).toBeNull();
  });

  test("returns null for non-numeric amount", () => {
    expect(decodeBolt11Amount("lnbcabcm1test")).toBeNull();
  });

  test("parses realistic bolt11 invoice", () => {
    const msat = decodeBolt11Amount("lnbc20n1p3knh2rpp5j3kq3uvx34j9");
    expect(msat).toBe(2000);
  });

  test("parses large amount", () => {
    const msat = decodeBolt11Amount("lnbc2500u1qtest");
    expect(msat).toBe(250000000);
  });
});

describe("analytics mock", () => {
  test("mock analytics endpoint returns correct aggregation", async () => {
    const ns = makeReplayNamespace();
    const id = ns.idFromName("04test00000001");
    const stub = ns.get(id);

    await stub.fetch(new Request("https://internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue: 1, bolt11: "lnbc10n1test", amountMsat: 1000 }),
    }));

    await stub.fetch(new Request("https://internal/update-tap-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter: 1, status: "completed" }),
    }));

    await stub.fetch(new Request("https://internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue: 2, bolt11: "lnbc20n1test", amountMsat: 2000 }),
    }));

    await stub.fetch(new Request("https://internal/update-tap-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter: 2, status: "failed" }),
    }));

    const resp = await stub.fetch(new Request("https://internal/analytics"));
    const data = await resp.json();

    expect(data.totalTaps).toBe(2);
    expect(data.completedTaps).toBe(1);
    expect(data.failedTaps).toBe(1);
    expect(data.completedMsat).toBe(1000);
    expect(data.failedMsat).toBe(2000);
    expect(data.totalMsat).toBe(3000);
  });
});

describe("analytics HTTP routes", () => {
  const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

  function makeEnv() {
    return { BOLT_CARD_K1, CARD_REPLAY: makeReplayNamespace(), ...TEST_OPERATOR_AUTH };
  }

  async function makeRequest(path, env) {
    return handleRequest(new Request("https://test.local" + path), env);
  }

  test("GET /analytics returns HTML page", async () => {
    const resp = await makeRequest("/experimental/analytics", makeEnv());
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/html");
    const body = await resp.text();
    expect(body).toContain("ANALYTICS");
  });

  test("GET /analytics/data without uid returns 400", async () => {
    const resp = await makeRequest("/analytics/data", makeEnv());
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.error).toMatch(/missing uid/i);
  });

  test("GET /analytics/data with valid uid returns analytics", async () => {
    const resp = await makeRequest("/analytics/data?uid=04996c6a926980", makeEnv());
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.totalTaps).toBe(0);
    expect(json.completedMsat).toBe(0);
    expect(json).toHaveProperty("completedTaps");
    expect(json).toHaveProperty("failedTaps");
    expect(json).toHaveProperty("pendingTaps");
  });
});

describe("generateFakeBolt11", () => {
  const amounts = [1, 100, 1000, 5000, 50000, 100000, 1000000];

  test.each(amounts)("round-trip encodes %d msat", (amountMsat) => {
    const invoice = generateFakeBolt11(amountMsat);
    expect(invoice).toMatch(/^lnbc/);
    expect(decodeBolt11Amount(invoice)).toBe(amountMsat);
  });

  test("produces unique invoices for the same amount", () => {
    const a = generateFakeBolt11(1000);
    const b = generateFakeBolt11(1000);
    expect(a).not.toBe(b);
    expect(decodeBolt11Amount(a)).toBe(1000);
    expect(decodeBolt11Amount(b)).toBe(1000);
  });

  test("throws for zero amount", () => {
    expect(() => generateFakeBolt11(0)).toThrow("positive integer");
  });

  test("throws for negative amount", () => {
    expect(() => generateFakeBolt11(-1)).toThrow("positive integer");
  });

  test("throws for non-integer amount", () => {
    expect(() => generateFakeBolt11(1.5)).toThrow("positive integer");
  });

  test("bech32 checksum is valid", async () => {
    const invoice = generateFakeBolt11(5000);
    const { bech32 } = await import("@scure/base");
    const decoded = bech32.decode(invoice, 1024);
    expect(decoded.prefix).toMatch(/^lnbc/);
  });
});

describe("GET /api/fake-invoice", () => {
  function makeEnv() {
    return {
      BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
      CARD_REPLAY: makeReplayNamespace(),
      UID_CONFIG: { get: async () => null, put: async () => {} },
    };
  }

  async function makeRequest(path, env) {
    return handleRequest(new Request("https://test.local" + path, { method: "GET" }), env);
  }

  test("returns a bolt11 invoice for valid amount", async () => {
    const env = makeEnv();
    const response = await makeRequest("/api/fake-invoice?amount=5000", env);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.pr).toMatch(/^lnbc/);
    expect(decodeBolt11Amount(json.pr)).toBe(5000);
  });

  test("returns 400 for missing amount", async () => {
    const env = makeEnv();
    const response = await makeRequest("/api/fake-invoice", env);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.status).toBe("ERROR");
    expect(json.reason).toMatch(/positive integer/);
  });

  test("returns 400 for zero amount", async () => {
    const env = makeEnv();
    const response = await makeRequest("/api/fake-invoice?amount=0", env);
    expect(response.status).toBe(400);
  });

  test("returns 400 for negative amount", async () => {
    const env = makeEnv();
    const response = await makeRequest("/api/fake-invoice?amount=-100", env);
    expect(response.status).toBe(400);
  });

  test("returns 400 for non-numeric amount", async () => {
    const env = makeEnv();
    const response = await makeRequest("/api/fake-invoice?amount=abc", env);
    expect(response.status).toBe(400);
  });

  test("returns different invoices for repeated calls", async () => {
    const env = makeEnv();
    const resp1 = await makeRequest("/api/fake-invoice?amount=1000", env);
    const resp2 = await makeRequest("/api/fake-invoice?amount=1000", env);
    const json1 = await resp1.json();
    const json2 = await resp2.json();
    expect(json1.pr).not.toBe(json2.pr);
  });
});
