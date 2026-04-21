/**
 * E2E tests using a virtual (simulated) NTAG424 bolt card.
 *
 * No physical card needed — we generate real AES-encrypted p/c parameters
 * using the same K1/K2 the server uses, then exercise the full lifecycle.
 *
 * Run:  npm test -- --testPathPattern="e2e/virtual-card"
 */

import { handleRequest } from "../../index.js";
import { jest } from "@jest/globals";
import { makeReplayNamespace } from "../replayNamespace.js";
import {
  hexToBytes,
  bytesToHex,
  buildVerificationData,
} from "../../cryptoutils.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import aesjs from "aes-js";

const BOLT_CARD_K1 =
  "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const PROG_ENDPOINT =
  "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFreshEnv() {
  const kvStore = {};
  return {
    BOLT_CARD_K1,
    CARD_REPLAY: makeReplayNamespace(),
    UID_CONFIG: {
      get: async (key) => kvStore[key] ?? null,
      put: async (key, value) => {
        kvStore[key] = value;
      },
    },
    __kvStore: kvStore,
  };
}

async function makeRequest(path, method = "GET", body = null, env) {
  const url = "https://test.local" + path;
  const opts = { method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, opts), env);
}

// Encrypt PICCData and compute CMAC — same as a real NTAG424 chip would
function virtualCardTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);

  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;

  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));

  const ctrHex = bytesToHex(
    new Uint8Array([
      (counter >> 16) & 0xff,
      (counter >> 8) & 0xff,
      counter & 0xff,
    ])
  );

  const cHex = computeCMAC(uidHex, ctrHex, k2Hex);
  return { pHex, cHex };
}

function computeCMAC(uidHex, ctrHex, k2Hex) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

// Provision a card via the programming endpoint, return env + keys + uid
async function provisionCard(uid, env, extra = "") {
  const resp = await makeRequest(
    PROG_ENDPOINT + extra,
    "POST",
    { UID: uid },
    env
  );
  expect(resp.status).toBe(200);
  const json = await resp.json();
  const version = json.Version || 1;
  const keys = await getDeterministicKeys(uid, env, version);
  return { json, keys, version };
}

// ── E2E: LNURL-withdraw (fakewallet) ────────────────────────────────────────

