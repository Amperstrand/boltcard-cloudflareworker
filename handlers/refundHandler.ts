import { renderRefundPage } from "../templates/refundPage.js";
import type { SessionPayload } from "../types/core.js";
import type { Env } from "../types/core.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { creditCard, getBalance } from "../card/balance.js";
import { getRequestOrigin, parsePositiveInt } from "../utils/validation.js";
import { refundBodySchema, type RefundBody } from "../utils/schemas.js";
import { withCardTap, handleOpFailure, logSuccess } from "../utils/cardHandler.js";
import { logger } from "../utils/logger.js";

export function handleRefundPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderRefundPage({ host, currencyLabel }));
}

export async function handleRefundApply(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  return withCardTap<RefundBody>(request, env, session, refundBodySchema, "Refund", async ({ data, tap, shiftId, env }) => {
    const isFullRefund = data.fullRefund === true;

    if (!isFullRefund && !parsePositiveInt(data.amount)) {
      return errorResponse("Amount must be a positive integer for partial refund", 400);
    }

    let refundAmount: number;
    if (isFullRefund) {
      try {
        const balanceData = await getBalance(env, tap.uidHex);
        refundAmount = balanceData.balance;
        if (!refundAmount || refundAmount <= 0) {
          return jsonResponse({ success: true, amount: 0, balance: 0, note: "refund:zero" });
        }
      } catch {
        return errorResponse("Balance check failed", 500);
      }
    } else {
      refundAmount = parsePositiveInt(data.amount) ?? 0;
      if (refundAmount <= 0) {
        return errorResponse("Amount must be a positive integer", 400);
      }
    }

    const note = `refund:${shiftId}`;
    const result = await creditCard(env, tap.uidHex, refundAmount, note);

    const failure = handleOpFailure(result, "refund", tap.uidHex, refundAmount, "Refund", "Refund failed");
    if (failure) return failure;

    const newBalance = result.balance ?? 0;
    await logSuccess(env, "refund", tap.uidHex, shiftId, { amount: refundAmount, balance: newBalance, fullRefund: isFullRefund });

    return jsonResponse({ success: true, amount: refundAmount, balance: newBalance, note });
  }, "Refund failed");
}
