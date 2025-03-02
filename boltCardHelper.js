import AES from "aes-js";
import {
  hexToBytes,
  bytesToHex,
  buildVerificationData,
  decryptP,
  computeAesCmacForVerification,
  getK2KeyForUID
} from "./cryptoutils.js";

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

export function verifyCmac(uidHex, ctr, cHex, env) {
  if (!cHex) {
    return { cmac_validated: false, cmac_validated_comment: null };
  }

  const k2Bytes = getK2KeyForUID(env, uidHex);
  if (!k2Bytes) {
    return {
      cmac_validated: false,
      cmac_validated_comment: `No K2 key found for UID ${uidHex}. Unable to verify CMAC.`
    };
  }

  const { sv2 } = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctr), k2Bytes);
  const computedCtHex = bytesToHex(computeAesCmacForVerification(sv2, k2Bytes));

  if (computedCtHex === cHex.toLowerCase()) {
    return { cmac_validated: true, cmac_validated_comment: null };
  }

  return {
    cmac_validated: false,
    cmac_validated_comment: `CMAC verification failed. Provided CMAC: ${cHex.toLowerCase()}, Calculated CMAC: ${computedCtHex}.`
  };
}

export function decodeAndValidate(pHex, cHex, env) {
  const extraction = extractUIDAndCounter(pHex, env);
  if (extraction.error) {
    return { error: extraction.error };
  }

  const { uidHex, ctr } = extraction;
  
  if (!cHex) {
    return {
      uidHex,
      ctr,
      cmac_validated: false,
      cmac_validated_comment: null
    };
  }

  const verification = verifyCmac(uidHex, ctr, cHex, env);

  if (!verification.cmac_validated) {
    console.warn(`Warning: ${verification.cmac_validated_comment}`);
  }

  return {
    uidHex,
    ctr,
    cmac_validated: verification.cmac_validated,
    cmac_validated_comment: verification.cmac_validated_comment
  };
}
