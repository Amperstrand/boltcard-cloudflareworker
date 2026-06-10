import { jsonResponse, errorResponse } from "../utils/responses.js";
import type { SessionPayload , OpResult} from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { debitCard } from "../replayProtection.js";
import { validateCardTap, type ValidateCardTapResult } from "../utils/validateCardTap.js";
import { logger } from "../utils/logger.js";
import { recordAuditEvent } from "../utils/auditLog.js";
import { parseValidatedBody, posChargeBodySchema, type PosChargeBody } from "../utils/schemas.js";

import { parsePositiveInt } from "../utils/validation.js";

export async function handlePosCharge(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const result = await parseValidatedBody<PosChargeBody>(request, posChargeBodySchema);
  if (!result.ok) return errorResponse(result.error, 400);
  const { p: pHex, c: cHex, amount, items, terminalId: rawTerminalId } = result.data;

  const terminalId: string = rawTerminalId || "unknown";

  const parsedAmount: number | null = parsePositiveInt(amount);
  if (!parsedAmount) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  if (env.MAX_TOPUP_AMOUNT) {
    const maxAmount: number | null = parsePositiveInt(env.MAX_TOPUP_AMOUNT);
    if (maxAmount !== null && parsedAmount > maxAmount) {
      return errorResponse(`Amount exceeds maximum of ${maxAmount}`, 400);
    }
  }

  const tap: ValidateCardTapResult = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context: "POS charge" });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId: string = session?.shiftId || "unknown";
  const noteParts: string[] = ["pos", shiftId, terminalId];
  if (items && items.length > 0) {
    noteParts.push(items.map((i) => `${i.name || "item"}:${i.qty || 1}`).join(","));
  }
  const note: string = noteParts.join(":");

  try {
    const result: OpResult = await debitCard(env, tap.uidHex, tap.counterValue, parsedAmount, note);
    if (!result.ok) {
      const isInsufficient: boolean = !!result.reason && result.reason.toLowerCase().includes("insufficient");
      const status: number = isInsufficient ? 402 : 500;
      const extra: Record<string, unknown> = result.balance != null ? { currentBalance: result.balance } : {};
      logger.warn("POS charge: debit failed", { action: "pos_charge", uidHex: tap.uidHex, amount: parsedAmount, reason: result.reason, currentBalance: result.balance });
      return errorResponse(result.reason || "Debit failed", status, extra);
    }

    const newBalance: number = result.balance ?? 0;
    logger.info("POS charge successful", { action: "pos_charge", uidHex: tap.uidHex, amount: parsedAmount, newBalance, shiftId, terminalId });
    await recordAuditEvent(env, { action: "pos_charge", uidHex: tap.uidHex, operatorShiftId: shiftId, details: { amount: parsedAmount, balance: newBalance, terminalId } });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      txnId: result.transaction?.id || null,
      note,
    });
  } catch (error: unknown) {
    logger.error("POS charge: unexpected error", { action: "pos_charge", uidHex: tap.uidHex, amount: parsedAmount, error: getErrorMessage(error) });
    return errorResponse("Charge failed", 500);
  }
}
