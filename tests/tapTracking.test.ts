import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import type { ReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import { getCardState } from "../replayProtection.js";
import aesjs from "aes-js";
import type { Env } from "../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

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
const TEST_UID_CONFIG_OBJECT = JSON.parse(TEST_UID_CONFIG);

function generateRealPandC(uidHex: string, counter: number, k1Hex: string) {
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

function computeRealC(uidHex: string, ctrHex: string, k2Hex: string) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

function makeEnv(replayInitial: Record<string, number> = {}, balance = 0): Env {
  const ns = makeReplayNamespace(replayInitial);
  if (balance > 0) {
    const uid = TEST_UID.toLowerCase();
    (ns as any).__activate(uid, 1);
    (ns as any).__cardStates.get(uid).balance = balance;
  }
  return {
    BOLT_CARD_K1,
    CARD_REPLAY: ns as unknown as DurableObjectNamespace,
    UID_CONFIG: {
      get: async (uid: string) => uid === TEST_UID ? TEST_UID_CONFIG : null,
      put: async () => {},
    } as unknown as KVNamespace,
  } as Env;
}

async function makeRequest(path: string, method = "GET", body: Record<string, unknown> | null = null, requestEnv: Env) {
  const url = "https://test.local" + path;
  const options: RequestInit = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

function replay(env: Env): ReplayNamespace {
  return env.CARD_REPLAY as ReplayNamespace;
}

describe("Tap tracking — Step 1 (initial tap)", () => {
  test("GET / records a 'read' tap", async () => {
    const env = makeEnv();
    replay(env).__cardConfigs.set(TEST_UID, TEST_UID_CONFIG_OBJECT);

    const response = await makeRequest(`/?p=${WITHDRAW_P_COUNTER3}&c=${WITHDRAW_C_COUNTER3}`, "GET", null, env);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, any>;
    expect(json.tag).toBe("withdrawRequest");

    expect(replay(env).__taps.size).toBe(1);
    const tap = replay(env).__taps.get(`${TEST_UID}:3`)!;
    expect(tap).toBeDefined();
    expect(tap.status).toBe("read");
    expect(tap.counter).toBe(3);
    expect(tap.bolt11).toBeNull();
    expect(tap.amount_msat).toBeNull();
  });

  test("repeated GET / with same counter is allowed while replay enforcement is disabled", async () => {
    const env = makeEnv();
    replay(env).__cardConfigs.set(TEST_UID, TEST_UID_CONFIG_OBJECT);

    const response1 = await makeRequest(`/?p=${WITHDRAW_P_COUNTER3}&c=${WITHDRAW_C_COUNTER3}`, "GET", null, env);
    expect(response1.status).toBe(200);

    const response2 = await makeRequest(`/?p=${WITHDRAW_P_COUNTER3}&c=${WITHDRAW_C_COUNTER3}`, "GET", null, env);
    expect(response2.status).toBe(200);
  });
});

describe("Tap tracking — Step 2 (withdraw callback)", () => {
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeAll(async () => {
    const env = { BOLT_CARD_K1: BOLT_CARD_K1 } as Env;
    keys = getDeterministicKeys(TEST_UID, env);
  });

  test("callback records tap with bolt11 and metadata", async () => {
    const env = makeEnv({}, 100000);
    env.UID_CONFIG = {
      get: async (uid: string) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    } as unknown as KVNamespace;

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, any>;
    expect(json.status).toBe("OK");

    expect(replay(env).__counters.get(TEST_UID)).toBe(1);

    expect(replay(env).__taps.size).toBe(1);
    const tapKey = `${TEST_UID}:1`;
    expect(replay(env).__taps.has(tapKey)).toBe(true);

    const tap = replay(env).__taps.get(tapKey)!;
    expect(tap.counter).toBe(1);
    expect(tap.bolt11).toBe("lnbc10n1testinvoice");
    expect(tap.status).toBe("completed");
    expect(tap.created_at).toBeDefined();
    expect(tap.updated_at).toBeDefined();
  });

  test("callback records tap with bolt11 and metadata when Step 1 already advanced counter", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid: string) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    } as unknown as KVNamespace;

    env.CARD_REPLAY = makeReplayNamespace({ [TEST_UID]: 1 });

    replay(env).__taps.set(`${TEST_UID.toLowerCase()}:1`, {
      counter: 1,
      bolt11: null,
      status: "read",
      payment_hash: null,
      amount_msat: null,
      user_agent: null,
      request_url: null,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    });

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 5000, note: "Initial funding" }),
    }));

    const { pHex } = generateRealPandC(TEST_UID, 1, BOLT_CARD_K1.split(",")[0]!);
    const ctrHex = bytesToHex(new Uint8Array([0x00, 0x00, 0x01]));
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1replay`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const tapKey = `${TEST_UID.toLowerCase()}:1`;
    expect(replay(env).__taps.has(tapKey)).toBe(true);

    const tap = replay(env).__taps.get(tapKey)!;
    expect(tap.bolt11).toBe("lnbc10n1replay");
    expect(tap.status).toBe("completed");
  });

  test("callback debits fakewallet balance and marks tap completed", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid: string) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    } as unknown as KVNamespace;

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 5000, note: "Initial funding" }),
    }));

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 10, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, any>;
    expect(json.status).toBe("OK");
    expect(json.balance).toBeLessThan(5000);

    const tapKey = `${TEST_UID}:10`;
    expect(replay(env).__taps.has(tapKey)).toBe(true);
    const tap = replay(env).__taps.get(tapKey)!;
    expect(tap.status).toBe("completed");
    expect(tap.bolt11).toBe("lnbc10n1testinvoice");

    const balanceResp = await stub.fetch(new Request("https://internal/balance"));
    const balanceJson = await balanceResp.json() as Record<string, any>;
    expect(balanceJson.balance).toBe(json.balance);

    const txResp = await stub.fetch(new Request("https://internal/transactions"));
    const txJson = await txResp.json() as Record<string, any>;
    expect(txJson.transactions).toHaveLength(2);
    expect(txJson.transactions[0].counter).toBe(10);
    expect(txJson.transactions[0].amount).toBeLessThan(0);
    expect(txJson.transactions[0].balance_after).toBe(json.balance);
  });

  test("recorded tap can be updated to different statuses", async () => {
    const env = makeEnv();
    env.UID_CONFIG = {
      get: async (uid: string) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    } as unknown as KVNamespace;

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 3, BOLT_CARD_K1.split(",")[0]!);
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
    const updateJson = await updateResp.json() as Record<string, any>;
    expect(updateJson.updated).toBe(true);

    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json() as Record<string, any>;
    expect(listJson.taps[0].status).toBe("failed");
  });
});

describe("Tap tracking — list-taps", () => {
  test("list-taps returns empty array when no taps", async () => {
    const env = makeEnv();
    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);

    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const json = await listResp.json() as Record<string, any>;

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
    const json = await listResp.json() as Record<string, any>;

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
    const json = await listResp.json() as Record<string, any>;

    expect(json.taps).toHaveLength(2);
    const counters = json.taps.map((t: { counter: number }) => t.counter);
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
      env,
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, any>;
    expect(json.success).toBe(true);
    expect(json.tapHistory).toBeDefined();
    expect(Array.isArray(json.tapHistory)).toBe(true);
    expect(json.tapHistory).toHaveLength(0);
  });

  test("POST /login tapHistory shows recorded taps", async () => {
    const env = makeEnv({}, 100000);

    const keys = getDeterministicKeys(TEST_UID, env);
    env.UID_CONFIG = {
      get: async (uid: string) => {
        if (uid === TEST_UID) {
          return JSON.stringify({
            payment_method: "fakewallet",
            K2: keys.k2,
          });
        }
        return null;
      },
      put: async () => {},
    } as unknown as KVNamespace;

    const { pHex, ctrHex } = generateRealPandC(TEST_UID, 15, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(TEST_UID, ctrHex, keys.k2);

    const callbackResp = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env,
    );
    expect(callbackResp.status).toBe(200);

    const loginResp = await makeRequest(
      "/login",
      "POST",
      { p: pHex, c: cHex },
      env,
    );

    expect(loginResp.status).toBe(200);
    const loginJson = await loginResp.json() as Record<string, any>;
    expect(loginJson.success).toBe(true);
    expect(loginJson.tapHistory).toHaveLength(2);
    expect(loginJson.tapHistory[0].counter).toBe(15);
    expect(loginJson.tapHistory[0].bolt11).toBe("lnbc10n1testinvoice");
    expect(loginJson.tapHistory[0].status).toBe("completed");
    expect(loginJson.tapHistory[1].status).toBe("payment");
  });

  test("POST /login tapHistory is empty when no taps recorded", async () => {
    const env = makeEnv();

    const response = await makeRequest(
      "/login",
      "POST",
      { p: WITHDRAW_P_COUNTER3, c: WITHDRAW_C_COUNTER3 },
      env,
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, any>;
    expect(json.success).toBe(true);
    expect(json.tapHistory).toHaveLength(0);
  });
});

describe("getCardState error handling", () => {
  test("getCardState throws on DO error (fail-closed)", async () => {
    const mockFetch = vi.fn(() => Promise.reject(new Error("DO connection failed")));
    const mockStub = {
      fetch: mockFetch,
    };

    const replay = makeReplayNamespace();
    (replay as unknown as { get: (id: string) => unknown }).get = (id: string) => mockStub;

    const env = { CARD_REPLAY: replay } as unknown as Env;

    await expect(getCardState(env, "04996c6a926980")).rejects.toThrow("DO connection failed");
  });
});
