import { describe, test, expect } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";

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
  return {
    BOLT_CARD_K1,
    CARD_REPLAY: makeReplayNamespace(),
    UID_CONFIG: {
      get: async (uid) => uidConfig && uid === TEST_UID ? JSON.stringify(uidConfig) : null,
      put: async () => {},
    },
  };
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

  test("debug page contains all tool links", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/debug", env);
    const html = await resp.text();
    expect(html).toContain("/experimental/nfc");
    expect(html).toContain("/experimental/analytics");
    expect(html).toContain("/experimental/bulkwipe");
    expect(html).toContain("/pos");
    expect(html).toContain("/experimental/activate");
    expect(html).toContain("/login");
    expect(html).toContain("/identity");
    expect(html).toContain("/2fa");
    expect(html).toContain("Debug & Tools");
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
  });
});

describe("Identity Verify API", () => {
  let keys;

  beforeAll(async () => {
    const env = { BOLT_CARD_K1 };
    keys = await getDeterministicKeys(TEST_UID, env);
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
