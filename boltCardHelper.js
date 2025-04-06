import {
  hexToBytes,
  bytesToHex,
  decryptP,
  verifyCmac
} from "./cryptoutils.js";
import { BOLT_CARD_K1 } from "./uidConfig.js"

/**
 * Helper to ensure the provided k1Keys is an array.
 * If it's not iterable, wrap it into an array.
 * @param {any} keys - The k1 keys.
 * @returns {Array}
 */
function ensureArray(keys) {
  return Array.isArray(keys) ? keys : [keys];
}

/**
 * Retrieves the K2 key for the given UID bytes from the KV configuration.
 * @param {Uint8Array} uidBytes - The UID bytes.
 * @returns {Promise<Uint8Array|null>} - Resolves with the K2 key in bytes, or null if not found.
 */
export async function getK2KeyForUIDSAFETODELETE(uidBytes) {
  if (!uidHex) { throw new Error('ct is undefined!'); }
  const uidHex = bytesToHex(uidBytes).toLowerCase();
  // Fetch the configuration for the UID from KV
  const configEntry = await UID_CONFIG.get(uidHex);
  if (!configEntry) {
    console.warn(`[WARNING] No config found for UID: ${uidHex}`);
    return null;
  }

  let config;
  try {
    config = JSON.parse(configEntry);
  } catch (err) {
    console.error(`[ERROR] Failed to parse config for UID: ${uidHex}`, err);
    return null;
  }

  if (!config.K2) {
    console.warn(`[WARNING] No K2 key found for UID: ${uidHex}`);
    return null;
  }
  return hexToBytes(config.K2);
}

/**
 * Extracts the UID and counter from the provided hex-encoded payload.
 * @param {string} pHex - The payload in hex string form.
 * @returns {{
 *   uidHex?: string,
 *   ctr?: string,
 *   error?: string
 * }}
 */
export function extractUIDAndCounter(pHex) {
  if (!BOLT_CARD_K1) {
    return { error: "BOLT_CARD_K1 variable is missing." };
  }

  // Determine if BOLT_CARD_K1 is a string (e.g., "key1,key2") or an array
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

  const result = decryptP(pHex, k1Keys);
  if (!result.success) {
    return { error: "Unable to decode UID from provided p parameter." };
  }
  console.log(result.ctr)
  console.log(result.uidBytes)

  return {
    success: true,
    uidHex: bytesToHex(result.uidBytes),
    ctr: bytesToHex(result.ctr)
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
  const k2Bytes = getK2KeyForUID(uidBytes);
  if (!k2Bytes) {
    return {
      cmac_validated: false,
      cmac_error: 'K2 key not found for UID'
    };
  }
  const verification = verifyCmac(uidBytes, ctr, cHex, k2Bytes);
  if (!verification.cmac_validated) {
    console.warn(`Warning: ${verification.cmac_error}`);
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
 *   uidBytes?: Uint8Array,
 *   ctr?: Uint8Array,
 *   usedK1?: Uint8Array,
 *   cmac_validated?: boolean,
 *   cmac_error?: string|null,
 *   error?: string
 * }}
 */
export function decodeAndValidate(pHex, cHex, k1Keys = BOLT_CARD_K1) {
	//const decryption = decrypt_uid_and_counter(pHex, k1Keys);
  const decryption = extractUIDAndCounter(pHex);
  if (!decryption.success) {
    return { success: false, error: decryption.error };
  }
  const { uidBytes, ctr, usedK1 } = decryption;
  //const validation = validate_cmac(uidBytes, ctr, cHex);
  return {
    success: true,
    uidBytes,
    ctr,
    usedK1,
    //cmac_validated: validation.cmac_validated,
    //cmac_error: validation.cmac_error
  };
}
