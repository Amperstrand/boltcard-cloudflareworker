import { getMenu, saveMenu, type MenuData } from "./menuHandler.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { renderMenuEditorPage } from "../templates/menuEditorPage.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { parseValidatedBody, menuUpdateSchema, type MenuUpdateBody } from "../utils/schemas.js";
import { getRequestOrigin } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export async function handleMenuEditorPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const terminalId: string = url.searchParams.get("t") || "default";
  const host = getRequestOrigin(request);
  try {
    const menu: MenuData = await getMenu(env, terminalId);
    return htmlResponse(renderMenuEditorPage({ host, terminalId, menu }));
  } catch (error: unknown) {
    logger.error("Failed to load menu for editor", { terminalId, error: getErrorMessage(error) });
    return errorResponse("Failed to load menu", 500);
  }
}

export async function handleMenuGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const terminalId: string = url.searchParams.get("t") || "default";
  try {
    const menu: MenuData = await getMenu(env, terminalId);
    return jsonResponse(menu);
  } catch (error: unknown) {
    logger.error("Failed to get menu", { terminalId, error: getErrorMessage(error) });
    return errorResponse("Failed to retrieve menu", 500);
  }
}

export async function handleMenuPut(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT") return errorResponse("Method not allowed", 405);
  const result = await parseValidatedBody<MenuUpdateBody>(request, menuUpdateSchema);
  if (!result.ok) return errorResponse(result.error, 400);
  const url = new URL(request.url);
  const terminalId: string = url.searchParams.get("t") || "default";
  return saveMenu(env, terminalId, result.data);
}
