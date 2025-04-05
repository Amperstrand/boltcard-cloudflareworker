// getUidConfig.js
import { uidConfig as staticUidConfig } from "./uidConfig.js";

/**
 * Retrieves UID config from KV storage or falls back to static config.
 * @param {string} uidHex - The UID to look up.
 * @param {Object} env - The Cloudflare environment containing the KV binding.
 * @returns {Promise<Object|null>}
 */
export async function getUidConfig(uidHex, env = {}) {
  let config = null;

  // 1. Try fetching from KV
  if (env.UID_CONFIG && typeof env.UID_CONFIG.get === "function") {
    try {
      const kvConfigJSON = await env.UID_CONFIG.get(`uid:${uidHex}`);
      if (kvConfigJSON) {
        config = JSON.parse(kvConfigJSON);
        console.log(`Found UID ${uidHex} in KV.`);
      }
    } catch (err) {
      console.error(`Error fetching UID ${uidHex} from KV:`, err);
    }
  }

  // 2. Fallback to static config
  if (!config) {
    config = staticUidConfig[uidHex] || null;
    if (config) {
      console.log(`Using static config for UID ${uidHex}.`);
    }
  }

  return config;
}
