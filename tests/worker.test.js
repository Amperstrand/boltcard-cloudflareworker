import { handleRequest } from "../index.js"; // Import the handleRequest function for testing
import { jest } from "@jest/globals";
import { makeReplayNamespace } from "./replayNamespace.js";

const env = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CLN_PROTOCOL: "https",
  CLN_IP: "192.0.2.10",
  CLN_PORT: "8080",
  CLN_RUNE: "your-rune-string",
  CARD_REPLAY: makeReplayNamespace(),
};

const baseEnv = env;

const makeKvEnv = (initialStore = {}) => {
  const kvStore = { ...initialStore };
  const replay = makeReplayNamespace();
  return {
    ...baseEnv,
    UID_CONFIG: {
      get: async (key) => kvStore[key] ?? null,
      put: async (key, value) => {
        kvStore[key] = value;
      },
    },
    CARD_REPLAY: replay,
    __kvStore: kvStore,
    __replayStore: replay.__counters,
  };
};

// Helper function to send requests to the Worker
async function makeRequest(path, method = "GET", body = null, requestEnv = env) {
  const url = "https://test.local" + path; // Use a mock domain
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv); // Pass the environment
}

describe("Cloudflare Worker Tests", () => {
  test("should return LNURLW withdraw request", async () => {
    const response = await makeRequest(
      "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE"
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toMatchObject({
      tag: "withdrawRequest",
      callback: expect.stringContaining("/api/v1/lnurl/cb/4E2E289D945A66BB13377A728884E867"),
      k1: "E19CCB1FED8892CE",
      minWithdrawable: 1000,
      maxWithdrawable: 1000,
      defaultDescription: expect.stringContaining("Boltcard payment from UID"),
    });
  });

  test("should return valid withdraw request for different UID", async () => {
    const response = await makeRequest(
      "/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4"
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    
    expect(json).toMatchObject({
      tag: "withdrawRequest",
      callback: expect.stringContaining("/api/v1/lnurl/cb/00F48C4F8E386DED06BCDC78FA92E2FE"),
      k1: "66B4826EA4C155B4",
      minWithdrawable: 1000,
      maxWithdrawable: 1000,
      defaultDescription: expect.stringContaining("Boltcard payment from UID"),
    });
  });

  test("should return valid LNURL callback response", async () => {
    const response = await makeRequest(
      "/boltcards/api/v1/lnurl/cb",
      "POST",
      {
        invoice: "lnbc1000n1p...your_bolt11_invoice...",
        amount: 1000,
        k1: "p=3736A84681238418D4B9B7210C13DC39&c=1549E9D901188F77"
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    
    expect(json).toMatchObject({
      status: "200"
    });
  });

  // New test case for Pull Payment with KeepVersion
  test("should handle pull payment with KeepVersion", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion",
      "POST",
      {
        LNURLW: "lnurlw://boltcardpoc.psbt.me/?p=C115F9FA83DCD2FEC0864A3B2DDD0AEF&c=BAA4A9496DEC311D"
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toMatchObject({
      PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
      PROTOCOL_VERSION: "1",
      CARD_NAME: "UID 044561FA967380",
      ID: "1",
      LNURLW: expect.stringContaining("lnurlw://test.local/"),
      K0: "157163032EF8A8F89C5FC3C271675A3C",
      K1: "55DA174C9608993DC27BB3F30A4A7314",
      K2: "33268DEA5B5511A1B3DF961198FA46D5",
      K3: "F78200E8918FCEEA9DB3574AE35B67E7",
      K4: "62F41E0DCFF67E74DB596AE0FE1C0A3F"
    });
  });

  test("should support decrypt-only proxy relay when K2 is omitted", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ status: "OK" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const proxyEnv = {
      ...env,
      CARD_REPLAY: makeReplayNamespace(),
      UID_CONFIG: {
        get: async (uid) => uid === "04996c6a926980"
          ? JSON.stringify({
              payment_method: "proxy",
              proxy: {
                baseurl: "https://relay.example.com/boltcards/api/v1/scan/test-backend"
              }
            })
          : null,
        put: async () => {},
      },
    };

    try {
      const response = await handleRequest(
        new Request("https://test.local/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE"),
        proxyEnv
      );

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const proxiedRequest = global.fetch.mock.calls[0][0];
      expect(proxiedRequest.url).toContain("https://relay.example.com/boltcards/api/v1/scan/test-backend");
      expect(proxiedRequest.url).toContain("p=4E2E289D945A66BB13377A728884E867");
      expect(proxiedRequest.url).toContain("c=E19CCB1FED8892CE");
      expect(proxiedRequest.headers.get("X-BoltCard-UID")).toBe("04996c6a926980");
      expect(proxiedRequest.headers.get("X-BoltCard-CMAC-Validated")).toBe("false");
      expect(proxiedRequest.headers.get("X-BoltCard-CMAC-Deferred")).toBe("true");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("should still require K2 for local withdraw responses", async () => {
    const localEnv = {
      ...env,
      CARD_REPLAY: makeReplayNamespace(),
      UID_CONFIG: {
        get: async (uid) => uid === "04996c6a926980"
          ? JSON.stringify({ payment_method: "clnrest" })
          : null,
        put: async () => {},
      },
    };

    const response = await handleRequest(
      new Request("https://test.local/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE"),
      localEnv
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.reason || json.error).toContain("K2");
  });

  describe("counter replay protection", () => {
    const counterThreePath = "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE";
    const counterFivePath = "/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4";
    const counterKey = "counter:04996c6a926980";

    test("first tap with no stored counter succeeds", async () => {
      const kvEnv = makeKvEnv();

      const response = await makeRequest(counterThreePath, "GET", null, kvEnv);

      expect(response.status).toBe(200);
      expect(kvEnv.__replayStore.get("04996c6a926980")).toBe(3);
    });

    test("replay with same counter is rejected", async () => {
      const kvEnv = makeKvEnv();

      const firstResponse = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(firstResponse.status).toBe(200);

      const replayResponse = await makeRequest(counterThreePath, "GET", null, kvEnv);

      expect(replayResponse.status).toBe(400);
      const json = await replayResponse.json();
      expect(json.reason || json.error).toMatch(/replay|counter/i);
      expect(kvEnv.__replayStore.get("04996c6a926980")).toBe(3);
    });

    test("incrementing counter succeeds", async () => {
      const kvEnv = makeKvEnv({ [counterKey]: "3" });
      kvEnv.CARD_REPLAY = makeReplayNamespace({ "04996c6a926980": 3 });
      kvEnv.__replayStore = kvEnv.CARD_REPLAY.__counters;

      const response = await makeRequest(counterFivePath, "GET", null, kvEnv);

      expect(response.status).toBe(200);
      expect(kvEnv.__replayStore.get("04996c6a926980")).toBe(5);
    });

    test("wipe resets replay state for reprovisioned cards", async () => {
      const kvEnv = makeKvEnv();

      const firstTap = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(firstTap.status).toBe(200);
      expect(kvEnv.__replayStore.get("04996c6a926980")).toBe(3);

      const wipeResponse = await handleRequest(
        new Request("https://test.local/wipe?uid=04996c6a926980"),
        kvEnv
      );
      expect(wipeResponse.status).toBe(200);
      expect(kvEnv.__replayStore.has("04996c6a926980")).toBe(false);

      const replayAfterWipe = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(replayAfterWipe.status).toBe(200);
      expect(kvEnv.__replayStore.get("04996c6a926980")).toBe(3);
    });
  });
});
