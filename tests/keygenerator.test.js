import { getDeterministicKeys } from "../keygenerator.js"; // Ensure correct path
import { expect, test } from "@jest/globals";

test("Generate deterministic keys for known UID", async () => {
  const uid = "04a39493cc8680";
  const keys = await getDeterministicKeys(uid);

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
