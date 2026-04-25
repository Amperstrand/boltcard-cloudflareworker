import worker, { handleRequest } from "../index.js";
import { jest } from "@jest/globals";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, computeAesCmacForVerification } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import AES from "aes-js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

const env = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CLN_PROTOCOL: "https",
  CLN_IP: "192.0.2.10",
  CLN_PORT: "8080",
  CLN_RUNE: "your-rune-string",
  CARD_REPLAY: makeReplayNamespace(),
  ...TEST_OPERATOR_AUTH,
};

const LEGACY_UID_CONFIGS = {
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
  "04d070fa967380": JSON.stringify({
    K2: "6DA6F8D39F574BDF304FEFFA896D9B99",
    payment_method: "lnurlpay",
    lnurlpay: {
      lightning_address: "test@getalby.com",
      min_sendable: 1000,
      max_sendable: 1000,
    },
  }),
};

const DO_CARD_CONFIGS = {
  "04996c6a926980": JSON.parse(LEGACY_UID_CONFIGS["04996c6a926980"]),
  "044561fa967380": JSON.parse(LEGACY_UID_CONFIGS["044561fa967380"]),
  "04d070fa967380": JSON.parse(LEGACY_UID_CONFIGS["04d070fa967380"]),
};

const seedDoConfigs = (replay, configs = DO_CARD_CONFIGS) => {
  Object.entries(configs).forEach(([uid, config]) => {
    replay.__cardConfigs.set(uid.toLowerCase(), config);
  });
  return replay;
};

