// Re-export all crypto primitives from @ntag424/crypto
export {
  hexToBytes,
  bytesToHex,
  computeAesCmac,
  decryptP,
  verifyCmac,
  buildVerificationData,
  _computeKs,
  _computeCm,
  _computeAesCmacForVerification,
} from "@ntag424/crypto";

export type { DecryptResult, DecryptSuccess, DecryptFailure } from "@ntag424/crypto";
export type { VerificationResult } from "@ntag424/crypto";
