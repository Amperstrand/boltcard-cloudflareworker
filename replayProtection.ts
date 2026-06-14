import { logger } from "./utils/logger.js";
import { getErrorMessage } from "./utils/logger.js";
import type { Env, CardStateRow, CardConfig, CounterCheckResult, TapRecordResult, ListTapsResult, ClaimTapResult, AnalyticsResult, BalanceResult, ListTransactionsResult, DiscoverResult, MarkPendingResult, OpResult, VoidResult } from "./types/core.js";
import type { DoPostRoutes, DoGetRoutes, DoRequestBody, DoResponseBody, PathWithOptionalQuery, CardExportData, ImportResult } from "./durableObjects/cardReplay/routes.js";
import { DEFAULT_TAP_LIMIT, DEFAULT_TXN_LIMIT, CARD_STATE } from "./utils/constants.js";
import { indexCard } from "./utils/cardIndex.js";
import { getDeterministicKeys } from "./keygenerator.js";

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

// --- Internal DO transport ---

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

function doPost(stub: DurableObjectStub, path: string, body: unknown): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

// --- Generic DO interaction helpers ---

async function doStateTransition<K extends DoPostRoutes>(env: Env, uidHex: string, path: K, body: DoRequestBody<K>, errorMsg: string, { legacyFallback, indexMetadata }: { legacyFallback?: DoResponseBody<K>; indexMetadata?: Record<string, unknown> } = {}): Promise<DoResponseBody<K>> {
  requireDo(env);
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, path, body);

  if (response.status === 404) {
    return (legacyFallback || { ...legacyCardState }) as DoResponseBody<K>;
  }

  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO error response", { path, error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.error || errorMsg));
  }

  const result = await response.json() as DoResponseBody<K>;

  if (indexMetadata) {
    await indexCard(env, uidHex, indexMetadata);
  }

  return result;
}

async function doCounterPost<K extends "/check" | "/record-tap">(env: Env, uidHex: string, path: K, body: DoRequestBody<K>, errorMsg: string): Promise<DoResponseBody<K>> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, path, body);
  const payload = await response.json() as DoResponseBody<K>;
  if (response.ok && payload.accepted) return payload;
  if (response.status === 409) return payload;
  throw new Error(payload.reason || errorMsg);
}

async function doRequiredPost<K extends DoPostRoutes>(env: Env, uidHex: string, path: K, body: DoRequestBody<K>, errorMsg: string): Promise<void> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, path, body);
  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO error response", { path: String(path), error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.reason || errorMsg));
  }
}

async function doSafeGet<K extends DoGetRoutes>(env: Env, uidHex: string, path: PathWithOptionalQuery<K>, fallback: DoResponseBody<K>): Promise<DoResponseBody<K>> {
  if (!env?.CARD_REPLAY) return fallback;
  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, path);
  if (!response.ok) return fallback;
  return response.json() as Promise<DoResponseBody<K>>;
}

async function doOptionalGet<K extends DoGetRoutes>(env: Env, uidHex: string, path: PathWithOptionalQuery<K>, fallback: DoResponseBody<K>): Promise<DoResponseBody<K>> {
  if (!env?.CARD_REPLAY) return fallback;
  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, path);
  return response.json() as Promise<DoResponseBody<K>>;
}

async function doOptionalPost<K extends DoPostRoutes>(env: Env, uidHex: string, path: K, body: DoRequestBody<K>, fallback: DoResponseBody<K>): Promise<DoResponseBody<K>> {
  if (!env?.CARD_REPLAY) return fallback;
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, path, body);
  return response.json() as Promise<DoResponseBody<K>>;
}

async function doOptionalVoidPost<K extends DoPostRoutes>(env: Env, uidHex: string, path: K, body: DoRequestBody<K>): Promise<void> {
  if (!env?.CARD_REPLAY) return;
  const stub = getCardStub(env, uidHex);
  await doPost(stub, path, body);
}

// --- Exported functions ---

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

export async function getAnalytics(env: Env, uidHex: string): Promise<AnalyticsResult> {
  return doSafeGet(env, uidHex, "/analytics", { ...EMPTY_ANALYTICS });
}

