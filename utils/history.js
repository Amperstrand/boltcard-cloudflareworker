import { listTaps, listTransactions } from "../replayProtection.js";
import { logger } from "./logger.js";

export function mergeHistory(taps, transactions) {
  const txEntries = (transactions || []).map((tx) => ({
    counter: tx.counter,
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

  const merged = [...(taps || []), ...txEntries].sort((a, b) => {
    const timeDiff = (b.created_at || 0) - (a.created_at || 0);
    if (timeDiff !== 0) return timeDiff;
    return (b.counter || 0) - (a.counter || 0);
  });

  return merged.slice(0, 25);
}

export async function getUnifiedHistory(env, uidHex) {
  let taps = [];
  let transactions = [];
  try {
    const tapData = await listTaps(env, uidHex, 25);
    taps = tapData.taps || [];
  } catch (e) {
    logger.warn("Could not load tap history", { uidHex, error: e.message });
  }
  try {
    const txData = await listTransactions(env, uidHex, 25);
    transactions = txData.transactions || [];
  } catch (e) {
    logger.warn("Could not load transactions", { uidHex, error: e.message });
  }
  return mergeHistory(taps, transactions);
}
