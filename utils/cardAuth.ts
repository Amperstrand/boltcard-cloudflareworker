import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { getCardState, resolveActiveVersion } from "../replayProtection.js";
import { logger } from "./logger.js";
import { CARD_STATE } from "./constants.js";

interface ResolveCardIdentityOptions {
  activeVersion?: number;
  requireState?: boolean;
  skipCmac?: boolean;
  context?: string;
}

interface ResolveSuccess {
  ok: true;
  uidHex: string;
  ctr: string;
  counterValue: number;
  config: Record<string, any>;
  cmac_validated: boolean;
  cardState?: any;
  activeVersion?: number;
}

interface ResolveFailure {
  ok: false;
  status: number;
  error: string;
}

type ResolveResult = ResolveSuccess | ResolveFailure;

export async function resolveCardIdentity(
  pHex: string | undefined,
  cHex: string | undefined,
  env: any,
  { activeVersion: forcedVersion, requireState = false, skipCmac = false, context = "card-auth" }: ResolveCardIdentityOptions = {}
): Promise<ResolveResult> {
  if (!pHex || !cHex) {
    return { ok: false, status: 400, error: "Missing card parameters (p and c required)" };
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return { ok: false, status: 400, error: "Invalid card data" };
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState: any = null;
  if (requireState) {
    try {
      cardState = await getCardState(env, uidHex);
    } catch (error: any) {
      logger.error(`${context}: card state check failed`, { uidHex, error: error.message });
      return { ok: false, status: 503, error: "Card state unavailable" };
    }
  }

  const activeVersion = forcedVersion || (cardState ? resolveActiveVersion(cardState) : undefined);

  let config: Record<string, any> | null;
  try {
    config = await getUidConfig(uidHex, env, activeVersion);
  } catch (e: any) {
    logger.error(`${context}: getUidConfig failed`, { uidHex, error: e.message });
    return { ok: false, status: 500, error: "Card configuration unavailable" };
  }

  if (!config || !config.K2) {
    return { ok: false, status: 404, error: "Card configuration not found" };
  }

  const { cmac_validated, cmac_error } = validateCmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    cHex,
    hexToBytes(config.K2),
  );

  if (!skipCmac && !cmac_validated) {
    logger.warn(`${context}: CMAC validation failed`, { uidHex, error: cmac_error });
    return { ok: false, status: 403, error: cmac_error || "CMAC validation failed" };
  }

  const result: ResolveSuccess = { ok: true, uidHex, ctr, counterValue, config, cmac_validated };
  if (cardState) result.cardState = cardState;
  if (activeVersion !== undefined) result.activeVersion = activeVersion;
  return result;
}
