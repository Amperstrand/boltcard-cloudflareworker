import { getMenu, saveMenu } from "./menuHandler.js";
import { renderMenuEditorPage } from "../templates/menuEditorPage.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getRequestOrigin } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export async function handleMenuEditorPage(request, env) {
  const url = new URL(request.url);
  const terminalId = url.searchParams.get("t") || "default";
  const host = getRequestOrigin(request);
  try {
    const menu = await getMenu(env, terminalId);
    return htmlResponse(renderMenuEditorPage({ host, terminalId, menu }));
  } catch (error) {
    logger.error("Failed to load menu for editor", { terminalId, error: error.message });
    return errorResponse("Failed to load menu", 500);
  }
}

export async function handleMenuGet(request, env) {
  const url = new URL(request.url);
  const terminalId = url.searchParams.get("t") || "default";
  try {
    const menu = await getMenu(env, terminalId);
    return jsonResponse(menu);
  } catch (error) {
    logger.error("Failed to get menu", { terminalId, error: error.message });
    return errorResponse("Failed to retrieve menu", 500);
  }
}

export async function handleMenuPut(request, env) {
  const body = await parseJsonBody(request).catch(() => null);
  if (!body) return errorResponse("Invalid JSON", 400);
  const url = new URL(request.url);
  const terminalId = url.searchParams.get("t") || "default";
  return saveMenu(env, terminalId, body);
}
