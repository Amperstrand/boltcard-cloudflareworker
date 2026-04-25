import { describe, it, expect, beforeEach } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import aesjs from "aes-js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04aabbccdd7788";
const K1_HEX = BOLT_CARD_K1.split(",")[0];

function generateP(uidHex, counter, k1Hex) {
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
  return bytesToHex(new Uint8Array(encrypted));
}

function computeC(uidHex, ctrHex, k2Hex) {
  const vd = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctrHex), hexToBytes(k2Hex));
  return bytesToHex(vd.ct);
}

function makeEnv(replay = makeReplayNamespace({ [TEST_UID]: 1 })) {
  const kvStore = {};
  return {
    BOLT_CARD_K1,
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async (uid) => kvStore[uid] ?? null,
      put: async (uid, value) => { kvStore[uid] = value; },
    },
    ...TEST_OPERATOR_AUTH,
  };
}

async function provisionCard(env, replay, balance = 0) {
  const keys = getDeterministicKeys(TEST_UID, env);
  const config = { K2: keys.k2, payment_method: "fakewallet" };
  env.UID_CONFIG.put(TEST_UID, JSON.stringify(config));
  if (balance > 0) {
    const id = replay.idFromName(TEST_UID.toLowerCase());
    const stub = replay.get(id);
    await stub.fetch(new Request("https://card-replay.internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: balance, note: "init" }),
    }));
  }
}

describe("POST /api/balance-check", () => {
  let env;
  let replay;
  let keys;

  beforeEach(async () => {
    replay = makeReplayNamespace({ [TEST_UID]: 1 });
    env = makeEnv(replay);
    keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 });
    await provisionCard(env, replay, 5000);
  });

  it("returns balance for valid card tap", async () => {
    const counter = 2;
    const pHex = generateP(TEST_UID, counter, K1_HEX);
    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const cHex = computeC(TEST_UID, ctrHex, keys.k2);

    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: cHex }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.balance).toBe(5000);
    expect(json.uidHex).toBe(TEST_UID);
  });

  it("returns 400 when p is missing", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: "0000000000000000" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when c is missing", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/invalid json/i);
  });

  it("returns 400 when card cannot be decrypted", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", c: "FFFFFFFFFFFFFFFF" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when CMAC validation fails", async () => {
    const pHex = generateP(TEST_UID, 2, K1_HEX);
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: "0000000000000000" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("returns zero balance for card with no transactions", async () => {
    const emptyReplay = makeReplayNamespace({ [TEST_UID]: 1 });
    const emptyEnv = makeEnv(emptyReplay);
    await provisionCard(emptyEnv, emptyReplay, 0);

    const counter = 2;
    const pHex = generateP(TEST_UID, counter, K1_HEX);
    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const cHex = computeC(TEST_UID, ctrHex, keys.k2);

    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: cHex }),
      }),
      emptyEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.balance).toBe(0);
  });
});
