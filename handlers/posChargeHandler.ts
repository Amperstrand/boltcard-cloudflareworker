import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { debitCard } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { recordAuditEvent } from "../utils/auditLog.js";

export async function handlePosCharge(request: Request, env: any, session: any): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: any = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p: pHex, c: cHex, amount } = body;
  const items: any[] | null = body.items || null;
  const terminalId: string = body.terminalId || "unknown";

  const parsedAmount: number = parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  const tap: any = await validateCardTap(request, env, { pHex, cHex, context: "POS charge" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId: string = session?.shiftId || "unknown";
  const noteParts: string[] = ["pos", shiftId, terminalId];
  if (items && items.length > 0) {
    noteParts.push(items.map((i: any) => `${i.name || "item"}:${i.qty || 1}`).join(","));
  }
  const note: string = noteParts.join(":");

  try {
    const result: any = await debitCard(env, tap.uidHex, tap.counterValue, parsedAmount, note);
    if (!result.ok) {
      const isInsufficient: boolean = result.reason && result.reason.toLowerCase().includes("insufficient");
      const status: number = isInsufficient ? 402 : 500;
      const extra: Record<string, any> = result.balance != null ? { currentBalance: result.balance } : {};
      return errorResponse(result.reason || "Debit failed", status, extra);
    }

    const newBalance: number = result.balance;
    logger.info("POS charge successful", { uidHex: tap.uidHex, amount: parsedAmount, newBalance, shiftId, terminalId });
    await recordAuditEvent(env, { action: "pos_charge", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: parsedAmount, balance: newBalance, terminalId } });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      txnId: result.transaction?.id || null,
      note,
    });
  } catch (error: any) {
    logger.error("POS charge: unexpected error", { uidHex: tap.uidHex, amount: parsedAmount, error: error.message });
    return errorResponse("Charge failed", 500);
  }
}
