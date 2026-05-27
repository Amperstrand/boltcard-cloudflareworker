import { renderRefundPage } from "../templates/refundPage.js";
import type { SessionPayload, OpResult, BalanceResult } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { creditCard, getBalance } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin, parsePositiveInt } from "../utils/validation.js";
import { recordAuditEvent } from "../utils/auditLog.js";
import { parseValidatedBody, refundBodySchema, type RefundBody } from "../utils/schemas.js";

export function handleRefundPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderRefundPage({ host, currencyLabel }));
}

export async function handleRefundApply(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const result = await parseValidatedBody<RefundBody>(request, refundBodySchema);
  if (!result.ok) return errorResponse(result.error, 400);
  const { p: pHex, c: cHex, amount, fullRefund } = result.data;

  const isFullRefund: boolean = fullRefund === true;

  if (!isFullRefund && !parsePositiveInt(amount)) {
    return errorResponse("Amount must be a positive integer for partial refund", 400);
  }

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "Refund" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  let refundAmount: number;
  if (isFullRefund) {
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
    refundAmount = parsePositiveInt(amount) ?? 0;
    if (refundAmount <= 0) {
      return errorResponse("Amount must be a positive integer", 400);
    }
  }

  const shiftId: string = session?.shiftId || "unknown";
  const note: string = `refund:${shiftId}`;

  try {
    const result: OpResult = await creditCard(env, tap.uidHex, refundAmount, note);
    if (!result.ok) {
      const isInsufficient = !!result.reason && result.reason.toLowerCase().includes("insufficient");
      const status = isInsufficient ? 400 : 500;
      const extra = result.balance != null ? { currentBalance: result.balance } : {};
      logger.error("Refund: credit failed", { uidHex: tap.uidHex, amount: refundAmount, reason: result.reason });
      return errorResponse(result.reason || "Refund failed", status, extra);
    }

    const newBalance: number = result.balance ?? 0;
    logger.info("Refund successful", { uidHex: tap.uidHex, amount: refundAmount, newBalance, shiftId, fullRefund: isFullRefund });
    await recordAuditEvent(env, { action: "refund", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: refundAmount, balance: newBalance, fullRefund: isFullRefund } });

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
