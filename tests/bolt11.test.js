import { decodeBolt11Amount } from "../utils/bolt11.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { handleRequest } from "../index.js";

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
    return { BOLT_CARD_K1, CARD_REPLAY: makeReplayNamespace() };
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
