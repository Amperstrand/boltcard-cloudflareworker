import { getDeterministicKeys } from "../keygenerator.js"; // Ensure correct path
import { expect, test } from "@jest/globals";
import { bytesToHex } from "../cryptoutils.js";
import { extractUIDAndCounter } from "../boltCardHelper.js";
import { getBoltCardK1 } from "../getUidConfig.js";

test("Generate deterministic keys for known UID", async () => {
  const uid = "04a39493cc8680";
  const keys = getDeterministicKeys(uid);

  const expectedKeys = {
    k0: "a29119fcb48e737d1591d3489557e49b",
    k1: "55da174c9608993dc27bb3f30a4a7314",
    k2: "f4b404be700ab285e333e32348fa3d3b",
    k3: "73610ba4afe45b55319691cb9489142f",
    k4: "addd03e52964369be7f2967736b7bdb5",
    id: "e07ce1279d980ecb892a81924b67bf18",
    cardKey: "ebff5a4e6da5ee14cbfe720ae06fbed9",
  };

  expect(keys.k0).toBe(expectedKeys.k0);
  expect(keys.k1).toBe(expectedKeys.k1);
  expect(keys.k2).toBe(expectedKeys.k2);
  expect(keys.k3).toBe(expectedKeys.k3);
  expect(keys.k4).toBe(expectedKeys.k4);
  expect(keys.id).toBe(expectedKeys.id);
  expect(keys.cardKey).toBe(expectedKeys.cardKey);
});

test("getBoltCardK1 derives deterministic K1 from ISSUER_KEY when explicit K1 is absent", async () => {
  const env = { ISSUER_KEY: "00000000000000000000000000000001" };

  const derivedK1Keys = getBoltCardK1(env);
  const deterministicKeys = getDeterministicKeys("04a39493cc8680", env);

  expect(derivedK1Keys).toHaveLength(1);
  expect(bytesToHex(derivedK1Keys[0])).toBe(deterministicKeys.k1);
});

test("extractUIDAndCounter works with ISSUER_KEY-only env", () => {
  const result = extractUIDAndCounter("3736A84681238418D4B9B7210C13DC39", {
    ISSUER_KEY: "00000000000000000000000000000001",
  });

  expect(result).toMatchObject({
    success: true,
    uidHex: "044561fa967380",
    ctr: "00004e",
  });
});

test("getDeterministicKeys throws in production when ISSUER_KEY is missing", () => {
  const prodEnv = { WORKER_ENV: "production" };
  expect(() => getDeterministicKeys("04a39493cc8680", prodEnv)).toThrow("ISSUER_KEY must be set in production");
});

test("getDeterministicKeys uses fallback in dev when ISSUER_KEY is missing", async () => {
  const devEnv = {};
  const keys = getDeterministicKeys("04a39493cc8680", devEnv);
  expect(keys.k0).toBe("a29119fcb48e737d1591d3489557e49b");
});

test("getDeterministicKeys throws for empty uidHex", () => {
  expect(() => getDeterministicKeys("", {})).toThrow(/Invalid UID.*no characters/);
});

test("getDeterministicKeys throws for null uidHex", () => {
  expect(() => getDeterministicKeys(null, {})).toThrow(/Invalid UID.*no characters/);
});

test("getDeterministicKeys throws for short uidHex", () => {
  expect(() => getDeterministicKeys("04a394", {})).toThrow(/Invalid UID.*6 characters/);
});
