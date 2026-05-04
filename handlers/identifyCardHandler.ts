import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import type { CardStateRow } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { getUidConfig } from "../getUidConfig.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { hexToBytes } from "../cryptoutils.js";
import { getCardState, resolveActiveVersion } from "../replayProtection.js";
import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { cmacScanVersions } from "../utils/cmacScan.js";
import { logger } from "../utils/logger.js";
import { CARD_STATE, MISSING_PARAMS_MSG, VERSION_SCAN_RANGE } from "../utils/constants.js";

export async function handleIdentifyCard(request: Request, env: Env): Promise<Response> {
  const body: any = await parseJsonBody(request);
  const pHex = body?.p || new URL(request.url).searchParams.get("p");
  const cHex = body?.c || new URL(request.url).searchParams.get("c");

  if (!pHex || !cHex) {
    return errorResponse(MISSING_PARAMS_MSG);
  }

  const decryption: any = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return errorResponse(decryption.error);
  }

  const { uidHex, ctr } = decryption;
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const counterValue = parseInt(ctr, 16);

  let cardState: CardStateRow | null = null;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (e: unknown) {
    logger.warn("Identify card: getCardState failed", { uidHex, error: getErrorMessage(e) });
  }

  const results: any[] = [];

  if (cardState && cardState.state !== CARD_STATE.TERMINATED) {
    const activeVersion = resolveActiveVersion(cardState);
    let config: any;
    try {
      config = await getUidConfig(uidHex, env, activeVersion);
    } catch (e: unknown) {
      logger.warn("Identify card: getUidConfig failed", { uidHex, error: getErrorMessage(e) });
    }

    if (config && config.K2) {
      const cmac = validateCmac(uidBytes, ctrBytes, cHex, hexToBytes(config.K2));
      results.push({
        source: "config",
        version: activeVersion,
        cmac_validated: cmac.cmac_validated,
        payment_method: config.payment_method,
        card_state: cardState.state,
        active_version: activeVersion,
      });
    }
  }

  const keyCache = new Map<number, any>();
  let detAttempts: any[] = [];
  try {
    const scanResult: any = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
      k2ForVersion: async (v: number) => {
        try {
          const keys = getDeterministicKeys(uidHex, env, v);
          keyCache.set(v, keys);
          return hexToBytes(keys.k2);
        } catch (e: unknown) {
          logger.warn("Identify card: key derivation failed", { uidHex, version: v, error: getErrorMessage(e) });
          return new Uint8Array(16);
        }
      },
      highVersion: VERSION_SCAN_RANGE,
      lowVersion: 1,
      stopOnFirst: false,
    });
    detAttempts = scanResult.attempts;
  } catch (e: unknown) {
    logger.warn("Identify card: CMAC scan failed", { uidHex, error: getErrorMessage(e) });
  }

  for (const attempt of detAttempts) {
    if (attempt.cmac_validated && keyCache.has(attempt.version)) {
      results.push({
        source: "deterministic",
        version: attempt.version,
        cmac_validated: true,
        id: keyCache.get(attempt.version).id,
      });
    }
  }

  const match = results.find((r: any) => r.cmac_validated);

  return jsonResponse({
    uid: uidHex,
    counter: counterValue,
    card_state: cardState?.state || "unknown",
    active_version: cardState?.active_version || null,
    latest_issued_version: cardState?.latest_issued_version || null,
    matched: match || null,
    all_attempts: results,
  });
}
