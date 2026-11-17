import { logger } from "../utils/logger.js";
import type { Env, K1ChallengeIssueResult, K1ChallengeVerifyResult } from "../types/core.js";
import { getCardStub, doPost, requireDo } from "./doFacade.js";

// K1_FRESH (audit #13, default OFF): per-card DO storage for random
// withdraw challenges — 16 bytes hex, single-use, TTL per
// K1_FRESH_TTL_SECONDS (Go default 60s, lnurlw_request_timeout_sec).
// The DO is keyed by UID, so a challenge is bound to the card AND the tap
// counter it was issued for (durableObjects/cardReplay/k1ChallengeHandlers.ts).

export async function issueK1Challenge(
  env: Env,
  uidHex: string,
  counterValue: number,
  ttlSeconds: number
): Promise<K1ChallengeIssueResult> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/k1-issue", { counterValue, maxAgeSec: ttlSeconds });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(payload.reason || "k1 challenge issue failed"));
  }
  return response.json() as Promise<K1ChallengeIssueResult>;
}

export async function verifyK1Challenge(
  env: Env,
  uidHex: string,
  k1: string,
  counterValue: number,
  ttlSeconds: number
): Promise<K1ChallengeVerifyResult> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/k1-verify", { k1, counterValue, ttlSeconds });
  const payload = await response.json() as K1ChallengeVerifyResult;
  if (!response.ok) {
    logger.warn("k1 verify returned non-OK", { uidHex, status: response.status });
  }
  return payload;
}

export function k1FreshTtlSeconds(env: Env): number {
  const raw = parseInt((env.K1_FRESH_TTL_SECONDS ?? "").trim(), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}
