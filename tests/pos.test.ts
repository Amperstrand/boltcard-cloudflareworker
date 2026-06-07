import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildCardTestEnv, virtualTap } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04996c6a926980";
const K1_HEX = BOLT_CARD_K1.split(",")[0]!;

function makeEnv(replayInitial: Record<string, number> = {}, balance: number = 0): Env & { __kvStore?: Record<string, string> } {
  return buildCardTestEnv({ uid: TEST_UID, replayInitial, balance, operatorAuth: true, extraEnv: { BOLT_CARD_K1 } });
}

async function makeRequest(path: string, method: string = "GET", body: Record<string, unknown> | null = null, requestEnv: Env): Promise<Response> {
  const url = "https://test.local" + path;
  const options: RequestInit = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

describe("POS Page", () => {
  function makeEnv(): Env {
    return buildCardTestEnv({ operatorAuth: true, extraEnv: { BOLT_CARD_K1 } });
  }

  test("GET /operator/pos returns HTML with 200 status", async () => {
    const env = makeEnv();
    const response = await handleRequest(new Request("https://test.local/operator/pos"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
  });

  test("GET /operator/pos response contains POS title and NFC script", async () => {
    const env = makeEnv();
    const response = await handleRequest(new Request("https://test.local/operator/pos"), env);
    const html = await response.text();
    expect(html).toContain("POS");
    expect(html).toContain('/static/js/nfc.js');
    expect(html).toContain('/static/js/pos.js');
    expect(html).toContain("CHARGE");
    expect(html).toContain("NEW SALE");
    expect(html).toContain("keypad-btn");
    expect(html).toContain("MENU");
    expect(html).toContain("amount");
  });
});

describe("POS Amount Parameter Support", () => {
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeAll(() => {
    keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 } as any);
  });

  test("callback handler accepts amount query parameter alongside pr", async () => {
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
    } as any;

    const { pHex, cHex } = virtualTap(TEST_UID, 1, K1_HEX, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice&amount=5000`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe("OK");

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json() as any;

    expect(listJson.taps).toHaveLength(1);
    expect(listJson.taps[0].amount_msat).toBe(5000);
  });

  test("callback handler works when only amount is provided (no pr) - for fakewallet POS", async () => {
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
    } as any;

    const { pHex, cHex } = virtualTap(TEST_UID, 2, K1_HEX, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&amount=10000`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe("OK");

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json() as any;

    expect(listJson.taps).toHaveLength(1);
    expect(listJson.taps[0].amount_msat).toBe(10000);
    expect(listJson.taps[0].bolt11).toBeNull();
  });

  test("callback handler rejects request when both pr and amount are missing", async () => {
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
    } as any;

    const { pHex, cHex } = virtualTap(TEST_UID, 3, K1_HEX, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(400);
    const json = await response.json() as any;
    expect(json.status).toBe("ERROR");
    expect(json.reason).toBe("Missing pr or amount parameter");
  });

  test("existing callback tests still pass - amount from bolt11 invoice", async () => {
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
    } as any;

    const { pHex, cHex } = virtualTap(TEST_UID, 4, K1_HEX, keys.k2);

    const bolt11Invoice = "lnbc1000n1pjrw..." + "u".repeat(50);
    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=${bolt11Invoice}`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe("OK");
  });

  test("explicit amount takes precedence over bolt11 amount when both provided", async () => {
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
    } as any;

    const { pHex, cHex } = virtualTap(TEST_UID, 5, K1_HEX, keys.k2);

    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc1000n1testinvoice&amount=25000`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe("OK");

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    const listResp = await stub.fetch(new Request("https://internal/list-taps"));
    const listJson = await listResp.json() as any;

    expect(listJson.taps).toHaveLength(1);
    expect(listJson.taps[0].amount_msat).toBe(25000);
  });

  test("fakewallet debits correct amount when explicit amount provided", async () => {
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
    } as any;

    const id = env.CARD_REPLAY.idFromName(TEST_UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 50000, note: "Initial funding" }),
    }));

    const { pHex, cHex } = virtualTap(TEST_UID, 6, K1_HEX, keys.k2);

    const debitAmount = 15000;
    const response = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&amount=${debitAmount}`,
      "GET",
      null,
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe("OK");
    expect(json.balance).toBe(35000);
  });
});
