import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { logger } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getCardState, getCardConfig, terminateCard, requestWipe, creditCard } from "../replayProtection.js";
import { validateUid, getRequestOrigin } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID, CARD_STATE } from "../utils/constants.js";

function resolvePullPaymentId(env, cardConfig) {
  return cardConfig?.pull_payment_id || env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;
}

function buildProgrammingEndpoint(requestOrigin, pullPaymentId) {
  return `${requestOrigin}/api/v1/pull-payments/${pullPaymentId}/boltcards?onExisting=UpdateVersion`;
}

function normalizeSubmittedUid(rawUid) {
  return validateUid(typeof rawUid === "string" ? rawUid.replace(/:/g, "") : "");
}

export async function handleTerminateAction(rawUid, env, request) {
  const requestOrigin = getRequestOrigin(request);
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse("Invalid UID format", 400);
  }

  const cardState = await getCardState(env, uidHex);
  if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.WIPE_REQUESTED) {
    return errorResponse(`Card is in '${cardState.state}' state, cannot terminate. Only active or wipe_requested cards can be terminated.`, 400);
  }

  await terminateCard(env, uidHex);

  const newState = await getCardState(env, uidHex);
  const cardConfig = await getCardConfig(env, uidHex);
  const pullPaymentId = resolvePullPaymentId(env, cardConfig);
  const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

  logger.info("Card terminated via wipe confirmation", { uidHex, previousVersion: cardState.active_version, newVersion: newState.latest_issued_version });

  return jsonResponse({
    success: true,
    uidHex,
    cardState: newState.state,
    keyVersion: newState.latest_issued_version || (cardState.active_version || 1),
    programmingEndpoint,
  });
}

export async function handleRequestWipeAction(rawUid, env, request) {
  const requestOrigin = getRequestOrigin(request);
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse("Invalid UID format", 400);
  }

  const cardState = await getCardState(env, uidHex);
  if (cardState.state !== CARD_STATE.ACTIVE) {
    return errorResponse(`Card is in '${cardState.state}' state. Only active cards can request wipe keys.`, 400);
  }

  const version = cardState.active_version || 1;
  const keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY, version);

  await requestWipe(env, uidHex);

  const endpointUrl = `${requestOrigin}/api/keys?uid=${uidHex}&format=boltcard`;
  const cardConfig = await getCardConfig(env, uidHex);
  const pullPaymentId = resolvePullPaymentId(env, cardConfig);
  const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

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
}

export async function handleTopUpAction(rawUid, rawAmount, env, request) {
  void request;
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) return errorResponse("Invalid UID format", 400);

  const amount = parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  try {
    const result = await creditCard(env, uidHex, amount, "Manual top-up via login page");
    if (result.ok) {
      return jsonResponse({ success: true, balance: result.balance, message: `Credited ${amount} units` });
    }
    return errorResponse(result.reason || "Top-up failed", 500);
  } catch (e) {
    logger.error("Top-up failed", { uidHex, amount, error: e.message });
    return errorResponse("Top-up failed", 500);
  }
}

export { resolvePullPaymentId, buildProgrammingEndpoint, normalizeSubmittedUid };
