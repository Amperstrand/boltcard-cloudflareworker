import { extractUIDAndCounter, validateCmac, buildMacWindowData } from "../boltCardHelper.js";
import type { CardStateRow, CardConfig, Env, CounterCheckResult } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { getCardState, activateCard, checkAndAdvanceCounter, recordTapRead, setCardK2 } from "../replayProtection.js";
import { logger } from "../utils/logger.js";
import { CARD_STATE } from "./constants.js";
import { detectCardVersion } from "./versionDetection.js";

interface ValidateCardTapOptions {
  pHex: string;
  cHex: string;
  context?: string;
}

interface ValidateCardTapSuccess {
  ok: true;
  uidHex: string;
  counterValue: number;
  activeVersion: number;
  config: CardConfig;
  cardState: CardStateRow;
}

interface ValidateCardTapFailure {
  ok: false;
  status: number;
  error: string;
}

export type ValidateCardTapResult = ValidateCardTapSuccess | ValidateCardTapFailure;

export async function validateCardTap(request: Request, env: Env, { pHex, cHex, context = "tap" }: ValidateCardTapOptions): Promise<ValidateCardTapResult> {
  if (!pHex || !cHex) {
    return { ok: false, status: 400, error: "Missing card parameters (p and c required)" };
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.warn(`${context}: failed to decrypt card`, { error: decryption.error });
    return { ok: false, status: 400, error: "Could not read card — decryption failed" };
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState: CardStateRow;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error: unknown) {
    logger.error(`${context}: card state check failed`, { uidHex, error: getErrorMessage(error) });
    return { ok: false, status: 503, error: "Card state unavailable" };
  }

  if (cardState.state === CARD_STATE.TERMINATED) {
    return { ok: false, status: 403, error: "Card has been terminated" };
  }

  if (cardState.state === CARD_STATE.WIPE_REQUESTED) {
    return { ok: false, status: 403, error: "Card is pending wipe — re-program before use" };
  }

  let activeVersion: number;
  if (cardState.state === CARD_STATE.KEYS_DELIVERED) {
    const keys = getDeterministicKeys(uidHex, env, cardState.latest_issued_version);
    const { cmac_validated } = validateCmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(keys.k2),
      buildMacWindowData(request.url, cHex),
    );
    if (cmac_validated) {
      activeVersion = cardState.latest_issued_version;
      await activateCard(env, uidHex, activeVersion);
      // Persist K2 so future ACTIVE taps use the correct key without version scanning
      try {
        await setCardK2(env, uidHex, keys.k2);
      } catch (e: unknown) {
        logger.warn(`${context}: failed to persist K2 after activation`, { uidHex, version: activeVersion, error: getErrorMessage(e) });
      }
    } else {
      // Fallback: scan versions for physical cards that can't change keys
      // after server-side reactivation (e.g., deliverKeys advanced the version
      // but the physical card is still at v1).
      const detectedVersion = await detectCardVersion(uidHex, ctr, cHex, env, cardState.latest_issued_version);
      if (detectedVersion !== null) {
        activeVersion = detectedVersion;
        await activateCard(env, uidHex, activeVersion);
        // Persist K2 so future taps skip version scanning
        try {
          const detectedKeys = getDeterministicKeys(uidHex, env, detectedVersion);
          await setCardK2(env, uidHex, detectedKeys.k2);
        } catch (e: unknown) {
          logger.warn(`${context}: failed to persist K2 after version detection`, { uidHex, version: detectedVersion, error: getErrorMessage(e) });
        }
      } else {
        return { ok: false, status: 403, error: "Card version mismatch — try again or re-program card" };
      }
    }
  } else if (cardState.state === CARD_STATE.ACTIVE || cardState.state === CARD_STATE.DISCOVERED) {
    activeVersion = cardState.active_version || 1;
  } else {
    activeVersion = 1;
  }

  const config = (await getUidConfig(uidHex, env, activeVersion)) as CardConfig | null;
  if (!config) {
    logger.warn(`${context}: UID not found in config`, { uidHex });
    return { ok: false, status: 404, error: "Card not registered" };
  }

  if (config.K2) {
    const { cmac_validated, cmac_error } = validateCmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(config.K2),
      buildMacWindowData(request.url, cHex),
    );
    if (!cmac_validated) {
      logger.warn(`${context}: CMAC validation failed`, { uidHex, error: cmac_error });
      return { ok: false, status: 403, error: "Card authentication failed" };
    }
  }

  let replayResult: CounterCheckResult;
  try {
    replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
  } catch (error: unknown) {
    logger.error(`${context}: replay protection check failed`, { uidHex, counterValue, error: getErrorMessage(error) });
    return { ok: false, status: 503, error: "Replay protection unavailable" };
  }
  // DESIGN DECISION: Replay enforcement is intentionally disabled for operator
  // handlers. The same physical NFC tap (same counter) must be usable across
  // multiple operations — e.g., top-up then POS charge. Operators may also need
  // to retry a tap if a network error occurred mid-operation.
  //
  // Security is NOT weakened because:
  // - Financial operations (topup/charge/refund) are individually authorized
  //   via operator session + CSRF token
  // - Balance updates are atomic per-DO (single-threaded)
  // - The replay counter is still advanced and logged for audit
  if (!replayResult.accepted) {
    logger.warn(`${context}: replay detected — continuing (replay enforcement disabled by design, see AGENTS.md)`, { uidHex, counterValue, reason: replayResult.reason, lastCounter: replayResult.lastCounter });
  }

  recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch((e: unknown) => logger.warn(`Failed to record ${context} tap`, { uidHex, counterValue, error: getErrorMessage(e) }));

  return {
    ok: true,
    uidHex,
    counterValue,
    activeVersion,
    config,
    cardState,
  };
}