const makeKvEnv = (initialStore = {}) => {
  const kvStore = { ...LEGACY_UID_CONFIGS, ...initialStore };
  const replay = seedDoConfigs(makeReplayNamespace());
  return {
    ...env,
    UID_CONFIG: {
      get: async (key) => kvStore[key] ?? null,
      put: async (key, value) => {
        kvStore[key] = value;
      },
      delete: async (key) => {
        delete kvStore[key];
      },
    },
    CARD_REPLAY: replay,
    __kvStore: kvStore,
    __replayStore: replay.__counters,
    __cardConfigs: replay.__cardConfigs,
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
    PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
    PROTOCOL_VERSION: "1",
    CARD_NAME: expect.any(String),
    ID: "1",
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
    expect(response.headers.get("Location")).toBe("https://test.local/login");
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
    expect(json).toMatchObject({
      status: "ERROR",
      reason: expect.any(String),
      error: expect.any(String),
      success: false,
    });
  });

  test("GET /activate/form returns HTML", async () => {
    const response = await makeRequest("/experimental/activate/form");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("BoltCard Activation");
  });

  test("GET /activate returns HTML with NFC console link", async () => {
    const response = await makeRequest("/experimental/activate");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("CARD ACTIVATION");
    expect(html).toContain('href="/debug#console"');
    expect(html).toContain("OPEN NFC TEST CONSOLE");
  });

  test("GET /experimental/nfc redirects to /debug#console", async () => {
    const response = await makeRequest("/experimental/nfc");

    expect(response.status).toBe(301);
    const location = response.headers.get("Location");
    expect(location).toBe("https://test.local/debug#console");
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

  test("POST /activate/form returns JSON error when DO is unavailable", async () => {
    const { CARD_REPLAY, ...envWithoutReplay } = env;
    const response = await makeRequest("/activate/form", "POST", { uid: "04a39493cc8680" }, envWithoutReplay);

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
    expect(json).toMatchObject({
      status: "ERROR",
      reason: expect.any(String),
      error: expect.any(String),
      success: false,
    });
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
    expect(json).toMatchObject({
      status: "ERROR",
      reason: expect.any(String),
      error: expect.any(String),
      success: false,
    });
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

  test("POST boltcards auto-registers new UID as fakewallet in DO", async () => {
    const kvEnv = makeKvEnv();

    const newUid = "04a39493cc8680";
    expect(kvEnv.__cardConfigs.get(newUid)).toBeUndefined();

    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: newUid },
      kvEnv
    );

    expect(response.status).toBe(200);

    const savedConfig = kvEnv.__cardConfigs.get(newUid);
    expect(savedConfig.payment_method).toBe("fakewallet");
    expect(savedConfig.K2).toBeDefined();
    expect(savedConfig.K2.length).toBe(32);
  });

  test("POST boltcards program withdraw overwrites existing DO mode to fakewallet", async () => {
    const existingConfig = JSON.stringify({
      K2: "EXISTINGKEY",
      payment_method: "lnurlpay",
      lnurlpay: {
        lightning_address: "merchant@getalby.com",
        min_sendable: 2000,
        max_sendable: 2000,
      },
    });
    const kvEnv = makeKvEnv({ "04a39493cc8680": existingConfig });
    kvEnv.__cardConfigs.set("04a39493cc8680", JSON.parse(existingConfig));

    await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: "04a39493cc8680" },
      kvEnv
    );

    const savedConfig = kvEnv.__cardConfigs.get("04a39493cc8680");
    expect(savedConfig.payment_method).toBe("fakewallet");
    expect(savedConfig.K2).toBeDefined();
    expect(savedConfig.K2.length).toBe(32);
  });

  test("POST boltcards with card_type=pos registers as lnurlpay in DO", async () => {
    const kvEnv = makeKvEnv();
    const posUid = "04a123fa967380";

    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion&card_type=pos&lightning_address=merchant%40getalby.com&min_sendable=2000&max_sendable=2000",
      "POST",
      { UID: posUid },
      kvEnv
    );

    expect(response.status).toBe(200);
    const savedConfig = kvEnv.__cardConfigs.get(posUid);
    expect(savedConfig.payment_method).toBe("lnurlpay");
    expect(savedConfig.lnurlpay.lightning_address).toBe("merchant@getalby.com");
    expect(savedConfig.lnurlpay.min_sendable).toBe(2000);
    expect(savedConfig.lnurlpay.max_sendable).toBe(2000);
    expect(savedConfig.K2).toBeDefined();
  });

  test("POST boltcards with card_type=pos rejects missing lightning_address", async () => {
    const kvEnv = makeKvEnv();

    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion&card_type=pos",
      "POST",
      { UID: "04a123fa967380" },
      kvEnv
    );

    expect(response.status).toBe(400);
  });

  test("POST boltcards can flip the same UID from withdraw to POS and back", async () => {
    const kvEnv = makeKvEnv();
    const uid = "04a123fa967380";

    const withdrawResponse = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: uid },
      kvEnv
    );
    expect(withdrawResponse.status).toBe(200);
    let savedConfig = kvEnv.__cardConfigs.get(uid);
    expect(savedConfig.payment_method).toBe("fakewallet");

    // Terminate card before reprogramming to a different card type
    kvEnv.CARD_REPLAY.__cardStates.get(uid.toLowerCase()).state = "terminated";

    const posResponse = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion&card_type=pos&lightning_address=merchant%40getalby.com&min_sendable=2000&max_sendable=2000",
      "POST",
      { UID: uid },
      kvEnv
    );
    expect(posResponse.status).toBe(200);
    savedConfig = kvEnv.__cardConfigs.get(uid);
    expect(savedConfig.payment_method).toBe("lnurlpay");
    expect(savedConfig.lnurlpay.lightning_address).toBe("merchant@getalby.com");

    // Terminate again before reprogramming back to withdraw
    kvEnv.CARD_REPLAY.__cardStates.get(uid.toLowerCase()).state = "terminated";

    const withdrawAgainResponse = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: uid },
      kvEnv
    );
    expect(withdrawAgainResponse.status).toBe(200);
    savedConfig = kvEnv.__cardConfigs.get(uid);
    expect(savedConfig.payment_method).toBe("fakewallet");
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

  test("POST /boltcards/api/v1/lnurl/cb returns 405 even without k1", async () => {
    const response = await makeRequest(
      "/boltcards/api/v1/lnurl/cb",
      "POST",
      { invoice: "lnbc1000n1ptest", amount: 1000 },
      makeKvEnv()
    );

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.status).toBe("ERROR");
    expect(body.reason).toContain("Method Not Allowed");
  });

  test("POST /boltcards/api/v1/lnurl/cb returns Method Not Allowed", async () => {
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

    expect(response.status).toBe(405);
    const body2 = await response.json();
    expect(body2.status).toBe("ERROR");
    expect(body2.reason).toContain("Method Not Allowed");
  });

  test("unknown route returns 404 text response", async () => {
    const response = await makeRequest("/nope");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const json = await response.json();
    expect(json.status).toBe("ERROR");
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

  /**
   * End-to-end simulation for UID 00000000000000 (all zeros — edge case).
   *
   * Flow:
   *   1. Auto-register via the programming endpoint (like the writer app does)
   *   2. Generate valid p (encrypted PICCData) and c (CMAC) using the same
   *      K1/K2 the server will use
   *   3. Simulate a card tap (GET /?p=...&c=...)
   *   4. Verify the server returns a valid LNURL withdraw request
   */
  test("full flow: auto-register and tap card with UID all zeros", async () => {
    const zeroUid = "00000000000000";
    const kvEnv = makeKvEnv();

    // --- Step 1: Auto-register via programming endpoint ---
    const progResponse = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: zeroUid },
      kvEnv
    );
    expect(progResponse.status).toBe(200);

    const savedConfig = kvEnv.__cardConfigs.get(zeroUid);
    expect(savedConfig.payment_method).toBe("fakewallet");
    expect(savedConfig.K2).toBeDefined();

    // --- Step 2: Generate valid p and c ---
    // K1 for encryption = first key in BOLT_CARD_K1 (what the server decrypts with)
    const k1Hex = kvEnv.BOLT_CARD_K1.split(",")[0];
    const k1Bytes = hexToBytes(k1Hex);

    // K2 for CMAC = from deterministic keys (what was stored in KV)
    const keys = getDeterministicKeys(zeroUid, kvEnv);
    const k2Bytes = hexToBytes(keys.k2);

    // Build PICCData plaintext: [0xC7][UID 7 bytes][Counter LE 3 bytes][Padding 5 bytes]
    const counter = 1;
    const piccPlain = new Uint8Array(16);
    piccPlain[0] = 0xC7;
    piccPlain.set(hexToBytes(zeroUid), 1);     // bytes 1-7: UID
    piccPlain[8] = counter & 0xFF;             // byte 8: counter LSB
    piccPlain[9] = (counter >> 8) & 0xFF;      // byte 9
    piccPlain[10] = (counter >> 16) & 0xFF;    // byte 10: counter MSB
    // bytes 11-15: padding (already 0)

    // Encrypt with K1 (AES-128-ECB)
    const aesEcb = new AES.ModeOfOperation.ecb(k1Bytes);
    const pBytes = aesEcb.encrypt(piccPlain);
    const pHex = bytesToHex(pBytes);

    // Compute CMAC verification tag (c)
    // Counter bytes as extracted by server: [decrypted[10], decrypted[9], decrypted[8]]
    const ctrBytes = new Uint8Array([
      (counter >> 16) & 0xFF,
      (counter >> 8) & 0xFF,
      counter & 0xFF,
    ]);
    const uidBytes = hexToBytes(zeroUid);
    const ctBytes = computeAesCmacForVerification(
      // SV2 = [3C C3 00 01 00 80][UID 7][ctr[2] ctr[1] ctr[0]]
      new Uint8Array([
        0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80,
        ...uidBytes,
        ctrBytes[2], ctrBytes[1], ctrBytes[0],
      ]),
      k2Bytes
    );
    const cHex = bytesToHex(ctBytes);

    // --- Step 3: Simulate card tap ---
    const tapResponse = await makeRequest(
      `/?p=${pHex}&c=${cHex}`,
      "GET",
      null,
      kvEnv
    );

    // --- Step 4: Verify LNURL withdraw response ---
    expect(tapResponse.status).toBe(200);
    expect(tapResponse.headers.get("Content-Type")).toContain("application/json");

    const json = await tapResponse.json();
    expect(json.tag).toBe("withdrawRequest");
    expect(json.callback).toBeDefined();
    expect(json.k1).toBeDefined();
    expect(json.minWithdrawable).toBeGreaterThan(0);
    expect(json.maxWithdrawable).toBeGreaterThanOrEqual(json.minWithdrawable);
    expect(json.defaultDescription).toContain("Boltcard payment");
  });

  test("proxy responses preserve upstream JSON content type and shape through router", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ status: "OK" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const proxyEnv = {
      ...env,
      CARD_REPLAY: seedDoConfigs(makeReplayNamespace(), {
        "04996c6a926980": {
          K2: "B45775776CB224C75BCDE7CA3704E933",
          payment_method: "proxy",
          proxy: {
            baseurl: "https://relay.example.com/boltcards/api/v1/scan/test-backend",
          },
        },
      }),
      UID_CONFIG: {
        get: async (uid) => uid === "04996c6a926980"
          ? JSON.stringify({
              K2: "B45775776CB224C75BCDE7CA3704E933",
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

  describe("short-URL redirects", () => {
    const redirectPaths = [
      { from: "/nfc", to: "/debug#console" },
      { from: "/activate", to: "/experimental/activate" },
      { from: "/activate/form", to: "/experimental/activate/form" },
      { from: "/bulkwipe", to: "/experimental/bulkwipe" },
      { from: "/analytics", to: "/experimental/analytics" },
    ];

    for (const { from, to } of redirectPaths) {
      test(`${from} redirects to ${to} with 301 and absolute URL`, async () => {
        const response = await makeRequest(from);
        expect(response.status).toBe(301);
        const location = response.headers.get("Location");
        expect(location).toBe("https://test.local" + to);
        expect(location).toMatch(/^https:\/\//);
      });
    }

    test("/pos redirects to /operator/pos with 302", async () => {
      const response = await makeRequest("/pos");
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/operator/pos");
    });

    test("/operator redirects to /operator/pos", async () => {
      const response = await makeRequest("/operator", "GET", null, makeKvEnv());
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/operator/pos");
    });
  });
});
