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

/**
 * The DO /import-state rejected the body with a contract 4xx (ops#42
 * rowid-bind gate, ops#43 reserved-keys guard). Carries the DO's status
 * and parsed payload so the worker surface can map it through instead
 * of collapsing it into the generic restore 500 (ops#66).
 */
export class ImportContractError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error || "Card state import failed"));
    this.name = "ImportContractError";
    this.status = status;
    this.payload = payload;
  }
}

export async function importCardState(env: Env, uidHex: string, data: CardExportData): Promise<ImportResult> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/import-state", data);
  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO import error", { uidHex, error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    if (response.status >= 400 && response.status < 500) {
      throw new ImportContractError(response.status, payload);
    }
    throw new Error(String(payload.error || "Card state import failed"));
  }
  return response.json() as Promise<ImportResult>;
}
