import {
  hexToBytes,
  bytesToHex,
  decryptP,
  verifyCmac
} from "./cryptoutils.js";
import { getBoltCardK1, staticUidConfig } from "./getUidConfig.js";

/**
 * Extracts the UID and counter from the provided hex-encoded payload.
 * @param {string} pHex - The payload in hex string form.
 * @returns {{
 *   uidHex?: string,
 *   ctr?: string,
 *   error?: string
 * }}
 */
export function extractUIDAndCounter(pHex, env) {
  console.log("extractUIDAndCounter input pHex:", pHex);
  
  // Get BOLT_CARD_K1 from env parameter (Cloudflare Workers env binding)
  const BOLT_CARD_K1 = getBoltCardK1(env);
  let k1Keys;
  console.log("BOLT_CARD_K1 type:", typeof BOLT_CARD_K1); // Add this debug line
  
  // Determine if BOLT_CARD_K1 is a string (e.g., "key1,key2") or an array
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
  console.log("decryptP result:", result); // Add this debug line
  
  if (!result.success) {
    return { error: "Unable to decode UID from provided p parameter." };
  }
  
  // Convert array-like object to actual Uint8Array
  const uidBytes = new Uint8Array(Object.values(result.uidBytes));
  const ctrBytes = new Uint8Array(Object.values(result.ctr));

  return {
    success: true,
    uidHex: bytesToHex(uidBytes),
    ctr: bytesToHex(ctrBytes)
  };
}


/**
 * Validates the CMAC for the given UID and counter.
 * It retrieves the K2 key from the configuration and then calls cryptoUtils.verifyCmac.
 * @param {Uint8Array} uidBytes - The UID bytes.
 * @param {Uint8Array} ctr - The counter bytes.
 * @param {string} cHex - The provided CMAC as a hex string.
 * @returns {{ cmac_validated: boolean, cmac_error: string|null }}
 */
export function validate_cmac(uidBytes, ctr, cHex) {
  if (!cHex) {
    return {
      cmac_validated: false,
      cmac_error: null
    };
  }
  
  if (!ctr || ctr.length === 0) {
    return {
      cmac_validated: false,
      cmac_error: 'Invalid counter value'
    };
  }
  
  const uidHex = bytesToHex(uidBytes);
  
  let config;
  try {
    // Use configuration from getUidConfig.js (single source of truth)
    config = staticUidConfig[uidHex.toLowerCase()];
    
    if (!config || !config.K2) {
      return {
        cmac_validated: false,
        cmac_error: 'K2 key not found for UID'
      };
    }
  } catch (e) {
    console.error("Error retrieving configuration:", e);
    return {
      cmac_validated: false,
      cmac_error: 'Configuration lookup failed'
    };
  }
  
  const k2Bytes = hexToBytes(config.K2);
  
  const verification = verifyCmac(uidBytes, ctr, cHex, k2Bytes);
  if (!verification.cmac_validated) {
    console.warn(`CMAC validation failed: ${verification.cmac_error}`);
  }
  return verification;
}

/**
 * Combines decryption and CMAC validation.
 * @param {string} pHex - The encrypted payload as a hex string.
 * @param {string} cHex - The provided CMAC as a hex string.
 * @param {Array<Uint8Array>|Uint8Array} k1Keys - An array (or single key) of possible K1 keys.
 * @returns {{
 *   success: boolean,
 *   uidHex?: string,
 *   ctr?: string,
 *   usedK1?: Uint8Array,
 *   cmac_validated?: boolean,
 *   cmac_error?: string|null,
 *   error?: string
 * }}
 */
export function decodeAndValidate(pHex, cHex, env) {
  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return { success: false, error: decryption.error };
  }
  
  const { uidHex, ctr } = decryption;
  
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  
  const validation = validate_cmac(uidBytes, ctrBytes, cHex);
  
  return {
    success: true,
    uidHex,
    ctr,
    cmac_validated: validation.cmac_validated,
    cmac_error: validation.cmac_error
  };
}
