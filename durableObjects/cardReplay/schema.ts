export const CARD_STATE_COLS = "state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance, key_provenance, key_fingerprint, key_label, first_seen_at";

export function initCardReplaySchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS replay_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      last_counter INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS taps (
      counter INTEGER PRIMARY KEY,
      bolt11 TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_hash TEXT,
      amount_msat INTEGER,
      user_agent TEXT,
      request_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS card_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      state TEXT NOT NULL DEFAULT 'new',
      latest_issued_version INTEGER NOT NULL DEFAULT 0,
      active_version INTEGER,
      activated_at INTEGER,
      terminated_at INTEGER,
      keys_delivered_at INTEGER,
      wipe_keys_fetched_at INTEGER,
      balance INTEGER NOT NULL DEFAULT 0,
      key_provenance TEXT,
      key_fingerprint TEXT,
      key_label TEXT,
      first_seen_at INTEGER
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS card_config (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      K2 TEXT,
      payment_method TEXT NOT NULL DEFAULT 'fakewallet',
      config_json TEXT,
      pull_payment_id TEXT,
      updated_at INTEGER
    )
  `);
  try { sql.exec(`ALTER TABLE card_state ADD COLUMN key_provenance TEXT`); } catch (_e: unknown) {}
  try { sql.exec(`ALTER TABLE card_state ADD COLUMN key_fingerprint TEXT`); } catch (_e: unknown) {}
  try { sql.exec(`ALTER TABLE card_state ADD COLUMN key_label TEXT`); } catch (_e: unknown) {}
  try { sql.exec(`ALTER TABLE card_state ADD COLUMN first_seen_at INTEGER`); } catch (_e: unknown) {}
  sql.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      counter INTEGER,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      note TEXT
    )
  `);
  try { sql.exec(`ALTER TABLE transactions ADD COLUMN voided_at INTEGER`); } catch (_e: unknown) {}
}
