import { logger } from "./utils/logger.js";
import { DEFAULT_TAP_LIMIT, DEFAULT_TXN_LIMIT } from "./utils/constants.js";

const legacyCardState = {
  state: "legacy",
  latest_issued_version: 0,
  active_version: null,
  activated_at: null,
  terminated_at: null,
  keys_delivered_at: null,
  wipe_keys_fetched_at: null,
  balance: 0,
};

function getCardStub(env, uidHex) {
  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  return env.CARD_REPLAY.get(id);
}

function requireDo(env) {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }
}

function doGet(stub, path) {
  return stub.fetch(new Request(`https://card-replay.internal${path}`));
}

function doPost(stub, path, body) {
  return stub.fetch(new Request(`https://card-replay.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function checkAndAdvanceCounter(env, uidHex, counterValue) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/check", { counterValue });

  const payload = await response.json();

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Replay protection check failed");
}

export async function recordTapRead(env, uidHex, counterValue, { userAgent, requestUrl } = {}) {
  if (!env?.CARD_REPLAY) return;

  const stub = getCardStub(env, uidHex);
  await doPost(stub, "/record-read", { counterValue, userAgent, requestUrl })
    .catch(e => logger.warn("Failed to record tap read", { uidHex, counterValue, error: e.message }));
}

export async function recordTap(env, uidHex, counterValue, { bolt11, amountMsat, userAgent, requestUrl } = {}) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/record-tap", { counterValue, bolt11, amountMsat, userAgent, requestUrl });

  const payload = await response.json();

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Tap recording failed");
}

export async function updateTapStatus(env, uidHex, counter, status, meta = {}) {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub = getCardStub(env, uidHex);
  await doPost(stub, "/update-tap-status", { counter, status, ...meta });
}

export async function listTaps(env, uidHex, limit = DEFAULT_TAP_LIMIT) {
  if (!env?.CARD_REPLAY) {
    return { taps: [] };
  }

  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, `/list-taps?limit=${limit}`);

  if (!response.ok) {
    return { taps: [] };
  }

  return response.json();
}

export async function resetReplayProtection(env, uidHex) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/reset", {});

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.reason || "Replay protection reset failed");
  }
}

export async function getAnalytics(env, uidHex) {
  if (!env?.CARD_REPLAY) {
    return { totalMsat: 0, completedMsat: 0, failedMsat: 0, totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0 };
  }

  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, "/analytics");

  if (!response.ok) {
    return { totalMsat: 0, completedMsat: 0, failedMsat: 0, totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0 };
  }

  return response.json();
}

export async function getCardState(env, uidHex) {
  if (!env?.CARD_REPLAY) {
    return { state: "new", latest_issued_version: 0, active_version: null, activated_at: null, terminated_at: null, keys_delivered_at: null, wipe_keys_fetched_at: null, balance: 0 };
  }

  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, "/card-state");

  if (response.status === 404) {
    return legacyCardState;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.reason || payload.error || "Card state unavailable");
  }

  return response.json();
}

export async function deliverKeys(env, uidHex) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/deliver-keys", {});

  if (response.status === 404) {
    return { ...legacyCardState, state: "keys_delivered", latest_issued_version: 1, version: 1 };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Key delivery failed");
  }

  return response.json();
}

export async function activateCard(env, uidHex, activeVersion) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/activate", { active_version: activeVersion });

  if (response.status === 404) {
    return { ...legacyCardState, state: "active", active_version: activeVersion };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Card activation failed");
  }

  return response.json();
}

export async function terminateCard(env, uidHex) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/terminate", {});

  if (response.status === 404) {
    return { ...legacyCardState, state: "terminated" };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Card termination failed");
  }

  return response.json();
}

export async function requestWipe(env, uidHex) {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, "/request-wipe", {});

  if (response.status === 404) {
    return { state: "new" };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Wipe request failed");
  }

  return response.json();
}

export async function getCardConfig(env, uidHex) {
  if (!env?.CARD_REPLAY) {
    return null;
  }

  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, "/get-config");

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export async function setCardConfig(env, uidHex, config) {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const stub = getCardStub(env, uidHex);
  await doPost(stub, "/set-config", config);
}

export async function debitCard(env, uidHex, counter, amount, note) {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const stub = getCardStub(env, uidHex);
  const resp = await doPost(stub, "/debit", { counter, amount, note });
  return resp.json();
}

export async function creditCard(env, uidHex, amount, note) {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const stub = getCardStub(env, uidHex);
  const resp = await doPost(stub, "/credit", { amount, note });
  return resp.json();
}

export async function getBalance(env, uidHex) {
  if (!env?.CARD_REPLAY) return { balance: 0 };
  const stub = getCardStub(env, uidHex);
  const resp = await doGet(stub, "/balance");
  return resp.json();
}

export async function listTransactions(env, uidHex, limit = DEFAULT_TXN_LIMIT) {
  if (!env?.CARD_REPLAY) return { transactions: [] };
  const stub = getCardStub(env, uidHex);
  const resp = await doGet(stub, `/transactions?limit=${limit}`);
  return resp.json();
}
