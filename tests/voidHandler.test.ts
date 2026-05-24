import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleVoidApply, handleVoidTransactions } from "../handlers/voidHandler.js";
import type { Env, SessionPayload, VoidResult, ListTransactionsResult } from "../types/core.js";
import { createMockKV } from "./testHelpers.js";

const BASE_URL = "https://boltcardpoc.psbt.me";
const VOID_APPLY_URL = `${BASE_URL}/operator/void/apply`;
const VOID_TXN_URL = `${BASE_URL}/operator/void/transactions`;

const session: SessionPayload = {
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 43200,
  shiftId: "test-shift-void",
};

function makeEnv(): Env {
  return {
    UID_CONFIG: createMockKV(),
    CARD_REPLAY: {} as DurableObjectNamespace,
    __TEST_OPERATOR_SESSION: session,
    WORKER_ENV: "test",
  } satisfies Env;
}

// Mock modules
vi.mock("../replayProtection.js", () => ({
  voidTransaction: vi.fn(),
  listTransactions: vi.fn(),
}));

vi.mock("../utils/validateCardTap.js", () => ({
  validateCardTap: vi.fn(),
}));

vi.mock("../utils/auditLog.js", () => ({
  recordAuditEvent: vi.fn(),
}));

import { voidTransaction, listTransactions } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { recordAuditEvent } from "../utils/auditLog.js";

const mockVoidTransaction = vi.mocked(voidTransaction);
const mockListTransactions = vi.mocked(listTransactions);
const mockValidateCardTap = vi.mocked(validateCardTap);
const mockRecordAuditEvent = vi.mocked(recordAuditEvent);

function makeApplyRequest(body: Record<string, unknown>): Request {
  return new Request(VOID_APPLY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── handleVoidApply ─────────────────────────────────────────────

describe("handleVoidApply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successful void returns success with voided txn ID and balance", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    const voidResult: VoidResult = {
      ok: true,
      balance: 6000,
      newTransaction: { id: 99, amount: 1000, balance_after: 6000, created_at: Date.now() },
    };
    mockVoidTransaction.mockResolvedValue(voidResult);

    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16), transactionId: "42" });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.voidedTxnId).toBe(42);
    expect(json.balance).toBe(6000);
    expect(json.amount).toBe(1000);
  });

  it("returns 400 for missing transaction ID", async () => {
    const env = makeEnv();
    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16) });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("returns 400 for non-numeric transaction ID", async () => {
    const env = makeEnv();
    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16), transactionId: "abc" });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("returns error when card tap validation fails", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Card authentication failed",
    });

    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16), transactionId: "42" });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("returns error when voidTransaction returns not ok", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    mockVoidTransaction.mockResolvedValue({
      ok: false,
      reason: "Transaction not found",
    });

    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16), transactionId: "99" });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
  });

  it("records audit event on success", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    mockVoidTransaction.mockResolvedValue({
      ok: true,
      balance: 6000,
      newTransaction: { id: 100, amount: 1000, balance_after: 6000, created_at: Date.now() },
    });

    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16), transactionId: "42" });
    await handleVoidApply(req, env, session);
    expect(mockRecordAuditEvent).toHaveBeenCalledOnce();
    const callArgs = mockRecordAuditEvent.mock.calls[0]!;
    expect(callArgs[1].action).toBe("void");
    expect(callArgs[1].uidHex).toBe("04a39493cc8680");
  });

  it("returns 405 for non-POST method", async () => {
    const env = makeEnv();
    const req = new Request(VOID_APPLY_URL, { method: "GET" });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(405);
  });

  it("returns 500 on unexpected error from voidTransaction", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    mockVoidTransaction.mockRejectedValue(new Error("DO unavailable"));

    const req = makeApplyRequest({ p: "a".repeat(32), c: "b".repeat(16), transactionId: "42" });
    const resp = await handleVoidApply(req, env, session);
    expect(resp.status).toBe(500);
  });
});

// ─── handleVoidTransactions ─────────────────────────────────────

