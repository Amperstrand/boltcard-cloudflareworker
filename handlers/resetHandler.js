import { getDeterministicKeys } from "../keygenerator.js";
import { getCardState, terminateCard } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse, errorResponse } from "../utils/responses.js";
import { validateUid } from "../utils/validation.js";
import { DEFAULT_FALLBACK_HOST, CARD_STATE } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

export async function handleReset(uid, env, baseUrl) {
  const normalizedUid = validateUid(uid);
  try {
    if (!env?.CARD_REPLAY) {
      throw new Error("Replay protection Durable Object binding is not configured");
    }

    if (!uid) {
      return errorResponse("Missing UID parameter for reset.", 400);
    }

    if (!normalizedUid) {
      return errorResponse("Invalid UID: must be exactly 14 hex characters.", 400);
    }

    const cardState = await getCardState(env, normalizedUid);

    if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.TERMINATED && cardState.state !== CARD_STATE.NEW) {
      return errorResponse("Card must be active to retrieve wipe keys.", 400);
    }

    const wipeVersion = cardState.active_version || 1;

    if (cardState.state === CARD_STATE.ACTIVE) {
      await terminateCard(env, normalizedUid);
    }

    const keys = getDeterministicKeys(normalizedUid, env, wipeVersion);
    const host = baseUrl || DEFAULT_FALLBACK_HOST;
    return jsonResponse(buildBoltCardResponse(keys, normalizedUid, host, wipeVersion), 200);
  } catch (err) {
    logger.error("Reset handler error", { uid: normalizedUid, error: err.message });
    return errorResponse("Internal error", 500);
  }
}
