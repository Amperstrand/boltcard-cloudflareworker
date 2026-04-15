/**
 * boltCardHelper.js — SUN/SDM verification for BoltCard protocol
 *
 * Implements the backend verification channel (Subsystem B) as described in:
 *   - NXP AN12196 §3 (SDM / SUN), §5.5 (PICCData), §5.7 (SDMMAC)
 *   - NXP NTAG 424 DNA data sheet
 *   - RFC 4493 (AES-CMAC)
 *
 * The BoltCard protocol uses NTAG 424 DNA's SDM feature but with its own
 * CMAC derivation and truncation scheme (see cryptoutils.js for details).
 * Keep SDM backend verification logic separate from SSM/provisioning logic.
 *
 * Ref: docs/ntag424_llm_context.md §3 ("The single most important
 * implementation split"), §5.8 ("Practical backend verification algorithm")
 */
import {
  hexToBytes,
  bytesToHex,
  decryptP,
  verifyCmac
} from "./cryptoutils.js";
import { getBoltCardK1 } from "./getUidConfig.js";

/**
 * Extracts the UID and counter from the encrypted `p` parameter.
 *
 * Per NXP AN12196 §5.5: the `p` parameter contains PICCENCData, which is
 * AES-128-ECB encrypted with K1 (the SDM meta read key). The plaintext
 * layout is:
 *   [PICCDataTag(1)] [UID(7)] [SDMReadCtr(3)] [padding(5)]
 *
 * PICCDataTag = 0xC7 means: UID mirrored (bit 7), SDMReadCtr mirrored
 * (bit 6), UID length = 7 bytes (bits 3..0 = 0b0111).
 *
 * The SDMReadCtr is stored little-endian (LSB first) in the plaintext,
 * matching NXP AN12196 §4 byte-order conventions.
 *
 * @param {string} pHex - The encrypted payload as a 32-char hex string (16 bytes).
 * @param {object} env - Cloudflare Workers env (for K1 key secrets).
 * @returns {{ success: boolean, uidHex?: string, ctr?: string, error?: string }}
 */
export function extractUIDAndCounter(pHex, env) {
  // K1 is the SDM meta read key, shared across all cards from the same IssuerKey.
  // Per boltcard key derivation: K1 = CMAC(IssuerKey, "2d003f77") — card-independent.
  // Multi-K1 rotation is supported for key migration (see boltcard-protocol.md §8).
  const BOLT_CARD_K1 = getBoltCardK1(env);
  let k1Keys;

  if (typeof BOLT_CARD_K1 === "string") {
    k1Keys = BOLT_CARD_K1.split(",").map(hexToBytes);
  } else if (Array.isArray(BOLT_CARD_K1)) {
    k1Keys = BOLT_CARD_K1;
  } else {
    return { error: "BOLT_CARD_K1 is not in a recognized format." };
  }

  if (!k1Keys || k1Keys.length === 0) {
    return { error: "Failed to parse BOLT_CARD_K1." };
  }

  let result;
  try {
    result = decryptP(pHex, k1Keys);
  } catch (error) {
    return { error: error.message };
  }

  if (!result.success) {
    return { error: "Unable to decode UID from provided p parameter." };
  }

  // Ensure proper Uint8Array type (aes-js may return plain arrays)
  const uidBytes = new Uint8Array(Object.values(result.uidBytes));
  const ctrBytes = new Uint8Array(Object.values(result.ctr));

  return {
    success: true,
    uidHex: bytesToHex(uidBytes),
    ctr: bytesToHex(ctrBytes)
  };
}


/**
 * Validates the CMAC (`c` parameter) against the decrypted UID and counter.
 *
 * Per NXP AN12196 §5.7 and §5.8: after recovering UID and SDMReadCtr from
 * PICCENCData, derive the SDM session MAC key (ks = CMAC(K2, SV2)), then
 * verify the truncated CMAC against the received `c` value.
 *
 * IMPORTANT: The BoltCard protocol uses a custom CMAC derivation and truncation
 * that differs from the standard NTAG424 SDM MACt (which uses S14||S12||..||S0).
 * See cryptoutils.js computeAesCmacForVerification() for details.
 *
 * @param {Uint8Array} uidBytes - The 7-byte UID from the card.
 * @param {Uint8Array} ctr - The 3-byte SDMReadCtr (big-endian after extraction).
 * @param {string} cHex - The received CMAC as a 16-char hex string (8 bytes).
 * @param {Uint8Array} [k2Bytes] - The K2 key (SDM file read key) for this card.
 *   If not provided, falls back to staticUidConfig lookup for backward compatibility.
 * @returns {{ cmac_validated: boolean, cmac_error: string|null }}
 */
export function validate_cmac(uidBytes, ctr, cHex, k2Bytes) {
  if (!cHex) {
    return { cmac_validated: false, cmac_error: null };
  }

  if (!ctr || ctr.length === 0) {
    return { cmac_validated: false, cmac_error: 'Invalid counter value' };
  }

  // If K2 was passed directly (from KV/deterministic config), use it.
  // This is the correct path for cards configured via KV or deterministic keys.
  if (k2Bytes) {
    const verification = verifyCmac(uidBytes, ctr, cHex, k2Bytes);
    if (!verification.cmac_validated) {
      console.warn(`CMAC validation failed: ${verification.cmac_error}`);
    }
    return verification;
  }

  // Fallback: no K2 provided — this should not happen in normal flow.
  // Callers should always pass K2 from the card's config (KV, static, or deterministic).
  return { cmac_validated: false, cmac_error: 'K2 key not provided for CMAC validation' };
}

/**
 * Combines decryption and CMAC validation into a single step.
 *
 * Implements steps 1-8 of the "Practical backend verification algorithm"
 * from NXP AN12196 §5.8:
 *   1. Parse incoming URL fields (p, c) — done by caller
 *   2. Extract PICCENCData (p param) — extractUIDAndCounter
 *   3. Recover UID and SDMReadCtr — from decryption result
 *   4. Derive SDM session keys — inside verifyCmac
 *   5. Compute and verify CMAC — verifyCmac
 *
 * Note: step 6 (SDMENCFileData decryption) and step 9 (counter replay
 * protection) are not implemented in this function. Counter monotonicity
 * should be enforced by the caller using Durable Objects or equivalent.
 *
 * @param {string} pHex - The encrypted payload (32 hex chars).
 * @param {string} cHex - The CMAC verification tag (16 hex chars).
 * @param {object} env - Cloudflare Workers env (for K1/K2 secrets).
 * @param {Uint8Array} [k2Bytes] - Optional K2 override; if absent, validation is skipped.
 * @returns {{ success: boolean, uidHex?: string, ctr?: string, cmac_validated?: boolean, cmac_error?: string|null, error?: string }}
 */
export function decodeAndValidate(pHex, cHex, env, k2Bytes) {
  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return { success: false, error: decryption.error };
  }

  const { uidHex, ctr } = decryption;

  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);

  const validation = validate_cmac(uidBytes, ctrBytes, cHex, k2Bytes);

  return {
    success: true,
    uidHex,
    ctr,
    cmac_validated: validation.cmac_validated,
    cmac_error: validation.cmac_error
  };
}
