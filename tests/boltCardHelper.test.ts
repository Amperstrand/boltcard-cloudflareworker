
import { decodeAndValidate } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { getUniquePerCardK1s } from "../utils/keyLookup.js";
import { virtualTap } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

describe("decodeAndValidate", () => {
  const env = { ISSUER_KEY } as unknown as Env;

  it("successfully decodes and validates with correct p, c, and k2", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, hexToBytes(keys.k2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.uidHex).toBe(UID);
      expect(result.cmac_validated).toBe(true);
      expect(result.cmac_error).toBeNull();
    }
  });

  it("returns success with cmac_validated=false when k2Bytes is omitted", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.uidHex).toBe(UID);
      expect(result.cmac_validated).toBe(false);
      expect(result.cmac_error).toBe("K2 key not available");
    }
  });

  it("returns success with cmac_validated=false when k2Bytes is null", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, undefined as unknown as Uint8Array | undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.cmac_validated).toBe(false);
    }
  });

  it("returns decryption error for invalid pHex", () => {
    const result = decodeAndValidate("0000000000000000", "abcdef0123456789", env, hexToBytes("aa".repeat(16)));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it("returns cmac_validated=false for wrong cHex", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex } = virtualTap(UID, 5, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, "0000000000000000", env, hexToBytes(keys.k2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.uidHex).toBe(UID);
      expect(result.cmac_validated).toBe(false);
    }
  });

  it("extracts counter correctly", async () => {
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 42, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, env, hexToBytes(keys.k2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.ctr).toBe("00002a");
    }
  });
});

describe("percard K1 fallback (ENABLE_PERCARD_FALLBACK)", () => {
  const envOff = { ISSUER_KEY } as unknown as Env;
  const envOn = { ISSUER_KEY, ENABLE_PERCARD_FALLBACK: "1" } as unknown as Env;
  const percard = getUniquePerCardK1s()[0];
  if (!percard) throw new Error("generatedKeyData has no percard entries — fixture drift");

  it("rejects a percard-keyed tap when the flag is unset (current behavior)", () => {
    const { pHex } = virtualTap(percard.uid, 7, percard.k1, percard.k2);
    const result = decodeAndValidate(pHex, "0011223344556677", envOff, undefined);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unable to decode UID");
    }
  });

  it("decodes a percard-keyed tap to its row UID when the flag is set", () => {
    const { pHex } = virtualTap(percard.uid, 9, percard.k1, percard.k2);
    const result = decodeAndValidate(pHex, "0011223344556677", envOn, undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.uidHex).toBe(percard.uid);
    }
  });

  it("leaves deterministic decoding unchanged when the flag is set", () => {
    const keys = getDeterministicKeys(UID, envOn, 1);
    const { pHex, cHex } = virtualTap(UID, 11, keys.k1, keys.k2);
    const result = decodeAndValidate(pHex, cHex, envOn, hexToBytes(keys.k2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.uidHex).toBe(UID);
      expect(result.cmac_validated).toBe(true);
    }
  });

  it("still rejects a tap under an unknown key even with the flag set", () => {
    const randomK1 = "0123456789abcdef0123456789abcdef";
    const randomK2 = "fedcba0987654321fedcba0987654321";
    const { pHex } = virtualTap(UID, 13, randomK1, randomK2);
    const result = decodeAndValidate(pHex, "0011223344556677", envOn, undefined);
    expect(result.success).toBe(false);
  });
});
