import { htmlResponse, jsonResponse } from "../utils/responses.js";
import { listIndexedCards } from "../utils/cardIndex.js";
import { renderCardAuditPage } from "../templates/cardAuditPage.js";
import { requireOperator } from "../middleware/operatorAuth.js";

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
