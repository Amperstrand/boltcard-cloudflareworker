import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { creditCard, getBalance } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { renderTopupPage } from "../templates/topupPage.js";
import { getRequestOrigin } from "../utils/validation.js";

export function handleTopupPage(request, env) {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderTopupPage({ host, currencyLabel }));
}

export async function handleTopupApply(request, env, session) {
  const body = await parseJsonBody(request).catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p: pHex, c: cHex, amount } = body;

  const parsedAmount = parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  if (env.MAX_TOPUP_AMOUNT) {
    const maxAmount = parseInt(env.MAX_TOPUP_AMOUNT, 10);
    if (Number.isInteger(maxAmount) && parsedAmount > maxAmount) {
      return errorResponse(`Amount exceeds maximum of ${maxAmount}`, 400);
    }
  }

  const tap = await validateCardTap(request, env, { pHex, cHex, context: "Top-up" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId = session?.shiftId || "unknown";
  const note = `topup:${shiftId}`;

  try {
    const result = await creditCard(env, tap.uidHex, parsedAmount, note);
    if (!result.ok) {
      logger.error("Top-up: credit failed", { uidHex: tap.uidHex, amount: parsedAmount, reason: result.reason });
      return errorResponse(result.reason || "Credit failed", 500);
    }

    const balanceData = await getBalance(env, tap.uidHex);
    const newBalance = balanceData.balance;

    logger.info("Top-up successful", { uidHex: tap.uidHex, amount: parsedAmount, newBalance, shiftId });
    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      note,
    });
  } catch (error) {
    logger.error("Top-up: unexpected error", { uidHex: tap.uidHex, amount: parsedAmount, error: error.message });
    return errorResponse("Top-up failed", 500);
  }
}
