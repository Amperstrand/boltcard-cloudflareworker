import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import type { SessionPayload , OpResult} from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { debitCard } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { recordAuditEvent } from "../utils/auditLog.js";

export async function handlePosCharge(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: Record<string, unknown> | null = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const pHex = body.p as string | undefined;
  const cHex = body.c as string | undefined;
  const amount = body.amount;
  const items: Array<Record<string, unknown>> | null = (body.items as Array<Record<string, unknown>> | undefined) || null;
  const terminalId: string = (body.terminalId as string) || "unknown";

  const parsedAmount: number = parseInt(String(amount), 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "POS charge" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId: string = session?.shiftId || "unknown";
  const noteParts: string[] = ["pos", shiftId, terminalId];
  if (items && items.length > 0) {
    noteParts.push(items.map((i: Record<string, unknown>) => `${i.name || "item"}:${i.qty || 1}`).join(","));
  }
  const note: string = noteParts.join(":");

  try {
    const result: OpResult = await debitCard(env, tap.uidHex, tap.counterValue, parsedAmount, note);
    if (!result.ok) {
      const isInsufficient: boolean = !!result.reason && result.reason.toLowerCase().includes("insufficient");
      const status: number = isInsufficient ? 402 : 500;
      const extra: Record<string, unknown> = result.balance != null ? { currentBalance: result.balance } : {};
      return errorResponse(result.reason || "Debit failed", status, extra);
    }

    const newBalance: number = result.balance!;
    logger.info("POS charge successful", { uidHex: tap.uidHex, amount: parsedAmount, newBalance, shiftId, terminalId });
    await recordAuditEvent(env, { action: "pos_charge", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: parsedAmount, balance: newBalance, terminalId } });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      txnId: result.transaction?.id || null,
      note,
    });
  } catch (error: unknown) {
    logger.error("POS charge: unexpected error", { uidHex: tap.uidHex, amount: parsedAmount, error: getErrorMessage(error) });
    return errorResponse("Charge failed", 500);
  }
}
