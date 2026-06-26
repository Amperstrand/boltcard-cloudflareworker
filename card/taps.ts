import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env, CounterCheckResult, TapRecordResult, ListTapsResult, ClaimTapResult } from "../types/core.js";
import { DEFAULT_TAP_LIMIT } from "../utils/constants.js";
import { getCardStub, doPost, requireDo, doCounterPost, doSafeGet, doOptionalPost, doOptionalVoidPost, doRequiredPost } from "./doFacade.js";

export async function checkAndAdvanceCounter(env: Env, uidHex: string, counterValue: number): Promise<CounterCheckResult> {
  return doCounterPost(env, uidHex, "/check", { counterValue }, "Replay protection check failed");
}

export async function recordTapRead(env: Env, uidHex: string, counterValue: number | null, { userAgent, requestUrl }: { userAgent?: string | null; requestUrl?: string } = {}): Promise<void> {
  if (!env?.CARD_REPLAY) return;
  const stub = getCardStub(env, uidHex);
  await doPost(stub, "/record-read", { counterValue, userAgent, requestUrl })
    .catch((e: unknown) => logger.warn("Failed to record tap read", { uidHex, counterValue, error: getErrorMessage(e) }));
}

export async function recordTap(env: Env, uidHex: string, counterValue: number, { bolt11, amountMsat, userAgent, requestUrl }: { bolt11?: string; amountMsat?: number; userAgent?: string | null; requestUrl?: string } = {}): Promise<TapRecordResult> {
  return doCounterPost(env, uidHex, "/record-tap", { counterValue, bolt11, amountMsat, userAgent, requestUrl }, "Tap recording failed");
}

export async function updateTapStatus(env: Env, uidHex: string, counter: number, status: string, meta: Record<string, unknown> = {}): Promise<void> {
  return doOptionalVoidPost(env, uidHex, "/update-tap-status", { counter, status, ...meta });
}

export async function listTaps(env: Env, uidHex: string, limit: number = DEFAULT_TAP_LIMIT): Promise<ListTapsResult> {
  return doSafeGet(env, uidHex, `/list-taps?limit=${limit}`, { taps: [] });
}

export async function claimTap(env: Env, uidHex: string, counterValue: number, { bolt11, amountMsat }: { bolt11?: string; amountMsat?: number } = {}): Promise<ClaimTapResult> {
  return doOptionalPost(env, uidHex, "/claim-tap", { counter: counterValue, bolt11: bolt11 || null, amountMsat: amountMsat ?? null }, { claimed: false });
}

export async function resetReplayProtection(env: Env, uidHex: string): Promise<void> {
  return doRequiredPost(env, uidHex, "/reset", {}, "Replay protection reset failed");
}