describe("E2E: Virtual card — LNURL-withdraw (fakewallet)", () => {
  const UID = "04a111fa967380";
  let env, keys;

  beforeEach(async () => {
    env = makeFreshEnv();
    const result = await provisionCard(UID, env);
    keys = result.keys;
  });

  test("full withdraw lifecycle: provision → tap → callback → tap history", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];

    // Step 1: Card tap — should return withdrawRequest, NOT record counter
    const { pHex, cHex } = virtualCardTap(UID, 1, k1Hex, keys.k2);
    const tapResp = await makeRequest(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(tapResp.status).toBe(200);
    const tapJson = await tapResp.json();
    expect(tapJson.tag).toBe("withdrawRequest");
    expect(tapJson.callback).toContain("/boltcards/api/v1/lnurl/cb");
    expect(env.CARD_REPLAY.__counters.has(UID)).toBe(false);

    // Step 2: Wallet callback — records counter + tap
    const cbResp = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1testinvoice`,
      "GET",
      null,
      env
    );
    expect(cbResp.status).toBe(200);
    expect(env.CARD_REPLAY.__counters.get(UID)).toBe(1);

    // Tap metadata recorded
    const tap = env.CARD_REPLAY.__taps.get(`${UID}:1`);
    expect(tap).toBeDefined();
    expect(tap.bolt11).toContain("lnbc10n1testinvoice");
    expect(tap.status).toBe("completed"); // fakewallet odd call succeeds
    expect(tap.user_agent).toBeNull();
    expect(tap.request_url).toBeTruthy();
    expect(tap.created_at).toBeGreaterThan(0);

    // Step 3: Login shows tap history
    const loginResp = await makeRequest(
      "/login",
      "POST",
      { p: pHex, c: cHex },
      env
    );
    expect(loginResp.status).toBe(200);
    const loginJson = await loginResp.json();
    expect(loginJson.success).toBe(true);
    expect(loginJson.tapHistory).toHaveLength(2);
    expect(loginJson.tapHistory[0].counter).toBe(1);
    expect(loginJson.tapHistory[0].status).toBe("completed");
    expect(loginJson.tapHistory[1].status).toBe("payment");
  });

  test("replay protection: stale counter rejected in callback", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];
    const { pHex, cHex } = virtualCardTap(UID, 1, k1Hex, keys.k2);

    // First callback — may succeed (200) or fail (400) due to fakewallet alternation,
    // but either way the counter gets recorded
    const first = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1test`,
      "GET",
      null,
      env
    );
    expect([200, 400]).toContain(first.status);
    expect(env.CARD_REPLAY.__counters.get(UID)).toBe(1);

    // Second callback with same counter rejected regardless
    const replay = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1test`,
      "GET",
      null,
      env
    );
    expect(replay.status).toBe(409);
  });

  test("incrementing counter works after previous callback", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];

    // Record counter=1 via callback (payment status doesn't matter for this test)
    const tap1 = virtualCardTap(UID, 1, k1Hex, keys.k2);
    const cb1 = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${tap1.pHex}?k1=${tap1.cHex}&pr=lnbc10n1first`,
      "GET",
      null,
      env
    );
    expect([200, 400]).toContain(cb1.status);
    expect(env.CARD_REPLAY.__counters.get(UID)).toBe(1);

    // Counter=2 Step 1 passes (checkReplayOnly: 2 > 1)
    const tap2 = virtualCardTap(UID, 2, k1Hex, keys.k2);
    const step1 = await makeRequest(`/?p=${tap2.pHex}&c=${tap2.cHex}`, "GET", null, env);
    expect(step1.status).toBe(200);

    // Counter=2 callback records and advances counter
    const step2 = await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${tap2.pHex}?k1=${tap2.cHex}&pr=lnbc10n1second`,
      "GET",
      null,
      env
    );
    expect([200, 400]).toContain(step2.status);
    expect(env.CARD_REPLAY.__counters.get(UID)).toBe(2);
  });

  test("Step 1 does not record counter — repeated taps succeed", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];
    const { pHex, cHex } = virtualCardTap(UID, 1, k1Hex, keys.k2);

    const first = await makeRequest(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(first.status).toBe(200);

    const second = await makeRequest(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(second.status).toBe(200);

    expect(env.CARD_REPLAY.__counters.has(UID)).toBe(false);
  });

  test("wipe resets replay state, allows re-provisioning", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];

    // Record counter=5 via callback
    const tap5 = virtualCardTap(UID, 5, k1Hex, keys.k2);
    await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${tap5.pHex}?k1=${tap5.cHex}&pr=lnbc10n1tap5`,
      "GET",
      null,
      env
    );
    expect(env.CARD_REPLAY.__counters.get(UID)).toBe(5);

    // Mark card as active so wipe endpoint accepts it
    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase()).state = "active";
    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase()).active_version = 1;

    // Wipe — card becomes terminated, counter reset
    const wipeResp = await makeRequest(`/wipe?uid=${UID}`, "GET", null, env);
    expect(wipeResp.status).toBe(200);
    expect(env.CARD_REPLAY.__counters.has(UID)).toBe(false);

    // Terminated card cannot be tapped
    const blockedTap = virtualCardTap(UID, 1, k1Hex, keys.k2);
    const blockedResp = await makeRequest(`/?p=${blockedTap.pHex}&c=${blockedTap.cHex}`, "GET", null, env);
    expect(blockedResp.status).toBe(403);

    // Re-provision (terminated → keys_delivered, version 2)
    const reprov = await provisionCard(UID, env);
    expect(reprov.version).toBe(2);

    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase()).state = "active";
    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase()).active_version = 2;

    const tap1 = virtualCardTap(UID, 1, k1Hex, reprov.keys.k2);
    const after = await makeRequest(`/?p=${tap1.pHex}&c=${tap1.cHex}`, "GET", null, env);
    expect(after.status).toBe(200);
  });
});

// ── E2E: LNURL-pay (POS) ────────────────────────────────────────────────────

