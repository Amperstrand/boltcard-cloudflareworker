// getUidConfig.js

import { getDeterministicKeys } from "./keygenerator.js";

// Static UID configuration. This is our fallback if no KV store entry is found.
export const staticUidConfig = {
  "044561fa967380": {
    K2: "33268DEA5B5511A1B3DF961198FA46D5",
    payment_method: "clnrest",
    proxy: {
      baseurl:
        "https://demo.lnbits.com/boltcards/api/v1/scan/tapko6sbthfdgzoejjztjb" // Full base URL for proxying
    },
    clnrest: {
      protocol: "httpsnotusing",
      host: "https://restk.psbt.me:3010",
      port: 3010,
      rune: "dummy"
    }
  },

  "A1B2C3D4E5": {
    payment_method: "proxy",
    proxy: {
      baseurl:
        "https://other.lnbits.instance/boltcards/api/v1/scan/anotherExternalId123"
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
  }
};

/**
 * Returns the configuration for a given UID by checking multiple sources.
 *
 * Priority:
 * 1. KV Store: If `env.UID_CONFIG_KV` is defined and contains a config for the UID.
 * 2. Static configuration: Defined in the local staticUidConfig object.
 * 3. Fallback default: If no configuration is found, generate deterministic keys using keygenerator.js
 *    and return a config with payment_method "fakewallet" and K2 set to the generated k2.
 *
 * @param {string} uid - The UID to look up.
 *   (For deterministic key generation, the UID should be exactly 14 hex characters, i.e. 7 bytes.)
 * @param {object} env - The environment object that may contain KV bindings.
 * @returns {Promise<object|null>} The UID configuration or null if a key cannot be generated.
 */
export async function getUidConfig(uid, env) {
  // 1. Try to get the config from KV storage.
  if (env && env.UID_CONFIG_KV) {
    try {
      const kvConfigStr = await env.UID_CONFIG_KV.get(uid);
      if (kvConfigStr) {
        const kvConfig = JSON.parse(kvConfigStr);
        console.log(`Found config for UID ${uid} in KV store.`);
        return kvConfig;
      }
    } catch (error) {
      console.error(`Error reading KV config for UID ${uid}:`, error);
    }
  }

  // 2. Fall back to the static configuration.
  if (staticUidConfig.hasOwnProperty(uid)) {
    console.log(`Using static config for UID ${uid}.`);
    return staticUidConfig[uid];
  }

  // 3. Fallback default: generate deterministic keys using keygenerator.js.
  // Note: getDeterministicKeys expects a UID as a 14-character hex string.
  try {
    const keys = await getDeterministicKeys(uid);
    if (keys && keys.k2) {
      console.log(
        `Returning default fakewallet config for UID ${uid} using deterministic key generation.`
      );
      return { payment_method: "fakewallet", K2: keys.k2 };
    }
  } catch (err) {
    console.error(`Error generating deterministic keys for UID ${uid}:`, err);
  }

  console.warn(`No configuration and no K2 key could be generated for UID ${uid}.`);
  return null;
}
