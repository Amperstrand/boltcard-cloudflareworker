import { logger } from "./utils/logger.js";
import { getErrorMessage } from "./utils/logger.js";
import type { Env, CardStateRow, CardConfig, CounterCheckResult, TapRecordResult, ListTapsResult, ClaimTapResult, AnalyticsResult, BalanceResult, ListTransactionsResult, DiscoverResult, MarkPendingResult, OpResult } from "./types/core.js";
import { DEFAULT_TAP_LIMIT, DEFAULT_TXN_LIMIT, CARD_STATE } from "./utils/constants.js";
import { indexCard } from "./utils/cardIndex.js";

const EMPTY_ANALYTICS: AnalyticsResult = Object.freeze({
  totalMsat: 0, completedMsat: 0, failedMsat: 0, pendingMsat: 0,
  totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0,
});

const legacyCardState: CardStateRow = {
  state: CARD_STATE.LEGACY,
  latest_issued_version: 0,
  active_version: null,
  activated_at: null,
  terminated_at: null,
  keys_delivered_at: null,
  wipe_keys_fetched_at: null,
  balance: 0,
  counter: 0,
  key_provenance: null,
  key_fingerprint: null,
  key_label: null,
  first_seen_at: null,
  created_at: 0,
  updated_at: 0,
};

export function resolveActiveVersion(cardState: CardStateRow): number {
  return cardState.active_version || cardState.latest_issued_version || 1;
}

export function resolveLatestVersion(cardState: CardStateRow): number {
  return cardState.latest_issued_version || cardState.active_version || 1;
}

async function doStateTransition<T = CardStateRow>(env: Env, uidHex: string, path: string, body: Record<string, unknown>, errorMsg: string, { legacyFallback, indexMetadata }: { legacyFallback?: T; indexMetadata?: Record<string, unknown> } = {}): Promise<T> {
  requireDo(env);
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, path, body);

  if (response.status === 404) {
    return legacyFallback || { ...legacyCardState } as T;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(payload.error || errorMsg));
  }

  const result = await response.json() as T;

  if (indexMetadata) {
    await indexCard(env, uidHex, indexMetadata);
  }

  return result;
}

function getCardStub(env: Env, uidHex: string): DurableObjectStub {
  const id: DurableObjectId = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  return env.CARD_REPLAY.get(id);
}

function requireDo(env: Env): void {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }
}

