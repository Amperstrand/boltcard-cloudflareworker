import { logger } from "./utils/logger.js";
import { DEFAULT_TAP_LIMIT, DEFAULT_TXN_LIMIT, CARD_STATE } from "./utils/constants.js";
import { indexCard } from "./utils/cardIndex.js";

const EMPTY_ANALYTICS: Record<string, number> = Object.freeze({
  totalMsat: 0, completedMsat: 0, failedMsat: 0,
  totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0,
});

const legacyCardState: Record<string, any> = {
  state: CARD_STATE.LEGACY,
  latest_issued_version: 0,
  active_version: null,
  activated_at: null,
  terminated_at: null,
  keys_delivered_at: null,
  wipe_keys_fetched_at: null,
  balance: 0,
};

export function resolveActiveVersion(cardState: any): number {
  return cardState.active_version || cardState.latest_issued_version || 1;
}

export function resolveLatestVersion(cardState: any): number {
  return cardState.latest_issued_version || cardState.active_version || 1;
}

async function doStateTransition(env: any, uidHex: string, path: string, body: Record<string, any>, errorMsg: string, { legacyFallback, indexMetadata }: { legacyFallback?: Record<string, any>; indexMetadata?: Record<string, any> } = {}): Promise<any> {
  requireDo(env);
  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, path, body);

  if (response.status === 404) {
    return legacyFallback || { ...legacyCardState };
  }

  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    throw new Error(payload.error || errorMsg);
  }

  const result: any = await response.json();

  if (indexMetadata) {
    await indexCard(env, uidHex, indexMetadata);
  }

  return result;
}

function getCardStub(env: any, uidHex: string): any {
  const id: any = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  return env.CARD_REPLAY.get(id);
}

function requireDo(env: any): void {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }
}

