import { htmlResponse, jsonResponse } from "../utils/responses.js";
import { listIndexedCards, repairCardIndex } from "../utils/cardIndex.js";
import { renderCardAuditPage } from "../templates/cardAuditPage.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { getCardState } from "../replayProtection.js";
import { logger } from "../utils/logger.js";
import { CARD_AUDIT_DEFAULT_LIMIT, CARD_AUDIT_MAX_LIMIT } from "../utils/constants.js";

export async function handleCardAuditPage(request, env) {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;
  return htmlResponse(renderCardAuditPage());
}

export async function handleCardAuditData(request, env) {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const state = url.searchParams.get("state") || undefined;
  const rawLimit = parseInt(url.searchParams.get("limit") || String(CARD_AUDIT_DEFAULT_LIMIT), 10);
  const limit = Math.max(1, Math.min(rawLimit, CARD_AUDIT_MAX_LIMIT));
  const cursor = url.searchParams.get("cursor") || undefined;

  try {
    const result = await listIndexedCards(env, { state, limit, cursor });
    return jsonResponse(result);
  } catch (err) {
    logger.error("Card audit data fetch failed", { error: err.message });
    return jsonResponse({ error: "Failed to fetch card data", cards: [], total: 0 }, 500);
  }
}

export async function handleIndexRepair(request, env) {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  try {
    const result = await repairCardIndex(env, getCardState);
    logger.info("Card index repair completed", result);
    return jsonResponse(result);
  } catch (err) {
    logger.error("Card index repair failed", { error: err.message });
    return jsonResponse({ error: "Index repair failed", scanned: 0, repaired: 0, errors: [] }, 500);
  }
}
