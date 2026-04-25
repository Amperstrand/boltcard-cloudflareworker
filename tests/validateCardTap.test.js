import { describe, it, expect } from "@jest/globals";
import { validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap } from "./testHelpers.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";
const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

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

  it("rejects terminated card", async () => {
    const env = makeTestEnv();
    env.CARD_REPLAY.__cardStates.get(UID).state = "terminated";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("terminated");
  });

  it("rejects wipe_requested card", async () => {
    const env = makeTestEnv();
    env.CARD_REPLAY.__cardStates.get(UID).state = "wipe_requested";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("wipe");
  });

  it("auto-activates keys_delivered card with valid CMAC", async () => {
    const env = makeTestEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    env.CARD_REPLAY.__cardStates.get(UID).latest_issued_version = 1;
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    env.CARD_REPLAY.__cardConfigs.set(UID, { K2: keys.k2, payment_method: "fakewallet" });

    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(result.ok).toBe(true);
    expect(env.CARD_REPLAY.__cardStates.get(UID).state).toBe("active");
  });

  it("rejects keys_delivered card with wrong CMAC (version mismatch)", async () => {
    const env = makeTestEnv();
    const keysV2 = getDeterministicKeys(UID, { ISSUER_KEY }, 2);
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    env.CARD_REPLAY.__cardStates.get(UID).latest_issued_version = 2;
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    env.CARD_REPLAY.__cardConfigs.set(UID, { K2: keysV2.k2, payment_method: "fakewallet" });

    const keysV1 = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keysV1.k1, keysV1.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("version mismatch");
  });

  it("rejects invalid CMAC for active card", async () => {
    const env = makeTestEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, { K2: keys.k2, payment_method: "fakewallet" });
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex: "DEADBEEFDEADBEEF" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("authentication failed");
  });

  it("returns config in result for valid tap", async () => {
    const env = makeTestEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, { K2: keys.k2, payment_method: "fakewallet" });
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config.payment_method).toBe("fakewallet");
  });

  it("accepts sequential taps with increasing counters", async () => {
    const env = makeTestEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    env.CARD_REPLAY.__cardConfigs.set(UID, { K2: keys.k2, payment_method: "fakewallet" });
    for (let counter = 2; counter <= 5; counter++) {
      const { pHex, cHex } = virtualTap(UID, counter, keys.k1, keys.k2);
      const result = await validateCardTap(makeTestRequest(), env, { pHex, cHex });
      expect(result.ok).toBe(true);
    }
  });

  it("returns decryption error for invalid p", async () => {
    const env = makeTestEnv();
    const result = await validateCardTap(makeTestRequest(), env, { pHex: "0000", cHex: "ABCDEF0123456789" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("decryption");
  });
});
