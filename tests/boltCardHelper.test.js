import { describe, it, expect } from "@jest/globals";
import { decodeAndValidate } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap } from "./testHelpers.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

describe("decodeAndValidate", () => {
  const env = { ISSUER_KEY };

  it("successfully decodes and validates with correct p, c, and k2", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, hexToBytes(keys.k2));
    expect(result.success).toBe(true);
    expect(result.uidHex).toBe(UID);
    expect(result.cmac_validated).toBe(true);
    expect(result.cmac_error).toBeNull();
  });

  it("returns success with cmac_validated=false when k2Bytes is omitted", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, undefined);
    expect(result.success).toBe(true);
    expect(result.uidHex).toBe(UID);
    expect(result.cmac_validated).toBe(false);
    expect(result.cmac_error).toBe("K2 key not available");
  });

  it("returns success with cmac_validated=false when k2Bytes is null", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, null);
    expect(result.success).toBe(true);
    expect(result.cmac_validated).toBe(false);
  });

  it("returns decryption error for invalid pHex", () => {
    const result = decodeAndValidate("0000000000000000", "abcdef0123456789", env, hexToBytes("aa".repeat(16)));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns cmac_validated=false for wrong cHex", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex } = virtualTap(UID, 5, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, "0000000000000000", env, hexToBytes(keys.k2));
    expect(result.success).toBe(true);
    expect(result.uidHex).toBe(UID);
    expect(result.cmac_validated).toBe(false);
  });

  it("extracts counter correctly", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 42, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, hexToBytes(keys.k2));
    expect(result.ctr).toBe("00002a");
  });
});
