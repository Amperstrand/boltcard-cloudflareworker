import { handleRequest } from "../index.js";
import { jest } from "@jest/globals";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, computeAesCmac } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

// Test vectors for UID 04996c6a926980 (counter=3)
const WITHDRAW_P_COUNTER3 = "4E2E289D945A66BB13377A728884E867";
const WITHDRAW_C_COUNTER3 = "E19CCB1FED8892CE";
const TEST_UID = "04996c6a926980";
const TEST_UID_CONFIG = JSON.stringify({
  K2: "B45775776CB224C75BCDE7CA3704E933",
  payment_method: "clnrest",
  clnrest: {
    protocol: "https",
    host: "https://cln.example.com",
    port: 3001,
    rune: "abcd1234efgh5678ijkl",
  },
});

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
    UID_CONFIG: {
      get: async (uid) => uid === TEST_UID ? TEST_UID_CONFIG : null,
      put: async () => {},
    },
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

describe("Tap tracking — Step 1 (initial tap)", () => {
  test("GET / records a 'read' tap", async () => {
    const env = makeEnv();

    const response = await makeRequest(`/?p=${WITHDRAW_P_COUNTER3}&c=${WITHDRAW_C_COUNTER3}`, "GET", null, env);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.tag).toBe("withdrawRequest");

    expect(env.CARD_REPLAY.__taps.size).toBe(1);
    const tap = env.CARD_REPLAY.__taps.get(`${TEST_UID}:3`);
    expect(tap).toBeDefined();
    expect(tap.status).toBe("read");
    expect(tap.counter).toBe(3);
    expect(tap.bolt11).toBeNull();
    expect(tap.amount_msat).toBeNull();
  });

  test("repeated GET / with same counter does not duplicate tap", async () => {
    const env = makeEnv();

    const response1 = await makeRequest(`/?p=${WITHDRAW_P_COUNTER3}&c=${WITHDRAW_C_COUNTER3}`, "GET", null, env);
    expect(response1.status).toBe(200);

    const response2 = await makeRequest(`/?p=${WITHDRAW_P_COUNTER3}&c=${WITHDRAW_C_COUNTER3}`, "GET", null, env);
    expect(response2.status).toBe(200);

    // Same counter = same tap key, INSERT OR IGNORE keeps the first
    expect(env.CARD_REPLAY.__taps.size).toBe(1);
  });
});

describe("Tap tracking — Step 2 (withdraw callback)", () => {
  let keys;

  beforeAll(async () => {
    const env = { BOLT_CARD_K1: BOLT_CARD_K1 };
    keys = await getDeterministicKeys(TEST_UID, env);
  });

  test("callback records tap with bolt11 and metadata", async () => {
    const env = makeEnv();
    const kvStore = {};
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
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("OK");

    expect(env.CARD_REPLAY.__counters.get(TEST_UID)).toBe(1);

    expect(env.CARD_REPLAY.__taps.size).toBe(1);
    const tapKey = `${TEST_UID}:1`;
    expect(env.CARD_REPLAY.__taps.has(tapKey)).toBe(true);

    const tap = env.CARD_REPLAY.__taps.get(tapKey);
    expect(tap.counter).toBe(1);
    expect(tap.bolt11).toBe("lnbc10n1testinvoice");
    expect(tap.status).toBe("completed");
    expect(tap.created_at).toBeDefined();
    expect(tap.updated_at).toBeDefined();
  });

  test("callback rejects replayed counter", async () => {
    const env = makeEnv();
    const kvStore = {};
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

    env.CARD_REPLAY = makeReplayNamespace({ [TEST_UID]: 1 });

    const { pHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const ctrHex = bytesToHex(new Uint8Array([0x00, 0x00, 0x01]));
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1replay`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.status).toBe("ERROR");
    expect(json.reason).toMatch(/replay|counter/i);
  });

  test("callback records tap status as failed on payment failure", async () => {
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

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 10, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(400);

    const tapKey = `${TEST_UID}:10`;
    expect(env.CARD_REPLAY.__taps.has(tapKey)).toBe(true);
    const tap = env.CARD_REPLAY.__taps.get(tapKey);
    expect(tap.status).toBe("failed");
    expect(tap.bolt11).toBe("lnbc10n1testinvoice");
  });

  test("recorded tap can be updated to different statuses", async () => {
    const env = makeEnv();
    const kvStore = {};
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

    await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1test`,
      "GET",
      null,
      env
    );

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const updateResp = await stub.fetch(new Request("https://internal/update-tap-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter: 3, status: "failed" }),
    }));

    expect(updateResp.status).toBe(200);
    const updateJson = await updateResp.json();
    expect(updateJson.updated).toBe(true);

    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json();
    expect(listJson.taps[0].status).toBe("failed");
  });
});

