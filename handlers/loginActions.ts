import { logger } from "../utils/logger.js";
import type { CardStateRow , OpResult} from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getCardState, getCardConfig, terminateCard, requestWipe, creditCard, resolveActiveVersion, resolveLatestVersion } from "../replayProtection.js";
import { validateUid, getRequestOrigin } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID, CARD_STATE, UID_VALIDATION_MSG } from "../utils/constants.js";

function resolvePullPaymentId(env: Env, cardConfig: any): string {
  return cardConfig?.pull_payment_id || env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;
}

function buildProgrammingEndpoint(requestOrigin: string, pullPaymentId: string): string {
  return `${requestOrigin}/api/v1/pull-payments/${pullPaymentId}/boltcards?onExisting=UpdateVersion`;
}

async function getCardProgrammingEndpoint(env: Env, uidHex: string, requestOrigin: string): Promise<{ cardConfig: any; pullPaymentId: string; programmingEndpoint: string }> {
  const cardConfig: any = await getCardConfig(env, uidHex);
  const pullPaymentId: string = resolvePullPaymentId(env, cardConfig);
  return { cardConfig, pullPaymentId, programmingEndpoint: buildProgrammingEndpoint(requestOrigin, pullPaymentId) };
}

function normalizeSubmittedUid(rawUid: string): string | null {
  return validateUid(typeof rawUid === "string" ? rawUid.replace(/:/g, "") : "");
}

export async function handleTerminateAction(rawUid: string, env: Env, request: Request): Promise<Response> {
  const requestOrigin = getRequestOrigin(request);
  const uidHex: string | null = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse(UID_VALIDATION_MSG, 400);
  }

  try {
    const cardState: CardStateRow = await getCardState(env, uidHex);
    if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.WIPE_REQUESTED) {
      return errorResponse(`Card is in '${cardState.state}' state, cannot terminate. Only active or wipe_requested cards can be terminated.`, 400);
    }

    await terminateCard(env, uidHex);

    const newState: any = await getCardState(env, uidHex);
    const { programmingEndpoint }: { programmingEndpoint: string } = await getCardProgrammingEndpoint(env, uidHex, requestOrigin);

    logger.info("Card terminated via wipe confirmation", { uidHex, previousVersion: cardState.active_version, newVersion: newState.latest_issued_version });

    return jsonResponse({
      success: true,
      uidHex,
      cardState: newState.state,
      keyVersion: resolveLatestVersion(newState) || resolveActiveVersion(cardState),
      programmingEndpoint,
    });
  } catch (err: unknown) {
    logger.error("Terminate action failed", { uidHex, error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}

export async function handleRequestWipeAction(rawUid: string, env: Env, request: Request): Promise<Response> {
  const requestOrigin = getRequestOrigin(request);
  const uidHex: string | null = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse(UID_VALIDATION_MSG, 400);
  }

  try {
    const cardState: CardStateRow = await getCardState(env, uidHex);
    if (cardState.state !== CARD_STATE.ACTIVE) {
      return errorResponse(`Card is in '${cardState.state}' state. Only active cards can request wipe keys.`, 400);
    }

    const version: number = resolveActiveVersion(cardState);
    const keys: any = deriveKeysFromHex(uidHex, env.ISSUER_KEY!, version);

    await requestWipe(env, uidHex);

    const endpointUrl: string = `${requestOrigin}/api/keys?uid=${uidHex}&format=boltcard`;
    const { programmingEndpoint }: { programmingEndpoint: string } = await getCardProgrammingEndpoint(env, uidHex, requestOrigin);

    logger.info("Wipe keys fetched", { uidHex, version });

    return jsonResponse({
      success: true,
      uidHex,
      cardState: CARD_STATE.WIPE_REQUESTED,
      keyVersion: version,
      k0: keys.k0,
      k1: keys.k1,
      k2: keys.k2,
      k3: keys.k3,
      k4: keys.k4,
      programmingEndpoint,
      wipeDeeplink: `boltcard://reset?url=${encodeURIComponent(endpointUrl)}`,
      wipeJson: JSON.stringify({
        version: version,
        action: "wipe",
        k0: keys.k0.toLowerCase(),
        k1: keys.k1.toLowerCase(),
        k2: keys.k2.toLowerCase(),
        k3: keys.k3.toLowerCase(),
        k4: keys.k4.toLowerCase(),
      }, null, 2),
    });
  } catch (err: unknown) {
    logger.error("Wipe action failed", { uidHex, error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}

export async function handleTopUpAction(rawUid: string, rawAmount: any, env: Env): Promise<Response> {
  const uidHex: string | null = normalizeSubmittedUid(rawUid);
  if (!uidHex) return errorResponse(UID_VALIDATION_MSG, 400);

  const amount: number = parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  try {
    const result: OpResult = await creditCard(env, uidHex, amount, "Manual top-up via login page");
    if (result.ok) {
      return jsonResponse({ success: true, balance: result.balance, message: `Credited ${amount} units` });
    }
    return errorResponse(result.reason || "Top-up failed", 500);
  } catch (e: unknown) {
    logger.error("Top-up failed", { uidHex, amount, error: getErrorMessage(e) });
    return errorResponse("Top-up failed", 500);
  }
}

export { resolvePullPaymentId, buildProgrammingEndpoint, normalizeSubmittedUid, getCardProgrammingEndpoint };
