import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { debitCard, getBalance } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";

export async function handlePosCharge(request, env, session) {
  const body = await parseJsonBody(request).catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p: pHex, c: cHex, amount } = body;
  const items = body.items || null;
  const terminalId = body.terminalId || "unknown";

  const parsedAmount = parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  const tap = await validateCardTap(request, env, { pHex, cHex, context: "POS charge" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId = session?.shiftId || "unknown";
  const noteParts = ["pos", shiftId, terminalId];
  if (items && items.length > 0) {
    noteParts.push(items.map(i => `${i.name || "item"}:${i.qty || 1}`).join(","));
  }
  const note = noteParts.join(":");

  try {
    const preBalance = await getBalance(env, tap.uidHex);
    if (preBalance.balance < parsedAmount) {
      logger.info("POS charge: insufficient balance", { uidHex: tap.uidHex, requested: parsedAmount, available: preBalance.balance });
      return errorResponse("Insufficient balance", 402, {
        currentBalance: preBalance.balance,
      });
    }

    const result = await debitCard(env, tap.uidHex, tap.counterValue, parsedAmount, note);
    if (!result.ok) {
      const status = result.reason && result.reason.toLowerCase().includes("insufficient") ? 402 : 500;
      return errorResponse(result.reason || "Debit failed", status);
    }

    const postBalance = await getBalance(env, tap.uidHex);
    logger.info("POS charge successful", { uidHex: tap.uidHex, amount: parsedAmount, newBalance: postBalance.balance, shiftId, terminalId });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: postBalance.balance,
      txnId: result.txnId || null,
      note,
    });
  } catch (error) {
    logger.error("POS charge: unexpected error", { uidHex: tap.uidHex, amount: parsedAmount, error: error.message });
    return errorResponse("Charge failed", 500);
  }
}