describe("Tap tracking — list-taps", () => {
  test("list-taps returns empty array when no taps", async () => {
    const env = makeEnv();
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);

    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const json = await listResp.json();

    expect(json.taps).toEqual([]);
  });

  test("list-taps returns taps in reverse counter order", async () => {
    const env = makeEnv();
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);

    await stub.fetch(new Request("https://internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        counterValue: 3,
        bolt11: "lnbc10n1tap3",
        userAgent: null,
        requestUrl: null,
      }),
    }));

    await stub.fetch(new Request("https://internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        counterValue: 5,
        bolt11: "lnbc10n1tap5",
        userAgent: null,
        requestUrl: null,
      }),
    }));

    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const json = await listResp.json();

    expect(json.taps).toHaveLength(2);
    expect(json.taps[0].counter).toBe(5);
    expect(json.taps[1].counter).toBe(3);
    expect(json.taps[0].bolt11).toBe("lnbc10n1tap5");
    expect(json.taps[1].bolt11).toBe("lnbc10n1tap3");
  });

  test("list-taps respects limit parameter", async () => {
    const env = makeEnv();
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);

    for (let i = 1; i <= 3; i++) {
      await stub.fetch(new Request("https://internal/record-tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterValue: i,
          bolt11: `lnbc10n1tap${i}`,
          userAgent: null,
          requestUrl: null,
        }),
      }));
    }

    const listResp = await stub.fetch(new Request("https://internal/list-taps?limit=2"));
    const json = await listResp.json();

    expect(json.taps).toHaveLength(2);
    const counters = json.taps.map(t => t.counter);
    expect(counters).toHaveLength(2);
  });
});

describe("Tap tracking — login response", () => {
  test("POST /login includes tapHistory array", async () => {
    const env = makeEnv();

    const response = await makeRequest(
      "/login",
      "POST",
      { p: WITHDRAW_P_COUNTER3, c: WITHDRAW_C_COUNTER3 },
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.tapHistory).toBeDefined();
    expect(Array.isArray(json.tapHistory)).toBe(true);
    expect(json.tapHistory).toHaveLength(0);
  });

  test("POST /login tapHistory shows recorded taps", async () => {
    const env = makeEnv();
    const kvStore = {};

    const keys = await getDeterministicKeys(TEST_UID, env);
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

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 15, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const callbackResp = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env
    );
    expect([200, 400]).toContain(callbackResp.status);

    const loginResp = await makeRequest(
      "/login",
      "POST",
      { p: pHex, c: cHex },
      env
    );

    expect(loginResp.status).toBe(200);
    const loginJson = await loginResp.json();
    expect(loginJson.success).toBe(true);
    expect(loginJson.tapHistory).toHaveLength(1);
    expect(loginJson.tapHistory[0].counter).toBe(15);
    expect(loginJson.tapHistory[0].bolt11).toBe("lnbc10n1testinvoice");
    expect(["completed", "failed"]).toContain(loginJson.tapHistory[0].status);
  });

  test("POST /login tapHistory is empty when no taps recorded", async () => {
    const env = makeEnv();

    const response = await makeRequest(
      "/login",
      "POST",
      { p: WITHDRAW_P_COUNTER3, c: WITHDRAW_C_COUNTER3 },
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.tapHistory).toHaveLength(0);
  });
});
