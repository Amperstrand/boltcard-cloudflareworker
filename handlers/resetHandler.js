import { getDeterministicKeys } from "../keygenerator.js";
import { getCardState, terminateCard } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse, errorResponse } from "../utils/responses.js";
import { DEFAULT_FALLBACK_HOST } from "../utils/constants.js";

export async function handleReset(uid, env, baseUrl) {
  try {
    if (!env?.CARD_REPLAY) {
      throw new Error("Replay protection Durable Object binding is not configured");
    }

    if (!uid) {
      return errorResponse("Missing UID parameter for reset.", 400);
    }

    const normalizedUid = uid.toLowerCase();
    const cardState = await getCardState(env, normalizedUid);

    if (cardState.state !== "active" && cardState.state !== "terminated" && cardState.state !== "new") {
      return errorResponse("Card must be active to retrieve wipe keys.", 400);
    }

    const wipeVersion = cardState.active_version || 1;

    if (cardState.state === "active") {
      await terminateCard(env, normalizedUid);
    }

    const keys = getDeterministicKeys(normalizedUid, env, wipeVersion);
    const host = baseUrl || DEFAULT_FALLBACK_HOST;
    return jsonResponse(buildBoltCardResponse(keys, normalizedUid, host, wipeVersion), 200);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}
