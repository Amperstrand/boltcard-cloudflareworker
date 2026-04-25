import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const env = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  ISSUER_KEY: "00000000000000000000000000000001",
  CARD_REPLAY: makeReplayNamespace(),
};

// Test vector: p/c that decrypts with K1=55da174c9608993dc27bb3f30a4a7314
const VALID_P = "4E2E289D945A66BB13377A728884E867";
const VALID_C = "E19CCB1FED8892CE";
const ACTION_UID = "04a39493cc8680";

function makeEnv(replay = makeReplayNamespace()) {
  return {
    ...env,
    CARD_REPLAY: replay,
  };
}

function makeEnvWithoutIssuerKey(replay = makeReplayNamespace()) {
  const { ISSUER_KEY, ...envWithoutKey } = env;
  return {
    ...envWithoutKey,
    CARD_REPLAY: replay,
  };
}

async function makeRequest(path, method = "GET", body = null, requestEnv = env) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

describe("GET /login", () => {
  test("returns HTML login page", async () => {
    const response = await makeRequest("/login");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("NFC LOGIN");
    expect(html).toContain("NTAG424");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("function browserSupportsNfc()");
  });
});

describe("POST /login (handleLoginVerify)", () => {
  test("missing p returns 400", async () => {
    const response = await makeRequest("/login", "POST", { c: VALID_C });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.any(String),
      reason: expect.any(String),
    });
    expect(json.error).toMatch(/missing p or c/i);
  });

  test("missing c returns 400", async () => {
    const response = await makeRequest("/login", "POST", { p: VALID_P });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.any(String),
      reason: expect.any(String),
    });
  });

  test("missing both p and c returns 400", async () => {
    const response = await makeRequest("/login", "POST", {});
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.any(String),
      reason: expect.any(String),
    });
  });

  test("invalid p that cannot be decrypted returns 400", async () => {
    const response = await makeRequest("/login", "POST", {
      p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      c: "FFFFFFFFFFFFFFFF",
    });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.any(String),
      reason: expect.any(String),
    });
    expect(json.error).toMatch(/could not decrypt/i);
  });

  test("valid p/c returns success with uidHex and keys", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.uidHex).toBeTruthy();
    expect(json.uidHex).toMatch(/^[0-9a-f]{14}$/);
    expect(typeof json.k0).toBe("string");
    expect(typeof json.k1).toBe("string");
    expect(typeof json.k2).toBe("string");
    expect(typeof json.k3).toBe("string");
    expect(typeof json.k4).toBe("string");
    expect(json.k0).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k1).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k2).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k3).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k4).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof json.cmacValid).toBe("boolean");
  });

  test("valid p with wrong c returns success but cmacValid false", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: "0000000000000000",
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.cmacValid).toBe(false);
  });

  test("response includes counterValue", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.counterValue).toBe("number");
    expect(json.counterValue).toBeGreaterThan(0);
  });

  test("response includes ndef URL", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(json.ndef).toMatch(/^https:\/\//);
    expect(json.ndef).toContain("p=");
    expect(json.ndef).toContain("c=");
  });

  test("response includes cardType", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.cardType).toBe("string");
  });

  test("response includes issuerKey label", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.issuerKey).toBe("string");
    expect(json.issuerKey.length).toBeGreaterThan(0);
  });

  test("response includes timestamp", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.timestamp).toBe("number");
    expect(json.timestamp).toBeGreaterThan(0);
  });

  test("UID-only login returns success with undeployed card details", async () => {
    const response = await makeRequest("/login", "POST", { uid: ACTION_UID }, makeEnv());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      uidHex: ACTION_UID,
      counterValue: null,
      cmacValid: false,
      deployed: false,
      cardState: "new",
      tapHistory: [],
    });
    expect(json.k0).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k4).toMatch(/^[0-9a-f]{32}$/);
  });

  test("request-wipe rejects non-active cards with standardized error", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "request-wipe" },
      makeEnv()
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.stringMatching(/Only active cards can request wipe keys/i),
      reason: expect.stringMatching(/Only active cards can request wipe keys/i),
    });
  });

  test("request-wipe returns wipe payload for active cards", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 2);

    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "request-wipe" },
      makeEnv(replay)
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      uidHex: ACTION_UID,
      cardState: "wipe_requested",
      keyVersion: 2,
      programmingEndpoint: expect.stringContaining("/api/v1/pull-payments/"),
      wipeDeeplink: expect.stringContaining("boltcard://reset?url="),
    });
    expect(json.wipeJson).toContain('"action": "wipe"');
  });

  test("terminate rejects cards that are not active or wipe_requested", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "terminate" },
      makeEnv()
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.stringMatching(/cannot terminate/i),
      reason: expect.stringMatching(/cannot terminate/i),
    });
  });

  test("terminate returns success payload for active cards", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 3);

    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "terminate" },
      makeEnv(replay)
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      uidHex: ACTION_UID,
      cardState: "terminated",
      keyVersion: 3,
      programmingEndpoint: expect.stringContaining("/api/v1/pull-payments/"),
    });
  });

  test("top-up rejects non-positive amounts with standardized error", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "top-up", amount: 0 },
      makeEnv()
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: "Amount must be a positive integer",
      reason: "Amount must be a positive integer",
    });
  });

  test("top-up returns updated balance on success", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "top-up", amount: 2500 },
      makeEnv()
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      success: true,
      balance: 2500,
      message: "Credited 2500 units",
    });
  });

  test("malformed JSON body returns 400 with standardized error payload", async () => {
    const url = "https://test.local/login";
    const response = await handleRequest(
      new Request(url, {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: "Invalid JSON body",
      reason: "Invalid JSON body",
    });
  });

  test("unexpected login verification failures return standardized 500 errors", async () => {
    const explodingEnv = new Proxy(makeEnv(), {
      get(target, prop, receiver) {
        if (prop === "BOLT_CARD_K1") {
          throw new Error("exploded issuer key lookup");
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const response = await makeRequest(
      "/login",
      "POST",
      { p: VALID_P, c: VALID_C },
      explodingEnv
    );

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: "exploded issuer key lookup",
      reason: "exploded issuer key lookup",
    });
  });

  test("UID-only login without ISSUER_KEY returns error", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID },
      makeEnvWithoutIssuerKey()
    );

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.any(String),
      reason: expect.any(String),
    });
    expect(json.error).toMatch(/invalid hex string/i);
    expect(json.reason).toMatch(/invalid hex string/i);
  });

  test("request-wipe without ISSUER_KEY returns error", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 2);

    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "request-wipe" },
      makeEnvWithoutIssuerKey(replay)
    );

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ERROR",
      success: false,
      error: expect.any(String),
      reason: expect.any(String),
    });
    expect(json.error).toMatch(/invalid hex string/i);
    expect(json.reason).toMatch(/invalid hex string/i);
  });

  test("UID-only login with DO config returns deployed=true", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 3);
    replay.__cardConfigs.set(ACTION_UID, { K2: "aa".repeat(16), payment_method: "fakewallet" });

    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID },
      makeEnv(replay)
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.deployed).toBe(true);
    expect(json.keyVersion).toBe(3);
  });

  test("UID-only login with keys_delivered state shows awaitingProgramming", async () => {
    const replay = makeReplayNamespace();
    replay.__cardStates.set(ACTION_UID, {
      state: "keys_delivered",
      latest_issued_version: 2,
      active_version: null,
      activated_at: null,
      terminated_at: null,
      keys_delivered_at: Math.floor(Date.now() / 1000),
      wipe_keys_fetched_at: null,
      balance: 0,
    });

    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID },
      makeEnv(replay)
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.cardState).toBe("keys_delivered");
    expect(json.awaitingProgramming).toBe(true);
  });

  test("terminate wipe_requested card succeeds", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 2);
    replay.__cardStates.get(ACTION_UID).state = "wipe_requested";

    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "terminate" },
      makeEnv(replay)
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.cardState).toBe("terminated");
  });

  test("top-up with invalid UID returns 400", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: "ZZZZ", action: "top-up", amount: 100 },
      makeEnv()
    );

    expect(response.status).toBe(400);
  });

  test("request-wipe with invalid UID returns 400", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: "ZZZZ", action: "request-wipe" },
      makeEnv()
    );

    expect(response.status).toBe(400);
  });

  test("terminate with invalid UID returns 400", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: "ZZZZ", action: "terminate" },
      makeEnv()
    );

    expect(response.status).toBe(400);
  });

  test("response includes tapHistory for valid login", async () => {
    const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C });
    const json = await response.json();
    expect(json.tapHistory).toBeDefined();
    expect(Array.isArray(json.tapHistory)).toBe(true);
  });

  test("response includes balance field", async () => {
    const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C });
    const json = await response.json();
    expect(typeof json.balance).toBe("number");
  });

  test("response includes debug info", async () => {
    const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C });
    const json = await response.json();
    expect(json.debug).toBeDefined();
    expect(typeof json.debug.issuerKey).toBe("string");
  });

  test("response includes card state", async () => {
    const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C });
    const json = await response.json();
    expect(typeof json.cardState).toBe("string");
  });
});
