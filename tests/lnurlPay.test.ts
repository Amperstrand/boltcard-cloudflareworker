import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const POS_UID_CONFIG_OBJECT = {
  K2: "6DA6F8D39F574BDF304FEFFA896D9B99",
  payment_method: "lnurlpay",
  lnurlpay: {
    lightning_address: "test@getalby.com",
    min_sendable: 1000,
    max_sendable: 1000,
  },
} as Record<string, unknown>;

const baseEnv: Record<string, unknown> = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CARD_REPLAY: makeReplayNamespace(),
  UID_CONFIG: {
    get: async (uid: string) => uid === "04d070fa967380" ? POS_UID_CONFIG_OBJECT : null,
    put: async () => {},
  },
};

const PAY_COUNTER_1 = "5737314e568ac8d16fe910a3a865be46";
const PAY_CMAC_1 = "9c5fac2622562c63";

const PAY_COUNTER_2 = "c18ab5683baf7e913d8ddd236477bf50";
const PAY_CMAC_2 = "e793e09cb10c2333";

const FAKE_INVOICE = "lnbc10n1p3knh2rpp5j3testinvoice";
const POS_UID_CONFIG = JSON.stringify(POS_UID_CONFIG_OBJECT);

(baseEnv.CARD_REPLAY as any).__cardConfigs.set("04d070fa967380", POS_UID_CONFIG_OBJECT);

async function makeRequest(path: string, method = "GET", body: Record<string, unknown> | null = null, requestEnv: Record<string, unknown> = baseEnv) {
  const url = "https://test.local" + path;
  const options: RequestInit & { headers?: Record<string, string> } = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv as unknown as Env);
}

function makePayEnv(replayInitial: Record<string, number> = {}) {
  const replay = makeReplayNamespace(replayInitial);
  (replay as any).__cardConfigs.set("04d070fa967380", POS_UID_CONFIG_OBJECT);
  return {
    ...baseEnv,
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async (uid: string) => uid === "04d070fa967380" ? POS_UID_CONFIG_OBJECT : null,
      put: async () => {},
    },
  };
}

