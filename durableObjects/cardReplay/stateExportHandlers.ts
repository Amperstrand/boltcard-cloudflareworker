import type { CardExportData, ImportResult } from "./routes.js";

export function handleExportState(sql: SqlStorage): Response {
  const replayStateRows = sql.exec("SELECT * FROM replay_state WHERE singleton = 1").toArray();
  const cardStateRows = sql.exec("SELECT * FROM card_state WHERE singleton = 1").toArray();
  const cardConfigRows = sql.exec("SELECT * FROM card_config WHERE singleton = 1").toArray();
  const taps = sql.exec("SELECT * FROM taps").toArray();
  const transactions = sql.exec("SELECT * FROM transactions").toArray();

  const data: CardExportData = {
    version: 1,
    exported_at: Date.now(),
    replay_state: replayStateRows[0] ?? null,
    card_state: cardStateRows[0] ?? null,
    card_config: cardConfigRows[0] ?? null,
    taps,
    transactions,
  };

  return Response.json(data);
}

export async function handleImportState(sql: SqlStorage, request: Request): Promise<Response> {
  const body = await request.json() as CardExportData;

  if (body.version !== 1) {
    return Response.json({ error: "Unsupported export version" }, { status: 400 });
  }

  sql.exec("DELETE FROM taps");
  sql.exec("DELETE FROM transactions");
  sql.exec("DELETE FROM replay_state WHERE singleton = 1");
  sql.exec("DELETE FROM card_state WHERE singleton = 1");
  sql.exec("DELETE FROM card_config WHERE singleton = 1");

  let replayCount = 0;
  let cardStateCount = 0;
  let cardConfigCount = 0;
  let tapsCount = 0;
  let txnsCount = 0;

  if (body.replay_state) {
    const r = body.replay_state;
    sql.exec(
      "INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)",
      r.last_counter
    );
    replayCount = 1;
  }

  if (body.card_state) {
    const c = body.card_state;
    sql.exec(
      `INSERT INTO card_state (
        singleton, state, latest_issued_version, active_version,
        activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at,
        balance, key_provenance, key_fingerprint, key_label, first_seen_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.state, c.latest_issued_version, c.active_version ?? null,
      c.activated_at ?? null, c.terminated_at ?? null,
      c.keys_delivered_at ?? null, c.wipe_keys_fetched_at ?? null,
      c.balance ?? 0, c.key_provenance ?? null,
      c.key_fingerprint ?? null, c.key_label ?? null, c.first_seen_at ?? null
    );
    cardStateCount = 1;
  }

  if (body.card_config) {
    const cfg = body.card_config;
    sql.exec(
      `INSERT INTO card_config (
        singleton, K2, payment_method, config_json, pull_payment_id, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?)`,
      cfg.K2 ?? null, cfg.payment_method ?? "fakewallet",
      cfg.config_json ?? null, cfg.pull_payment_id ?? null,
      cfg.updated_at ?? null
    );
    cardConfigCount = 1;
  }

  if (Array.isArray(body.taps)) {
    for (const t of body.taps) {
      sql.exec(
        `INSERT INTO taps (
          counter, bolt11, status, payment_hash, amount_msat,
          user_agent, request_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.counter, t.bolt11 ?? null, t.status ?? "pending",
        t.payment_hash ?? null, t.amount_msat ?? null,
        t.user_agent ?? null, t.request_url ?? null,
        t.created_at, t.updated_at
      );
      tapsCount++;
    }
  }

  if (Array.isArray(body.transactions)) {
    for (const t of body.transactions) {
      sql.exec(
        `INSERT INTO transactions (
          id, counter, amount, balance_after, created_at, note, voided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        t.id, t.counter ?? null, t.amount, t.balance_after,
        t.created_at, t.note ?? null, t.voided_at ?? null
      );
      txnsCount++;
    }
  }

  const result: ImportResult = {
    restored: true,
    tables: {
      replay_state: replayCount,
      card_state: cardStateCount,
      card_config: cardConfigCount,
      taps: tapsCount,
      transactions: txnsCount,
    },
  };

  return Response.json(result);
}
