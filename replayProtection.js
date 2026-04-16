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
