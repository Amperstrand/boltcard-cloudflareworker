import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys, deriveKeysFromHex } from "../keygenerator.js";
import { handleTerminateAction, handleRequestWipeAction, handleTopUpAction, normalizeSubmittedUid } from "../handlers/loginActions.js";
import aesjs from "aes-js";

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
    __TEST_OPERATOR_SESSION: { shiftId: "test-shift" },
  };
}

function makeEnvWithoutIssuerKey(replay = makeReplayNamespace()) {
  const { ISSUER_KEY, ...envWithoutKey } = env;
  return {
    ...envWithoutKey,
    CARD_REPLAY: replay,
    __TEST_OPERATOR_SESSION: { shiftId: "test-shift" },
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

  test("privileged actions reject without operator auth", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 2);
    const unauthorizedEnv = {
      ...env,
      CARD_REPLAY: replay,
    };
    for (const action of ["request-wipe", "terminate", "top-up"]) {
      const body = action === "top-up"
        ? { uid: ACTION_UID, action, amount: 100 }
        : { uid: ACTION_UID, action };
      const response = await makeRequest("/login", "POST", body, unauthorizedEnv);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toMatch(/operator authentication required/i);
    }
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
      error: "Internal error",
      reason: "Internal error",
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
    expect(json.error).toMatch(/internal error/i);
    expect(json.reason).toMatch(/internal error/i);
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
    expect(json.error).toMatch(/internal error/i);
    expect(json.reason).toMatch(/internal error/i);
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

  test("per-card UID validates CMAC via per-card keys", async () => {
    const perCardUid = "040a69fa967380";
    const perCardK1 = "3db8852a71d11fa0adb6babaf274af89";
    const perCardK2 = "ce08c57983d65fceaa571e248390790f";

    const uid = hexToBytes(perCardUid);
    const counter = 5;
    const plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = counter & 0xff;
    plaintext[9] = (counter >> 8) & 0xff;
    plaintext[10] = (counter >> 16) & 0xff;
    const aes = new aesjs.ModeOfOperation.ecb(hexToBytes(perCardK1));
    const encrypted = aes.encrypt(plaintext);
    const pHex = bytesToHex(new Uint8Array(encrypted));

    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(perCardK2));
    const cHex = bytesToHex(vd.ct);

    const replay = makeReplayNamespace();
    replay.__activate(perCardUid, 1);

    const perCardEnv = {
      ...env,
      BOLT_CARD_K1: env.BOLT_CARD_K1 + "," + perCardK1,
      CARD_REPLAY: replay,
    };

    const response = await makeRequest(
      "/login",
      "POST",
      { p: pHex, c: cHex },
      perCardEnv,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.uidHex).toBe(perCardUid);
    expect(json.cmacValid).toBe(true);
    expect(json.compromised).toBe(true);
  });

  test("per-card K1 fallback loop validates without ISSUER_KEY", async () => {
    const perCardUid = "040c66fa967380";
    const perCardK1 = "3db8852a71d11fa0adb6babaf274af89";
    const perCardK2 = "420e18a161fec00e083aaaa787fb3a3f";

    const uid = hexToBytes(perCardUid);
    const counter = 3;
    const plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = counter & 0xff;
    plaintext[9] = (counter >> 8) & 0xff;
    plaintext[10] = (counter >> 16) & 0xff;
    const aes = new aesjs.ModeOfOperation.ecb(hexToBytes(perCardK1));
    const encrypted = aes.encrypt(plaintext);
    const pHex = bytesToHex(new Uint8Array(encrypted));

    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(perCardK2));
    const cHex = bytesToHex(vd.ct);

    const replay = makeReplayNamespace();
    replay.__activate(perCardUid, 1);

    const perCardEnv = {
      ...env,
      BOLT_CARD_K1: env.BOLT_CARD_K1 + "," + perCardK1,
      CARD_REPLAY: replay,
    };
    delete perCardEnv.ISSUER_KEY;

    const response = await makeRequest(
      "/login",
      "POST",
      { p: pHex, c: cHex },
      perCardEnv,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.cmacValid).toBe(true);
    expect(json.compromised).toBe(true);
  });

  test("response includes keysDeliveredAt for keys_delivered card", async () => {
    const tapUid = "04996c6a926980";
    const replay = makeReplayNamespace();
    replay.__cardStates.set(tapUid, {
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
      { p: VALID_P, c: VALID_C },
      makeEnv(replay),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.keysDeliveredAt).toBeGreaterThan(0);
  });

  test("response includes programmingEndpoint for keys_delivered card", async () => {
    const tapUid = "04996c6a926980";
    const replay = makeReplayNamespace();
    replay.__cardStates.set(tapUid, {
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
      { p: VALID_P, c: VALID_C },
      makeEnv(replay),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.programmingEndpoint).toContain("/api/v1/pull-payments/");
  });

  test("top-up with non-integer string amount returns 400", async () => {
    const response = await makeRequest(
      "/login",
      "POST",
      { uid: ACTION_UID, action: "top-up", amount: "abc" },
      makeEnv()
    );
    expect(response.status).toBe(400);
  });

  describe("issuer key CMAC scan match (lines 94-96)", () => {
    const SCAN_UID = "04a39493cc8680";

    function buildScanTapEnv(replay = makeReplayNamespace()) {
      const keys = getDeterministicKeys(SCAN_UID, { ISSUER_KEY: env.ISSUER_KEY }, 1);
      const uid = hexToBytes(SCAN_UID);
      const counter = 7;
      const plaintext = new Uint8Array(16);
      plaintext[0] = 0xc7;
      plaintext.set(uid, 1);
      plaintext[8] = counter & 0xff;
      plaintext[9] = (counter >> 8) & 0xff;
      plaintext[10] = (counter >> 16) & 0xff;
      const aes = new aesjs.ModeOfOperation.ecb(hexToBytes(keys.k1));
      const encrypted = aes.encrypt(plaintext);
      const pHex = bytesToHex(new Uint8Array(encrypted));
      const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
      const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(keys.k2));
      const cHex = bytesToHex(vd.ct);
      return { pHex, cHex, keys, replay };
    }

    test("valid issuer-derived CMAC returns cmacValid true via scan match", async () => {
      const { pHex, cHex, replay } = buildScanTapEnv();
      const response = await makeRequest("/login", "POST", { p: pHex, c: cHex }, makeEnv(replay));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.cmacValid).toBe(true);
      expect(json.uidHex).toBe(SCAN_UID);
    });

    test("valid issuer-derived CMAC includes matchedVersion in debug", async () => {
      const { pHex, cHex, replay } = buildScanTapEnv();
      const response = await makeRequest("/login", "POST", { p: pHex, c: cHex }, makeEnv(replay));
      const json = await response.json();
      expect(json.debug.matchedVersion).toBe(1);
    });
  });

  describe("error paths in main login flow", () => {
    test("getBalance throwing logs warning and returns balance 0 (line 196)", async () => {
      const replay = makeReplayNamespace();
      const origGet = replay.get.bind(replay);
      let balanceCallCount = 0;
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/balance") {
              balanceCallCount++;
              throw new Error("balance fetch failed");
            }
            return obj.fetch(request);
          },
        };
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C }, makeEnv(replay));
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.balance).toBe(0);
        const warnLog = warns.find(l => l.includes("Could not fetch balance"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });

    test("recordTapRead rejecting logs warning (line 202)", async () => {
      const replay = makeReplayNamespace();
      let idFromNameCallCount = 0;
      const origIdFromName = replay.idFromName.bind(replay);
      replay.idFromName = (name) => {
        idFromNameCallCount++;
        if (idFromNameCallCount > 7) throw new Error("idFromName failed");
        return origIdFromName(name);
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C }, makeEnv(replay));
        expect(response.status).toBe(200);
        await new Promise(r => setTimeout(r, 100));
        const warnLog = warns.find(l => l.includes("Failed to record login tap"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });

    test("listTaps throwing logs warning and returns partial history (line 438)", async () => {
      const replay = makeReplayNamespace();
      const origGet = replay.get.bind(replay);
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/list-taps") {
              throw new Error("tap list failed");
            }
            return obj.fetch(request);
          },
        };
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C }, makeEnv(replay));
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.tapHistory).toEqual([]);
        const warnLog = warns.find(l => l.includes("Could not load tap history"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });

    test("listTransactions throwing logs warning (line 444)", async () => {
      const replay = makeReplayNamespace();
      const origGet = replay.get.bind(replay);
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/transactions") {
              throw new Error("tx list failed");
            }
            return obj.fetch(request);
          },
        };
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { p: VALID_P, c: VALID_C }, makeEnv(replay));
        expect(response.status).toBe(200);
        const warnLog = warns.find(l => l.includes("Could not load transactions"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe("UID-only login edge cases", () => {
    test("UID-only login with invalid UID (no action) returns 400 (line 243)", async () => {
      const response = await makeRequest("/login", "POST", { uid: "ZZZZ" }, makeEnv());
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/invalid uid/i);
    });

    test("getBalance throwing in UID-only path logs warning (line 273)", async () => {
      const replay = makeReplayNamespace();
      replay.__activate(ACTION_UID, 1);
      const origGet = replay.get.bind(replay);
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/balance") {
              throw new Error("balance fetch failed");
            }
            return obj.fetch(request);
          },
        };
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { uid: ACTION_UID }, makeEnv(replay));
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.balance).toBe(0);
        const warnLog = warns.find(l => l.includes("Could not fetch balance"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });

    test("recordTapRead rejecting in UID-only path logs warning (line 279)", async () => {
      const replay = makeReplayNamespace();
      replay.__activate(ACTION_UID, 1);
      let idFromNameCallCount = 0;
      const origIdFromName = replay.idFromName.bind(replay);
      replay.idFromName = (name) => {
        idFromNameCallCount++;
        if (idFromNameCallCount > 6) throw new Error("idFromName failed");
        return origIdFromName(name);
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { uid: ACTION_UID }, makeEnv(replay));
        expect(response.status).toBe(200);
        await new Promise(r => setTimeout(r, 100));
        const warnLog = warns.find(l => l.includes("Failed to record UID-only login tap"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });

    test("listTaps throwing in UID-only path logs warning (line 438)", async () => {
      const replay = makeReplayNamespace();
      replay.__activate(ACTION_UID, 1);
      const origGet = replay.get.bind(replay);
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (url.pathname === "/list-taps") {
              throw new Error("tap list failed");
            }
            return obj.fetch(request);
          },
        };
      };

      const warns = [];
      const origWarn = console.warn;
      console.warn = (...args) => warns.push(args.join(" "));

      try {
        const response = await makeRequest("/login", "POST", { uid: ACTION_UID }, makeEnv(replay));
        expect(response.status).toBe(200);
        const warnLog = warns.find(l => l.includes("Could not load tap history"));
        expect(warnLog).toBeDefined();
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe("top-up error paths", () => {
    test("creditCard returns ok:false returns 500 (line 400)", async () => {
      const replay = makeReplayNamespace();
      replay.__activate(ACTION_UID, 1);
      const origGet = replay.get.bind(replay);
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (request.method === "POST" && url.pathname === "/credit") {
              return Response.json({ ok: false, reason: "Credit limit exceeded" });
            }
            return obj.fetch(request);
          },
        };
      };

      const response = await makeRequest(
        "/login",
        "POST",
        { uid: ACTION_UID, action: "top-up", amount: 100 },
        makeEnv(replay)
      );
      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toContain("Credit limit exceeded");
    });

    test("creditCard throwing returns 500 (lines 402-403)", async () => {
      const replay = makeReplayNamespace();
      replay.__activate(ACTION_UID, 1);
      const origGet = replay.get.bind(replay);
      replay.get = (id) => {
        const obj = origGet(id);
        return {
          fetch: async (request) => {
            const url = new URL(request.url);
            if (request.method === "POST" && url.pathname === "/credit") {
              throw new Error("credit DO failed");
            }
            return obj.fetch(request);
          },
        };
      };

      const errors = [];
      const origError = console.error;
      console.error = (...args) => errors.push(args.join(" "));

      try {
        const response = await makeRequest(
          "/login",
          "POST",
          { uid: ACTION_UID, action: "top-up", amount: 100 },
          makeEnv(replay)
        );
        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toContain("Top-up failed");
        const errLog = errors.find(l => l.includes("Top-up failed"));
        expect(errLog).toBeDefined();
      } finally {
        console.error = origError;
      }
    });
  });
});

