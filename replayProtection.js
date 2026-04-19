export async function enforceReplayProtection(env, uidHex, counterValue) {
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
