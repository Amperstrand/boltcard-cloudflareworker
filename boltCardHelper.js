import AES from "aes-js";
import {
  hexToBytes,
  bytesToHex,
  buildVerificationData,
  decryptP,
  computeAesCmacForVerification,
  getK2KeyForUID
} from "./cryptoutils.js";

/**
 * Extracts UID and counter from the provided pHex parameter.
 * @param {string} pHex - Encrypted UID and counter in hexadecimal.
 * @param {object} env - Environment variables.
 * @returns {object} Object with uidHex, ctr or an error property.
 */
export function extractUIDAndCounter(pHex, env) {
  if (!env.BOLT_CARD_K1) {
    return { error: "BOLT_CARD_K1 environment variable is missing." };
  }
  const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes);
  if (!k1Keys || k1Keys.length === 0) {
    return { error: "Failed to parse BOLT_CARD_K1." };
  }
  const result = decryptP(pHex, k1Keys);
  if (!result.success) {
    return { error: "Unable to decode UID from provided p parameter." };
  }
  return {
    uidHex: bytesToHex(result.uidBytes),
    ctr: bytesToHex(result.ctr)
  };
}

/**
 * Verifies the CMAC for the provided UID and counter.
 * @param {string} uidHex - UID in hexadecimal.
 * @param {string} ctr - Counter in hexadecimal.
 * @param {string} cHex - Provided CMAC in hexadecimal.
 * @param {object} env - Environment variables.
 * @returns {object} Object with a success flag or an error property.
 */
export function verifyCmac(uidHex, ctr, cHex, env) {
  if (!cHex) {
    return { error: "Missing c parameter for CMAC verification." };
  }
  const k2Bytes = getK2KeyForUID(env, uidHex);
  if (!k2Bytes) {
    return { error: `No K2 key found for UID ${uidHex}. Unable to verify CMAC.` };
  }
  const { sv2 } = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctr), k2Bytes);
  const computedCtHex = bytesToHex(computeAesCmacForVerification(sv2, k2Bytes));
  if (computedCtHex !== cHex.toLowerCase()) {
    return {
      error: `CMAC verification failed. Expected CMAC: ${cHex.toLowerCase()}, Calculated CMAC: ${computedCtHex}. This is likely because the K2 key is incorrect.`
    };
  }
  return { success: true };
}

/**
 * Combines extraction and CMAC verification.
 * @param {string} pHex - Encrypted UID and counter in hexadecimal.
 * @param {string} cHex - Provided CMAC in hexadecimal.
 * @param {object} env - Environment variables.
 * @returns {object} Object with uidHex, ctr or an error property.
 */
export function decodeAndValidate(pHex, cHex, env) {
  const extraction = extractUIDAndCounter(pHex, env);
  if (extraction.error) {
    return extraction;
  }
  const { uidHex, ctr } = extraction;
  const verification = verifyCmac(uidHex, ctr, cHex, env);
  if (verification.error) {
    return verification;
  }
  return { uidHex, ctr };
}
