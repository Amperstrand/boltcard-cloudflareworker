import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env, OpResult, VoidResult, BalanceResult, ListTransactionsResult } from "../types/core.js";
import { DEFAULT_TXN_LIMIT } from "../utils/constants.js";
import { doOptionalPost, doOptionalGet } from "./doFacade.js";

export async function debitCard(env: Env, uidHex: string, counter: number, amount: number, note: string): Promise<OpResult> {
  return doOptionalPost(env, uidHex, "/debit", { counter, amount, note }, { ok: false, reason: "DO not available" });
}

export async function creditCard(env: Env, uidHex: string, amount: number, note: string): Promise<OpResult> {
  return doOptionalPost(env, uidHex, "/credit", { amount, note }, { ok: false, reason: "DO not available" });
}

export async function voidTransaction(env: Env, uidHex: string, transactionId: number): Promise<VoidResult> {
  return doOptionalPost(env, uidHex, "/void", { transactionId }, { ok: false, reason: "DO not available" });
}

export async function getBalance(env: Env, uidHex: string): Promise<BalanceResult> {
  return doOptionalGet(env, uidHex, "/balance", { balance: 0 });
}

export async function safeGetBalance(env: Env, uidHex: string): Promise<BalanceResult> {
  try {
    const result = await getBalance(env, uidHex);
    return { balance: result.balance ?? 0 };
  } catch (e: unknown) {
    logger.warn("Could not fetch balance", { uidHex, error: getErrorMessage(e) });
    return { balance: 0 };
  }
}

export async function listTransactions(env: Env, uidHex: string, limit: number = DEFAULT_TXN_LIMIT): Promise<ListTransactionsResult> {
  return doOptionalGet(env, uidHex, `/transactions?limit=${limit}`, { transactions: [] });
}
