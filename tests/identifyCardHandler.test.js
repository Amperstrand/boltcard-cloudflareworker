import { describe, it, expect, beforeAll } from "@jest/globals";
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
  return {
    BOLT_CARD_K1,
    CARD_REPLAY: replay,
    ...TEST_OPERATOR_AUTH,
  };
}

let keys;

beforeAll(() => {
  keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 });
});

describe("POST /api/identify-card", () => {
  it("returns error when p is missing", async () => {
    const env = makeEnv();
    const ctrHex = bytesToHex(new Uint8Array([(2 >> 16) & 0xff, (2 >> 8) & 0xff, 2 & 0xff]));
    const cHex = computeC(TEST_UID, ctrHex, keys.k2);
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ c: cHex }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/missing.*p.*c/i);
  });

  it("returns error when c is missing", async () => {
    const env = makeEnv();
    const pHex = generateP(TEST_UID, 2, K1_HEX);
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: pHex }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/missing.*p.*c/i);
  });

  it("returns error when p cannot be decrypted", async () => {
    const env = makeEnv();
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", c: "FFFFFFFFFFFFFFFF" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/unable to decode/i);
  });

  it("returns card identification with matched deterministic source", async () => {
    const env = makeEnv();
    const counter = 2;
    const pHex = generateP(TEST_UID, counter, K1_HEX);
    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const cHex = computeC(TEST_UID, ctrHex, keys.k2);

    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: pHex, c: cHex }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uid).toBe(TEST_UID);
    expect(json.counter).toBe(counter);
    expect(json.card_state).toBe("active");
    expect(json.matched).toBeTruthy();
    expect(json.matched.source).toBe("config");
    expect(json.matched.cmac_validated).toBe(true);
    expect(Array.isArray(json.all_attempts)).toBe(true);
    expect(json.all_attempts.length).toBeGreaterThan(0);
  });

  it("returns matched null when CMAC does not validate", async () => {
    const env = makeEnv();
    const pHex = generateP(TEST_UID, 2, K1_HEX);
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: pHex, c: "0000000000000000" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uid).toBe(TEST_UID);
    expect(json.matched).toBeNull();
    expect(json.all_attempts.length).toBeGreaterThan(0);
  });

  it("reports active_version from card state", async () => {
    const replay = makeReplayNamespace({ [TEST_UID]: 1 });
    replay.__activate(TEST_UID, 3);
    const env = makeEnv(replay);

    const counter = 2;
    const pHex = generateP(TEST_UID, counter, K1_HEX);
    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const version3Keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 }, 3);
    const cHex = computeC(TEST_UID, ctrHex, version3Keys.k2);

    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: pHex, c: cHex }),
      }),
      env,
    );
    const json = await res.json();
    expect(json.active_version).toBe(3);
    expect(json.matched.version).toBe(3);
  });

  it("returns unknown card_state when no DO state exists", async () => {
    const env = makeEnv(makeReplayNamespace());
    const counter = 2;
    const pHex = generateP(TEST_UID, counter, K1_HEX);
    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const cHex = computeC(TEST_UID, ctrHex, keys.k2);

    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: pHex, c: cHex }),
      }),
      env,
    );
    const json = await res.json();
    expect(json.card_state).toBe("new");
  });

  it("accepts p and c from query string", async () => {
    const env = makeEnv();
    const counter = 2;
    const pHex = generateP(TEST_UID, counter, K1_HEX);
    const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
    const cHex = computeC(TEST_UID, ctrHex, keys.k2);

    const res = await handleRequest(
      new Request(`https://test.local/api/identify-card?p=${pHex}&c=${cHex}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uid).toBe(TEST_UID);
    expect(json.matched).toBeTruthy();
  });

  it("requires operator auth", async () => {
    const env = makeEnv();
    delete env.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: "a", c: "b" }),
      }),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/operator/login");
  });
});
