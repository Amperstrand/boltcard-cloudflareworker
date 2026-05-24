import { renderVoidPage } from "../templates/voidPage.js";
import type { SessionPayload, VoidResult, ListTransactionsResult, Transaction } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { voidTransaction, listTransactions } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin, parsePositiveInt } from "../utils/validation.js";
import { recordAuditEvent } from "../utils/auditLog.js";
import { parseValidatedBody, voidBodySchema, type VoidBody } from "../utils/schemas.js";

export function handleVoidPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderVoidPage({ host, currencyLabel }));
}

export async function handleVoidApply(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const result = await parseValidatedBody<VoidBody>(request, voidBodySchema);
  if (!result.ok) return errorResponse(result.error, 400);
  const { p: pHex, c: cHex, transactionId } = result.data;

  const txnId = parsePositiveInt(transactionId);
  if (!txnId) return errorResponse("Transaction ID must be a positive integer", 400);

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "Void" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId: string = session?.shiftId || "unknown";

  try {
    const voidResult: VoidResult = await voidTransaction(env, tap.uidHex, txnId);
    if (!voidResult.ok) {
      return errorResponse(voidResult.reason || "Void failed", 400);
    }

    logger.info("Void successful", { uidHex: tap.uidHex, transactionId: txnId, voidAmount: voidResult.newTransaction?.amount, shiftId });
    await recordAuditEvent(env, { action: "void", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { voidedTxnId: txnId, amount: voidResult.newTransaction?.amount, balance: voidResult.balance } });

    return jsonResponse({
      success: true,
      voidedTxnId: txnId,
      amount: voidResult.newTransaction?.amount,
      balance: voidResult.balance,
    });
  } catch (error: unknown) {
    logger.error("Void: unexpected error", { uidHex: tap.uidHex, transactionId: txnId, error: getErrorMessage(error) });
    return errorResponse("Void failed", 500);
  }
}

export async function handleVoidTransactions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pHex = url.searchParams.get("p") || "";
  const cHex = url.searchParams.get("c") || "";

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex, cHex, context: "Void lookup" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  try {
    const txData: ListTransactionsResult = await listTransactions(env, tap.uidHex, 20);
    const charges = (txData.transactions || []).filter(
      (t: Transaction) => t.amount < 0 && !t.voided_at
    );
    return jsonResponse({ transactions: charges, uid: tap.uidHex });
  } catch (error: unknown) {
    logger.error("Void transactions lookup failed", { error: getErrorMessage(error) });
    return errorResponse("Lookup failed", 500);
  }
}
