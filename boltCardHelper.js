import AES from "aes-js";
import {
  hexToBytes,
  bytesToHex,
  buildVerificationData,
  decryptP,
  computeAesCmacForVerification,
  getK2KeyForUID
} from "./cryptoutils.js";

//import { uidConfig } from "./uidConfig.js"
import { BOLT_CARD_K1 } from "./uidConfig.js"

export function extractUIDAndCounter(pHex) {
  if (!BOLT_CARD_K1) {
    return { error: "BOLT_CARD_K1 variable is missing." };
  }
  const k1Keys = BOLT_CARD_K1.split(",").map(hexToBytes);
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

export function verifyCmac(uidHex, ctr, cHex) {
  if (!cHex) {
    return { cmac_validated: false, cmac_error: null };
  }

  const k2Bytes = getK2KeyForUID(uidHex);
  if (!k2Bytes) {
    return {
      cmac_validated: false,
      cmac_error: `No K2 key found for UID ${uidHex}. Unable to verify CMAC.`
    };
  }

  const { sv2 } = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctr), k2Bytes);
  const computedCtHex = bytesToHex(computeAesCmacForVerification(sv2, k2Bytes));

  if (computedCtHex === cHex.toLowerCase()) {
    return { cmac_validated: true, cmac_error: null };
  }

  return {
    cmac_validated: false,
    cmac_error: `CMAC verification failed. Provided CMAC: ${cHex.toLowerCase()}, Calculated CMAC: ${computedCtHex}.`
  };
}

export function decodeAndValidate(pHex, cHex) {
  const extraction = extractUIDAndCounter(pHex);
  if (extraction.error) {
    return { error: extraction.error };
  }

  const { uidHex, ctr } = extraction;
  
  if (!cHex) {
    return {
      uidHex,
      ctr,
      cmac_validated: false,
      cmac_error: null
    };
  }

  const verification = verifyCmac(uidHex, ctr, cHex);

  if (!verification.cmac_validated) {
    console.warn(`Warning: ${verification.cmac_error}`);
  }

  return {
    uidHex,
    ctr,
    cmac_validated: verification.cmac_validated,
    cmac_error: verification.cmac_error
  };
}
