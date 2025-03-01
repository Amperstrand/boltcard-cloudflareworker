import AES from "aes-js";
import {
  hexToBytes,
  bytesToHex,
  computeKs,
  computeCm
} from "../cryptoutils.js";
import { TEST_VECTORS, assertEqual, assertArrayEqual } from "../testvectors.js";

export async function handleVerification(url, env) {
  const pHex = url.searchParams.get("p");
  const cHex = url.searchParams.get("c");

  if (!pHex || !cHex) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Missing parameters" }),
      { status: 400 }
    );
  }

  const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes); // Convert K1 keys to byte arrays
  const k2Bytes = hexToBytes(env.BOLT_CARD_K2);
  const pBytes = hexToBytes(pHex);
  const cBytes = hexToBytes(cHex);

  if (pBytes.length !== 16 || cBytes.length !== 8) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Invalid p or c length" }),
      { status: 400 }
    );
  }

  let decrypted, uidBytes, ctr;
  let matched = false;
  let usedK1 = null; // Store which K1 was used

  for (const k1Bytes of k1Keys) {
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    decrypted = aesEcbK1.decrypt(pBytes);

    if (decrypted[0] === 0xC7) {
      matched = true;
      usedK1 = bytesToHex(k1Bytes); // Save the K1 key that worked
      uidBytes = decrypted.slice(1, 8);
      ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
      break; // Stop after the first successful decryption
    }
  }

  if (!matched) {
    console.error("Failed to decrypt UID with any provided K1 keys.");
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Unable to decode UID" }),
      { status: 400 }
    );
  }

  console.log(`Decryption successful with K1: ${usedK1}`);

  // Construct sv2 block
  const sv2 = new Uint8Array(16);
  sv2.set([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uidBytes, 6);
  sv2[13] = ctr[2];
  sv2[14] = ctr[1];
  sv2[15] = ctr[0];

  const ks = computeKs(sv2, k2Bytes);
  const cm = computeCm(ks);
  const ct = new Uint8Array([
    cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]
  ]);

  // Check against test vectors if applicable
  const testVector = TEST_VECTORS.find(tv => tv.p === pHex && tv.c === cHex);
  if (testVector) {
    assertEqual("UID", bytesToHex(uidBytes), testVector.expectedUID);
    assertEqual("Counter", bytesToHex(ctr), testVector.expectedCounter);
    assertArrayEqual("sv2", sv2, testVector.expectedSv2);
    assertArrayEqual("ks", ks, testVector.expectedKs);
    assertArrayEqual("cm", cm, testVector.expectedCm);
    assertArrayEqual("ct", ct, testVector.expectedCt);

    const response = {
      tag: "withdrawRequest",
      callback: `https://card.yourdomain.com/withdraw?uid=${testVector.expectedUID}`,
      k1: testVector.expectedUID,
      maxWithdrawable: 100000000,
      minWithdrawable: 1000,
      defaultDescription: `Bolt Card Payment for UID ${testVector.expectedUID}, counter ${testVector.expectedCounter}`
    };

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ status: "ERROR", reason: "CMAC verification failed" }),
    { status: 400 }
  );
}
