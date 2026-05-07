import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

const env: Record<string, unknown> = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CLN_PROTOCOL: "https",
  CLN_IP: "192.0.2.10",
  CLN_PORT: "8080",
  CLN_RUNE: "your-rune-string",
  CARD_REPLAY: makeReplayNamespace(),
  ...TEST_OPERATOR_AUTH,
};

const LEGACY_UID_CONFIGS: Record<string, string> = {
  "04996c6a926980": JSON.stringify({
    K2: "B45775776CB224C75BCDE7CA3704E933",
    payment_method: "clnrest",
    clnrest: {
      protocol: "https",
      host: "https://cln.example.com",
      port: 3001,
      rune: "abcd1234efgh5678ijkl",
    },
  }),
  "044561fa967380": JSON.stringify({
    K2: "33268DEA5B5511A1B3DF961198FA46D5",
    payment_method: "clnrest",
    proxy: {
      baseurl: "https://demo.lnbits.com/boltcards/api/v1/scan/tapko6sbthfdgzoejjztjb",
    },
    clnrest: {
      protocol: "httpsnotusing",
      host: "https://restk.psbt.me:3010",
      port: 3010,
      rune: "dummy",
    },
  }),
};

const DO_CARD_CONFIGS: Record<string, Record<string, unknown>> = {
  "04996c6a926980": JSON.parse(LEGACY_UID_CONFIGS["04996c6a926980"]!),
  "044561fa967380": JSON.parse(LEGACY_UID_CONFIGS["044561fa967380"]!),
};

const seedDoConfigs = (replay: ReturnType<typeof makeReplayNamespace>, configs: Record<string, unknown> = DO_CARD_CONFIGS) => {
  Object.entries(configs).forEach(([uid, config]) => {
    (replay as any).__cardConfigs.set(uid.toLowerCase(), config);
  });
  return replay;
};

seedDoConfigs(env.CARD_REPLAY as ReturnType<typeof makeReplayNamespace>);

env.UID_CONFIG = {
  get: async (key: string) => LEGACY_UID_CONFIGS[key] ?? null,
  put: async () => {},
};

const baseEnv = env;

const makeKvEnv = (initialStore: Record<string, string> = {}) => {
  const kvStore = { ...LEGACY_UID_CONFIGS, ...initialStore };
  const replay = seedDoConfigs(makeReplayNamespace());
  return {
    ...baseEnv,
    UID_CONFIG: {
      get: async (key: string) => kvStore[key] ?? null,
      put: async (key: string, value: string) => {
        kvStore[key] = value;
      },
    },
    CARD_REPLAY: replay,
    __kvStore: kvStore,
    __replayStore: (replay as any).__counters,
  };
};

async function makeRequest(path: string, method = "GET", body: Record<string, unknown> | null = null, requestEnv: Record<string, unknown> = env) {
  const url = "https://test.local" + path;
  const options: RequestInit & { headers?: Record<string, string> } = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv as unknown as Env);
}

