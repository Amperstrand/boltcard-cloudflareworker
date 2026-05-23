import type { CreditPayload, DebitPayload } from "./types.js";
import { nowSec } from "./types.js";
import { MAX_BALANCE } from "../../utils/constants.js";

export async function handleDebit(sql: SqlStorage, request: Request): Promise<Response> {
  const { counter, amount, note } = await request.json() as DebitPayload;
  if (!Number.isInteger(amount) || amount <= 0) {
    return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
  }

  const currentBalance: number = getCurrentBalance(sql);
  if (currentBalance < amount) {
    return Response.json({ ok: false, reason: "Insufficient balance", balance: currentBalance }, { status: 400 });
  }

  const newBalance = currentBalance - amount;
  const createdAt = nowSec();

  ensureCardStateRow(sql, currentBalance);
  sql.exec(
    `UPDATE card_state SET balance = ? WHERE singleton = 1 AND balance >= ?`,
    newBalance, amount
  );

  const rows = sql.exec(
    `INSERT INTO transactions (counter, amount, balance_after, created_at, note)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, amount, balance_after, created_at`,
    Number.isInteger(counter) ? counter : null,
    -amount,
    newBalance,
    createdAt,
    note || null
  ).toArray();

  return Response.json({ ok: true, balance: newBalance, transaction: rows[0] });
}

export async function handleCredit(sql: SqlStorage, request: Request): Promise<Response> {
  const { amount, note } = await request.json() as CreditPayload;
  if (!Number.isInteger(amount) || amount <= 0) {
    return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
  }

  const currentBalance: number = getCurrentBalance(sql);
  if (currentBalance + amount > MAX_BALANCE) {
    return Response.json({ ok: false, reason: "Balance would exceed maximum", balance: currentBalance }, { status: 400 });
  }
  const newBalance = currentBalance + amount;
  const createdAt = nowSec();

  ensureCardStateRow(sql, currentBalance);
  sql.exec(
    `UPDATE card_state SET balance = balance + ? WHERE singleton = 1`,
    amount
  );

  const balanceRows = sql.exec(
    `SELECT balance FROM card_state WHERE singleton = 1`
  ).toArray();
  const actualBalance = (balanceRows[0]?.balance as number) ?? newBalance;

  const txnRows = sql.exec(
    `INSERT INTO transactions (counter, amount, balance_after, created_at, note)
     VALUES (NULL, ?, ?, ?, ?)
     RETURNING id, amount, balance_after, created_at`,
    amount,
    actualBalance,
    createdAt,
    note || null
  ).toArray();

  return Response.json({ ok: true, balance: actualBalance, transaction: txnRows[0] });
}

export function handleGetBalance(sql: SqlStorage): Response {
  return Response.json({ balance: getCurrentBalance(sql) });
}

export function handleReset(sql: SqlStorage): Response {
  sql.exec("DELETE FROM taps");
  sql.exec("DELETE FROM replay_state WHERE singleton = 1");
  return Response.json({ reset: true });
}

export function handleListTransactions(sql: SqlStorage, url: URL): Response {
  const requestedLimit = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 200))
    : 50;

  const transactions = sql.exec(
    `SELECT * FROM transactions ORDER BY id DESC LIMIT ?`,
    limit
  ).toArray();

  return Response.json({ transactions });
}

function getCurrentBalance(sql: SqlStorage): number {
  const rows = sql.exec(
    `SELECT balance FROM card_state WHERE singleton = 1`
  ).toArray();
  return (rows[0]?.balance as number) ?? 0;
}

function ensureCardStateRow(sql: SqlStorage, balance: number = 0): void {
  sql.exec(
    `INSERT INTO card_state (singleton, balance)
     VALUES (1, ?)
     ON CONFLICT(singleton) DO NOTHING`,
    balance
  );
}
