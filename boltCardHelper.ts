import { decryptP, verifyCmac, hexToBytes, bytesToHex } from "@ntag424/crypto";
import { getBoltCardK1 } from "./getUidConfig.js";
import { getUniquePerCardK1s, getPerCardKeys, percardFallbackEnabled } from "./utils/keyLookup.js";
import { logger, getErrorMessage } from "./utils/logger.js";
import type { Env } from "./types/core.js";

export function buildMacWindowData(requestUrl: string, cHex: string): Uint8Array | null {
  const uriContent = requestUrl.replace(/^https?:\/\//, "");
  const encoded = cHex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = uriContent.match(new RegExp(`[?&]c=${encoded}`));
  if (!match || match.index === undefined) return null;
  const macValueStart = match.index + match[0].length - cHex.length;
  return new TextEncoder().encode(uriContent.slice(0, macValueStart));
}

interface ExtractSuccess {
  success: true;
  uidHex: string;
  ctr: string;
}

interface ExtractFailure {
  success: false;
  error: string;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

export function extractUIDAndCounter(pHex: string, env: Env): ExtractResult {
  const k1Keys = getBoltCardK1(env);

  if (!k1Keys || k1Keys.length === 0) {
    return { error: "Failed to parse BOLT_CARD_K1." } as ExtractFailure;
  }

  let result: ReturnType<typeof decryptP>;
  try {
    result = decryptP(pHex, k1Keys);
  } catch (error: unknown) {
    return { error: getErrorMessage(error) } as ExtractFailure;
  }

  // Opt-in percard fallback (ENABLE_PERCARD_FALLBACK=1): when the configured
  // K1s cannot decode p, retry against the unique percard K1s from
  // generatedKeyData. Safe by construction: the UID comes from the decrypted
  // plaintext (not from key identity), and the row's K2 still gates the CMAC.
  // See docs/percard-fallback.md for the tradeoff analysis.
  if (!result.success && percardFallbackEnabled(env)) {
    const percardK1s = getUniquePerCardK1s().map((entry) => hexToBytes(entry.k1));
    if (percardK1s.length > 0) {
      try {
        result = decryptP(pHex, [...k1Keys, ...percardK1s]);
        if (result.success) {
          logger.info("p decoded via percard K1 fallback", { action: "card_tap" });
        }
      } catch {
        // keep the original deterministic-path failure
      }
    }
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

export function validateCmac(
  uidBytes: Uint8Array,
  ctr: Uint8Array,
  cHex: string | null | undefined,
  k2Bytes: Uint8Array | undefined,
  windowData?: Uint8Array | null,
): { cmac_validated: boolean; cmac_error: string | null } {
  if (!cHex) {
    return { cmac_validated: false, cmac_error: null };
  }

  if (!ctr || ctr.length === 0) {
    return { cmac_validated: false, cmac_error: 'Invalid counter value' };
  }

  if (k2Bytes) {
    const verification = verifyCmac(uidBytes, ctr, cHex, k2Bytes);
    if (verification.cmac_validated) return verification;

    if (windowData && windowData.length > 0) {
      const fallback = verifyCmac(uidBytes, ctr, cHex, k2Bytes, windowData);
      if (fallback.cmac_validated) {
        logger.info("CMAC validated via MAC window fallback");
        return fallback;
      }
    }

    logger.warn("CMAC validation failed", { error: verification.cmac_error });
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

export function decodeAndValidate(
  pHex: string,
  cHex: string | null | undefined,
  env: Env,
  k2Bytes?: Uint8Array,
  requestUrl?: string,
): DecodeAndValidateResult {
  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return { success: false, error: (decryption as ExtractFailure).error };
  }

  const { uidHex, ctr } = decryption;

  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);

  const windowData = requestUrl && cHex ? buildMacWindowData(requestUrl, cHex) : null;
  const validation = validateCmac(uidBytes, ctrBytes, cHex, k2Bytes, windowData);

  return {
    success: true,
    uidHex,
    ctr,
    cmac_validated: validation.cmac_validated,
    cmac_error: validation.cmac_error
  };
}

/**
 * CMAC validation with percard K2 fallback (ENABLE_PERCARD_FALLBACK).
 * The config K2 comes from the card's DO row (deterministic-era for
 * previously-deterministic cards) and never matches a percard-burned card;
 * retry with the percard row K2 — the same public key material as the
 * identification fallback in extractUIDAndCounter (docs/percard-fallback.md).
 * Shared by resolveCardIdentity (all card-tap endpoints) and the LNURLW
 * handler so operator paths (topup/POS/refund) accept percard cards too.
 */
export function validateCmacWithPercardFallback(
  uidBytes: Uint8Array,
  ctr: Uint8Array,
  cHex: string,
  configK2Bytes: Uint8Array,
  env: Env,
  windowData?: Uint8Array | null,
): { cmac_validated: boolean; cmac_error: string | null } {
  const first = validateCmac(uidBytes, ctr, cHex, configK2Bytes, windowData);
  if (first.cmac_validated || !percardFallbackEnabled(env)) return first;

  const percard = getPerCardKeys(bytesToHex(uidBytes));
  if (!percard?.k2) return first;

  const retry = validateCmac(uidBytes, ctr, cHex, hexToBytes(percard.k2), windowData);
  if (retry.cmac_validated) {
    logger.info("CMAC validated via percard K2 fallback");
  }
  return retry;
}
