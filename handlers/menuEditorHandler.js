import { getMenu, saveMenu } from "./menuHandler.js";
import { renderMenuEditorPage } from "../templates/menuEditorPage.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";

export async function handleMenuEditorPage(request, env) {
  const url = new URL(request.url);
  const terminalId = url.searchParams.get("t") || "default";
  const host = new URL(request.url).origin;
  const menu = await getMenu(env, terminalId);
  return htmlResponse(renderMenuEditorPage({ host, terminalId, menu }));
}

export async function handleMenuGet(request, env) {
  const url = new URL(request.url);
  const terminalId = url.searchParams.get("t") || "default";
  const menu = await getMenu(env, terminalId);
  return jsonResponse(menu);
}

export async function handleMenuPut(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }
  const url = new URL(request.url);
  const terminalId = url.searchParams.get("t") || "default";
  return saveMenu(env, terminalId, body);
}
