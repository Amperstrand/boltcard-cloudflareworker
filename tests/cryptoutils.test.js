import {
  hexToBytes,
  bytesToHex,
  bytesToDecimalString,
  xorArrays,
  shiftGo,
  generateSubkeyGo,
  computeAesCmac,
  computeKs,
  computeCm,
  computeAesCmacForVerification,
  buildVerificationData,
  decryptP,
  verifyCmac,
} from "../cryptoutils.js";

import AES from "aes-js";

describe("BoltCard Crypto Tests", () => {
  const TEST_VECTORS = [
    {
      p: "4E2E289D945A66BB13377A728884E867",
      c: "E19CCB1FED8892CE",
      k1: "0c3b25d92b38ae443229dd59ad34b85d",
      k2: "b45775776cb224c75bcde7ca3704e933",
      expected_uid: "04996c6a926980",
      expected_ctr: "000003",
      expected_sv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 3, 0, 0],
      expected_ks: [242, 92, 75, 92, 230, 171, 63, 244, 5, 242, 135, 175, 172, 78, 77, 26],
      expected_cm: [118, 225, 233, 156, 238, 203, 64, 31, 163, 237, 110, 136, 112, 146, 124, 206],
      expected_ct: [225, 156, 203, 31, 237, 136, 146, 206]
    }
  ];

  TEST_VECTORS.forEach(({ p, c, k1, k2, expected_uid, expected_ctr, expected_sv2, expected_ks, expected_cm, expected_ct }) => {
    test(`Decoding p=${p} and c=${c}`, () => {
      const k1Bytes = hexToBytes(k1);
      const k2Bytes = hexToBytes(k2);
      const pBytes = hexToBytes(p);
      const cBytes = hexToBytes(c);

      // Step 1: Decrypt p using decryptP()
      const { success, uidBytes, ctr } = decryptP(bytesToHex(pBytes), [k1Bytes]);

      expect(success).toBe(true);
      expect(bytesToHex(uidBytes)).toBe(expected_uid);
      expect(bytesToHex(ctr)).toBe(expected_ctr);

      // Step 2: Generate sv2 and compare
      const { sv2, ks, cm, ct } = buildVerificationData(uidBytes, ctr, k2Bytes);

      expect(sv2.join(", ")).toBe(expected_sv2.join(", "));
      expect(ks.join(", ")).toBe(expected_ks.join(", "));
      expect(cm.join(", ")).toBe(expected_cm.join(", "));
      expect(ct.join(", ")).toBe(expected_ct.join(", "));

      // Step 3: Verify CMAC
      const computedCmac = computeAesCmacForVerification(sv2, k2Bytes);
      expect(bytesToHex(computedCmac)).toBe(bytesToHex(expected_ct));
    });
  });
});

// Additional Tests
test("hexToBytes and bytesToHex should work correctly", () => {
  const hex = "4E2E289D945A66BB13377A728884E867".toLowerCase();
  const bytes = hexToBytes(hex);
  expect(bytesToHex(bytes)).toBe(hex);
});

test("xorArrays should correctly XOR two byte arrays", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5, 6]);
  expect(xorArrays(a, b)).toEqual(new Uint8Array([5, 7, 5])); // (1^4, 2^5, 3^6)
});

test("xorArrays should throw an error if arrays have different lengths", () => {
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([4, 5, 6]);
  expect(() => xorArrays(a, b)).toThrow("xorArrays: Input arrays must have the same length");
});

test("shiftGo should correctly shift bytes left", () => {
  const input = new Uint8Array([0b01000000, 0b00000001]); // [64, 1]
  const { shifted, carry } = shiftGo(input);
  expect(shifted).toEqual(new Uint8Array([0b10000000, 0b00000010])); // [128, 2]
  expect(carry).toBe(0);
});

test("computeAesCmac should generate expected CMAC", () => {
  const message = hexToBytes("4E2E289D945A66BB13377A728884E867");
  const key = hexToBytes("b45775776cb224c75bcde7ca3704e933");
  const cmac = computeAesCmac(message, key);
  expect(bytesToHex(cmac).length).toBe(32); // CMAC should be 16 bytes (32 hex chars)
});