function doGet(stub: DurableObjectStub, path: string): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`));
}

function doPost(stub: DurableObjectStub, path: string, body: Record<string, unknown>): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function checkAndAdvanceCounter(env: Env, uidHex: string, counterValue: number): Promise<CounterCheckResult> {
  requireDo(env);
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, "/check", { counterValue });

  const payload = await response.json() as CounterCheckResult;

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Replay protection check failed");
}

export async function recordTapRead(env: Env, uidHex: string, counterValue: number | null, { userAgent, requestUrl }: { userAgent?: string | null; requestUrl?: string } = {}): Promise<void> {
  if (!env?.CARD_REPLAY) return;

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  await doPost(stub, "/record-read", { counterValue, userAgent, requestUrl })
    .catch((e: unknown) => logger.warn("Failed to record tap read", { uidHex, counterValue, error: getErrorMessage(e) }));
}

export async function recordTap(env: Env, uidHex: string, counterValue: number, { bolt11, amountMsat, userAgent, requestUrl }: { bolt11?: string; amountMsat?: number; userAgent?: string | null; requestUrl?: string } = {}): Promise<TapRecordResult> {
  requireDo(env);
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, "/record-tap", { counterValue, bolt11, amountMsat, userAgent, requestUrl });

  const payload = await response.json() as TapRecordResult;

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Tap recording failed");
}

export async function updateTapStatus(env: Env, uidHex: string, counter: number, status: string, meta: Record<string, unknown> = {}): Promise<void> {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  await doPost(stub, "/update-tap-status", { counter, status, ...meta });
}

export async function listTaps(env: Env, uidHex: string, limit: number = DEFAULT_TAP_LIMIT): Promise<ListTapsResult> {
  if (!env?.CARD_REPLAY) {
    return { taps: [] };
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, `/list-taps?limit=${limit}`);

  if (!response.ok) {
    return { taps: [] };
  }

  return response.json() as Promise<ListTapsResult>;
}

export async function claimTap(env: Env, uidHex: string, counterValue: number, { bolt11, amountMsat }: { bolt11?: string; amountMsat?: number } = {}): Promise<ClaimTapResult> {
  if (!env?.CARD_REPLAY) {
    return { claimed: false };
  }
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const resp: Response = await doPost(stub, "/claim-tap", { counter: counterValue, bolt11: bolt11 || null, amountMsat: amountMsat ?? null });
  return resp.json() as Promise<ClaimTapResult>;
}

export async function resetReplayProtection(env: Env, uidHex: string): Promise<void> {
  requireDo(env);
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, "/reset", {});

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(payload.reason || "Replay protection reset failed"));
  }
}

export async function getAnalytics(env: Env, uidHex: string): Promise<AnalyticsResult> {
  if (!env?.CARD_REPLAY) {
    return { ...EMPTY_ANALYTICS };
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, "/analytics");

  if (!response.ok) {
    return { ...EMPTY_ANALYTICS };
  }

  return response.json() as Promise<AnalyticsResult>;
}

export async function getCardState(env: Env, uidHex: string): Promise<CardStateRow> {
  if (!env?.CARD_REPLAY) {
    return { state: CARD_STATE.NEW, latest_issued_version: 0, active_version: null, activated_at: null, terminated_at: null, keys_delivered_at: null, wipe_keys_fetched_at: null, balance: 0, counter: 0, key_provenance: null, key_fingerprint: null, key_label: null, first_seen_at: null, created_at: 0, updated_at: 0 };
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, "/card-state");

  if (response.status === 404) {
    return legacyCardState;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(payload.reason || payload.error || "Card state unavailable"));
  }

  return response.json() as Promise<CardStateRow>;
}

export async function deliverKeys(env: Env, uidHex: string): Promise<CardStateRow & { version: number }> {
  return doStateTransition<CardStateRow & { version: number }>(env, uidHex, "/deliver-keys", {}, "Key delivery failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.KEYS_DELIVERED, latest_issued_version: 1, version: 1 },
    indexMetadata: { state: CARD_STATE.KEYS_DELIVERED },
  });
}

export async function activateCard(env: Env, uidHex: string, activeVersion: number): Promise<CardStateRow> {
  return doStateTransition(env, uidHex, "/activate", { active_version: activeVersion }, "Card activation failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.ACTIVE, active_version: activeVersion },
    indexMetadata: { state: CARD_STATE.ACTIVE },
  });
}

export async function terminateCard(env: Env, uidHex: string): Promise<CardStateRow> {
  return doStateTransition(env, uidHex, "/terminate", {}, "Card termination failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.TERMINATED },
    indexMetadata: { state: CARD_STATE.TERMINATED },
  });
}

export async function requestWipe(env: Env, uidHex: string): Promise<CardStateRow> {
  return doStateTransition(env, uidHex, "/request-wipe", {}, "Wipe request failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.NEW },
  });
}

export async function getCardConfig(env: Env, uidHex: string): Promise<CardConfig | null> {
  if (!env?.CARD_REPLAY) {
    return null;
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, "/get-config");

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<CardConfig>;
}

export async function setCardConfig(env: Env, uidHex: string, config: Record<string, unknown>): Promise<void> {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  await doPost(stub, "/set-config", config);
}

export async function setCardK2(env: Env, uidHex: string, k2: string): Promise<void> {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub: DurableObjectStub = getCardStub(env, uidHex);
  await doPost(stub, "/set-k2", { K2: k2 });
}

export async function debitCard(env: Env, uidHex: string, counter: number, amount: number, note: string): Promise<OpResult> {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const resp: Response = await doPost(stub, "/debit", { counter, amount, note });
  return resp.json() as Promise<OpResult>;
}

export async function creditCard(env: Env, uidHex: string, amount: number, note: string): Promise<OpResult> {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const resp: Response = await doPost(stub, "/credit", { amount, note });
  return resp.json() as Promise<OpResult>;
}

export async function getBalance(env: Env, uidHex: string): Promise<BalanceResult> {
  if (!env?.CARD_REPLAY) return { balance: 0 };
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const resp: Response = await doGet(stub, "/balance");
  return resp.json() as Promise<BalanceResult>;
}

export async function safeGetBalance(env: Env, uidHex: string): Promise<BalanceResult> {
  try {
    const result = await getBalance(env, uidHex);
    return { balance: result.balance ?? 0 };
  } catch (e: unknown) {
    logger.warn("Could not fetch balance", { uidHex, error: getErrorMessage(e) });
    return { balance: 0 };
  }
}

export async function listTransactions(env: Env, uidHex: string, limit: number = DEFAULT_TXN_LIMIT): Promise<ListTransactionsResult> {
  if (!env?.CARD_REPLAY) return { transactions: [] };
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const resp: Response = await doGet(stub, `/transactions?limit=${limit}`);
  return resp.json() as Promise<ListTransactionsResult>;
}

export async function markPending(env: Env, uidHex: string, { key_provenance, key_fingerprint, key_label }: { key_provenance?: string; key_fingerprint?: string; key_label?: string } = {}): Promise<MarkPendingResult> {
  return doStateTransition<MarkPendingResult>(env, uidHex, "/mark-pending", {
    key_provenance: key_provenance || null,
    key_fingerprint: key_fingerprint || null,
    key_label: key_label || null,
  }, "Mark pending failed", {
    indexMetadata: {
      state: CARD_STATE.PENDING,
      keyProvenance: key_provenance,
      keyLabel: key_label,
      keyFingerprint: key_fingerprint,
    },
  });
}

export async function discoverCard(env: Env, uidHex: string, { key_provenance, key_fingerprint, key_label, active_version }: { key_provenance?: string; key_fingerprint?: string; key_label?: string; active_version?: number } = {}): Promise<DiscoverResult> {
  return doStateTransition<DiscoverResult>(env, uidHex, "/discover", {
    key_provenance: key_provenance || null,
    key_fingerprint: key_fingerprint || null,
    key_label: key_label || null,
    active_version: active_version || null,
  }, "Discover card failed", {
    indexMetadata: {
      state: CARD_STATE.DISCOVERED,
      keyProvenance: key_provenance,
      keyLabel: key_label,
      keyFingerprint: key_fingerprint,
    },
  });
}
