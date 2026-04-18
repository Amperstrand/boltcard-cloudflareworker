// getUidConfig.js
import { computeAesCmac, hexToBytes } from './cryptoutils.js';
import { logger } from './utils/logger.js';

// BOLT_CARD_K1 from environment/secrets (secure for production)
// Falls back to development keys for local testing
export function getBoltCardK1(env) {
  // Try to get from env parameter (Cloudflare Workers env binding)
  if (env && env.BOLT_CARD_K1_0 && env.BOLT_CARD_K1_1) {
    return [
      hexToBytes(env.BOLT_CARD_K1_0),
      hexToBytes(env.BOLT_CARD_K1_1)
    ];
  }
  // Support comma-separated string format (e.g., from test env)
  if (env && env.BOLT_CARD_K1) {
    return env.BOLT_CARD_K1.split(',').map(hexToBytes);
  }

  if (env && env.ISSUER_KEY) {
    logger.debug("Deriving K1 from ISSUER_KEY for PICC decryption");
    const issuerKeyBytes = hexToBytes(env.ISSUER_KEY);
    return [computeAesCmac(hexToBytes("2d003f77"), issuerKeyBytes)];
  }
  
  // Fallback to development keys (for local testing only)
  logger.warn("Using fallback BOLT_CARD_K1 development keys - not for production");
  return [
    hexToBytes("55da174c9608993dc27bb3f30a4a7314"),
    hexToBytes("0c3b25d92b38ae443229dd59ad34b85d"),
  ];
}
export const UID_PRIVACY = false

import { getDeterministicKeys } from "./keygenerator.js";

async function withDeterministicK2IfMissing(uidHex, config, env, source) {
  if (!config || config.K2) {
    return config;
  }

  try {
    const keys = await getDeterministicKeys(uidHex, env);
    if (keys?.k2) {
      logger.debug("Resolved deterministic K2 for UID config", { uidHex, source });
      return { ...config, K2: keys.k2 };
    }
  } catch (error) {
    logger.error("Error deriving deterministic K2 for UID config", {
      uidHex,
      source,
      error: error.message,
    });
  }

  return config;
}

// Static UID configuration. This is our fallback if no KV store entry is found.
export const staticUidConfig = {
  "044561fa967380": {
    K2: "33268DEA5B5511A1B3DF961198FA46D5",
    payment_method: "clnrest",
    proxy: {
      baseurl:
        "https://demo.lnbits.com/boltcards/api/v1/scan/tapko6sbthfdgzoejjztjb" 
    },
    clnrest: {
      protocol: "httpsnotusing",
      host: "https://restk.psbt.me:3010",
      port: 3010,
      rune: "dummy"
    }
},

  "04996c6a926980": {
    K2: "B45775776CB224C75BCDE7CA3704E933",
    payment_method: "clnrest",
    clnrest: {
      protocol: "https",
      host: "cln.example.com",
      port: 3001,
      rune: "abcd1234efgh5678ijkl"
    }
  },

  "04a071fa967380": {
    K2: "EFCF2DD0528E57FF2E674E76DFC6B3B1",
    payment_method: "fakewallet"
  },
  
  // Add the missing UID that's being used in the requests
  "04b060fa967380": {
    K2: "8378cb4c0660012b6c791e3858c2353b",
    payment_method: "fakewallet"
  },

  "04d070fa967380": {
    payment_method: "lnurlpay",
    lnurlpay: {
      lightning_address: "test@getalby.com",
      min_sendable: 1000,
      max_sendable: 1000
    }
  }
};

/**
 * Get configuration for a card UID from KV storage or generate it
 */
export async function getUidConfig(uidHex, env) {
  // Normalize the UID to lowercase for consistency
  const normalizedUid = uidHex.toLowerCase();
  logger.trace("Looking up UID config", { uidHex: normalizedUid });
  
  // Step 1: Try to get from KV
  if (env && env.UID_CONFIG) {
    try {
      const configStr = await env.UID_CONFIG.get(normalizedUid);
      if (configStr) {
        const config = JSON.parse(configStr);
        logger.trace("Found UID config in KV", {
          uidHex: normalizedUid,
          paymentMethod: config.payment_method,
          hasK2: typeof config.K2 === "string" && config.K2.length > 0,
        });
        
        // Validation - ensure required fields exist
        if (!config.K2) {
          logger.warn("UID config is missing K2 key", { uidHex: normalizedUid });
        }
        if (!config.payment_method) {
          logger.warn("UID config is missing payment_method", { uidHex: normalizedUid });
        }
        
        return config;
      }
      logger.trace("No UID config found in KV", { uidHex: normalizedUid });
    } catch (error) {
      logger.error("Error retrieving UID config from KV", {
        uidHex: normalizedUid,
        error: error.message,
      });
    }
  } else {
    logger.warn("KV storage not available for UID config lookup");
  }

  // Step 2: Check static configuration
  if (staticUidConfig.hasOwnProperty(normalizedUid)) {
    logger.trace("Using static UID config", { uidHex: normalizedUid });
    return withDeterministicK2IfMissing(normalizedUid, staticUidConfig[normalizedUid], env, "static");
  }

  // Step 3: Generate deterministic keys as fallback
  try {
    logger.debug("Generating deterministic fallback config", { uidHex: normalizedUid });
    const keys = await getDeterministicKeys(normalizedUid, env);
    if (keys && keys.k2) {
      const defaultConfig = { 
        payment_method: "fakewallet", 
        K2: keys.k2 
      };
      logger.debug("Using deterministic fallback config", {
        uidHex: normalizedUid,
        paymentMethod: defaultConfig.payment_method,
        hasK2: true,
      });
      return defaultConfig;
    } else {
      logger.error("Failed to generate valid K2 key", { uidHex: normalizedUid });
    }
  } catch (err) {
    logger.error("Error generating deterministic keys", {
      uidHex: normalizedUid,
      error: err.message,
    });
  }

  logger.warn("No UID configuration could be resolved", { uidHex: normalizedUid });
  return null;
}
