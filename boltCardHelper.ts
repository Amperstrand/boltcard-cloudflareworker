import {
  hexToBytes,
  bytesToHex,
  decryptP,
  verifyCmac
} from "./cryptoutils.js";
import { getBoltCardK1 } from "./getUidConfig.js";
import { logger } from "./utils/logger.js";

interface ExtractSuccess {
  success: true;
  uidHex: string;
  ctr: string;
}

interface ExtractFailure {
  success: false;
  error: string;
}

type ExtractResult = ExtractSuccess | ExtractFailure;

export function extractUIDAndCounter(pHex: string, env: any): ExtractResult {
  const k1Keys = getBoltCardK1(env);

  if (!k1Keys || k1Keys.length === 0) {
    return { error: "Failed to parse BOLT_CARD_K1." } as ExtractFailure;
  }

  let result: any;
  try {
    result = decryptP(pHex, k1Keys);
  } catch (error: any) {
    return { error: error.message } as ExtractFailure;
  }

  if (!result.success) {
    return { error: "Unable to decode UID from provided p parameter." } as ExtractFailure;
  }

  const uidBytes = new Uint8Array(result.uidBytes);
  const ctrBytes = new Uint8Array(result.ctr);

  return {
    success: true,
    uidHex: bytesToHex(uidBytes),
    ctr: bytesToHex(ctrBytes)
  };
}

export function validateCmac(uidBytes: Uint8Array, ctr: Uint8Array, cHex: string | null | undefined, k2Bytes: Uint8Array | undefined): { cmac_validated: boolean; cmac_error: string | null } {
  if (!cHex) {
    return { cmac_validated: false, cmac_error: null };
  }

  if (!ctr || ctr.length === 0) {
    return { cmac_validated: false, cmac_error: 'Invalid counter value' };
  }

  if (k2Bytes) {
    const verification = verifyCmac(uidBytes, ctr, cHex, k2Bytes);
    if (!verification.cmac_validated) {
      logger.warn("CMAC validation failed", { error: verification.cmac_error });
    }
    return verification;
  }

  return { cmac_validated: false, cmac_error: "K2 key not available" };
}

interface DecodeAndValidateSuccess {
  success: true;
  uidHex: string;
  ctr: string;
  cmac_validated: boolean;
  cmac_error: string | null;
}

interface DecodeAndValidateFailure {
  success: false;
  error: string;
}

type DecodeAndValidateResult = DecodeAndValidateSuccess | DecodeAndValidateFailure;

export function decodeAndValidate(pHex: string, cHex: string | null | undefined, env: any, k2Bytes?: Uint8Array): DecodeAndValidateResult {
  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return { success: false, error: (decryption as ExtractFailure).error };
  }

  const { uidHex, ctr } = decryption;

  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);

  const validation = validateCmac(uidBytes, ctrBytes, cHex, k2Bytes);

  return {
    success: true,
    uidHex,
    ctr,
    cmac_validated: validation.cmac_validated,
    cmac_error: validation.cmac_error
  };
}
