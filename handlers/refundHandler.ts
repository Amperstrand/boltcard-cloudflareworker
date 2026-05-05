import { renderRefundPage } from "../templates/refundPage.js";
import type { SessionPayload, OpResult, BalanceResult } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { debitCard, getBalance } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin } from "../utils/validation.js";
import { recordAuditEvent } from "../utils/auditLog.js";

export function handleRefundPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderRefundPage({ host, currencyLabel }));
}

export async function handleRefundApply(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: Record<string, unknown> | null = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const pHex = body.p as string | undefined;
  const cHex = body.c as string | undefined;
  const amount = body.amount;
  const fullRefund: boolean = body.fullRefund === true;

  if (!fullRefund && (!amount || parseInt(String(amount), 10) <= 0)) {
    return errorResponse("Amount must be a positive integer for partial refund", 400);
  }

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "Refund" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  let refundAmount: number;
  if (fullRefund) {
    let balanceData: BalanceResult;
    try {
      balanceData = await getBalance(env, tap.uidHex);
    } catch (err: unknown) {
      logger.error("Refund: balance check failed", { uidHex: tap.uidHex, error: getErrorMessage(err) });
      return errorResponse("Balance check failed", 500);
    }
    refundAmount = balanceData.balance;
    if (!refundAmount || refundAmount <= 0) {
      return jsonResponse({ success: true, amount: 0, balance: 0, note: "refund:zero" });
    }
  } else {
    refundAmount = parseInt(String(amount), 10);
    let balanceData: BalanceResult;
    try {
      balanceData = await getBalance(env, tap.uidHex);
    } catch (err: unknown) {
      logger.error("Refund: balance check failed", { uidHex: tap.uidHex, error: getErrorMessage(err) });
      return errorResponse("Balance check failed", 500);
    }
    if (refundAmount > balanceData.balance) {
      return errorResponse(`Refund amount (${refundAmount}) exceeds balance (${balanceData.balance})`, 400, {
        currentBalance: balanceData.balance,
      });
    }
  }

  const shiftId: string = session?.shiftId || "unknown";
  const note: string = `refund:${shiftId}`;

  try {
    const result: OpResult = await debitCard(env, tap.uidHex, tap.counterValue, refundAmount, note);
    if (!result.ok) {
      logger.error("Refund: debit failed", { uidHex: tap.uidHex, amount: refundAmount, reason: result.reason });
      return errorResponse(result.reason || "Refund failed", 500);
    }

    const newBalance: number = result.balance ?? 0;
    logger.info("Refund successful", { uidHex: tap.uidHex, amount: refundAmount, newBalance, shiftId, fullRefund });
    await recordAuditEvent(env, { action: "refund", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: refundAmount, balance: newBalance, fullRefund } });

    return jsonResponse({
      success: true,
      amount: refundAmount,
      balance: newBalance,
      note,
    });
  } catch (error: unknown) {
    logger.error("Refund: unexpected error", { uidHex: tap.uidHex, amount: refundAmount, error: getErrorMessage(error) });
    return errorResponse("Refund failed", 500);
  }
}
