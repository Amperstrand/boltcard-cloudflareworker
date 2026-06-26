import { jsonResponse, errorResponse } from "../utils/responses.js";
import type { SessionPayload } from "../types/core.js";
import type { Env } from "../types/core.js";
import { debitCard } from "../card/balance.js";
import { recordAuditEvent } from "../utils/auditLog.js";
import { posChargeBodySchema, type PosChargeBody } from "../utils/schemas.js";
import { withCardTap, validateAmount, handleOpFailure, logSuccess } from "../utils/cardHandler.js";
import { logger } from "../utils/logger.js";

export async function handlePosCharge(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  return withCardTap<PosChargeBody>(request, env, session, posChargeBodySchema, "POS charge", async ({ data, tap, shiftId, env }) => {
    const terminalId = data.terminalId || "unknown";

    const amountOrError = validateAmount(data.amount, env);
    if (amountOrError instanceof Response) return amountOrError;
    const parsedAmount = amountOrError;

    const noteParts: string[] = ["pos", shiftId, terminalId];
    if (data.items && data.items.length > 0) {
      noteParts.push(data.items.map((i) => `${i.name || "item"}:${i.qty || 1}`).join(","));
    }
    const note = noteParts.join(":");

    const result = await debitCard(env, tap.uidHex, tap.counterValue, parsedAmount, note);

    const failure = handleOpFailure(result, "pos_charge", tap.uidHex, parsedAmount, "POS charge", "Debit failed");
    if (failure) return failure;

    const newBalance = result.balance ?? 0;
    await logSuccess(env, "pos_charge", tap.uidHex, shiftId, { amount: parsedAmount, balance: newBalance, terminalId });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      txnId: result.transaction?.id || null,
      note,
    });
  }, "Charge failed");
}
