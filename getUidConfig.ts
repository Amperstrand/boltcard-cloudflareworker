import { computeAesCmac, hexToBytes } from './cryptoutils.js';
import { getErrorMessage } from "./utils/logger.js";
import type { CardConfig, Env } from "./types/core.js";
import { logger } from './utils/logger.js';
import { getDeterministicKeys } from "./keygenerator.js";
import { getCardConfig } from "./replayProtection.js";
import { PAYMENT_METHOD } from "./utils/constants.js";


export function getBoltCardK1(env: Env | null | undefined): Uint8Array[] {
  if (env && env.BOLT_CARD_K1_0 && env.BOLT_CARD_K1_1) {
    return [
      hexToBytes(env.BOLT_CARD_K1_0),
      hexToBytes(env.BOLT_CARD_K1_1)
    ];
  }
  if (env && env.BOLT_CARD_K1) {
    return env.BOLT_CARD_K1.split(',').map(hexToBytes);
  }

  if (env && env.ISSUER_KEY) {
    logger.debug("Deriving K1 from ISSUER_KEY for PICC decryption");
    const issuerKeyBytes = hexToBytes(env.ISSUER_KEY);
    return [computeAesCmac(hexToBytes("2d003f77"), issuerKeyBytes)];
  }

  const isProduction = env && (env.WORKER_ENV === "production" || env.ENVIRONMENT === "production");
  if (isProduction) {
    throw new Error("Production deploy must set BOLT_CARD_K1 or BOLT_CARD_K1_0/1");
  }

  logger.warn("Using fallback BOLT_CARD_K1 development keys - not for production");
  return [
    hexToBytes("55da174c9608993dc27bb3f30a4a7314"),
    hexToBytes("0c3b25d92b38ae443229dd59ad34b85d"),
  ];
}

async function withDeterministicK2IfMissing(uidHex: string, config: CardConfig | null, env: Env, source: string, version: number = 1): Promise<CardConfig | null> {
  if (!config || config.K2) {
    return config;
  }

  try {
    const keys = getDeterministicKeys(uidHex, env, version);
    if (keys?.k2) {
      logger.debug("Resolved deterministic K2 for UID config", { uidHex, source });
      return { ...config, K2: keys.k2 };
    }
  } catch (error: unknown) {
    logger.error("Error deriving deterministic K2 for UID config", {
      uidHex,
      source,
      error: getErrorMessage(error),
    });
  }

  return config;
}

export async function getUidConfig(uidHex: string, env: Env, version: number = 1): Promise<CardConfig | null> {
  const normalizedUid = uidHex.toLowerCase();
  logger.trace("Looking up UID config", { uidHex: normalizedUid });

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
  } catch (error: unknown) {
    logger.error("Error retrieving UID config from DO", {
      uidHex: normalizedUid,
      error: getErrorMessage(error),
    });
  }

  try {
    logger.debug("Generating deterministic fallback config", { uidHex: normalizedUid });
    const keys = getDeterministicKeys(normalizedUid, env, version);
    if (keys && keys.k2) {
      const defaultConfig: CardConfig = {
        payment_method: PAYMENT_METHOD.FAKEWALLET,
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
  } catch (err: unknown) {
    logger.error("Error generating deterministic keys", {
      uidHex: normalizedUid,
      error: getErrorMessage(err),
    });
  }

  logger.warn("No UID configuration could be resolved", { uidHex: normalizedUid });
  return null;
}