describe("loginActions branch coverage", () => {
  test("normalizeSubmittedUid handles non-string input", () => {
    expect(normalizeSubmittedUid(null)).toBeNull();
    expect(normalizeSubmittedUid(undefined)).toBeNull();
    expect(normalizeSubmittedUid(123)).toBeNull();
  });

  test("normalizeSubmittedUid strips colons from valid UID", () => {
    expect(normalizeSubmittedUid("04:a3:94:93:cc:86:80")).toBe("04a39493cc8680");
  });

  test("terminate returns keyVersion fallback when latest_issued_version is null", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 1);
    const state = replay.__cardStates.get(ACTION_UID);
    state.active_version = 2;
    state.latest_issued_version = null;
    const testEnv = makeEnv(replay);
    const req = new Request("https://test.local/login");
    const res = await handleTerminateAction(ACTION_UID, testEnv, req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.keyVersion).toBe(2);
  });

  test("request-wipe uses version 1 when active_version is null", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 1);
    const state = replay.__cardStates.get(ACTION_UID);
    state.active_version = null;
    const testEnv = makeEnv(replay);
    const req = new Request("https://test.local/login");
    const res = await handleRequestWipeAction(ACTION_UID, testEnv, req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.keyVersion).toBe(1);
  });

  test("top-up returns fallback message when creditCard fails without reason", async () => {
    const replay = makeReplayNamespace();
    replay.__activate(ACTION_UID, 1);
    const testEnv = makeEnv(replay);
    const origGet = testEnv.CARD_REPLAY.get.bind(testEnv.CARD_REPLAY);
    testEnv.CARD_REPLAY.get = (id) => {
      const obj = origGet(id);
      const origFetch = obj.fetch.bind(obj);
      return {
        fetch: async (request) => {
          const url = new URL(request.url);
          if (request.method === "POST" && url.pathname === "/credit") {
            return Response.json({ ok: false });
          }
          return origFetch(request);
        },
      };
    };
    const req = new Request("https://test.local/login");
    const res = await handleTopUpAction(ACTION_UID, "500", testEnv, req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.reason).toContain("Top-up failed");
  });
});
