import { jsonResponse, errorResponse } from "../utils/responses.js";
import { getBalance } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";

export async function handleBalanceCheck(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { p: pHex, c: cHex } = body;

  const tap = await validateCardTap(request, env, { pHex, cHex, context: "Balance check" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const balanceData = await getBalance(env, tap.uidHex);
  return jsonResponse({ success: true, balance: balanceData.balance, uidHex: tap.uidHex });
}
