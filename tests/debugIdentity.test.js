import { describe, test, expect } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";
import { buildCardTestEnv } from "./testHelpers.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04996c6a926980";

function generateRealPandC(uidHex, counter, k1Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xC7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctrHex = bytesToHex(new Uint8Array([
    (counter >> 16) & 0xff,
    (counter >> 8) & 0xff,
    counter & 0xff,
  ]));
  return { pHex, ctrHex };
}

function computeRealC(uidHex, ctrHex, k2Hex) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

function makeEnv(uidConfig = null) {
  return buildCardTestEnv({ uid: TEST_UID, kvData: uidConfig ? JSON.stringify(uidConfig) : null, operatorAuth: true, extraEnv: { BOLT_CARD_K1 } });
}

async function makeRequest(path, env) {
  return handleRequest(new Request("https://test.local" + path, { method: "GET" }), env);
}

describe("Debug Page", () => {
  test("GET /debug returns HTML with 200", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/debug", env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
  });

  test("debug page renders tabbed console", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/debug", env);
    const html = await resp.text();
    expect(html).toContain("Debug Console");
    expect(html).toContain("debug-tab");
    expect(html).toContain("panel-console");
    expect(html).toContain("panel-identify");
    expect(html).toContain("panel-wipe");
    expect(html).toContain("panel-twofa");
    expect(html).toContain("panel-identity");
    expect(html).toContain("panel-pos");
    expect(html).toContain("Card Info");
  });
});

describe("Identity Page", () => {
  test("GET /identity returns HTML with 200", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/identity", env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
  });

  test("identity page contains NFC and profile elements", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/identity", env);
    const html = await resp.text();
    expect(html).toContain("IDENTITY");
    expect(html).toContain("ACCESS GRANTED");
    expect(html).toContain("ACCESS DENIED");
    expect(html).toContain("NDEFReader");
    expect(html).toContain("/api/verify-identity");
    expect(html).toContain("Save avatar");
    expect(html).toContain("Open 2FA demo");
  });
});

describe("Identity Verify API", () => {
  let keys;

  beforeAll(async () => {
    const env = { BOLT_CARD_K1 };
    keys = getDeterministicKeys(TEST_UID, env);
  });

  test("returns verified for valid card", async () => {
    const env = makeEnv({ payment_method: "fakewallet", K2: keys.k2 });
    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const resp = await makeRequest(`/api/verify-identity?p=${pHex}&c=${cHex}`, env);
    expect(resp.status).toBe(200);

    const json = await resp.json();
    expect(json.verified).toBe(true);
    expect(json.uid).toBe(TEST_UID);
    expect(json.maskedUid).toContain("0499");
    expect(json.maskedUid).toContain("6980");
    expect(json.profile).toMatchObject({
      emoji: expect.any(String),
      name: expect.stringMatching(/^Operator-/),
      role: expect.any(String),
      dept: expect.any(String),
      level: expect.stringMatching(/^Level /),
    });
  });

  test("saves a selected emoji avatar for a verified card", async () => {
    const env = makeEnv({ payment_method: "fakewallet", K2: keys.k2 });
    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await handleRequest(new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, emoji: "🚀" }),
    }), env);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.profile.emoji).toBe("🚀");

    const verifyResp = await makeRequest(`/api/verify-identity?p=${pHex}&c=${cHex}`, env);
    const verifyJson = await verifyResp.json();
    expect(verifyJson.profile.emoji).toBe("🚀");
  });

  test("rejects unsupported emoji selection", async () => {
    const env = makeEnv({ payment_method: "fakewallet", K2: keys.k2 });
    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await handleRequest(new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, emoji: "❌" }),
    }), env);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.status).toBe("ERROR");
  });

  test("returns unverified for unknown card", async () => {
    const env = makeEnv(null);
    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const resp = await makeRequest(`/api/verify-identity?p=${pHex}&c=${cHex}`, env);
    const json = await resp.json();
    expect(json.verified).toBe(false);
    expect(json.reason).toMatch(/not enrolled|not recognized/i);
  });

  test("returns 400 for missing p parameter", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/api/verify-identity?c=abcdef", env);
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.status).toBe("ERROR");
  });

  test("returns 400 for missing c parameter", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/api/verify-identity?p=abcdef", env);
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.status).toBe("ERROR");
  });
});
