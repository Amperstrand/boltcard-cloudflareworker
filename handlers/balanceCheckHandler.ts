import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env, BalanceResult } from "../types/core.js";
import { getBalance } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";

export async function handleBalanceCheck(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: Record<string, unknown> | null = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p: pHex, c: cHex } = body as { p?: string; c?: string };

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "Balance check" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  try {
    const balanceData: BalanceResult = await getBalance(env, tap.uidHex);
    return jsonResponse({ success: true, balance: balanceData.balance, uidHex: tap.uidHex });
  } catch (error: unknown) {
    logger.error("Balance check failed", { uidHex: tap.uidHex, error: getErrorMessage(error) });
    return errorResponse("Failed to retrieve balance", 500);
  }
}
