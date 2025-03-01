import { hexToBytes, bytesToHex, bytesToDecimalString } from "../cryptoutils.js";
import { computeKs, computeCm, computeAesCmacForVerification } from "../cryptoutils.js";
import AES from "aes-js";

// Test vectors
const TEST_VECTORS = [
  {
    p: "4E2E289D945A66BB13377A728884E867",
    c: "E19CCB1FED8892CE",
    k1_aes_decrypt_key: "0c3b25d92b38ae443229dd59ad34b85d",
    k2_aes_cmac_key: "b45775776cb224c75bcde7ca3704e933",
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
    k1_aes_decrypt_key: "0c3b25d92b38ae443229dd59ad34b85d",
    k2_aes_cmac_key: "b45775776cb224c75bcde7ca3704e933",
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
    k1_aes_decrypt_key: "0c3b25d92b38ae443229dd59ad34b85d",
    k2_aes_cmac_key: "b45775776cb224c75bcde7ca3704e933",
    expected_uid: "04996c6a926980",
    expected_ctr: "000007",
    expected_sv2: [60, 195, 0, 1, 0, 128, 4, 153, 108, 106, 146, 105, 128, 7, 0, 0],
    expected_ks: [97, 189, 177, 81, 15, 79, 217, 5, 102, 95, 162, 58, 192, 199, 38, 97],
    expected_cm: [40, 204, 202, 97, 87, 102, 6, 12, 101, 2, 250, 11, 199, 77, 73, 150],
    expected_ct: [204, 97, 102, 12, 2, 11, 77, 150]
  }
];

describe("BoltCard Crypto Tests", () => {
  TEST_VECTORS.forEach(({ p, c, k1_aes_decrypt_key, k2_aes_cmac_key, expected_uid, expected_ctr, expected_sv2, expected_ks, expected_cm, expected_ct }) => {
    test(`Decoding p=${p} and c=${c}`, () => {
      const k1Bytes = hexToBytes(k1_aes_decrypt_key);
      const k2Bytes = hexToBytes(k2_aes_cmac_key);
      const pBytes = hexToBytes(p);
      const cBytes = hexToBytes(c);

      // Step 1: Decrypt p using AES-ECB(K1)
      const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
      const decrypted = aesEcbK1.decrypt(pBytes);

      // Print decrypted block for debugging
      console.log("Decrypted block:", bytesToHex(decrypted));

      // Extract UID (bytes 1-7) and Counter (bytes 8-10)
      const uidBytes = decrypted.slice(1, 8);
      const ctrBytes = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
      const uidHex = bytesToHex(uidBytes);
      const ctrHex = bytesToHex(ctrBytes);

      console.log("Extracted UID:", uidHex);
      console.log("Extracted Counter:", ctrHex);

      // Assert UID and Counter
      expect(uidHex).toBe(expected_uid);
      expect(ctrHex).toBe(expected_ctr);

      // Step 2: Generate sv2
      const sv2 = new Uint8Array(16);
      sv2.set([60, 195, 0, 1, 0, 128]);
      sv2.set(uidBytes, 6);
      sv2[13] = ctrBytes[2];
      sv2[14] = ctrBytes[1];
      sv2[15] = ctrBytes[0];

      // Convert both expected_sv2 and sv2 to strings for easier comparison
      const sv2String = sv2.join(', ');
      const expectedSv2String = expected_sv2.join(', ');

      // Print both values for debugging
      console.log("Expected sv2 (decimal):", expectedSv2String);
      console.log("Generated sv2 (decimal):", sv2String);

      // Compare the arrays as strings to avoid Jest serialization issues
      expect(sv2String).toBe(expectedSv2String);  // Compare as strings

      // Step 3: Compute ks
      const ks = computeKs(sv2, k2Bytes);
      console.log("Computed ks (decimal):", ks);

      // Compare ks as strings
      const ksString = ks.join(', ');
      const expectedKsString = expected_ks.join(', ');
      console.log("Expected ks (decimal):", expectedKsString);
      console.log("Computed ks (decimal):", ksString);
      expect(ksString).toBe(expectedKsString);

      // Step 4: Compute cm
      const cm = computeCm(ks);
      console.log("Computed cm (decimal):", cm);

      // Compare cm as strings
      const cmString = cm.join(', ');
      const expectedCmString = expected_cm.join(', ');
      console.log("Expected cm (decimal):", expectedCmString);
      console.log("Computed cm (decimal):", cmString);
      expect(cmString).toBe(expectedCmString);

      // Step 5: Extract ct from cm
      const ct = Uint8Array.of(cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]);
      console.log("Extracted ct (decimal):", ct);

      // Compare ct as strings
      const ctString = ct.join(', ');
      const expectedCtString = expected_ct.join(', ');
      console.log("Expected ct (decimal):", expectedCtString);
      console.log("Extracted ct (decimal):", ctString);
      expect(ctString).toBe(expectedCtString);

      // Optional: Verify CMAC directly
      const computedCmac = computeAesCmacForVerification(sv2, k2Bytes);
      console.log("Computed CMAC for verification:", bytesToHex(computedCmac));

      expect(bytesToHex(computedCmac)).toBe(bytesToHex(expected_ct));
    });
  });
});
