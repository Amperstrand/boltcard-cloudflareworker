import { computeAesCmac, hexToBytes } from './cryptoutils.js';
import { logger } from './utils/logger.js';
import { getDeterministicKeys } from "./keygenerator.js";
import { getCardConfig } from "./replayProtection.js";
import { PAYMENT_METHOD } from "./utils/constants.js";

interface EnvLike {
  BOLT_CARD_K1_0?: string;
  BOLT_CARD_K1_1?: string;
  BOLT_CARD_K1?: string;
  ISSUER_KEY?: string;
  WORKER_ENV?: string;
  ENVIRONMENT?: string;
  UID_CONFIG?: KVNamespace;
  CARD_REPLAY?: DurableObjectNamespace;
}

export function getBoltCardK1(env: EnvLike | null | undefined): Uint8Array[] {
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

async function withDeterministicK2IfMissing(uidHex: string, config: Record<string, any> | null, env: EnvLike, source: string, version: number = 1): Promise<Record<string, any> | null> {
  if (!config || config.K2) {
    return config;
  }

  try {
    const keys = getDeterministicKeys(uidHex, env, version);
    if (keys?.k2) {
      logger.debug("Resolved deterministic K2 for UID config", { uidHex, source });
      return { ...config, K2: keys.k2 };
    }
  } catch (error: any) {
    logger.error("Error deriving deterministic K2 for UID config", {
      uidHex,
      source,
      error: error.message,
    });
  }

  return config;
}

export async function getUidConfig(uidHex: string, env: EnvLike, version: number = 1): Promise<Record<string, any> | null> {
  const normalizedUid = uidHex.toLowerCase();
  logger.trace("Looking up UID config", { uidHex: normalizedUid });

  try {
    const doConfig = await getCardConfig(env as any, normalizedUid);
    if (doConfig) {
      logger.trace("Found UID config in DO", {
        uidHex: normalizedUid,
        paymentMethod: doConfig.payment_method,
        hasK2: typeof doConfig.K2 === "string" && doConfig.K2.length > 0,
      });
      return withDeterministicK2IfMissing(normalizedUid, doConfig, env, "do", version);
    }
    logger.trace("No UID config found in DO", { uidHex: normalizedUid });
  } catch (error: any) {
    logger.error("Error retrieving UID config from DO", {
      uidHex: normalizedUid,
      error: error.message,
    });
  }

  try {
    logger.debug("Generating deterministic fallback config", { uidHex: normalizedUid });
    const keys = getDeterministicKeys(normalizedUid, env, version);
    if (keys && keys.k2) {
      const defaultConfig: Record<string, any> = {
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
  } catch (err: any) {
    logger.error("Error generating deterministic keys", {
      uidHex: normalizedUid,
      error: err.message,
    });
  }

  logger.warn("No UID configuration could be resolved", { uidHex: normalizedUid });
  return null;
}
