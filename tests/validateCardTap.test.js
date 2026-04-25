import { describe, it, expect } from "@jest/globals";
import { validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { buildVerificationData, bytesToHex } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import aesjs from "aes-js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";
const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

function virtualTap(uidHex, counter, k1Hex, k2Hex) {
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
  const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
  const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(k2Hex));
  const cHex = bytesToHex(vd.ct);
  return { pHex, cHex };
}

describe("validate_cmac", () => {
  it("returns explicit error when K2 is missing and cHex is provided", () => {
    const result = validate_cmac(hexToBytes(UID), hexToBytes("000001"), "abcdef0123456789", null);
    expect(result.cmac_validated).toBe(false);
    expect(result.cmac_error).toBe("K2 key not available");
  });

  it("returns false when cHex is empty", () => {
    const result = validate_cmac(hexToBytes(UID), hexToBytes("000001"), "", hexToBytes("f4b404be700ab285e333e32348fa3d3b"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validates correct CMAC", async () => {
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { cHex } = virtualTap(UID, 1, keys.k1, keys.k2);
    const ctr = hexToBytes("000001");
    const result = validate_cmac(hexToBytes(UID), ctr, cHex, hexToBytes(keys.k2));
    expect(result.cmac_validated).toBe(true);
  });
});

describe("validateCardTap", () => {
  function makeTestEnv() {
    const doStub = makeReplayNamespace({}, { [UID]: 1 });
    return { CARD_REPLAY: doStub, BOLT_CARD_K1, ISSUER_KEY };
  }

  function makeTestRequest() {
    return new Request("http://localhost/api/balance-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "test" },
    });
  }

  it("returns error when p and c are missing", async () => {
    const result = await validateCardTap(makeTestRequest(), makeTestEnv(), { pHex: "", cHex: "" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("Missing card parameters");
  });

  it("returns error when p is missing but c is present", async () => {
    const result = await validateCardTap(makeTestRequest(), makeTestEnv(), { pHex: "", cHex: "abc123" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("returns error when c is missing but p is present", async () => {
    const result = await validateCardTap(makeTestRequest(), makeTestEnv(), { pHex: "abc123", cHex: "" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("successfully validates a valid card tap", async () => {
    const env = makeTestEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(result.ok).toBe(true);
    expect(result.uidHex).toBe(UID);
    expect(result.counterValue).toBe(1);
    expect(result.activeVersion).toBe(1);
  });

  it("rejects replay (second tap with same counter)", async () => {
    const env = makeTestEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const first = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(first.ok).toBe(true);

    const second = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(second.ok).toBe(false);
    expect(second.status).toBe(400);
    expect(second.error).toContain("already used");
  });
});
