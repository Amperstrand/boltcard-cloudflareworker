import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getBalance } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";

export async function handleBalanceCheck(request: Request, env: any): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: any = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p: pHex, c: cHex } = body;

  const tap: any = await validateCardTap(request, env, { pHex, cHex, context: "Balance check" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  try {
    const balanceData: any = await getBalance(env, tap.uidHex);
    return jsonResponse({ success: true, balance: balanceData.balance, uidHex: tap.uidHex });
  } catch (error: any) {
    logger.error("Balance check failed", { uidHex: tap.uidHex, error: error.message });
    return errorResponse("Failed to retrieve balance", 500);
  }
}