describe("handleVoidTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns charge transactions (negative amounts, not voided)", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    const txData: ListTransactionsResult = {
      transactions: [
        { id: 1, counter: 1, amount: -500, balance_after: 4500, created_at: 1000, note: "charge" },
        { id: 2, counter: 2, amount: 1000, balance_after: 5500, created_at: 2000, note: "topup" },
        { id: 3, counter: 3, amount: -300, balance_after: 5200, created_at: 3000, note: "charge", voided_at: 3001 },
      ],
    };
    mockListTransactions.mockResolvedValue(txData);

    const req = new Request(`${VOID_TXN_URL}?p=${"a".repeat(32)}&c=${"b".repeat(16)}`);
    const resp = await handleVoidTransactions(req, env);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { transactions: Array<{ id: number; amount: number }> };
    expect(json.transactions).toHaveLength(1);
    expect(json.transactions[0]!.id).toBe(1);
    expect(json.transactions[0]!.amount).toBe(-500);
  });

  it("returns error when card tap validation fails", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Card authentication failed",
    });

    const req = new Request(`${VOID_TXN_URL}?p=${"a".repeat(32)}&c=${"b".repeat(16)}`);
    const resp = await handleVoidTransactions(req, env);
    expect(resp.status).toBe(403);
  });

  it("filters out non-charge transactions (positive amounts)", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    const txData: ListTransactionsResult = {
      transactions: [
        { id: 1, counter: 1, amount: 1000, balance_after: 1000, created_at: 1000, note: "topup" },
        { id: 2, counter: 2, amount: 500, balance_after: 500, created_at: 2000, note: "refund" },
        { id: 3, counter: 3, amount: -200, balance_after: 800, created_at: 3000, note: "charge" },
      ],
    };
    mockListTransactions.mockResolvedValue(txData);

    const req = new Request(`${VOID_TXN_URL}?p=${"a".repeat(32)}&c=${"b".repeat(16)}`);
    const resp = await handleVoidTransactions(req, env);
    const json = (await resp.json()) as { transactions: Array<{ id: number; amount: number }> };
    expect(json.transactions).toHaveLength(1);
    expect(json.transactions[0]!.id).toBe(3);
  });

  it("filters out already-voided transactions", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    const txData: ListTransactionsResult = {
      transactions: [
        { id: 1, counter: 1, amount: -500, balance_after: 4500, created_at: 1000, note: "charge", voided_at: 1001 },
        { id: 2, counter: 2, amount: -300, balance_after: 4200, created_at: 2000, note: "charge" },
      ],
    };
    mockListTransactions.mockResolvedValue(txData);

    const req = new Request(`${VOID_TXN_URL}?p=${"a".repeat(32)}&c=${"b".repeat(16)}`);
    const resp = await handleVoidTransactions(req, env);
    const json = (await resp.json()) as { transactions: Array<{ id: number; voided_at?: unknown }> };
    expect(json.transactions).toHaveLength(1);
    expect(json.transactions[0]!.id).toBe(2);
  });

  it("returns 500 on unexpected error", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    mockListTransactions.mockRejectedValue(new Error("DO error"));

    const req = new Request(`${VOID_TXN_URL}?p=${"a".repeat(32)}&c=${"b".repeat(16)}`);
    const resp = await handleVoidTransactions(req, env);
    expect(resp.status).toBe(500);
  });

  it("returns uid in response", async () => {
    const env = makeEnv();
    mockValidateCardTap.mockResolvedValue({
      ok: true,
      uidHex: "04a39493cc8680",
      counterValue: 5,
      activeVersion: 1,
      config: { K2: "abc", payment_method: "fakewallet" },
      cardState: { state: "active", balance: 5000 } as never,
    });
    mockListTransactions.mockResolvedValue({ transactions: [] });

    const req = new Request(`${VOID_TXN_URL}?p=${"a".repeat(32)}&c=${"b".repeat(16)}`);
    const resp = await handleVoidTransactions(req, env);
    const json = (await resp.json()) as { uid: string };
    expect(json.uid).toBe("04a39493cc8680");
  });
});
