// getUidConfig.js
import { computeAesCmac, hexToBytes } from './cryptoutils.js';
import { logger } from './utils/logger.js';
import { getDeterministicKeys } from "./keygenerator.js";
import { getCardConfig } from "./replayProtection.js";

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

  // Production guard: throw if no keys are configured in production
  const isProduction = env && (env.WORKER_ENV === "production" || env.ENVIRONMENT === "production");
  if (isProduction) {
    throw new Error("Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1");
  }

  // Fallback to development keys (for local testing only)
  logger.warn("Using fallback BOLT_CARD_K1 development keys - not for production");
  return [
    hexToBytes("55da174c9608993dc27bb3f30a4a7314"),
    hexToBytes("0c3b25d92b38ae443229dd59ad34b85d"),
  ];
}

async function withDeterministicK2IfMissing(uidHex, config, env, source, version = 1) {
  if (!config || config.K2) {
    return config;
  }

  try {
    const keys = await getDeterministicKeys(uidHex, env, version);
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

export async function getUidConfig(uidHex, env, version = 1) {
  const normalizedUid = uidHex.toLowerCase();
  logger.trace("Looking up UID config", { uidHex: normalizedUid });

  // Step 1: Try to get from DO
  try {
    const doConfig = await getCardConfig(env, normalizedUid);
    if (doConfig) {
      logger.trace("Found UID config in DO", {
        uidHex: normalizedUid,
        paymentMethod: doConfig.payment_method,
        hasK2: typeof doConfig.K2 === "string" && doConfig.K2.length > 0,
      });
      return withDeterministicK2IfMissing(normalizedUid, doConfig, env, "do", version);
    }
    logger.trace("No UID config found in DO", { uidHex: normalizedUid });
  } catch (error) {
    logger.error("Error retrieving UID config from DO", {
      uidHex: normalizedUid,
      error: error.message,
    });
  }

  // Step 2: Generate deterministic keys as fallback
  try {
    logger.debug("Generating deterministic fallback config", { uidHex: normalizedUid });
    const keys = await getDeterministicKeys(normalizedUid, env, version);
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