describe("Cloudflare Worker Tests", () => {
  test("should return LNURLW withdraw request", async () => {
    const response = await makeRequest(
      "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE"
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;

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
    const json = await response.json() as Record<string, unknown>;
    
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

    expect(response.status).toBe(405);
    const body = await response.json() as Record<string, unknown>;
    expect(body.status).toBe("ERROR");
    expect(body.reason).toContain("Method Not Allowed");
  });

  test("should return 405 for POST to LNURL callback", async () => {
    const response = await makeRequest(
      "/boltcards/api/v1/lnurl/cb",
      "POST",
      {
        invoice: "lnbc1000n1p...your_bolt11_invoice...",
        amount: 1000,
        k1: "p=3736A84681238418D4B9B7210C13DC39&c=1549E9D901188F77"
      }
    );

    expect(response.status).toBe(405);
    const body2 = await response.json() as Record<string, unknown>;
    expect(body2.status).toBe("ERROR");
    expect(body2.reason).toContain("Method Not Allowed");
  });

  test("should handle pull payment with KeepVersion", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion",
      "POST",
      {
        LNURLW: "lnurlw://boltcardpoc.psbt.me/?p=C115F9FA83DCD2FEC0864A3B2DDD0AEF&c=BAA4A9496DEC311D"
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;

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

  test("should proxy relay with DO-backed proxy config", async () => {
    const originalFetch = global.fetch;
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ status: "OK" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    global.fetch = mockFetch;

    const proxyEnv: Record<string, unknown> = {
      ...env,
      CARD_REPLAY: seedDoConfigs(makeReplayNamespace(), {
        "04996c6a926980": {
          K2: "B45775776CB224C75BCDE7CA3704E933",
          payment_method: "proxy",
          proxy: {
            baseurl: "https://relay.example.com/boltcards/api/v1/scan/test-backend"
          }
        },
      } as Record<string, unknown>),
      UID_CONFIG: {
        get: async (uid: string) => uid === "04996c6a926980"
          ? JSON.stringify({
              K2: "B45775776CB224C75BCDE7CA3704E933",
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
        proxyEnv as unknown as Env
      );

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const proxiedRequest = ((mockFetch.mock.calls as unknown[][])[0] as unknown[])[0] as Request;
      expect(proxiedRequest.url).toContain("https://relay.example.com/boltcards/api/v1/scan/test-backend");
      expect(proxiedRequest.url).toContain("p=4E2E289D945A66BB13377A728884E867");
      expect(proxiedRequest.url).toContain("c=E19CCB1FED8892CE");
      expect(proxiedRequest.headers.get("X-BoltCard-UID")).toBe("04996c6a926980");
      expect(proxiedRequest.headers.get("X-BoltCard-CMAC-Validated")).toBe("true");
      expect(proxiedRequest.headers.get("X-BoltCard-CMAC-Deferred")).toBe("false");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("should still require K2 for local withdraw responses", async () => {
    const localEnv: Record<string, unknown> = {
      ...env,
      CARD_REPLAY: seedDoConfigs(makeReplayNamespace(), {
        "04996c6a926980": {
          payment_method: "clnrest",
        },
      } as Record<string, unknown>),
      UID_CONFIG: {
        get: async (uid: string) => uid === "04996c6a926980"
          ? JSON.stringify({ payment_method: "clnrest" })
          : null,
        put: async () => {},
      },
    };

    const response = await handleRequest(
      new Request("https://test.local/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE"),
      localEnv as unknown as Env
    );

    expect(response.status).toBe(403);
    const json = await response.json() as Record<string, unknown>;
    expect(json.reason || json.error).toMatch(/CMAC|K2/i);
  });

  describe("counter replay protection", () => {
    const counterThreePath = "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE";
    const counterFivePath = "/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4";
    const counterKey = "counter:04996c6a926980";

    test("first tap with no stored counter succeeds and atomically records counter", async () => {
      const kvEnv = makeKvEnv();

      const response = await makeRequest(counterThreePath, "GET", null, kvEnv);

      expect(response.status).toBe(200);
      expect((kvEnv.__replayStore as Map<string, number>).has("04996c6a926980")).toBe(true);
      expect((kvEnv.__replayStore as Map<string, number>).get("04996c6a926980")).toBe(3);
    });

    test("replay is rejected only if counter was previously recorded", async () => {
      const kvEnv = makeKvEnv() as Record<string, unknown>;
      kvEnv.CARD_REPLAY = seedDoConfigs(makeReplayNamespace({ "04996c6a926980": 3 }));
      kvEnv.__replayStore = (kvEnv.CARD_REPLAY as any).__counters;

      const replayResponse = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(replayResponse.status).toBe(409);
      const json = await replayResponse.json() as Record<string, unknown>;
      expect(json.reason || json.error).toMatch(/replay|counter/i);
    });

    test("replayed Step 1 with same counter is rejected (atomic advance)", async () => {
      const kvEnv = makeKvEnv();
      const first = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(first.status).toBe(200);

      const second = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(second.status).toBe(409);
    });

    test("incrementing counter succeeds", async () => {
      const kvEnv = makeKvEnv({ [counterKey]: "3" }) as Record<string, unknown>;
      kvEnv.CARD_REPLAY = seedDoConfigs(makeReplayNamespace({ "04996c6a926980": 3 }));
      kvEnv.__replayStore = (kvEnv.CARD_REPLAY as any).__counters;

      const response = await makeRequest(counterFivePath, "GET", null, kvEnv);

      expect(response.status).toBe(200);
      expect((kvEnv.__replayStore as Map<string, number>).get("04996c6a926980")).toBe(5);
    });

    test("wipe resets replay state for reprovisioned cards", async () => {
      const kvEnv = makeKvEnv() as Record<string, unknown>;

      (kvEnv.CARD_REPLAY as any).__activate("04996c6a926980", 1);

      const firstTap = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(firstTap.status).toBe(200);
      expect((kvEnv.__replayStore as Map<string, number>).has("04996c6a926980")).toBe(true);
      expect((kvEnv.__replayStore as Map<string, number>).get("04996c6a926980")).toBe(3);

      const wipeResponse = await handleRequest(
        new Request("https://test.local/wipe?uid=04996c6a926980"),
        kvEnv as unknown as Env
      );
      expect(wipeResponse.status).toBe(200);
      expect((kvEnv.__replayStore as Map<string, number>).has("04996c6a926980")).toBe(false);

      const blockedTap = await makeRequest(counterThreePath, "GET", null, kvEnv);
      expect(blockedTap.status).toBe(403);
    });
  });
});
