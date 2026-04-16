import worker, { handleRequest } from "../index.js";
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

const makeKvEnv = (initialStore = {}) => {
  const kvStore = { ...initialStore };
  const replay = makeReplayNamespace();
  return {
    ...env,
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

async function makeRequest(path, method = "GET", body = null, requestEnv = env) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

const expectBoltcardKeys = (json) => {
  expect(json).toMatchObject({
    protocol_name: "new_bolt_card_response",
    protocol_version: 1,
    card_name: expect.any(String),
    K0: expect.any(String),
    K1: expect.any(String),
    K2: expect.any(String),
    K3: expect.any(String),
    K4: expect.any(String),
  });
};

describe("response patterns", () => {
  test("GET /status returns JSON status when UID_CONFIG exists", async () => {
    const response = await makeRequest("/status", "GET", null, makeKvEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "OK",
      kv_status: "working",
      message: "Server is running",
    });
  });

  test("GET /status redirects to /activate when UID_CONFIG is absent", async () => {
    const response = await makeRequest("/status");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://test.local/activate");
  });

  test("GET /wipe returns JSON boltcard payload for valid uid", async () => {
    const response = await makeRequest("/wipe?uid=04996c6a926980", "GET", null, makeKvEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expectBoltcardKeys(json);
    expect(json.LNURLW).toContain("lnurlw://test.local/");
  });

  test("GET /wipe returns JSON error body on exception", async () => {
    const { CARD_REPLAY, ...envWithoutReplay } = env;
    const response = await makeRequest("/wipe?uid=04996c6a926980", "GET", null, envWithoutReplay);

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({ error: expect.any(String) });
  });

  test("GET /activate/form returns HTML", async () => {
    const response = await makeRequest("/activate/form");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("BoltCard Activation");
  });

  test("POST /activate/form returns success JSON for valid UID", async () => {
    const requestEnv = makeKvEnv();
    const response = await makeRequest("/activate/form", "POST", { uid: "04a39493cc8680" }, requestEnv);

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "SUCCESS",
      message: expect.any(String),
      uid: "04a39493cc8680",
      config: {
        K2: expect.any(String),
        payment_method: "fakewallet",
      },
    });
  });

  test("POST /activate/form returns JSON error for invalid UID", async () => {
    const response = await makeRequest("/activate/form", "POST", { uid: "bad-uid" }, makeKvEnv());

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      reason: expect.any(String),
    });
  });

  test("POST /activate/form returns JSON error when KV is unavailable", async () => {
    const response = await makeRequest("/activate/form", "POST", { uid: "04a39493cc8680" }, { ...env });

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      reason: expect.any(String),
    });
  });

  test("GET boltcards pull-payment endpoint returns JSON method error", async () => {
    const response = await makeRequest("/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards");

    expect(response.status).toBe(405);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({ error: expect.any(String) });
  });

  test("POST boltcards pull-payment endpoint requires UID or LNURLW", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards",
      "POST",
      {},
      makeKvEnv()
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({ error: expect.any(String) });
  });

  test("POST boltcards pull-payment endpoint returns keys for UpdateVersion UID flow", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: "044561fa967380" },
      makeKvEnv()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expectBoltcardKeys(json);
  });

  test("POST boltcards pull-payment endpoint returns keys for KeepVersion LNURLW flow", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion",
      "POST",
      {
        LNURLW: "lnurlw://boltcardpoc.psbt.me/?p=C115F9FA83DCD2FEC0864A3B2DDD0AEF&c=BAA4A9496DEC311D",
      },
      makeKvEnv()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expectBoltcardKeys(json);
  });

  test("POST boltcards pull-payment endpoint returns JSON error on invalid LNURLW", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion",
      "POST",
      { LNURLW: "lnurlw://boltcardpoc.psbt.me/" },
      makeKvEnv()
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({ error: expect.any(String) });
  });

  test("POST /boltcards/api/v1/lnurl/cb returns JSON error when k1 is missing", async () => {
    const response = await makeRequest(
      "/boltcards/api/v1/lnurl/cb",
      "POST",
      { invoice: "lnbc1000n1ptest", amount: 1000 },
      makeKvEnv()
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      reason: expect.any(String),
    });
  });

  test("POST /boltcards/api/v1/lnurl/cb returns JSON success when k1 is valid", async () => {
    const response = await makeRequest(
      "/boltcards/api/v1/lnurl/cb",
      "POST",
      {
        invoice: "lnbc1000n1p...your_bolt11_invoice...",
        amount: 1000,
        k1: "p=3736A84681238418D4B9B7210C13DC39&c=1549E9D901188F77",
      },
      makeKvEnv()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "200",
      message: "POST received",
    });
  });

  test("unknown route returns 404 text response", async () => {
    const response = await makeRequest("/nope");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("Not found");
  });

  test("rate-limited requests return JSON error response", async () => {
    const request = new Request("https://test.local/status", {
      headers: { "CF-Connecting-IP": "198.51.100.10" },
    });

    const response = await worker.fetch(request, {
      ...env,
      RATE_LIMITS: {
        get: async () => "100",
        put: async () => {},
      },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      reason: "Rate limit exceeded",
    });
  });

  test("proxy responses preserve upstream JSON content type and shape through router", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ status: "OK" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const proxyEnv = {
      ...env,
      CARD_REPLAY: makeReplayNamespace(),
      UID_CONFIG: {
        get: async (uid) => uid === "04996c6a926980"
          ? JSON.stringify({
              payment_method: "proxy",
              proxy: {
                baseurl: "https://relay.example.com/boltcards/api/v1/scan/test-backend",
              },
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
      expect(response.headers.get("Content-Type")).toContain("application/json");

      const json = await response.json();
      expect(json).toMatchObject({ status: "OK" });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
