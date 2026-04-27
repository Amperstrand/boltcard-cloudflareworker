import { htmlResponse, jsonResponse } from "../utils/responses.js";
import { listIndexedCards, repairCardIndex } from "../utils/cardIndex.js";
import { renderCardAuditPage } from "../templates/cardAuditPage.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { getCardState } from "../replayProtection.js";
import { logger } from "../utils/logger.js";

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
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const cursor = url.searchParams.get("cursor") || undefined;

  const result = await listIndexedCards(env, { state, limit, cursor });
  return jsonResponse(result);
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
