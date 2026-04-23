import { jsonResponse, errorResponse } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

const MENU_PREFIX = "pos_menu:";

function menuKey(terminalId) {
  return `${MENU_PREFIX}${terminalId}`;
}

export async function getMenu(env, terminalId) {
  if (!env.UID_CONFIG) return { items: [] };
  try {
    const raw = await env.UID_CONFIG.get(menuKey(terminalId));
    if (!raw) return { items: [] };
    return JSON.parse(raw);
  } catch (e) {
    logger.warn("Failed to load POS menu", { terminalId, error: e.message });
    return { items: [] };
  }
}

export async function saveMenu(env, terminalId, menu) {
  if (!env.UID_CONFIG) return errorResponse("KV not available", 500);
  if (!menu.items || !Array.isArray(menu.items)) {
    return errorResponse("menu.items must be an array", 400);
  }
  for (const item of menu.items) {
    if (!item.name || typeof item.name !== "string") {
      return errorResponse("Each item must have a name", 400);
    }
    const price = parseInt(item.price, 10);
    if (!Number.isInteger(price) || price < 0) {
      return errorResponse(`Invalid price for item "${item.name}"`, 400);
    }
  }
  try {
    await env.UID_CONFIG.put(menuKey(terminalId), JSON.stringify(menu));
    return jsonResponse({ success: true, terminalId, itemCount: menu.items.length });
  } catch (e) {
    logger.error("Failed to save POS menu", { terminalId, error: e.message });
    return errorResponse("Failed to save menu", 500);
  }
}

export async function deleteMenu(env, terminalId) {
  if (!env.UID_CONFIG) return errorResponse("KV not available", 500);
  try {
    await env.UID_CONFIG.delete(menuKey(terminalId));
    return jsonResponse({ success: true, terminalId });
  } catch (e) {
    logger.error("Failed to delete POS menu", { terminalId, error: e.message });
    return errorResponse("Failed to delete menu", 500);
  }
}
