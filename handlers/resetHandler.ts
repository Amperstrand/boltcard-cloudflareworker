import { getDeterministicKeys } from "../keygenerator.js";
import { getCardState, terminateCard, resolveActiveVersion } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse, errorResponse } from "../utils/responses.js";
import { validateUid } from "../utils/validation.js";
import { DEFAULT_FALLBACK_HOST, CARD_STATE, UID_VALIDATION_MSG, isCardUsable, isCardTerminated, isCardNew } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

export async function handleReset(uid: string, env: any, baseUrl?: string): Promise<Response> {
  const normalizedUid: string | null = validateUid(uid);
  try {
    if (!env?.CARD_REPLAY) {
      throw new Error("Replay protection Durable Object binding is not configured");
    }

    if (!uid) {
      return errorResponse("Missing UID parameter for reset.", 400);
    }

    if (!normalizedUid) {
      return errorResponse(UID_VALIDATION_MSG, 400);
    }

    const cardState: any = await getCardState(env, normalizedUid);

    if (!isCardUsable(cardState.state) && !isCardTerminated(cardState.state) && !isCardNew(cardState.state)) {
      return errorResponse("Card must be active, terminated, or new to retrieve wipe keys.", 409);
    }

    const wipeVersion: number = resolveActiveVersion(cardState);

    if (cardState.state === CARD_STATE.ACTIVE) {
      await terminateCard(env, normalizedUid);
    }

    const keys: any = getDeterministicKeys(normalizedUid, env, wipeVersion);
    const host: string = baseUrl || DEFAULT_FALLBACK_HOST;
    return jsonResponse(buildBoltCardResponse(keys, normalizedUid, host, wipeVersion), 200);
  } catch (err: any) {
    logger.error("Reset handler error", { uid: normalizedUid, error: err.message });
    return errorResponse("Internal error", 500);
  }
}
