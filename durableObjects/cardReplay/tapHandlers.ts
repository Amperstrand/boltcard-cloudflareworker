import type { CheckCounterPayload, ClaimTapNoBolt11Payload, ClaimTapPayload, DoCardStateRow, RecordReadPayload, RecordTapPayload } from "./types.js";
import { nowSec } from "./types.js";

const VALID_TAP_STATUSES = ["read", "pending", "paying", "completed", "failed", "expired"];

export async function handleCheck(sql: SqlStorage, request: Request, readOnly: boolean): Promise<Response> {
  const { counterValue } = await request.json() as CheckCounterPayload;
  if (!Number.isInteger(counterValue) || counterValue < 0) {
    return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
  }

  if (readOnly) {
    const existing = sql.exec(
      "SELECT last_counter FROM replay_state WHERE singleton = 1"
    ).toArray();
    const lastCounter: number | null = (existing[0]?.last_counter as number) ?? null;

    if (lastCounter !== null && counterValue <= lastCounter) {
      return Response.json(
        { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
        { status: 409 }
      );
    }
    return Response.json({ accepted: true, lastCounter });
  }

  const updated = sql.exec(
    `
      INSERT INTO replay_state (singleton, last_counter)
      VALUES (1, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        last_counter = excluded.last_counter
      WHERE replay_state.last_counter < excluded.last_counter
      RETURNING last_counter
    `,
    counterValue
  ).toArray();

  if (updated.length === 1) {
    return Response.json({ accepted: true, lastCounter: updated[0]!.last_counter as number });
  }

  const existing = sql.exec(
    "SELECT last_counter FROM replay_state WHERE singleton = 1"
  ).toArray();
  const lastCounter: number | null = (existing[0]?.last_counter as number) ?? null;

  return Response.json(
    { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
    { status: 409 }
  );
}

export async function handleRecordTap(sql: SqlStorage, request: Request): Promise<Response> {
  const { counterValue, bolt11, amountMsat, userAgent, requestUrl } = await request.json() as RecordTapPayload;
  if (!Number.isInteger(counterValue) || counterValue < 0) {
    return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
  }

  const updated = sql.exec(
    `
      INSERT INTO replay_state (singleton, last_counter)
      VALUES (1, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        last_counter = excluded.last_counter
      WHERE replay_state.last_counter < excluded.last_counter
      RETURNING last_counter
    `,
    counterValue
  ).toArray();

  if (updated.length === 1) {
    const now = nowSec();
    sql.exec(
      `INSERT OR REPLACE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      counterValue,
      bolt11 || null,
      amountMsat || null,
      userAgent || null,
      requestUrl || null,
      now,
      now
    );

    return Response.json({ accepted: true, lastCounter: updated[0]!.last_counter as number, tapRecorded: true });
  }

  const existing = sql.exec(
    "SELECT last_counter FROM replay_state WHERE singleton = 1"
  ).toArray();
  const lastCounter: number | null = (existing[0]?.last_counter as number) ?? null;

  return Response.json(
    { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
    { status: 409 }
  );
}

export async function handleRecordRead(sql: SqlStorage, request: Request): Promise<Response> {
  const { counterValue, userAgent, requestUrl } = await request.json() as RecordReadPayload;
  const counter: number = (Number.isInteger(counterValue) && counterValue >= 0)
    ? counterValue
    : Date.now();

  const now = nowSec();
  sql.exec(
    `INSERT OR IGNORE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
     VALUES (?, NULL, 'read', NULL, ?, ?, ?, ?)`,
    counter,
    userAgent || null,
    requestUrl || null,
    now,
    now
  );

  return Response.json({ recorded: true });
}

export async function handleUpdateTapStatus(sql: SqlStorage, request: Request): Promise<Response> {
  const { counter, status, bolt11, amountMsat } = await request.json() as ClaimTapPayload;
  if (counter == null || !status) {
    return Response.json({ error: "Missing counter or status" }, { status: 400 });
  }

  if (!VALID_TAP_STATUSES.includes(status)) {
    return Response.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const now = nowSec();
  const updated = sql.exec(
    `UPDATE taps SET status = ?, updated_at = ?, bolt11 = COALESCE(?, bolt11), amount_msat = COALESCE(?, amount_msat) WHERE counter = ? RETURNING counter`,
    status,
    now,
    bolt11 ?? null,
    amountMsat ?? null,
    counter
  ).toArray();

  return Response.json({ updated: updated.length > 0 });
}

export async function handleClaimTap(sql: SqlStorage, request: Request): Promise<Response> {
  const { counter, bolt11, amountMsat } = await request.json() as ClaimTapNoBolt11Payload;
  if (!Number.isInteger(counter) || counter < 0) {
    return Response.json({ claimed: false, reason: "Invalid counter" }, { status: 400 });
  }

  const rows = sql.exec(
    `SELECT bolt11, status FROM taps WHERE counter = ?`,
    counter
  ).toArray();

  if (rows.length === 0) {
    const now = nowSec();
    sql.exec(
      `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, NULL, NULL, ?, ?)`,
      counter,
      bolt11 || null,
      amountMsat ?? null,
      now,
      now
    );
    return Response.json({ claimed: true });
  }

  const tap = rows[0]!;
  if (tap.bolt11) {
    return Response.json({ claimed: false, reason: "Tap already claimed", bolt11: tap.bolt11 }, { status: 409 });
  }

  const now = nowSec();
  sql.exec(
    `UPDATE taps SET bolt11 = ?, amount_msat = COALESCE(?, amount_msat), status = 'pending', updated_at = ? WHERE counter = ?`,
    bolt11 || null,
    amountMsat ?? null,
    now,
    counter
  );

  return Response.json({ claimed: true });
}

export function handleListTaps(sql: SqlStorage, url: URL): Response {
  let rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
  if (!Number.isFinite(rawLimit)) rawLimit = 50;
  const limit = Math.max(1, Math.min(rawLimit, 200));
  const taps = sql.exec(
    `SELECT counter, bolt11, status, payment_hash, amount_msat, user_agent, request_url, created_at, updated_at
     FROM taps ORDER BY counter DESC LIMIT ?`,
    limit
  ).toArray();

  const stateRows = sql.exec(
    `SELECT state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, key_provenance, key_fingerprint, key_label, first_seen_at
     FROM card_state WHERE singleton = 1`
  ).toArray();
  const cardState: DoCardStateRow | null = (stateRows[0] as DoCardStateRow) || null;

  const events: Record<string, unknown>[] = [];

  if (cardState) {
    if (cardState.keys_delivered_at) {
      events.push({ counter: null, bolt11: null, status: "provisioned", payment_hash: null, amount_msat: null, user_agent: null, request_url: null, created_at: cardState.keys_delivered_at, updated_at: cardState.keys_delivered_at, version: cardState.latest_issued_version });
    }
    if (cardState.activated_at) {
      events.push({ counter: null, bolt11: null, status: "activated", payment_hash: null, amount_msat: null, user_agent: null, request_url: null, created_at: cardState.activated_at, updated_at: cardState.activated_at, version: cardState.active_version });
    }
    if (cardState.terminated_at) {
      events.push({ counter: null, bolt11: null, status: "terminated", payment_hash: null, amount_msat: null, user_agent: null, request_url: null, created_at: cardState.terminated_at, updated_at: cardState.terminated_at, version: null });
    }
    if (cardState.wipe_keys_fetched_at) {
      events.push({ counter: null, bolt11: null, status: "wipe_requested", payment_hash: null, amount_msat: null, user_agent: null, request_url: null, created_at: cardState.wipe_keys_fetched_at, updated_at: cardState.wipe_keys_fetched_at, version: cardState.active_version });
    }
  }

  const merged = [...taps, ...events].sort((a, b) => {
    const timeDiff = ((b.created_at as number) || 0) - ((a.created_at as number) || 0);
    if (timeDiff !== 0) return timeDiff;
    return ((b.counter as number) || 0) - ((a.counter as number) || 0);
  });

  return Response.json({ taps: merged.slice(0, limit) });
}

export function handleAnalytics(sql: SqlStorage): Response {
  const stats = sql.exec(
    `SELECT
       COUNT(*) as totalTaps,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_msat ELSE 0 END), 0) as completedMsat,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN amount_msat ELSE 0 END), 0) as failedMsat,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_msat ELSE 0 END), 0) as pendingMsat,
       COALESCE(SUM(amount_msat), 0) as totalMsat,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTaps,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedTaps,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTaps
     FROM taps`
  ).toArray();

  return Response.json(stats[0] || {
    totalMsat: 0, completedMsat: 0, failedMsat: 0, pendingMsat: 0,
    totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0,
  });
}
