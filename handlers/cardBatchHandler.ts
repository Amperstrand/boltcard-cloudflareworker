import { jsonResponse, errorResponse } from "../utils/responses.js";
import type { CardStateRow } from "../types/core.js";
import type { SessionPayload } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { terminateCard, requestWipe, getCardState, deliverKeys, resolveActiveVersion } from "../replayProtection.js";
import { validateUid } from "../utils/validation.js";
import { CARD_STATE, BATCH_MAX_CARDS, UID_VALIDATION_MSG } from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { recordAuditEvent } from "../utils/auditLog.js";
import { parseValidatedBody, batchActionSchema, type BatchActionBody } from "../utils/schemas.js";

const VALID_ACTIONS: string[] = ["terminate", "wipe", "activate", "reprovision"];

interface BatchResult {
  uid: string;
  status: string;
  reason?: string;
  version?: number;
}

export async function handleCardBatchAction(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const result = await parseValidatedBody<BatchActionBody>(request, batchActionSchema);
  if (!result.ok) {
    return errorResponse(result.error, 400);
  }

  const { uids, action } = result.data;

  if (uids.length === 0) {
    return errorResponse("uids must be a non-empty array", 400);
  }

  if (uids.length > BATCH_MAX_CARDS) {
    return errorResponse(`Batch size limited to ${BATCH_MAX_CARDS} cards`, 400);
  }

  if (!VALID_ACTIONS.includes(action)) {
    return errorResponse(`action must be one of: ${VALID_ACTIONS.join(", ")}`, 400);
  }

  const normalizedUids: string[] = [];
  for (const uid of uids) {
    const normalized: string | null = validateUid(uid);
    if (!normalized) {
      return errorResponse(UID_VALIDATION_MSG, 400);
    }
    normalizedUids.push(normalized);
  }

  const results: BatchResult[] = [];
  const errors: Array<{ uid: string; error: string }> = [];

  for (const uid of normalizedUids) {
    try {
      const cardState: CardStateRow = await getCardState(env, uid);

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
          await activateCard(env, uid, resolveActiveVersion(cardState));
          results.push({ uid, status: "activated" });
        } else {
          results.push({ uid, status: "skipped", reason: `cannot activate card in ${cardState.state} state` });
          continue;
        }
      } else if (action === "reprovision") {
        if (cardState.state !== CARD_STATE.TERMINATED) {
          results.push({ uid, status: "skipped", reason: `card must be terminated to re-provision (state: ${cardState.state})` });
          continue;
        }
        const delivered: CardStateRow & { version: number } = await deliverKeys(env, uid);
        const newVersion: number = delivered.latest_issued_version || delivered.version || (cardState.latest_issued_version || 0) + 1;
        results.push({ uid, status: "reprovisioned", version: newVersion });
      }
    } catch (err: unknown) {
      logger.error("Batch action failed for card", { uid, action, error: getErrorMessage(err) });
      errors.push({ uid, error: getErrorMessage(err) });
    }
  }

  const succeeded: BatchResult[] = results.filter(r => r.status !== "skipped");
  if (succeeded.length > 0) {
    await recordAuditEvent(env, {
      action: `batch_${action}`,
      operatorShiftId: session?.shiftId,
      details: { count: succeeded.length, uids: succeeded.map(r => r.uid) },
    });
  }

  return jsonResponse({
    action,
    processed: results.length + errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}
