import { listTaps, listTransactions } from "../replayProtection.js";
import type { TapEntry, Transaction, Env } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import { logger } from "./logger.js";
import { HISTORY_LIMIT } from "./constants.js";

export interface HistoryEntry {
  counter: number | null;
  bolt11: string | null;
  status: string;
  payment_hash: string | null;
  amount_msat: number | null;
  user_agent: string | null;
  request_url: string | null;
  created_at: number;
  updated_at: number;
  note?: string | null;
  balance_after?: number;
}

export function _mergeHistory(taps: TapEntry[], transactions: Transaction[]): HistoryEntry[] {
  const txEntries: HistoryEntry[] = (transactions || []).map((tx) => ({
    counter: tx.counter ?? null,
    bolt11: null,
    status: tx.amount > 0 ? "topup" : "payment",
    payment_hash: null,
    amount_msat: Math.abs(tx.amount),
    user_agent: null,
    request_url: null,
    created_at: tx.created_at,
    updated_at: tx.created_at,
    note: tx.note || null,
    balance_after: tx.balance_after,
  }));

  const sanitizedTaps: HistoryEntry[] = (taps || []).map((tap) => ({
    counter: tap.counter ?? null,
    bolt11: tap.bolt11 ? tap.bolt11.slice(0, 8) + "..." : null,
    status: tap.status,
    payment_hash: null,
    amount_msat: tap.amount_msat,
    user_agent: null,
    request_url: null,
    created_at: tap.created_at,
    updated_at: tap.updated_at,
  }));

  const merged: HistoryEntry[] = [...sanitizedTaps, ...txEntries].sort((a, b) => {
    const timeDiff = (b.created_at || 0) - (a.created_at || 0);
    if (timeDiff !== 0) return timeDiff;
    return (b.counter || 0) - (a.counter || 0);
  });

  return merged.slice(0, HISTORY_LIMIT);
}

export async function getUnifiedHistory(env: Env, uidHex: string): Promise<HistoryEntry[]> {
  let taps: TapEntry[] = [];
  let transactions: Transaction[] = [];
  try {
    const tapData = await listTaps(env, uidHex, HISTORY_LIMIT);
    taps = tapData.taps || [];
  } catch (e: unknown) {
    logger.warn("Could not load tap history", { uidHex, error: getErrorMessage(e) });
  }
  try {
    const txData = await listTransactions(env, uidHex, HISTORY_LIMIT);
    transactions = txData.transactions || [];
  } catch (e: unknown) {
    logger.warn("Could not load transactions", { uidHex, error: getErrorMessage(e) });
  }
  return _mergeHistory(taps, transactions);
}
