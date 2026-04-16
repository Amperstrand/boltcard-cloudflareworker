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
    },
    {
      p: "00F48C4F8E386DED06BCDC78FA92E2FE",
      c: "66B4826EA4C155B4",
      k1: "0c3b25d92b38ae443229dd59ad34b85d",
      k2: "b45775776cb224c75bcde7ca3704e933",
      expected_uid: "04996c6a926980",
      expected_ctr: "000005",
      expected_sv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 5, 0, 0],
      expected_ks: [73, 70, 39, 105, 116, 24, 126, 152, 96, 101, 139, 189, 130, 16, 200, 190],
      expected_cm: [94, 102, 243, 180, 93, 130, 2, 110, 198, 164, 241, 193, 67, 85, 112, 180],
      expected_ct: [102, 180, 130, 110, 164, 193, 85, 180]
    },
    {
      p: "0DBF3C59B59B0638D60B5842A997D4D1",
      c: "CC61660C020B4D96",
      k1: "0c3b25d92b38ae443229dd59ad34b85d",
      k2: "b45775776cb224c75bcde7ca3704e933",
      expected_uid: "04996c6a926980",
      expected_ctr: "000007",
      expected_sv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 7, 0, 0],
      expected_ks: [97, 189, 177, 81, 15, 79, 217, 5, 102, 95, 162, 58, 192, 199, 38, 97],
      expected_cm: [40, 204, 202, 97, 87, 102, 6, 12, 101, 2, 250, 11, 199, 77, 73, 150],
      expected_ct: [204, 97, 102, 12, 2, 11, 77, 150]
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

test("computeAesCmac should throw for 15-byte key (wrong length)", () => {
  const message = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const wrongKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

  expect(() => computeAesCmac(message, wrongKey)).toThrow(
    "AES-CMAC requires a 16-byte key (AES-128), per RFC 4493 §2.3"
  );
});

test("computeAesCmac should throw for 17-byte key (wrong length)", () => {
  const message = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const wrongKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

  expect(() => computeAesCmac(message, wrongKey)).toThrow(
    "AES-CMAC requires a 16-byte key (AES-128), per RFC 4493 §2.3"
  );
});

test("computeAesCmac should succeed with 16-byte key (correct length)", () => {
  const message = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const correctKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  expect(() => computeAesCmac(message, correctKey)).not.toThrow();
  const result = computeAesCmac(message, correctKey);
  expect(result.length).toBe(16);
});

test("computeAesCmac should throw for 17-byte message (exceeds single-block limit)", () => {
  const message = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  expect(() => computeAesCmac(message, key)).toThrow(
    "computeAesCmac: message length 17 exceeds single-block limit (16)"
  );
});

test("computeAesCmac should succeed with 16-byte message (exactly one block)", () => {
  const message = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  expect(() => computeAesCmac(message, key)).not.toThrow();
  const result = computeAesCmac(message, key);
  expect(result.length).toBe(16);
});

test("computeAesCmac should succeed with 0-byte message (empty message)", () => {
  const message = new Uint8Array([]);
  const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  expect(() => computeAesCmac(message, key)).not.toThrow();
  const result = computeAesCmac(message, key);
  expect(result.length).toBe(16);
});

test("verifyCmac returns cmac_validated=true when CMAC matches", () => {
  const { p, c, k1, k2 } = {
    p: "4E2E289D945A66BB13377A728884E867",
    c: "E19CCB1FED8892CE",
    k1: "0c3b25d92b38ae443229dd59ad34b85d",
    k2: "b45775776cb224c75bcde7ca3704e933",
  };
  const k1Bytes = hexToBytes(k1);
  const k2Bytes = hexToBytes(k2);
  const { success, uidBytes, ctr } = decryptP(p, [k1Bytes]);
  expect(success).toBe(true);
  const result = verifyCmac(uidBytes, ctr, c, k2Bytes);
  expect(result.cmac_validated).toBe(true);
  expect(result.cmac_error).toBeNull();
});

