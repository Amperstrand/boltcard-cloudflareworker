import type * as v from "valibot";
import type { Env, SessionPayload, OpResult } from "../types/core.js";
import type { ValidateCardTapResult } from "./validateCardTap.js";
import { errorResponse, jsonResponse } from "./responses.js";
import { parseValidatedBody } from "./schemas.js";
import { validateCardTap } from "./validateCardTap.js";
import { logger, getErrorMessage } from "./logger.js";
import { recordAuditEvent } from "./auditLog.js";
import { parsePositiveInt } from "./validation.js";

type ValidatedTap = Extract<ValidateCardTapResult, { ok: true }>;

export interface CardTapContext<T> {
  data: T;
  tap: ValidatedTap;
  shiftId: string;
  env: Env;
}

export async function withCardTap<T>(
  request: Request,
  env: Env,
  session: SessionPayload,
  schema: v.BaseSchema<any, T, any>,
  context: string,
  execute: (ctx: CardTapContext<T>) => Promise<Response>,
  failureMessage = "Internal error",
): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  const result = await parseValidatedBody<T>(request, schema);
  if (!result.ok) return errorResponse(result.error, 400);

  const { p: pHex, c: cHex } = result.data as { p?: string; c?: string };
  const tap = await validateCardTap(request, env, { pHex: pHex || "", cHex: cHex || "", context });
  if (!tap.ok) return errorResponse(tap.error, tap.status);

  const shiftId = session?.shiftId || "unknown";

  try {
    return await execute({ data: result.data, tap, shiftId, env });  } catch (error: unknown) {
    logger.error(`${context} failed`, { action: context.toLowerCase().replace(/\s+/g, "_"), error: getErrorMessage(error) });
    return errorResponse(failureMessage, 500);
  }
}

export function validateAmount(amount: unknown, env?: Env): number | Response {
  const parsed = parsePositiveInt(amount);
  if (!parsed) return errorResponse("Amount must be a positive integer", 400);

  if (env?.MAX_TOPUP_AMOUNT) {
    const max = parsePositiveInt(env.MAX_TOPUP_AMOUNT);
    if (max !== null && parsed > max) {
      return errorResponse(`Amount exceeds maximum of ${max}`, 400);
    }
  }
  return parsed;
}

export function handleOpFailure(
  result: OpResult,
  action: string,
  uidHex: string,
  amount: number,
  context: string,
  fallbackMessage = "Operation failed",
): Response | null {
  if (result.ok) return null;

  const isInsufficient = !!result.reason && result.reason.toLowerCase().includes("insufficient");
  const status = isInsufficient ? 402 : 500;
  const extra = result.balance != null ? { currentBalance: result.balance } : {};

  logger.warn(`${context}: operation failed`, { action, uidHex, amount, reason: result.reason, currentBalance: result.balance });
  return errorResponse(result.reason || fallbackMessage, status, extra);
}

export async function logSuccess(
  env: Env,
  action: string,
  uidHex: string,
  shiftId: string,
  details: Record<string, unknown>,
): Promise<void> {
  logger.info(`${action} successful`, { action, uidHex, ...details, shiftId });
  await recordAuditEvent(env, { action, uidHex, operatorShiftId: shiftId, details });
}
