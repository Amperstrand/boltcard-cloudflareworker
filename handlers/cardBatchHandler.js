import { jsonResponse, errorResponse } from "../utils/responses.js";
import { terminateCard, requestWipe, getCardState } from "../replayProtection.js";
import { validateUid } from "../utils/validation.js";
import { CARD_STATE } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

const VALID_ACTIONS = ["terminate", "wipe", "activate"];

export async function handleCardBatchAction(request, env) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { uids, action } = body;

  if (!Array.isArray(uids) || uids.length === 0) {
    return errorResponse("uids must be a non-empty array", 400);
  }

  if (uids.length > 100) {
    return errorResponse("Batch size limited to 100 cards", 400);
  }

  if (!VALID_ACTIONS.includes(action)) {
    return errorResponse(`action must be one of: ${VALID_ACTIONS.join(", ")}`, 400);
  }

  const normalizedUids = [];
  for (const uid of uids) {
    const normalized = validateUid(uid);
    if (!normalized) {
      return errorResponse(`Invalid UID: ${uid}`, 400);
    }
    normalizedUids.push(normalized);
  }

  const results = [];
  const errors = [];

  for (const uid of normalizedUids) {
    try {
      const cardState = await getCardState(env, uid);

      if (action === "terminate") {
        if (cardState.state === CARD_STATE.TERMINATED) {
          results.push({ uid, status: "skipped", reason: "already terminated" });
          continue;
        }
        await terminateCard(env, uid);
        results.push({ uid, status: "terminated" });
      } else if (action === "wipe") {
        if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.KEYS_DELIVERED) {
          results.push({ uid, status: "skipped", reason: `cannot wipe card in ${cardState.state} state` });
          continue;
        }
        await requestWipe(env, uid);
        results.push({ uid, status: "wipe_requested" });
      } else if (action === "activate") {
        if (cardState.state === CARD_STATE.ACTIVE) {
          results.push({ uid, status: "skipped", reason: "already active" });
          continue;
        }
        if (cardState.state === CARD_STATE.KEYS_DELIVERED || cardState.state === CARD_STATE.DISCOVERED) {
          const { activateCard } = await import("../replayProtection.js");
          await activateCard(env, uid, cardState.latest_issued_version || 1);
          results.push({ uid, status: "activated" });
        } else {
          results.push({ uid, status: "skipped", reason: `cannot activate card in ${cardState.state} state` });
          continue;
        }
      }
    } catch (err) {
      logger.error("Batch action failed for card", { uid, action, error: err.message });
      errors.push({ uid, error: err.message });
    }
  }

  return jsonResponse({
    action,
    processed: results.length + errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}
