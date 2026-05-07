import { CARD_STATE_COLS } from "./schema.js";
import type { DeliverKeysPayload, DiscoverPayload, DoCardStateRow, SetProvenancePayload } from "./types.js";
import { nowSec } from "./types.js";

export function handleGetCardState(sql: SqlStorage): Response {
  const rows = sql.exec(
    `SELECT ${CARD_STATE_COLS}
     FROM card_state WHERE singleton = 1`
  ).toArray();
  if (rows.length === 0) {
    return Response.json({
      state: "new",
      latest_issued_version: 0,
      active_version: null,
      activated_at: null,
      terminated_at: null,
      keys_delivered_at: null,
      wipe_keys_fetched_at: null,
      balance: 0,
      key_provenance: null,
      key_fingerprint: null,
      key_label: null,
      first_seen_at: null,
    });
  }
  return Response.json(rows[0]);
}

export function handleDeliverKeys(sql: SqlStorage): Response {
  const now = nowSec();
  const rows = sql.exec(
    `INSERT INTO card_state (
       singleton,
       state,
       latest_issued_version,
       active_version,
       activated_at,
       terminated_at,
       keys_delivered_at,
       wipe_keys_fetched_at,
       balance,
       first_seen_at
      )
     VALUES (1, 'keys_delivered', 1, NULL, NULL, NULL, ?, NULL, 0, COALESCE((SELECT first_seen_at FROM card_state WHERE singleton = 1), ?))
     ON CONFLICT(singleton) DO UPDATE SET
       state = 'keys_delivered',
       latest_issued_version = card_state.latest_issued_version + 1,
       active_version = NULL,
       activated_at = NULL,
       terminated_at = NULL,
       keys_delivered_at = excluded.keys_delivered_at,
       wipe_keys_fetched_at = NULL
      RETURNING ${CARD_STATE_COLS}`,
    now, now
  );
  const cardState: DoCardStateRow = rows.toArray()[0] as DoCardStateRow;
  return Response.json({ ...cardState, version: cardState.latest_issued_version });
}

export async function handleActivate(sql: SqlStorage, request: Request): Promise<Response> {
  const { active_version } = await request.json() as DeliverKeysPayload;
  if (!Number.isInteger(active_version) || active_version < 1) {
    return Response.json({ error: "Invalid active_version" }, { status: 400 });
  }
  const now = nowSec();
  const rows = sql.exec(
    `INSERT INTO card_state (
       singleton,
       state,
       latest_issued_version,
       active_version,
       activated_at,
       terminated_at,
       keys_delivered_at,
       wipe_keys_fetched_at,
       balance
     )
     VALUES (1, 'active', ?, ?, ?, NULL, NULL, NULL, 0)
     ON CONFLICT(singleton) DO UPDATE SET
         state = 'active',
         active_version = excluded.active_version,
         activated_at = excluded.activated_at,
         terminated_at = NULL
      RETURNING ${CARD_STATE_COLS}`,
    active_version,
    active_version,
    now
  );
  return Response.json(rows.toArray()[0]);
}

export function handleRequestWipe(sql: SqlStorage): Response {
  const now = nowSec();
  const rows = sql.exec(
     `UPDATE card_state SET
        state = 'wipe_requested',
        wipe_keys_fetched_at = ?
      WHERE singleton = 1
      RETURNING ${CARD_STATE_COLS}`,
    now
  );
  const result = rows.toArray();
  if (result.length === 0) {
    return Response.json({ state: "new" }, { status: 404 });
  }
  return Response.json(result[0]);
}

export function handleTerminate(sql: SqlStorage): Response {
  const now = nowSec();
  const rows = sql.exec(
    `INSERT INTO card_state (singleton, state, latest_issued_version, terminated_at, balance)
     VALUES (1, 'terminated', 0, ?, 0)
     ON CONFLICT(singleton) DO UPDATE SET
          state = 'terminated',
          terminated_at = excluded.terminated_at
      RETURNING ${CARD_STATE_COLS}`,
    now
  );
  sql.exec("DELETE FROM taps");
  sql.exec("DELETE FROM replay_state WHERE singleton = 1");
  return Response.json(rows.toArray()[0]);
}

export async function handleMarkPending(sql: SqlStorage, request: Request): Promise<Response> {
  const { key_provenance, key_fingerprint, key_label } = await request.json() as SetProvenancePayload;
  const now = nowSec();
  const existing = sql.exec(
    `SELECT state FROM card_state WHERE singleton = 1`
  ).toArray();

  if (existing.length > 0) {
    return Response.json({
      state: existing[0]!.state,
      already_exists: true,
    });
  }

  sql.exec(
    `INSERT INTO card_state (singleton, state, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
     VALUES (1, 'pending', 0, ?, ?, ?, ?)`,
    key_provenance || null,
    key_fingerprint || null,
    key_label || null,
    now
  );

  return Response.json({
    state: "pending",
    key_provenance: key_provenance || null,
    key_fingerprint: key_fingerprint || null,
    key_label: key_label || null,
    first_seen_at: now,
  });
}

export async function handleDiscover(sql: SqlStorage, request: Request): Promise<Response> {
  const { key_provenance, key_fingerprint, key_label, active_version } = await request.json() as DiscoverPayload;
  const now = nowSec();
  const version: number = active_version || 1;

  const existing = sql.exec(
    `SELECT state, key_provenance, key_fingerprint, key_label, first_seen_at FROM card_state WHERE singleton = 1`
  ).toArray();

  if (existing.length > 0) {
    const current = existing[0] as Record<string, unknown>;
    if (current.state === "pending" || current.state === "new" || current.state === "legacy") {
      sql.exec(
        `UPDATE card_state SET
           state = 'discovered',
           active_version = ?,
           key_provenance = COALESCE(?, key_provenance),
           key_fingerprint = COALESCE(?, key_fingerprint),
           key_label = COALESCE(?, key_label)
         WHERE singleton = 1`,
        version,
        key_provenance || null,
        key_fingerprint || null,
        key_label || null
      );
    }
    const updated = sql.exec(
      `SELECT ${CARD_STATE_COLS} FROM card_state WHERE singleton = 1`
    ).toArray();
    return Response.json({ ...updated[0], already_exists: true });
  }

  sql.exec(
    `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
     VALUES (1, 'discovered', ?, ?, 0, ?, ?, ?, ?)`,
    version,
    version,
    key_provenance || null,
    key_fingerprint || null,
    key_label || null,
    now
  );

  return Response.json({
    state: "discovered",
    latest_issued_version: version,
    active_version: version,
    key_provenance: key_provenance || null,
    key_fingerprint: key_fingerprint || null,
    key_label: key_label || null,
    first_seen_at: now,
  });
}
