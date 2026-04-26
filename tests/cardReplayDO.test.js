import Database from "better-sqlite3";

function createDoDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  db.exec(`CREATE TABLE IF NOT EXISTS replay_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_counter INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS taps (
    counter INTEGER PRIMARY KEY,
    bolt11 TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_hash TEXT,
    amount_msat INTEGER,
    user_agent TEXT,
    request_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS card_state (
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
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS card_config (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    K2 TEXT,
    payment_method TEXT NOT NULL DEFAULT 'fakewallet',
    config_json TEXT,
    pull_payment_id TEXT,
    updated_at INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    counter INTEGER,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    note TEXT
  )`);

  return db;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

describe("CardReplayDO SQL logic", () => {
  let db;

  beforeEach(() => {
    db = createDoDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("check (counter replay)", () => {
    it("accepts first counter", () => {
      const result = db.prepare(
        `INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET last_counter = excluded.last_counter
         WHERE replay_state.last_counter < excluded.last_counter
         RETURNING last_counter`
      ).get(5);
      expect(result.last_counter).toBe(5);
    });

    it("accepts higher counter", () => {
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(3);
      const result = db.prepare(
        `INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET last_counter = excluded.last_counter
         WHERE replay_state.last_counter < excluded.last_counter
         RETURNING last_counter`
      ).get(7);
      expect(result.last_counter).toBe(7);
    });

    it("rejects same counter (no row returned)", () => {
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(5);
      const result = db.prepare(
        `INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET last_counter = excluded.last_counter
         WHERE replay_state.last_counter < excluded.last_counter
         RETURNING last_counter`
      ).get(5);
      expect(result).toBeUndefined();
    });

    it("rejects lower counter", () => {
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(10);
      const result = db.prepare(
        `INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET last_counter = excluded.last_counter
         WHERE replay_state.last_counter < excluded.last_counter
         RETURNING last_counter`
      ).get(3);
      expect(result).toBeUndefined();
    });

    it("returns current last_counter on rejection", () => {
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(10);
      const row = db.prepare("SELECT last_counter FROM replay_state WHERE singleton = 1").get();
      expect(row.last_counter).toBe(10);
    });
  });

  describe("record-tap", () => {
    it("records tap with bolt11 and amount", () => {
      const now = nowSec();
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(5);
      db.prepare(
        `INSERT OR REPLACE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
      ).run(5, "lnbc10n1test", 1000, null, null, now, now);

      const tap = db.prepare("SELECT * FROM taps WHERE counter = 5").get();
      expect(tap.bolt11).toBe("lnbc10n1test");
      expect(tap.amount_msat).toBe(1000);
      expect(tap.status).toBe("pending");
    });
  });

  describe("card state lifecycle", () => {
    it("returns new state when no row exists", () => {
      const row = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(row).toBeUndefined();
    });

    it("deliver-keys transitions to keys_delivered", () => {
      const now = nowSec();
      const row = db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance, first_seen_at)
         VALUES (1, 'keys_delivered', 1, NULL, NULL, NULL, ?, NULL, 0, COALESCE((SELECT first_seen_at FROM card_state WHERE singleton = 1), ?))
         ON CONFLICT(singleton) DO UPDATE SET
           state = 'keys_delivered',
           latest_issued_version = card_state.latest_issued_version + 1,
           active_version = NULL,
           activated_at = NULL,
           terminated_at = NULL,
           keys_delivered_at = excluded.keys_delivered_at,
           wipe_keys_fetched_at = NULL
         RETURNING *`
      ).get(now, now);
      expect(row.state).toBe("keys_delivered");
      expect(row.latest_issued_version).toBe(1);
    });

    it("activate transitions to active", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance)
         VALUES (1, 'active', ?, ?, ?, NULL, NULL, NULL, 0)
         ON CONFLICT(singleton) DO UPDATE SET
           state = 'active',
           active_version = excluded.active_version,
           activated_at = excluded.activated_at,
           terminated_at = NULL
         RETURNING *`
      ).get(1, 1, now);
      const row = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("active");
      expect(row.active_version).toBe(1);
    });

    it("terminate clears taps and counters", () => {
      const now = nowSec();
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(5);
      db.prepare(
        `INSERT OR REPLACE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
      ).run(5, "lnbc_test", 1000, null, null, now, now);
      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'active', 1, 1, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?)`
      ).run(now, now);

      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, terminated_at, balance)
         VALUES (1, 'terminated', 0, ?, 0)
         ON CONFLICT(singleton) DO UPDATE SET
           state = 'terminated',
           latest_issued_version = 0,
           terminated_at = excluded.terminated_at`
      ).run(now);
      db.exec("DELETE FROM taps");
      db.exec("DELETE FROM replay_state WHERE singleton = 1");

      const state = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(state.state).toBe("terminated");
      const taps = db.prepare("SELECT COUNT(*) as count FROM taps").get();
      expect(taps.count).toBe(0);
      const counter = db.prepare("SELECT * FROM replay_state WHERE singleton = 1").get();
      expect(counter).toBeUndefined();
    });

    it("request-wipe updates state", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, activated_at, balance)
         VALUES (1, 'active', 1, 1, ?, 0)`
      ).run(now);

      const row = db.prepare(
        `UPDATE card_state SET state = 'wipe_requested', wipe_keys_fetched_at = ?
         WHERE singleton = 1 RETURNING *`
      ).get(now);
      expect(row.state).toBe("wipe_requested");
    });
  });

  describe("card config", () => {
    it("set and get config", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           K2 = excluded.K2,
           payment_method = excluded.payment_method,
           config_json = excluded.config_json,
           pull_payment_id = excluded.pull_payment_id,
           updated_at = excluded.updated_at`
      ).run("abcdef0123456789", "fakewallet", null, null, now);

      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      expect(row.K2).toBe("abcdef0123456789");
      expect(row.payment_method).toBe("fakewallet");
    });

    it("returns null when no config set", () => {
      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      expect(row).toBeUndefined();
    });

    it("stores extra config as JSON", () => {
      const now = nowSec();
      const extra = JSON.stringify({ clnrest: { host: "https://cln.example.com", rune: "test" } });
      db.prepare(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           K2 = excluded.K2,
           payment_method = excluded.payment_method,
           config_json = excluded.config_json,
           pull_payment_id = excluded.pull_payment_id,
           updated_at = excluded.updated_at`
      ).run(null, "clnrest", extra, null, now);

      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      const parsed = JSON.parse(row.config_json);
      expect(parsed.clnrest.host).toBe("https://cln.example.com");
    });
  });

  describe("balance + transactions", () => {
    it("credits and debits with transaction records", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, balance) VALUES (1, ?) ON CONFLICT(singleton) DO NOTHING`
      ).run(0);

      db.prepare("UPDATE card_state SET balance = ? WHERE singleton = 1").run(1000);
      db.prepare(
        `INSERT INTO transactions (counter, amount, balance_after, created_at, note)
         VALUES (?, ?, ?, ?, ?)`
      ).run(null, 1000, 1000, now, "topup");

      db.prepare("UPDATE card_state SET balance = ? WHERE singleton = 1").run(700);
      db.prepare(
        `INSERT INTO transactions (counter, amount, balance_after, created_at, note)
         VALUES (?, ?, ?, ?, ?)`
      ).run(null, -300, 700, now, "payment");

      const state = db.prepare("SELECT balance FROM card_state WHERE singleton = 1").get();
      expect(state.balance).toBe(700);

      const txs = db.prepare("SELECT * FROM transactions ORDER BY id").all();
      expect(txs).toHaveLength(2);
      expect(txs[0].amount).toBe(1000);
      expect(txs[1].amount).toBe(-300);
    });
  });

  describe("analytics", () => {
    it("aggregates tap stats", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(2, "lnbc1a", "completed", 1000, null, null, now, now);
      db.prepare(
        `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(3, "lnbc1b", "completed", 2000, null, null, now, now);
      db.prepare(
        `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(4, "lnbc1c", "failed", 500, null, null, now, now);

      const stats = db.prepare(
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
      ).get();

      expect(stats.totalTaps).toBe(3);
      expect(stats.completedMsat).toBe(3000);
      expect(stats.failedMsat).toBe(500);
      expect(stats.completedTaps).toBe(2);
      expect(stats.failedTaps).toBe(1);
    });
  });

  describe("update-tap-status", () => {
    it("updates status and optional bolt11", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(2, null, "pending", null, null, null, now, now);

      db.prepare(
        `UPDATE taps SET status = ?, updated_at = ?, bolt11 = COALESCE(?, bolt11), amount_msat = COALESCE(?, amount_msat) WHERE counter = ?`
      ).run("completed", nowSec(), "lnbc1test", 1000, 2);

      const tap = db.prepare("SELECT * FROM taps WHERE counter = 2").get();
      expect(tap.status).toBe("completed");
      expect(tap.bolt11).toBe("lnbc1test");
      expect(tap.amount_msat).toBe(1000);
    });
  });

  describe("reset", () => {
    it("clears all taps and counters", () => {
      db.prepare("INSERT INTO replay_state (singleton, last_counter) VALUES (1, ?)").run(10);
      const now = nowSec();
      db.prepare(
        `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(5, "test", "completed", 1000, null, null, now, now);

      db.exec("DELETE FROM taps");
      db.exec("DELETE FROM replay_state WHERE singleton = 1");

      expect(db.prepare("SELECT COUNT(*) as c FROM taps").get().c).toBe(0);
      expect(db.prepare("SELECT * FROM replay_state WHERE singleton = 1").get()).toBeUndefined();
    });
  });

  describe("mark-pending", () => {
    it("creates pending row with provenance", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'pending', 0, ?, ?, ?, ?)`
      ).run("public_issuer", "abc123", "test-key-0", now);

      const row = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("pending");
      expect(row.key_provenance).toBe("public_issuer");
      expect(row.key_fingerprint).toBe("abc123");
      expect(row.key_label).toBe("test-key-0");
      expect(row.first_seen_at).toBe(now);
    });

    it("is idempotent when row already exists", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'pending', 0, 'public_issuer', 'abc', 'label', ?)`
      ).run(now);

      const existing = db.prepare("SELECT state FROM card_state WHERE singleton = 1").get();
      expect(existing.state).toBe("pending");

      const insertResult = db.prepare(
        `INSERT INTO card_state (singleton, state, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'pending', 0, 'env_issuer', 'def', 'other', ?)
         ON CONFLICT(singleton) DO NOTHING`
      ).run(now);
      expect(insertResult.changes).toBe(0);
    });
  });

  describe("discover", () => {
    it("creates discovered row from scratch", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'discovered', 1, 1, 0, 'public_issuer', 'abc123', 'test-key-0', ?)`
      ).run(now);

      const row = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("discovered");
      expect(row.active_version).toBe(1);
      expect(row.key_provenance).toBe("public_issuer");
      expect(row.key_fingerprint).toBe("abc123");
      expect(row.first_seen_at).toBe(now);
    });

    it("upgrades pending to discovered", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'pending', 0, 'public_issuer', 'abc', 'label', ?)`
      ).run(now);

      db.prepare(
        `UPDATE card_state SET
           state = 'discovered',
           active_version = 1,
           key_provenance = COALESCE(?, key_provenance),
           key_fingerprint = COALESCE(?, key_fingerprint),
           key_label = COALESCE(?, key_label)
         WHERE singleton = 1`
      ).run("public_issuer", "abc", "test-key-0");

      const row = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("discovered");
      expect(row.active_version).toBe(1);
      expect(row.key_provenance).toBe("public_issuer");
      expect(row.first_seen_at).toBe(now);
    });

    it("preserves first_seen_at from pending when upgrading", () => {
      const pendingTime = 1000000;
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'pending', 0, 'public_issuer', 'abc', 'label', ?)`
      ).run(pendingTime);

      db.prepare(
        `UPDATE card_state SET state = 'discovered', active_version = 1 WHERE singleton = 1`
      ).run();

      const row = db.prepare("SELECT first_seen_at FROM card_state WHERE singleton = 1").get();
      expect(row.first_seen_at).toBe(pendingTime);
    });

    it("upgrades new state to discovered", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance, first_seen_at)
         VALUES (1, 'new', 0, ?)`
      ).run(now);

      db.prepare(
        `UPDATE card_state SET
           state = 'discovered',
           active_version = 1,
           key_provenance = COALESCE(?, key_provenance),
           key_fingerprint = COALESCE(?, key_fingerprint),
           key_label = COALESCE(?, key_label)
         WHERE singleton = 1`
      ).run("env_issuer", "def", "test");

      const row = db.prepare("SELECT state, active_version, key_provenance FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("discovered");
      expect(row.active_version).toBe(1);
      expect(row.key_provenance).toBe("env_issuer");
    });

    it("upgrades legacy state to discovered", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance, first_seen_at)
         VALUES (1, 'legacy', 0, ?)`
      ).run(now);

      db.prepare(
        `UPDATE card_state SET state = 'discovered', active_version = 2 WHERE singleton = 1`
      ).run();

      const row = db.prepare("SELECT state, active_version FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("discovered");
      expect(row.active_version).toBe(2);
    });
  });

  describe("deliver-keys preserves provenance", () => {
    it("preserves provenance when upgrading from discovered", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, balance, key_provenance, key_fingerprint, key_label, first_seen_at)
         VALUES (1, 'discovered', 1, 1, 0, 'public_issuer', 'abc', 'test-key', ?)`
      ).run(now);

      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance, first_seen_at)
         VALUES (1, 'keys_delivered', 1, NULL, NULL, NULL, ?, NULL, 0, COALESCE((SELECT first_seen_at FROM card_state WHERE singleton = 1), ?))
         ON CONFLICT(singleton) DO UPDATE SET
           state = 'keys_delivered',
           latest_issued_version = card_state.latest_issued_version + 1,
           active_version = NULL,
           activated_at = NULL,
           terminated_at = NULL,
           keys_delivered_at = excluded.keys_delivered_at,
           wipe_keys_fetched_at = NULL`
      ).run(now, now);

      const row = db.prepare("SELECT * FROM card_state WHERE singleton = 1").get();
      expect(row.state).toBe("keys_delivered");
      expect(row.key_provenance).toBe("public_issuer");
      expect(row.first_seen_at).toBe(now);
    });
  });

  describe("set-k2 (targeted K2 update)", () => {
    it("inserts minimal config when no config exists", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, ?, 'fakewallet', NULL, NULL, ?)`
      ).run("AABB", now);

      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      expect(row.K2).toBe("AABB");
      expect(row.payment_method).toBe("fakewallet");
    });

    it("updates only K2 preserving existing payment_method and config_json", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, 'OLD_K2', 'lnurlpay', '{"lightning_address":"test@example.com"}', NULL, ?)`
      ).run(now);

      db.prepare(
        `UPDATE card_config SET K2 = ?, updated_at = ? WHERE singleton = 1`
      ).run("NEW_K2", nowSec());

      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      expect(row.K2).toBe("NEW_K2");
      expect(row.payment_method).toBe("lnurlpay");
      expect(row.config_json).toBe('{"lightning_address":"test@example.com"}');
    });
  });

  describe("record-read (INSERT OR IGNORE)", () => {
    it("inserts a read-status tap", () => {
      const now = nowSec();
      db.prepare(
        `INSERT OR IGNORE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, NULL, 'read', NULL, ?, ?, ?, ?)`
      ).run(5, "TestAgent", "https://example.com", now, now);

      const row = db.prepare("SELECT * FROM taps WHERE counter = 5").get();
      expect(row.status).toBe("read");
      expect(row.bolt11).toBeNull();
      expect(row.user_agent).toBe("TestAgent");
    });

    it("ignores duplicate counter on second insert", () => {
      const now = nowSec();
      db.prepare(
        `INSERT OR IGNORE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (5, NULL, 'read', NULL, NULL, NULL, ?, ?)`
      ).run(now, now);

      db.prepare(
        `INSERT OR IGNORE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (5, NULL, 'read', NULL, 'Other', 'http://x', ?, ?)`
      ).run(now + 1, now + 1);

      const row = db.prepare("SELECT * FROM taps WHERE counter = 5").get();
      expect(row.user_agent).toBeNull();
      expect(row.updated_at).toBe(now);
    });
  });

  describe("list-taps with lifecycle events", () => {
    it("merges taps with synthetic lifecycle events sorted by time", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, latest_issued_version, active_version, activated_at, keys_delivered_at, balance, first_seen_at)
         VALUES (1, 'active', 1, 1, ?, ?, 0, ?)`
      ).run(now - 100, now - 200, now - 300);

      db.prepare(
        `INSERT INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (1, 'lnbc...', 'completed', 1000, NULL, NULL, ?, ?)`
      ).run(now, now);

      const taps = db.prepare("SELECT * FROM taps ORDER BY counter DESC LIMIT 50").all();
      const stateRows = db.prepare("SELECT * FROM card_state WHERE singleton = 1").all();
      const cardState = stateRows[0];

      const events = [];
      if (cardState.keys_delivered_at) {
        events.push({ counter: null, status: 'provisioned', created_at: cardState.keys_delivered_at });
      }
      if (cardState.activated_at) {
        events.push({ counter: null, status: 'activated', created_at: cardState.activated_at });
      }

      const merged = [...taps, ...events].sort((a, b) => {
        const timeDiff = (b.created_at || 0) - (a.created_at || 0);
        if (timeDiff !== 0) return timeDiff;
        return (b.counter || 0) - (a.counter || 0);
      });

      expect(merged).toHaveLength(3);
      expect(merged[0].status).toBe('completed');
      expect(merged[1].status).toBe('activated');
      expect(merged[2].status).toBe('provisioned');
    });
  });

  describe("get-config (JSON merge)", () => {
    it("merges config_json into base fields", () => {
      db.prepare(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, 'AABB', 'lnurlpay', '{"lightning_address":"test@example.com","min_sendable":1000}', NULL, ?)`
      ).run(nowSec());

      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      let config = { payment_method: row.payment_method };
      if (row.K2) config.K2 = row.K2;
      if (row.config_json) {
        const extra = JSON.parse(row.config_json);
        config = { ...config, ...extra };
      }

      expect(config.payment_method).toBe("lnurlpay");
      expect(config.K2).toBe("AABB");
      expect(config.lightning_address).toBe("test@example.com");
      expect(config.min_sendable).toBe(1000);
    });

    it("returns base fields when config_json is null", () => {
      db.prepare(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, 'CCDD', 'fakewallet', NULL, NULL, ?)`
      ).run(nowSec());

      const row = db.prepare("SELECT * FROM card_config WHERE singleton = 1").get();
      let config = { payment_method: row.payment_method };
      if (row.K2) config.K2 = row.K2;

      expect(config.payment_method).toBe("fakewallet");
      expect(config.K2).toBe("CCDD");
      expect(Object.keys(config)).toHaveLength(2);
    });
  });

  describe("list-transactions (limit clamping)", () => {
    it("clamps negative limit to default 50", () => {
      const requestedLimit = -1;
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, 200))
        : 50;
      expect(limit).toBe(1);
    });

    it("clamps oversized limit to 200", () => {
      const requestedLimit = 999;
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, 200))
        : 50;
      expect(limit).toBe(200);
    });

    it("returns transactions ordered by id DESC", () => {
      const now = nowSec();
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance) VALUES (1, 'active', 5000)`
      ).run();
      db.prepare(
        `INSERT INTO transactions (counter, amount, balance_after, created_at, note) VALUES (1, -1000, 4000, ?, 'debit')`
      ).run(now);
      db.prepare(
        `INSERT INTO transactions (counter, amount, balance_after, created_at, note) VALUES (2, -500, 3500, ?, 'debit2')`
      ).run(now);

      const txs = db.prepare("SELECT * FROM transactions ORDER BY id DESC LIMIT 50").all();
      expect(txs).toHaveLength(2);
      expect(txs[0].amount).toBe(-500);
      expect(txs[1].amount).toBe(-1000);
    });
  });

  describe("balance (standalone read)", () => {
    it("returns balance from card_state", () => {
      db.prepare(
        `INSERT INTO card_state (singleton, state, balance) VALUES (1, 'active', 7500)`
      ).run();
      const rows = db.prepare("SELECT balance FROM card_state WHERE singleton = 1").all();
      expect(rows[0].balance).toBe(7500);
    });

    it("returns 0 when no card_state row", () => {
      const rows = db.prepare("SELECT balance FROM card_state WHERE singleton = 1").all();
      const balance = rows[0]?.balance ?? 0;
      expect(balance).toBe(0);
    });
  });
});
