import { describe, test, expect } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04996c6a926980";

// Real crypto: encrypt a valid p parameter and compute valid c for a given UID + counter
function generateRealPandC(uidHex, counter, k1Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);

  // Counter in little-endian at positions 8-10
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xC7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;

  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));

  // Extract counter as decryptP would return it (big-endian after reversal)
  const ctrHex = bytesToHex(new Uint8Array([
    (counter >> 16) & 0xff,
    (counter >> 8) & 0xff,
    counter & 0xff,
  ]));

  return { pHex, ctrHex };
}

// Compute a valid BoltCard CMAC (c) for given UID, ctr (big-endian hex), K2
function computeRealC(uidHex, ctrHex, k2Hex) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

function makeEnv(replayInitial = {}) {
  return {
    BOLT_CARD_K1,
    CARD_REPLAY: makeReplayNamespace(replayInitial),
    UID_CONFIG: { get: async () => null, put: async () => {} },
    ...TEST_OPERATOR_AUTH,
  };
}

async function makeRequest(path, method = "GET", body = null, requestEnv) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

describe("POS Page", () => {
  function makeEnv() {
    return {
      BOLT_CARD_K1,
      CARD_REPLAY: makeReplayNamespace(),
      UID_CONFIG: { get: async () => null, put: async () => {} },
      ...TEST_OPERATOR_AUTH,
    };
  }

  test("GET /operator/pos returns HTML with 200 status", async () => {
    const env = makeEnv();
    const response = await handleRequest(new Request("https://test.local/operator/pos"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
  });

  test("GET /operator/pos response contains POS title and NFC code", async () => {
    const env = makeEnv();
    const response = await handleRequest(new Request("https://test.local/operator/pos"), env);
    const html = await response.text();
    expect(html).toContain("POS");
    expect(html).toContain("NDEFReader");
    expect(html).toContain("CHARGE");
    expect(html).toContain("NEW SALE");
    expect(html).toContain("keypad-btn");
    expect(html).toContain("MENU");
    expect(html).toContain("amount");
  });
});

describe("POS Amount Parameter Support", () => {
  let keys;

  beforeAll(async () => {
    const env = { BOLT_CARD_K1: BOLT_CARD_K1 };
    keys = await getDeterministicKeys(TEST_UID, env);
  });

  test("callback handler accepts amount query parameter alongside pr", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    };

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice&amount=5000`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("OK");

    // Verify the tap was recorded with the explicit amount
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json();

    expect(listJson.taps).toHaveLength(1);
    expect(listJson.taps[0].amount_msat).toBe(5000);
  });

  test("callback handler works when only amount is provided (no pr) - for fakewallet POS", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    };

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 2, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&amount=10000`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("OK");

    // Verify the tap was recorded with the explicit amount
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json();

    expect(listJson.taps).toHaveLength(1);
    expect(listJson.taps[0].amount_msat).toBe(10000);
    expect(listJson.taps[0].bolt11).toBeNull();
  });

  test("callback handler rejects request when both pr and amount are missing", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    };

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 3, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.status).toBe("ERROR");
    expect(json.reason).toBe("Missing pr or amount parameter");
  });

  test("existing callback tests still pass - amount from bolt11 invoice", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    };

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 4, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    // Use a realistic bolt11 invoice with amount
    const bolt11Invoice = "lnbc1000n1pjrw..." + "u".repeat(50); // Simulated invoice
    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=${bolt11Invoice}`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("OK");
  });

  test("explicit amount takes precedence over bolt11 amount when both provided", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    };

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 5, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    // Provide both pr and amount - amount should take precedence
    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc1000n1testinvoice&amount=25000`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("OK");

    // Verify the tap was recorded with the explicit amount (25000), not the bolt11 amount
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json();

    expect(listJson.taps).toHaveLength(1);
    expect(listJson.taps[0].amount_msat).toBe(25000);
  });

  test("fakewallet debits correct amount when explicit amount provided", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    };

    // Credit the card with initial balance
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 50000, note: "Initial funding" }),
    }));

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 6, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const debitAmount = 15000;
    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&amount=${debitAmount}`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("OK");
    expect(json.balance).toBe(35000); // 50000 - 15000
  });
});
