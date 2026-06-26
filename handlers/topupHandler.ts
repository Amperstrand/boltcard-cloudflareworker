import { getCurrencyLabel } from "../utils/currency.js";
import type { SessionPayload } from "../types/core.js";
import type { Env } from "../types/core.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { creditCard } from "../card/balance.js";
import { renderTopupPage } from "../templates/topupPage.js";
import { getRequestOrigin } from "../utils/validation.js";
import { topupBodySchema, type TopupBody } from "../utils/schemas.js";
import { withCardTap, validateAmount, handleOpFailure, logSuccess } from "../utils/cardHandler.js";

export function handleTopupPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderTopupPage({ host, currencyLabel }));
}

export async function handleTopupApply(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  return withCardTap<TopupBody>(request, env, session, topupBodySchema, "Top-up", async ({ data, tap, shiftId, env }) => {
    const amountOrError = validateAmount(data.amount, env);
    if (amountOrError instanceof Response) return amountOrError;
    const parsedAmount = amountOrError;

    const note = `topup:${shiftId}`;
    const result = await creditCard(env, tap.uidHex, parsedAmount, note);

    const failure = handleOpFailure(result, "topup", tap.uidHex, parsedAmount, "Top-up", "Credit failed");
    if (failure) return failure;

    const newBalance = result.balance ?? 0;
    await logSuccess(env, "topup", tap.uidHex, shiftId, { amount: parsedAmount, balance: newBalance });

    return jsonResponse({ success: true, amount: parsedAmount, balance: newBalance, note });
  }, "Top-up failed");
}