test("verifyCmac returns cmac_validated=false when cHex has wrong length", () => {
  const k2Bytes = hexToBytes("b45775776cb224c75bcde7ca3704e933");
  const uidBytes = hexToBytes("04996c6a926980");
  const ctr = hexToBytes("000003");

  const shortCHex = "E19CCB1FED8892";
  const result = verifyCmac(uidBytes, ctr, shortCHex, k2Bytes);
  expect(result.cmac_validated).toBe(false);
  expect(result.cmac_error).toBe("CMAC validation failed");
});

// ============================================================================
// RFC 4493 §4 — AES-CMAC Test Vectors
// Ref: https://tools.ietf.org/html/rfc4493#section-4
// These vectors validate our CMAC implementation against the IETF standard
// independently of any BoltCard-specific logic.
// ============================================================================

describe("RFC 4493 §4 — AES-CMAC Test Vectors", () => {
  // RFC 4493 §4 key used for all examples
  const rfcKey = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");

  test("RFC 4493 §4 — Subkey Generation: K1 and K2", () => {
    // Ref: RFC 4493 §4 "Subkey Generation"
    // Step 1: L = AES-128(K, 0^128) = 7df76b0c1ab899b33e42f047b91b546f
    // Step 2: K1 = fbeed618357133667c85e08f7236a8de
    // Step 3: K2 = f7ddac306ae266ccf90bc11ee46d513b

    // First, we need L. L = AES-128(key, 0^128)
    // Use the imported AES from aes-js (ES module)
    const aesEcb = new AES.ModeOfOperation.ecb(rfcKey);
    const L = aesEcb.encrypt(new Uint8Array(16));

    // Now generate subkeys from L
    const k1 = generateSubkeyGo(L);
    const k2 = generateSubkeyGo(k1);

    expect(bytesToHex(k1)).toBe("fbeed618357133667c85e08f7236a8de");
    expect(bytesToHex(k2)).toBe("f7ddac306ae266ccf90bc11ee46d513b");
  });

  test("RFC 4493 §4 — Example 1: len=0 (empty message)", () => {
    // Ref: RFC 4493 §4 "Example 1: len = 0"
    // M = <empty string>
    // AES-CMAC = bb1d6929 e9593728 7fa37d12 9b756746
    const result = computeAesCmac(new Uint8Array(0), rfcKey);
    expect(bytesToHex(result)).toBe("bb1d6929e95937287fa37d129b756746");
  });

  test("RFC 4493 §4 — Example 2: len=16 (single block)", () => {
    // Ref: RFC 4493 §4 "Example 2: len = 16"
    // M = 6bc1bee2 2e409f96 e93d7e11 7393172a
    // AES-CMAC = 070a16b4 6b4d4144 f79bdd9d d04a287c
    const msg = hexToBytes("6bc1bee22e409f96e93d7e117393172a");
    const result = computeAesCmac(msg, rfcKey);
    expect(bytesToHex(result)).toBe("070a16b46b4d4144f79bdd9dd04a287c");
  });

  test("RFC 4493 §4 — Example 3: len=40 throws (multi-block not implemented)", () => {
    // Ref: RFC 4493 §4 "Example 3: len = 40"
    // Our implementation only supports single-block (≤16 bytes).
    // Full CBC-MAC chaining per RFC 4493 §2.4 Algorithm 3 steps 5-6 is not implemented.
    const msg = hexToBytes("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411");
    expect(() => computeAesCmac(msg, rfcKey)).toThrow(/multi-block/i);
  });

  test("RFC 4493 §4 — Example 4: len=64 throws (multi-block not implemented)", () => {
    // Ref: RFC 4493 §4 "Example 4: len = 64"
    const msg = hexToBytes("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710");
    expect(() => computeAesCmac(msg, rfcKey)).toThrow(/multi-block/i);
  });
});

// ============================================================================
// BTCPayServer.BoltCardTools-inspired tests
// Ref: https://github.com/btcpayserver/BTCPayServer.BoltCardTools/blob/master/tests/UnitTest1.cs
// These tests mirror the patterns used by the BTCPayServer C# reference
// implementation to validate NTAG424/BoltCard crypto operations.
// ============================================================================