describe("LNURL-pay POS card flow", () => {
  describe("initial tap returns payRequest", () => {
    test("returns payRequest JSON for lnurlpay card", async () => {
      const response = await makeRequest(
        `/?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}`
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;

      expect(json).toMatchObject({
        tag: "payRequest",
        minSendable: 1000,
        maxSendable: 1000,
        metadata: expect.stringContaining("Order #"),
      });

      expect(json.callback).toContain("/lnurlp/cb");
      expect(json.callback).toContain("p=");
      expect(json.callback).toContain("c=");
      expect(json.metadata).toContain("Order #1");
    });

    test("different counter produces different order number", async () => {
      const response = await makeRequest(
        `/?p=${PAY_COUNTER_2}&c=${PAY_CMAC_2}`
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;
      expect(json.metadata).toContain("Order #2");
    });

    test("does not advance replay counter on initial tap", async () => {
      const env = makePayEnv();
      await makeRequest(`/?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}`, "GET", null, env);

      expect((env.CARD_REPLAY as any).__counters.has("04d070fa967380")).toBe(false);
    });

    test("allows same counter on repeated initial taps", async () => {
      const env = makePayEnv();

      const first = await makeRequest(`/?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}`, "GET", null, env);
      expect(first.status).toBe(200);

      const second = await makeRequest(`/?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}`, "GET", null, env);
      expect(second.status).toBe(200);
    });
  });

  describe("/lnurlp/cb callback returns invoice", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      global.fetch = vi.fn(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes(".well-known/lnurlp")) {
          return new Response(JSON.stringify({
            callback: "https://minibits.cash/lnurlp/callback",
            tag: "payRequest",
            minSendable: 1000,
            maxSendable: 100000000,
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (urlStr.includes("callback") && urlStr.includes("amount=")) {
          return new Response(JSON.stringify({
            pr: FAKE_INVOICE,
            routes: [],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        return new Response("Not found", { status: 404 });
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test("card without lightning_address AND no pool env → 503", async () => {
      const env = makePayEnv() as Record<string, unknown>;
      const noAddressConfig = { ...POS_UID_CONFIG_OBJECT, lnurlpay: { ...POS_UID_CONFIG_OBJECT.lnurlpay as Record<string, unknown> } };
      delete (noAddressConfig as Record<string, unknown>).lightning_address;
      delete (noAddressConfig.lnurlpay as Record<string, unknown>).lightning_address;
      (env.UID_CONFIG as Record<string, unknown>).get = async (uid: string) => uid === "04d070fa967380" ? JSON.stringify(noAddressConfig) : null;
      (env.CARD_REPLAY as any).__cardConfigs.set("04d070fa967380", noAddressConfig);

      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );

      expect(response.status).toBe(503);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toContain("No Lightning Address");
    });

    test("card with pool env set → uses pool address", async () => {
      const env = makePayEnv() as Record<string, unknown>;
      const noAddressConfig = { ...POS_UID_CONFIG_OBJECT, lnurlpay: { ...POS_UID_CONFIG_OBJECT.lnurlpay as Record<string, unknown> } };
      delete (noAddressConfig.lnurlpay as Record<string, unknown>).lightning_address;
      (env.UID_CONFIG as Record<string, unknown>).get = async (uid: string) => uid === "04d070fa967380" ? JSON.stringify(noAddressConfig) : null;
      (env.CARD_REPLAY as any).__cardConfigs.set("04d070fa967380", noAddressConfig);
      env.POS_ADDRESS_POOL = "pooltest1@example.com,pooltest2@example.com";

      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;
      expect(json.pr).toBeDefined();
    });

    test("returns invoice from Lightning Address", async () => {
      const env = makePayEnv();

      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;
      expect(json.pr).toBe(FAKE_INVOICE);
      expect(json.routes).toEqual([]);
    });

    test("advances replay counter on successful callback", async () => {
      const env = makePayEnv();

      await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );

      expect((env.CARD_REPLAY as any).__counters.get("04d070fa967380")).toBe(1);
    });

    test("rejects replayed counter on callback", async () => {
      const env = makePayEnv();

      const first = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );
      expect(first.status).toBe(200);

      const replay = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );
      expect(replay.status).toBe(409);
      const json = await replay.json() as Record<string, unknown>;
      expect(json.reason).toMatch(/replay|counter/i);
    });

    test("accepts incrementing counter on callback", async () => {
      const env = makePayEnv({ "04d070fa967380": 1 });

      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_2}&c=${PAY_CMAC_2}&amount=1000`,
        "GET", null, env
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;
      expect(json.pr).toBe(FAKE_INVOICE);
      expect((env.CARD_REPLAY as any).__counters.get("04d070fa967380")).toBe(2);
    });

    test("rejects missing amount parameter", async () => {
      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}`,
        "GET"
      );

      expect(response.status).toBe(400);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toMatch(/amount/i);
    });

    test("rejects invalid amount", async () => {
      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=abc`,
        "GET"
      );

      expect(response.status).toBe(400);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toMatch(/amount/i);
    });

    test("rejects missing p parameter", async () => {
      const response = await makeRequest(
        `/lnurlp/cb?c=${PAY_CMAC_1}&amount=1000`,
        "GET"
      );

      expect(response.status).toBe(400);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toMatch(/p and c/i);
    });

    test("rejects invalid CMAC", async () => {
      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=deadbeefdeadbeef&amount=1000`,
        "GET"
      );

      expect(response.status).toBe(403);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toMatch(/cmac|CMAC/i);
    });

    test("rejects decryption failure in callback", async () => {
      const response = await makeRequest(
        `/lnurlp/cb?p=00000000000000000000000000000000&c=deadbeefdeadbeef&amount=1000`,
        "GET"
      );
      expect(response.status).toBe(400);
    });

    test("rejects non-lnurlpay payment method in callback", async () => {
      const env = makePayEnv() as Record<string, unknown>;
      const fakewalletConfig = { ...POS_UID_CONFIG_OBJECT, payment_method: "fakewallet", K2: POS_UID_CONFIG_OBJECT.K2 };
      (env.CARD_REPLAY as any).__cardConfigs.set("04d070fa967380", fakewalletConfig);
      (env.UID_CONFIG as Record<string, unknown>).get = async (uid: string) => uid === "04d070fa967380" ? fakewalletConfig : null;

      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );
      expect(response.status).toBe(400);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toContain("Unsupported payment method");
    });

    test("rejects amount outside range", async () => {
      const env = makePayEnv();

      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=5000`,
        "GET", null, env
      );
      expect(response.status).toBe(400);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toContain("outside allowed range");
    });

    test("rejects zero amount", async () => {
      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=0`,
        "GET"
      );
      expect(response.status).toBe(400);
    });

    test("forwards correct amount to Lightning Address", async () => {
      const env = makePayEnv();

      await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      const callbackCall = mockFetch.mock.calls.find(
        (call: unknown[]) => (call[0] as Request).toString().includes("amount=1000")
      );
      expect(callbackCall).toBeDefined();
    });

    test("returns 500 when recordTap throws", async () => {
      const replay = makeReplayNamespace();
      (replay as any).__cardConfigs.set("04d070fa967380", POS_UID_CONFIG_OBJECT);
      const origGet = replay.get.bind(replay);
      (replay as any).get = (id: any) => {
        const obj = origGet(id);
        const origFetch = obj.fetch.bind(obj);
        return {
          fetch: async (request: Request) => {
            const url = new URL(request.url);
            if (url.pathname === "/record-tap") throw new Error("DO unavailable");
            return origFetch(request);
          },
        } as unknown as DurableObjectStub;
      };
      const env = { ...baseEnv, CARD_REPLAY: replay };
      const response = await makeRequest(
        `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
        "GET", null, env
      );
      expect(response.status).toBe(500);
      const json = await response.json() as Record<string, unknown>;
      expect(json.reason).toContain("Replay protection unavailable");
    });

    test("returns 500 on outer catch when resolveLightningAddress throws", async () => {
      const env = makePayEnv();
      const mockFetch = vi.fn().mockRejectedValue(new Error("DNS failure"));
      global.fetch = mockFetch;
      try {
        const response = await makeRequest(
          `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`,
          "GET", null, env
        );
        expect(response.status).toBe(500);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });
});