function doGet(stub: any, path: string): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`));
}

function doPost(stub: any, path: string, body: Record<string, any>): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function checkAndAdvanceCounter(env: any, uidHex: string, counterValue: number): Promise<any> {
  requireDo(env);
  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, "/check", { counterValue });

  const payload: any = await response.json();

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Replay protection check failed");
}

export async function recordTapRead(env: any, uidHex: string, counterValue: number | null, { userAgent, requestUrl }: { userAgent?: string | null; requestUrl?: string } = {}): Promise<void> {
  if (!env?.CARD_REPLAY) return;

  const stub: any = getCardStub(env, uidHex);
  await doPost(stub, "/record-read", { counterValue, userAgent, requestUrl })
    .catch((e: any) => logger.warn("Failed to record tap read", { uidHex, counterValue, error: e.message }));
}

export async function recordTap(env: any, uidHex: string, counterValue: number, { bolt11, amountMsat, userAgent, requestUrl }: { bolt11?: string; amountMsat?: number; userAgent?: string | null; requestUrl?: string } = {}): Promise<any> {
  requireDo(env);
  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, "/record-tap", { counterValue, bolt11, amountMsat, userAgent, requestUrl });

  const payload: any = await response.json();

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Tap recording failed");
}

export async function updateTapStatus(env: any, uidHex: string, counter: number, status: string, meta: Record<string, any> = {}): Promise<void> {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub: any = getCardStub(env, uidHex);
  await doPost(stub, "/update-tap-status", { counter, status, ...meta });
}

export async function listTaps(env: any, uidHex: string, limit: number = DEFAULT_TAP_LIMIT): Promise<any> {
  if (!env?.CARD_REPLAY) {
    return { taps: [] };
  }

  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, `/list-taps?limit=${limit}`);

  if (!response.ok) {
    return { taps: [] };
  }

  return response.json();
}

export async function claimTap(env: any, uidHex: string, counterValue: number, { bolt11, amountMsat }: { bolt11?: string; amountMsat?: number } = {}): Promise<any> {
  if (!env?.CARD_REPLAY) {
    return { claimed: false };
  }
  const stub: any = getCardStub(env, uidHex);
  const resp: Response = await doPost(stub, "/claim-tap", { counter: counterValue, bolt11: bolt11 || null, amountMsat: amountMsat ?? null });
  return resp.json();
}

export async function resetReplayProtection(env: any, uidHex: string): Promise<void> {
  requireDo(env);
  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, "/reset", {});

  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    throw new Error(payload.reason || "Replay protection reset failed");
  }
}

export async function getAnalytics(env: any, uidHex: string): Promise<any> {
  if (!env?.CARD_REPLAY) {
    return { ...EMPTY_ANALYTICS };
  }

  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, "/analytics");

  if (!response.ok) {
    return { ...EMPTY_ANALYTICS };
  }

  return response.json();
}

export async function getCardState(env: any, uidHex: string): Promise<any> {
  if (!env?.CARD_REPLAY) {
    return { state: CARD_STATE.NEW, latest_issued_version: 0, active_version: null, activated_at: null, terminated_at: null, keys_delivered_at: null, wipe_keys_fetched_at: null, balance: 0 };
  }

  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, "/card-state");

  if (response.status === 404) {
    return legacyCardState;
  }

  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    throw new Error(payload.reason || payload.error || "Card state unavailable");
  }

  return response.json();
}

export async function deliverKeys(env: any, uidHex: string): Promise<any> {
  return doStateTransition(env, uidHex, "/deliver-keys", {}, "Key delivery failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.KEYS_DELIVERED, latest_issued_version: 1, version: 1 },
    indexMetadata: { state: CARD_STATE.KEYS_DELIVERED },
  });
}

export async function activateCard(env: any, uidHex: string, activeVersion: number): Promise<any> {
  return doStateTransition(env, uidHex, "/activate", { active_version: activeVersion }, "Card activation failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.ACTIVE, active_version: activeVersion },
    indexMetadata: { state: CARD_STATE.ACTIVE },
  });
}

export async function terminateCard(env: any, uidHex: string): Promise<any> {
  return doStateTransition(env, uidHex, "/terminate", {}, "Card termination failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.TERMINATED },
    indexMetadata: { state: CARD_STATE.TERMINATED },
  });
}

export async function requestWipe(env: any, uidHex: string): Promise<any> {
  return doStateTransition(env, uidHex, "/request-wipe", {}, "Wipe request failed", {
    legacyFallback: { state: CARD_STATE.NEW },
  });
}

export async function getCardConfig(env: any, uidHex: string): Promise<any> {
  if (!env?.CARD_REPLAY) {
    return null;
  }

  const stub: any = getCardStub(env, uidHex);
  const response: Response = await doGet(stub, "/get-config");

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export async function setCardConfig(env: any, uidHex: string, config: Record<string, any>): Promise<void> {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub: any = getCardStub(env, uidHex);
  await doPost(stub, "/set-config", config);
}

export async function setCardK2(env: any, uidHex: string, k2: string): Promise<void> {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub: any = getCardStub(env, uidHex);
  await doPost(stub, "/set-k2", { K2: k2 });
}

export async function debitCard(env: any, uidHex: string, counter: number, amount: number, note: string): Promise<any> {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const stub: any = getCardStub(env, uidHex);
  const resp: Response = await doPost(stub, "/debit", { counter, amount, note });
  return resp.json();
}

export async function creditCard(env: any, uidHex: string, amount: number, note: string): Promise<any> {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const stub: any = getCardStub(env, uidHex);
  const resp: Response = await doPost(stub, "/credit", { amount, note });
  return resp.json();
}

export async function getBalance(env: any, uidHex: string): Promise<any> {
  if (!env?.CARD_REPLAY) return { balance: 0 };
  const stub: any = getCardStub(env, uidHex);
  const resp: Response = await doGet(stub, "/balance");
  return resp.json();
}

export async function safeGetBalance(env: any, uidHex: string): Promise<{ balance: number }> {
  try {
    const result: any = await getBalance(env, uidHex);
    return { balance: result.balance || 0 };
  } catch (e: any) {
    logger.warn("Could not fetch balance", { uidHex, error: e.message });
    return { balance: 0 };
  }
}

export async function listTransactions(env: any, uidHex: string, limit: number = DEFAULT_TXN_LIMIT): Promise<any> {
  if (!env?.CARD_REPLAY) return { transactions: [] };
  const stub: any = getCardStub(env, uidHex);
  const resp: Response = await doGet(stub, `/transactions?limit=${limit}`);
  return resp.json();
}

export async function markPending(env: any, uidHex: string, { key_provenance, key_fingerprint, key_label }: { key_provenance?: string; key_fingerprint?: string; key_label?: string } = {}): Promise<any> {
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

export async function discoverCard(env: any, uidHex: string, { key_provenance, key_fingerprint, key_label, active_version }: { key_provenance?: string; key_fingerprint?: string; key_label?: string; active_version?: number } = {}): Promise<any> {
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