describe("BTCPayServer.BoltCardTools-inspired tests", () => {
  const k1 = hexToBytes("0c3b25d92b38ae443229dd59ad34b85d");
  const k2 = hexToBytes("b45775776cb224c75bcde7ca3704e933");

  // Modeled after: BTCPayServer.BoltCardTools CanCalculateSunMac
  // Ref: https://github.com/btcpayserver/BTCPayServer.BoltCardTools/blob/master/tests/UnitTest1.cs
  // The C# test verifies: given uid + counter + K2, the SUN MAC (truncated CMAC) matches c
  test("CanCalculateSunMac — uid=04996c6a926980, ctr=3", () => {
    const uidBytes = hexToBytes("04996c6a926980");
    const ctr = hexToBytes("000003");
    const { ct } = buildVerificationData(uidBytes, ctr, k2);
    // Expected truncated CMAC matches the c= parameter from boltcard TEST_VECTORS.md
    expect(bytesToHex(ct)).toBe("e19ccb1fed8892ce");
  });

  test("CanCalculateSunMac — uid=04996c6a926980, ctr=5", () => {
    const uidBytes = hexToBytes("04996c6a926980");
    const ctr = hexToBytes("000005");
    const { ct } = buildVerificationData(uidBytes, ctr, k2);
    expect(bytesToHex(ct)).toBe("66b4826ea4c155b4");
  });

  test("CanCalculateSunMac — uid=04996c6a926980, ctr=7", () => {
    const uidBytes = hexToBytes("04996c6a926980");
    const ctr = hexToBytes("000007");
    const { ct } = buildVerificationData(uidBytes, ctr, k2);
    expect(bytesToHex(ct)).toBe("cc61660c020b4d96");
  });

  // Modeled after: BTCPayServer.BoltCardTools CanDecryptSunPICCData
  // Ref: https://github.com/btcpayserver/BTCPayServer.BoltCardTools/blob/master/tests/UnitTest1.cs
  // The C# test verifies: given encrypted p + K1, decryption yields correct uid + counter
  test("CanDecryptSunPICCData — p=4E2E..., uid=04996c6a926980, ctr=3", () => {
    const p = "4E2E289D945A66BB13377A728884E867";
    const result = decryptP(p, [k1]);
    expect(result.success).toBe(true);
    expect(bytesToHex(result.uidBytes)).toBe("04996c6a926980");
    expect(bytesToHex(result.ctr)).toBe("000003");
  });

  test("CanDecryptSunPICCData — p=00F4..., uid=04996c6a926980, ctr=5", () => {
    const p = "00F48C4F8E386DED06BCDC78FA92E2FE";
    const result = decryptP(p, [k1]);
    expect(result.success).toBe(true);
    expect(bytesToHex(result.uidBytes)).toBe("04996c6a926980");
    expect(bytesToHex(result.ctr)).toBe("000005");
  });

  test("CanDecryptSunPICCData — p=0DBF..., uid=04996c6a926980, ctr=7", () => {
    const p = "0DBF3C59B59B0638D60B5842A997D4D1";
    const result = decryptP(p, [k1]);
    expect(result.success).toBe(true);
    expect(bytesToHex(result.uidBytes)).toBe("04996c6a926980");
    expect(bytesToHex(result.ctr)).toBe("000007");
  });

  // Modeled after: boltcard/boltcard crypto.go — CMAC truncation pattern
  // Ref: https://github.com/boltcard/boltcard/blob/main/crypto/crypto.go
  // The Go implementation extracts ct from cm using odd-indexed bytes:
  // ct[0]=cm[1], ct[1]=cm[3], ct[2]=cm[5], ct[3]=cm[7],
  // ct[4]=cm[9], ct[5]=cm[11], ct[6]=cm[13], ct[7]=cm[15]
  test("Odd-byte CMAC truncation matches boltcard Go reference", () => {
    const uidBytes = hexToBytes("04996c6a926980");
    const ctr = hexToBytes("000003");
    const { cm, ct } = buildVerificationData(uidBytes, ctr, k2);

    // Verify ct contains exactly the odd-indexed bytes from cm
    // This matches the truncation pattern in boltcard/boltcard crypto.go:
    //   ct[0] = cm[1], ct[1] = cm[3], ... ct[7] = cm[15]
    expect(ct.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(ct[i]).toBe(cm[2 * i + 1]);
    }
  });
});