export async function getCardState(env: Env, uidHex: string): Promise<CardStateRow> {
  if (!env?.CARD_REPLAY) {
    return { state: CARD_STATE.NEW, latest_issued_version: 0, active_version: null, activated_at: null, terminated_at: null, keys_delivered_at: null, wipe_keys_fetched_at: null, balance: 0, counter: 0, key_provenance: null, key_fingerprint: null, key_label: null, first_seen_at: null, created_at: 0, updated_at: 0 };
  }
  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, "/card-state");
  if (response.status === 404) return legacyCardState;
  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO card-state error", { uidHex, error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.reason || payload.error || "Card state unavailable"));
  }
  return response.json() as Promise<CardStateRow>;
}

export async function getCardConfig(env: Env, uidHex: string): Promise<CardConfig | null> {
  return doSafeGet(env, uidHex, "/get-config", null);
}

export async function setCardConfig(env: Env, uidHex: string, config: Record<string, unknown>): Promise<void> {
  return doOptionalVoidPost(env, uidHex, "/set-config", config);
}

export async function setCardK2(env: Env, uidHex: string, k2: string): Promise<void> {
  return doOptionalVoidPost(env, uidHex, "/set-k2", { K2: k2 });
}

export async function debitCard(env: Env, uidHex: string, counter: number, amount: number, note: string): Promise<OpResult> {
  return doOptionalPost(env, uidHex, "/debit", { counter, amount, note }, { ok: false, reason: "DO not available" });
}

export async function creditCard(env: Env, uidHex: string, amount: number, note: string): Promise<OpResult> {
  return doOptionalPost(env, uidHex, "/credit", { amount, note }, { ok: false, reason: "DO not available" });
}

export async function voidTransaction(env: Env, uidHex: string, transactionId: number): Promise<VoidResult> {
  return doOptionalPost(env, uidHex, "/void", { transactionId }, { ok: false, reason: "DO not available" });
}

export async function getBalance(env: Env, uidHex: string): Promise<BalanceResult> {
  return doOptionalGet(env, uidHex, "/balance", { balance: 0 });
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
  return doOptionalGet(env, uidHex, `/transactions?limit=${limit}`, { transactions: [] });
}

export async function deliverKeys(env: Env, uidHex: string): Promise<CardStateRow & { version: number }> {
  const result = await doStateTransition(env, uidHex, "/deliver-keys", {}, "Key delivery failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.KEYS_DELIVERED, latest_issued_version: 1, version: 1 },
    indexMetadata: { state: CARD_STATE.KEYS_DELIVERED },
  });
  // Persist K2 for the delivered version so future taps use the correct key
  // (without this, re-provisioned cards retain stale K2 from the previous version)
  try {
    const keys = getDeterministicKeys(uidHex, env, result.version);
    await setCardK2(env, uidHex, keys.k2);
  } catch (e: unknown) {
    logger.warn("Failed to persist K2 after deliverKeys", { uidHex, version: result.version, error: getErrorMessage(e) });
  }
  return result;
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

export async function markPending(env: Env, uidHex: string, { key_provenance, key_fingerprint, key_label }: { key_provenance?: string; key_fingerprint?: string; key_label?: string } = {}): Promise<MarkPendingResult> {
  return doStateTransition(env, uidHex, "/mark-pending", {
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
  return doStateTransition(env, uidHex, "/discover", {
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

const EMPTY_EXPORT: CardExportData = Object.freeze({
  version: 1,
  exported_at: 0,
  replay_state: null,
  card_state: null,
  card_config: null,
  taps: [],
  transactions: [],
});

export async function exportCardState(env: Env, uidHex: string): Promise<CardExportData> {
  return doSafeGet(env, uidHex, "/export-state", { ...EMPTY_EXPORT });
}

export async function importCardState(env: Env, uidHex: string, data: CardExportData): Promise<ImportResult> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/import-state", data);
  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO import error", { uidHex, error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.error || "Card state import failed"));
  }
  return response.json() as Promise<ImportResult>;
}
