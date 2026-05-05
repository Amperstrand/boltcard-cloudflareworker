import { htmlResponse, jsonResponse } from "../utils/responses.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { listIndexedCards, repairCardIndex } from "../utils/cardIndex.js";
import { renderCardAuditPage } from "../templates/cardAuditPage.js";
import { requireOperator, type OperatorAuthResult } from "../middleware/operatorAuth.js";
import { getCardState } from "../replayProtection.js";
import { logger } from "../utils/logger.js";
import { CARD_AUDIT_DEFAULT_LIMIT, CARD_AUDIT_MAX_LIMIT } from "../utils/constants.js";

export async function handleCardAuditPage(request: Request, env: Env): Promise<Response> {
  const auth: OperatorAuthResult = requireOperator(request, env);
  if (!auth.authorized) return auth.response;
  return htmlResponse(renderCardAuditPage());
}

export async function handleCardAuditData(request: Request, env: Env): Promise<Response> {
  const auth: OperatorAuthResult = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const state: string | undefined = url.searchParams.get("state") || undefined;
  const rawLimit: number = parseInt(url.searchParams.get("limit") || String(CARD_AUDIT_DEFAULT_LIMIT), 10);
  const limit: number = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, CARD_AUDIT_MAX_LIMIT)) : CARD_AUDIT_DEFAULT_LIMIT;
  const cursor: string | undefined = url.searchParams.get("cursor") || undefined;

  try {
    const result = await listIndexedCards(env, { state, limit, cursor });
    return jsonResponse(result);
  } catch (err: unknown) {
    logger.error("Card audit data fetch failed", { error: getErrorMessage(err) });
    return jsonResponse({ error: "Failed to fetch card data", cards: [], total: 0 }, 500);
  }
}

export async function handleIndexRepair(request: Request, env: Env): Promise<Response> {
  const auth: OperatorAuthResult = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  try {
    const result: { scanned: number; repaired: number; errors: Array<{ uid: string; error: string }> } = await repairCardIndex(env, getCardState);
    logger.info("Card index repair completed", result);
    return jsonResponse(result);
  } catch (err: unknown) {
    logger.error("Card index repair failed", { error: getErrorMessage(err) });
    return jsonResponse({ error: "Index repair failed", scanned: 0, repaired: 0, errors: [] }, 500);
  }
}
