import { jsonResponse, errorResponse } from "../utils/responses.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { logger } from "../utils/logger.js";

const MENU_PREFIX = "pos_menu:";

function menuKey(terminalId: string): string {
  return `${MENU_PREFIX}${terminalId}`;
}

interface MenuItem {
  name: string;
  price: number | string;
  [key: string]: unknown;
}

interface MenuData {
  items: MenuItem[];
}

export async function getMenu(env: Env, terminalId: string): Promise<MenuData> {
  if (!env.UID_CONFIG) return { items: [] };
  try {
    const raw = await env.UID_CONFIG.get(menuKey(terminalId));
    if (!raw) return { items: [] };
    return JSON.parse(raw);
  } catch (e: unknown) {
    logger.warn("Failed to load POS menu", { terminalId, error: getErrorMessage(e) });
    return { items: [] };
  }
}

export async function saveMenu(env: Env, terminalId: string, menu: Record<string, unknown>): Promise<Response> {
  if (!env.UID_CONFIG) return errorResponse("KV not available", 500);
  if (!menu.items || !Array.isArray(menu.items)) {
    return errorResponse("menu.items must be an array", 400);
  }
  for (const item of menu.items as MenuItem[]) {
    if (!item.name || typeof item.name !== "string") {
      return errorResponse("Each item must have a name", 400);
    }
    const price = parseInt(String(item.price), 10);
    if (!Number.isInteger(price) || price < 0) {
      return errorResponse(`Invalid price for item "${item.name}"`, 400);
    }
  }
  try {
    await env.UID_CONFIG.put(menuKey(terminalId), JSON.stringify(menu));
    return jsonResponse({ success: true, terminalId, itemCount: menu.items.length });
  } catch (e: unknown) {
    logger.error("Failed to save POS menu", { terminalId, error: getErrorMessage(e) });
    return errorResponse("Failed to save menu", 500);
  }
}
