import { getCurrencyLabel } from "../utils/currency.js";
import type { SessionPayload , OpResult} from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { creditCard } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { renderTopupPage } from "../templates/topupPage.js";
import { getRequestOrigin } from "../utils/validation.js";
import { recordAuditEvent } from "../utils/auditLog.js";

export function handleTopupPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderTopupPage({ host, currencyLabel }));
}

export async function handleTopupApply(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: Record<string, unknown> | null = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p: pHex, c: cHex, amount } = body as { p?: string; c?: string; amount?: string };

  const parsedAmount: number = parseInt(amount!, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  if (env.MAX_TOPUP_AMOUNT) {
    const maxAmount: number = parseInt(env.MAX_TOPUP_AMOUNT, 10);
    if (Number.isInteger(maxAmount) && parsedAmount > maxAmount) {
      return errorResponse(`Amount exceeds maximum of ${maxAmount}`, 400);
    }
  }

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "Top-up" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId: string = session?.shiftId || "unknown";
  const note: string = `topup:${shiftId}`;

  try {
    const result: OpResult = await creditCard(env, tap.uidHex, parsedAmount, note);
    if (!result.ok) {
      logger.error("Top-up: credit failed", { uidHex: tap.uidHex, amount: parsedAmount, reason: result.reason });
      return errorResponse(result.reason || "Credit failed", 500);
    }

    const newBalance: number = result.balance ?? 0;

    logger.info("Top-up successful", { uidHex: tap.uidHex, amount: parsedAmount, newBalance, shiftId });
    await recordAuditEvent(env, { action: "topup", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: parsedAmount, balance: newBalance } });
    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      note,
    });
  } catch (error: unknown) {
    logger.error("Top-up: unexpected error", { uidHex: tap.uidHex, amount: parsedAmount, error: getErrorMessage(error) });
    return errorResponse("Top-up failed", 500);
  }
}
