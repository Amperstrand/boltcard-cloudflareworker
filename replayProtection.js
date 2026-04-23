import { logger } from "./utils/logger.js";

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

export async function checkReplayOnly(env, uidHex, counterValue) {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/check-readonly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue }),
    })
  );

  const payload = await response.json();

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Replay protection check failed");
}

export async function checkAndAdvanceCounter(env, uidHex, counterValue) {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue }),
    })
  );

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

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  // Intentional catch: recording is auditing-only, must not block the payment flow.
  // Callers still await this to ensure the attempt completes before proceeding.
  await stub.fetch(
    new Request("https://card-replay.internal/record-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue, userAgent, requestUrl }),
    })
  ).catch(e => logger.warn("Failed to record tap read", { uidHex, counterValue, error: e.message }));
}

export async function recordTap(env, uidHex, counterValue, { bolt11, amountMsat, userAgent, requestUrl } = {}) {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/record-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counterValue, bolt11, amountMsat, userAgent, requestUrl }),
    })
  );

  const payload = await response.json();

  if (response.ok && payload.accepted) {
    return payload;
  }

  if (response.status === 409) {
    return payload;
  }

  throw new Error(payload.reason || "Tap recording failed");
}

export async function updateTapStatus(env, uidHex, counter, status) {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  await stub.fetch(
    new Request("https://card-replay.internal/update-tap-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter, status }),
    })
  );
}

export async function listTaps(env, uidHex, limit = 50) {
  if (!env?.CARD_REPLAY) {
    return { taps: [] };
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request(`https://card-replay.internal/list-taps?limit=${limit}`)
  );

  if (!response.ok) {
    return { taps: [] };
  }

  return response.json();
}

export async function resetReplayProtection(env, uidHex) {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/reset", {
      method: "POST",
    })
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.reason || "Replay protection reset failed");
  }
}

export async function getAnalytics(env, uidHex) {
  if (!env?.CARD_REPLAY) {
    return { totalMsat: 0, completedMsat: 0, failedMsat: 0, totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0 };
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/analytics")
  );

  if (!response.ok) {
    return { totalMsat: 0, completedMsat: 0, failedMsat: 0, totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0 };
  }

  return response.json();
}

export async function getCardState(env, uidHex) {
  if (!env?.CARD_REPLAY) {
    return { state: "new", latest_issued_version: 0, active_version: null, activated_at: null, terminated_at: null, keys_delivered_at: null, wipe_keys_fetched_at: null, balance: 0 };
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/card-state")
  );

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
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/deliver-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
  );

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
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_version: activeVersion }),
    })
  );

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
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
  );

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
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/request-wipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
  );

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

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const response = await stub.fetch(
    new Request("https://card-replay.internal/get-config")
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export async function setCardConfig(env, uidHex, config) {
  if (!env?.CARD_REPLAY) {
    return;
  }

  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  await stub.fetch(
    new Request("https://card-replay.internal/set-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    })
  );
}

export async function debitCard(env, uidHex, counter, amount, note) {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const resp = await stub.fetch(
    new Request("https://card-replay.internal/debit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter, amount, note }),
    })
  );
  return resp.json();
}

export async function creditCard(env, uidHex, amount, note) {
  if (!env?.CARD_REPLAY) return { ok: false, reason: "DO not available" };
  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const resp = await stub.fetch(
    new Request("https://card-replay.internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, note }),
    })
  );
  return resp.json();
}

export async function getBalance(env, uidHex) {
  if (!env?.CARD_REPLAY) return { balance: 0 };
  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const resp = await stub.fetch(new Request("https://card-replay.internal/balance"));
  return resp.json();
}

export async function listTransactions(env, uidHex, limit = 50) {
  if (!env?.CARD_REPLAY) return { transactions: [] };
  const id = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  const stub = env.CARD_REPLAY.get(id);
  const resp = await stub.fetch(new Request(`https://card-replay.internal/transactions?limit=${limit}`));
  return resp.json();
}
