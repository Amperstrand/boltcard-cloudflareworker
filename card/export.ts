import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import type { CardExportData, ImportResult } from "../durableObjects/cardReplay/routes.js";
import { getCardStub, doPost, doSafeGet, requireDo } from "./doFacade.js";

const EMPTY_EXPORT: CardExportData = Object.freeze({
  version: 1,
  exported_at: 0,
  replay_state: null,
  card_state: null,
  card_config: null,
  taps: [],
  transactions: [],
});

export async function exportCardState(env: Env, uidHex: string): Promise<CardExportData> {
  return doSafeGet(env, uidHex, "/export-state", { ...EMPTY_EXPORT });
}

export async function importCardState(env: Env, uidHex: string, data: CardExportData): Promise<ImportResult> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/import-state", data);
  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO import error", { uidHex, error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.error || "Card state import failed"));
  }
  return response.json() as Promise<ImportResult>;
}