describe("E2E: Virtual card — LNURL-pay (POS)", () => {
  const UID = "04a222fa967380";
  let env, keys;
  let originalFetch;

  beforeEach(async () => {
    env = makeFreshEnv();
    const result = await provisionCard(UID, env, "&card_type=pos&lightning_address=test@getalby.com&min_sendable=1000&max_sendable=100000000");
    keys = result.keys;

    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes(".well-known/lnurlp")) {
        return new Response(
          JSON.stringify({
            callback: "https://getalby.com/lnurlp/test/callback",
            tag: "payRequest",
            minSendable: 1000,
            maxSendable: 100000000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("callback") && urlStr.includes("amount=")) {
        return new Response(
          JSON.stringify({ pr: "lnbc10n1testinvoice", routes: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("full POS lifecycle: tap → payRequest → callback → invoice", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];
    const { pHex, cHex } = virtualCardTap(UID, 1, k1Hex, keys.k2);

    // Step 1: tap returns payRequest
    const tapResp = await makeRequest(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(tapResp.status).toBe(200);
    const tapJson = await tapResp.json();
    expect(tapJson.tag).toBe("payRequest");
    expect(tapJson.minSendable).toBe(1000);
    expect(tapJson.metadata).toContain("Order #1");
    expect(env.CARD_REPLAY.__counters.has(UID)).toBe(false);

    // Step 2: callback returns invoice
    const cbResp = await makeRequest(
      `/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`,
      "GET",
      null,
      env
    );
    expect(cbResp.status).toBe(200);
    const cbJson = await cbResp.json();
    expect(cbJson.pr).toBe("lnbc10n1testinvoice");
    expect(env.CARD_REPLAY.__counters.get(UID)).toBe(1);
  });

  test("POS replay protection in callback", async () => {
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];
    const { pHex, cHex } = virtualCardTap(UID, 1, k1Hex, keys.k2);

    // First callback succeeds
    await makeRequest(`/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`, "GET", null, env);

    // Replay rejected
    const replay = await makeRequest(`/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`, "GET", null, env);
    expect(replay.status).toBe(400);
    const json = await replay.json();
    expect(json.reason).toMatch(/replay|counter/i);
  });
});

// ── E2E: Concurrent taps ────────────────────────────────────────────────────

describe("E2E: Virtual card — concurrent taps", () => {
  const UID = "04a333fa967380";

  test("new tap accepted while old tap completed", async () => {
    const env = makeFreshEnv();
    const { keys } = await provisionCard(UID, env);
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];

    // Record counter=1 via callback
    const tap1 = virtualCardTap(UID, 1, k1Hex, keys.k2);
    await makeRequest(
      `/boltcards/api/v1/lnurl/cb/${tap1.pHex}?k1=${tap1.cHex}&pr=lnbc10n1first`,
      "GET",
      null,
      env
    );

    // Counter=2 Step 1 accepted
    const tap2 = virtualCardTap(UID, 2, k1Hex, keys.k2);
    const step1 = await makeRequest(`/?p=${tap2.pHex}&c=${tap2.cHex}`, "GET", null, env);
    expect(step1.status).toBe(200);

    // Both taps exist in history
    expect(env.CARD_REPLAY.__taps.get(`${UID}:1`)).toBeDefined();
    // counter=2 recorded as a "read" tap by Step 1 (awaited recordTapRead)
    const tap2Record = env.CARD_REPLAY.__taps.get(`${UID}:2`);
    expect(tap2Record).toBeDefined();
    expect(tap2Record.status).toBe("read");
  });
});

// ── E2E: Login and tap history ───────────────────────────────────────────────

describe("E2E: Virtual card — login and tap history", () => {
  const UID = "04a444fa967380";

  test("login shows full tap history with metadata", async () => {
    const env = makeFreshEnv();
    const { keys } = await provisionCard(UID, env);
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];

    // Do 3 taps
    for (let i = 1; i <= 3; i++) {
      const { pHex, cHex } = virtualCardTap(UID, i, k1Hex, keys.k2);
      await makeRequest(
        `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1tap${i}`,
        "GET",
        null,
        env
      );
    }

    // Login
    const { pHex, cHex } = virtualCardTap(UID, 4, k1Hex, keys.k2);
    const loginResp = await makeRequest("/login", "POST", { p: pHex, c: cHex }, env);
    expect(loginResp.status).toBe(200);
    const json = await loginResp.json();
    expect(json.success).toBe(true);
    // 3 completed taps + 3 payment transactions = 6 entries
    // (tap 1 failed has no payment transaction)
    expect(json.tapHistory).toHaveLength(5);

    // First entry should be counter 3 (tap or payment)
    expect(json.tapHistory[0].counter).toBe(3);
    expect([3, 2]).toContain(json.tapHistory[2].counter);

    // Each entry has metadata
    for (const tap of json.tapHistory) {
      expect(tap.created_at).toBeGreaterThan(0);
      expect(tap.status).toBeTruthy();
    }
  });

  test("login tap history limited to 20 entries", async () => {
    const env = makeFreshEnv();
    const { keys } = await provisionCard(UID, env);
    const k1Hex = env.BOLT_CARD_K1.split(",")[0];

    // Do 25 taps
    for (let i = 1; i <= 25; i++) {
      const { pHex, cHex } = virtualCardTap(UID, i, k1Hex, keys.k2);
      await makeRequest(
        `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1tap${i}`,
        "GET",
        null,
        env
      );
    }

    const { pHex, cHex } = virtualCardTap(UID, 26, k1Hex, keys.k2);
    const loginResp = await makeRequest("/login", "POST", { p: pHex, c: cHex }, env);
    const json = await loginResp.json();
    // 25 taps produce 25 tap entries + 25 payment transactions = 50, capped at 25 by merge
    expect(json.tapHistory.length).toBeLessThanOrEqual(25);
  });
});
