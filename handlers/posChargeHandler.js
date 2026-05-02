import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { debitCard } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { recordAuditEvent } from "../utils/auditLog.js";

export async function handlePosCharge(request, env, session) {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body = await parseJsonBody(request);
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
    const result = await debitCard(env, tap.uidHex, tap.counterValue, parsedAmount, note);
    if (!result.ok) {
      const isInsufficient = result.reason && result.reason.toLowerCase().includes("insufficient");
      const status = isInsufficient ? 402 : 500;
      const extra = result.balance != null ? { currentBalance: result.balance } : {};
      return errorResponse(result.reason || "Debit failed", status, extra);
    }

    const newBalance = result.balance;
    logger.info("POS charge successful", { uidHex: tap.uidHex, amount: parsedAmount, newBalance, shiftId, terminalId });
    await recordAuditEvent(env, { action: "pos_charge", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: parsedAmount, balance: newBalance, terminalId } });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      txnId: result.transaction?.id || null,
      note,
    });
  } catch (error) {
    logger.error("POS charge: unexpected error", { uidHex: tap.uidHex, amount: parsedAmount, error: error.message });
    return errorResponse("Charge failed", 500);
  }
}