test("buildVerificationData should generate correct outputs", () => {
  const uidBytes = hexToBytes("04996c6a926980");
  const ctr = hexToBytes("000003");
  const k2Bytes = hexToBytes("b45775776cb224c75bcde7ca3704e933");

  const { sv2, ks, cm, ct } = buildVerificationData(uidBytes, ctr, k2Bytes);

  expect(sv2.length).toBe(16);
  expect(ks.length).toBe(16);
  expect(cm.length).toBe(16);
  expect(ct.length).toBe(8);
});

test("verifyCmac should return generic error message without leaking hex values", () => {
  const uidBytes = hexToBytes("04996c6a926980");
  const ctr = hexToBytes("000003");
  const k2Bytes = hexToBytes("b45775776cb224c75bcde7ca3704e933");

  // Provide a WRONG CMAC (not the expected value)
  const wrongCmac = "0000000000000000";
  const result = verifyCmac(uidBytes, ctr, wrongCmac, k2Bytes);

  // Should fail validation
  expect(result.cmac_validated).toBe(false);

  // Error message should be generic and NOT contain hex values
  expect(result.cmac_error).toBe("CMAC validation failed");

  // Verify no hex patterns (8+ hex chars) in error message
  expect(result.cmac_error).not.toMatch(/[0-9a-fA-F]{8,}/i);
});

test("verifyCmac should return null error when validation succeeds", () => {
  const uidBytes = hexToBytes("04996c6a926980");
  const ctr = hexToBytes("000003");
  const k2Bytes = hexToBytes("b45775776cb224c75bcde7ca3704e933");

  // Build the correct CMAC
  const { ct } = buildVerificationData(uidBytes, ctr, k2Bytes);
  const correctCmac = bytesToHex(ct);

  const result = verifyCmac(uidBytes, ctr, correctCmac, k2Bytes);

  // Should pass validation
  expect(result.cmac_validated).toBe(true);

  // Error should be null
  expect(result.cmac_error).toBe(null);
});

test("hexToBytes should throw for non-hex characters (ZZZZ)", () => {
  expect(() => hexToBytes("ZZZZ")).toThrow("Invalid hex string: contains non-hex characters");
});

test("hexToBytes should throw for mixed hex/non-hex (0g1h)", () => {
  expect(() => hexToBytes("0g1h")).toThrow("Invalid hex string: contains non-hex characters");
});

test("hexToBytes should accept lowercase hex (abCD12)", () => {
  const bytes = hexToBytes("abCD12");
  expect(bytesToHex(bytes)).toBe("abcd12");
});

test("hexToBytes should accept uppercase hex (ABCDEF)", () => {
  const bytes = hexToBytes("ABCDEF");
  expect(bytesToHex(bytes)).toBe("abcdef");
});

test("decryptP should work with single K1 key (existing behavior)", () => {
  const p = "4E2E289D945A66BB13377A728884E867";
  const k1 = "0c3b25d92b38ae443229dd59ad34b85d";
  const expected_uid = "04996c6a926980";
  const expected_ctr = "000003";

  const k1Bytes = hexToBytes(k1);
  const { success, uidBytes, ctr } = decryptP(p, [k1Bytes]);

  expect(success).toBe(true);
  expect(bytesToHex(uidBytes)).toBe(expected_uid);
  expect(bytesToHex(ctr)).toBe(expected_ctr);
});

test("decryptP should work with multiple K1 keys and return first match", () => {
  const p = "4E2E289D945A66BB13377A728884E867";
  const k1Correct = "0c3b25d92b38ae443229dd59ad34b85d";
  const k1Wrong = "00000000000000000000000000000001";
  const expected_uid = "04996c6a926980";
  const expected_ctr = "000003";

  const k1CorrectBytes = hexToBytes(k1Correct);
  const k1WrongBytes = hexToBytes(k1Wrong);

  const result1 = decryptP(p, [k1CorrectBytes, k1WrongBytes]);
  expect(result1.success).toBe(true);
  expect(bytesToHex(result1.uidBytes)).toBe(expected_uid);
  expect(bytesToHex(result1.ctr)).toBe(expected_ctr);
  expect(result1.usedK1).toEqual(k1CorrectBytes);

  const result2 = decryptP(p, [k1WrongBytes, k1CorrectBytes]);
  expect(result2.success).toBe(true);
  expect(bytesToHex(result2.uidBytes)).toBe(expected_uid);
  expect(bytesToHex(result2.ctr)).toBe(expected_ctr);
  expect(result2.usedK1).toEqual(k1CorrectBytes);
});
