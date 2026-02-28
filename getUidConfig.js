// getUidConfig.js
import { hexToBytes } from './cryptoutils';

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
  
  // Fallback to development keys (for local testing only)
  console.warn("⚠️  Using fallback BOLT_CARD_K1 development keys - NOT FOR PRODUCTION");
  return [
    hexToBytes("55da174c9608993dc27bb3f30a4a7314"),
    hexToBytes("0c3b25d92b38ae443229dd59ad34b85d"),
  ];
}
export const UID_PRIVACY = false

import { getDeterministicKeys } from "./keygenerator.js";

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
  }
};

/**
 * Get configuration for a card UID from KV storage or generate it
 */
export async function getUidConfig(uidHex, env) {
  // Normalize the UID to lowercase for consistency
  const normalizedUid = uidHex.toLowerCase();
  console.log(`Looking up config for UID: ${normalizedUid}`);
  
  // Step 1: Try to get from KV
  if (env && env.UID_CONFIG) {
    try {
      const configStr = await env.UID_CONFIG.get(normalizedUid);
      if (configStr) {
        const config = JSON.parse(configStr);
        console.log(`Found config in KV for UID=${normalizedUid}:`, JSON.stringify(config));
        
        // Validation - ensure required fields exist
        if (!config.K2) {
          console.warn(`Config for UID=${normalizedUid} is missing K2 key`);
        }
        if (!config.payment_method) {
          console.warn(`Config for UID=${normalizedUid} is missing payment_method`);
        }
        
        return config;
      }
      console.log(`No config found in KV for UID=${normalizedUid}`);
    } catch (error) {
      console.error(`Error retrieving config for UID=${normalizedUid} from KV:`, error);
    }
  } else {
    console.warn("KV storage not available for config lookup");
  }

  // Step 2: Check static configuration
  if (staticUidConfig.hasOwnProperty(normalizedUid)) {
    console.log(`Using static config for UID ${normalizedUid}.`);
    return staticUidConfig[normalizedUid];
  }

  // Step 3: Generate deterministic keys as fallback
  try {
    console.log(`Attempting to generate deterministic keys for ${normalizedUid}`);
    const keys = await getDeterministicKeys(normalizedUid, env);
    if (keys && keys.k2) {
      const defaultConfig = { 
        payment_method: "fakewallet", 
        K2: keys.k2 
      };
      console.log(`Returning default fakewallet config for UID ${normalizedUid} using deterministic key generation:`, JSON.stringify(defaultConfig));
      return defaultConfig;
    } else {
      console.error(`Failed to generate valid k2 key for UID ${normalizedUid}`);
    }
  } catch (err) {
    console.error(`Error generating deterministic keys for UID ${normalizedUid}:`, err.message);
  }

  console.warn(`No configuration and no K2 key could be generated for UID ${normalizedUid}.`);
  return null;
}
