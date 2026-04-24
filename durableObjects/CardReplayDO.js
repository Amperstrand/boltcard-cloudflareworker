import { DurableObject } from "cloudflare:workers";
import { logger } from "../utils/logger.js";

export class CardReplayDO extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;

    state.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS replay_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          last_counter INTEGER NOT NULL
        )
      `);
      this.sql.exec(`
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
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS card_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          state TEXT NOT NULL DEFAULT 'new',
          latest_issued_version INTEGER NOT NULL DEFAULT 0,
          active_version INTEGER,
          activated_at INTEGER,
          terminated_at INTEGER,
          keys_delivered_at INTEGER,
          wipe_keys_fetched_at INTEGER
        )
      `);
      try {
        this.sql.exec(`ALTER TABLE card_state ADD COLUMN wipe_keys_fetched_at INTEGER`);
      } catch (e) {
        // Column already exists — expected on subsequent initializations
      }
      try {
        this.sql.exec(`ALTER TABLE card_state ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`);
      } catch (e) {
        // Column already exists — expected on subsequent initializations
      }
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS card_config (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          K2 TEXT,
          payment_method TEXT NOT NULL DEFAULT 'fakewallet',
          config_json TEXT,
          pull_payment_id TEXT,
          updated_at INTEGER
        )
      `);
      try {
        this.sql.exec(`ALTER TABLE card_config ADD COLUMN pull_payment_id TEXT`);
      } catch (e) {
      }
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          counter INTEGER,
          amount INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          note TEXT
        )
      `);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/check") {
      return this.handleCheck(request, false);
    }

    if (request.method === "POST" && url.pathname === "/check-readonly") {
      return this.handleCheck(request, true);
    }

    if (request.method === "POST" && url.pathname === "/record-tap") {
      return this.handleRecordTap(request);
    }

    if (request.method === "POST" && url.pathname === "/record-read") {
      return this.handleRecordRead(request);
    }

    if (request.method === "POST" && url.pathname === "/update-tap-status") {
      return this.handleUpdateTapStatus(request);
    }

    if (request.method === "GET" && url.pathname === "/analytics") {
      return this.handleAnalytics();
    }

    if (request.method === "GET" && url.pathname === "/list-taps") {
      return this.handleListTaps(url);
    }

    if (request.method === "GET" && url.pathname === "/card-state") {
      return this.handleGetCardState();
    }

    if (request.method === "POST" && url.pathname === "/deliver-keys") {
      return this.handleDeliverKeys();
    }

    if (request.method === "POST" && url.pathname === "/activate") {
      return this.handleActivate(request);
    }

    if (request.method === "POST" && url.pathname === "/terminate") {
      return this.handleTerminate();
    }

    if (request.method === "POST" && url.pathname === "/request-wipe") {
      return this.handleRequestWipe();
    }

    if (request.method === "GET" && url.pathname === "/get-config") {
      return this.handleGetConfig();
    }

    if (request.method === "POST" && url.pathname === "/set-config") {
      return this.handleSetConfig(request);
    }

    if (request.method === "POST" && url.pathname === "/debit") {
      return this.handleDebit(request);
    }

    if (request.method === "POST" && url.pathname === "/credit") {
      return this.handleCredit(request);
    }

    if (request.method === "GET" && url.pathname === "/balance") {
      return this.handleGetBalance();
    }

    if (request.method === "GET" && url.pathname === "/transactions") {
      return this.handleListTransactions(url);
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      this.sql.exec("DELETE FROM taps");
      this.sql.exec("DELETE FROM replay_state WHERE singleton = 1");
      return Response.json({ reset: true });
    }

    return new Response("Not found", { status: 404 });
  }

  handleCheck(request, readOnly) {
    return request.json().then(({ counterValue }) => {
      if (!Number.isInteger(counterValue) || counterValue < 0) {
        return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
      }

      if (readOnly) {
        const existing = this.sql.exec(
          "SELECT last_counter FROM replay_state WHERE singleton = 1"
        ).toArray();
        const lastCounter = existing[0]?.last_counter ?? null;

        if (lastCounter !== null && counterValue <= lastCounter) {
          return Response.json(
            { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
            { status: 409 }
          );
        }
        return Response.json({ accepted: true, lastCounter });
      }

      const updated = this.sql.exec(
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
        return Response.json({ accepted: true, lastCounter: updated[0].last_counter });
      }

      const existing = this.sql.exec(
        "SELECT last_counter FROM replay_state WHERE singleton = 1"
      ).toArray();
      const lastCounter = existing[0]?.last_counter ?? null;

      return Response.json(
        { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
        { status: 409 }
      );
    });
  }

  handleRecordTap(request) {
    return request.json().then(({ counterValue, bolt11, amountMsat, userAgent, requestUrl }) => {
      if (!Number.isInteger(counterValue) || counterValue < 0) {
        return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
      }

      const updated = this.sql.exec(
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
        const now = Math.floor(Date.now() / 1000);
        this.sql.exec(
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

        return Response.json({ accepted: true, lastCounter: updated[0].last_counter, tapRecorded: true });
      }

      const existing = this.sql.exec(
        "SELECT last_counter FROM replay_state WHERE singleton = 1"
      ).toArray();
      const lastCounter = existing[0]?.last_counter ?? null;

      return Response.json(
        { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
        { status: 409 }
      );
    });
  }

  handleRecordRead(request) {
    return request.json().then(({ counterValue, userAgent, requestUrl }) => {
      const counter = (Number.isInteger(counterValue) && counterValue >= 0)
        ? counterValue
        : Date.now();

      const now = Math.floor(Date.now() / 1000);
      this.sql.exec(
        `INSERT OR IGNORE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, NULL, 'read', NULL, ?, ?, ?, ?)`,
        counter,
        userAgent || null,
        requestUrl || null,
        now,
        now
      );

      return Response.json({ recorded: true });
    });
  }

  handleUpdateTapStatus(request) {
    return request.json().then(({ counter, status, bolt11, amountMsat }) => {
      if (!counter || !status) {
        return Response.json({ error: "Missing counter or status" }, { status: 400 });
      }

      const validStatuses = ["read", "pending", "paying", "completed", "failed", "expired"];
      if (!validStatuses.includes(status)) {
        return Response.json({ error: `Invalid status: ${status}` }, { status: 400 });
      }

      const now = Math.floor(Date.now() / 1000);
      const result = this.sql.exec(
        `UPDATE taps SET status = ?, updated_at = ?, bolt11 = COALESCE(?, bolt11), amount_msat = COALESCE(?, amount_msat) WHERE counter = ?`,
        status,
        now,
        bolt11 ?? null,
        amountMsat ?? null,
        counter
      );

      return Response.json({ updated: result.rowsAffected > 0 });
    });
  }

  handleListTaps(url) {
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const taps = this.sql.exec(
      `SELECT counter, bolt11, status, payment_hash, amount_msat, user_agent, request_url, created_at, updated_at
       FROM taps ORDER BY counter DESC LIMIT ?`,
      limit
    ).toArray();

    const stateRows = this.sql.exec(
      `SELECT state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at
       FROM card_state WHERE singleton = 1`
    ).toArray();
    const cardState = stateRows[0] || null;

    const events = [];

    if (cardState) {
      if (cardState.keys_delivered_at) {
        events.push({
          counter: null,
          bolt11: null,
          status: 'provisioned',
          payment_hash: null,
          amount_msat: null,
          user_agent: null,
          request_url: null,
          created_at: cardState.keys_delivered_at,
          updated_at: cardState.keys_delivered_at,
          version: cardState.latest_issued_version,
        });
      }
      if (cardState.activated_at) {
        events.push({
          counter: null,
          bolt11: null,
          status: 'activated',
          payment_hash: null,
          amount_msat: null,
          user_agent: null,
          request_url: null,
          created_at: cardState.activated_at,
          updated_at: cardState.activated_at,
          version: cardState.active_version,
        });
      }
      if (cardState.terminated_at) {
        events.push({
          counter: null,
          bolt11: null,
          status: 'terminated',
          payment_hash: null,
          amount_msat: null,
          user_agent: null,
          request_url: null,
          created_at: cardState.terminated_at,
          updated_at: cardState.terminated_at,
          version: null,
        });
      }
      if (cardState.wipe_keys_fetched_at) {
        events.push({
          counter: null,
          bolt11: null,
          status: 'wipe_requested',
          payment_hash: null,
          amount_msat: null,
          user_agent: null,
          request_url: null,
          created_at: cardState.wipe_keys_fetched_at,
          updated_at: cardState.wipe_keys_fetched_at,
          version: cardState.active_version,
        });
      }
    }

    const merged = [...taps, ...events].sort((a, b) => {
      const timeDiff = (b.created_at || 0) - (a.created_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (b.counter || 0) - (a.counter || 0);
    });

    return Response.json({ taps: merged.slice(0, limit) });
  }

  handleAnalytics() {
    const stats = this.sql.exec(
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

  handleGetCardState() {
    const rows = this.sql.exec(
      `SELECT state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance
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
      });
    }
    return Response.json(rows[0]);
  }

  handleDeliverKeys() {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.sql.exec(
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
       VALUES (1, 'keys_delivered', 1, NULL, NULL, NULL, ?, NULL, 0)
       ON CONFLICT(singleton) DO UPDATE SET
         state = 'keys_delivered',
         latest_issued_version = card_state.latest_issued_version + 1,
         active_version = NULL,
         activated_at = NULL,
         terminated_at = NULL,
         keys_delivered_at = excluded.keys_delivered_at,
          wipe_keys_fetched_at = NULL
       RETURNING state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance`,
      now
    );
    const cardState = rows.toArray()[0];
    return Response.json({ ...cardState, version: cardState.latest_issued_version });
  }

  handleActivate(request) {
    return request.json().then(({ active_version }) => {
      if (!Number.isInteger(active_version) || active_version < 1) {
        return Response.json({ error: "Invalid active_version" }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      const rows = this.sql.exec(
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
         RETURNING state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance`,
        active_version,
        active_version,
        now
      );
      return Response.json(rows.toArray()[0]);
    });
  }

  handleRequestWipe() {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.sql.exec(
       `UPDATE card_state SET
          state = 'wipe_requested',
          wipe_keys_fetched_at = ?
        WHERE singleton = 1
        RETURNING state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance`,
      now
    );
    const result = rows.toArray();
    if (result.length === 0) {
      return Response.json({ state: "new" }, { status: 404 });
    }
    return Response.json(result[0]);
  }

  handleTerminate() {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.sql.exec(
      `INSERT INTO card_state (singleton, state, latest_issued_version, terminated_at, balance)
       VALUES (1, 'terminated', 0, ?, 0)
       ON CONFLICT(singleton) DO UPDATE SET
           state = 'terminated',
           latest_issued_version = 0,
           terminated_at = excluded.terminated_at
       RETURNING state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance`,
      now
    );
    this.sql.exec("DELETE FROM taps");
    this.sql.exec("DELETE FROM replay_state WHERE singleton = 1");
    return Response.json(rows.toArray()[0]);
  }

  handleGetConfig() {
    const rows = this.sql.exec(
      `SELECT K2, payment_method, config_json, pull_payment_id, updated_at FROM card_config WHERE singleton = 1`
    ).toArray();
    if (rows.length === 0) {
      return Response.json(null);
    }
    const row = rows[0];
    let config = { payment_method: row.payment_method };
    if (row.K2) config.K2 = row.K2;
    if (row.pull_payment_id) config.pull_payment_id = row.pull_payment_id;
    if (row.config_json) {
      try {
        const extra = JSON.parse(row.config_json);
        config = { ...config, ...extra };
      } catch (e) {
        logger.warn("Failed to parse card_config.config_json", { error: e.message });
      }
    }
    return Response.json(config);
  }

  handleSetConfig(request) {
    return request.json().then((config) => {
      const { K2, payment_method, pull_payment_id, ...rest } = config;
      const method = payment_method || "fakewallet";
      const k2 = K2 || null;
      const pullPaymentId = pull_payment_id || null;
      const configJson = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
      const now = Math.floor(Date.now() / 1000);

      this.sql.exec(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           K2 = excluded.K2,
           payment_method = excluded.payment_method,
           config_json = excluded.config_json,
           pull_payment_id = excluded.pull_payment_id,
           updated_at = excluded.updated_at`,
        k2, method, configJson, pullPaymentId, now
      );

      return Response.json({ ok: true });
    });
  }

  handleDebit(request) {
    return request.json().then(({ counter, amount, note }) => {
      if (!Number.isInteger(amount) || amount <= 0) {
        return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
      }

      const currentBalance = this.getCurrentBalance();
      const newBalance = currentBalance - amount;
      const createdAt = Math.floor(Date.now() / 1000);

      this.ensureCardStateRow(currentBalance);
      this.sql.exec(
        `UPDATE card_state SET balance = ? WHERE singleton = 1`,
        newBalance
      );

      const rows = this.sql.exec(
        `INSERT INTO transactions (counter, amount, balance_after, created_at, note)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id, amount, balance_after, created_at`,
        Number.isInteger(counter) ? counter : null,
        -amount,
        newBalance,
        createdAt,
        note || null
      ).toArray();

      return Response.json({ ok: true, balance: newBalance, transaction: rows[0] });
    });
  }

  handleCredit(request) {
    return request.json().then(({ amount, note }) => {
      if (!Number.isInteger(amount) || amount <= 0) {
        return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
      }

      const currentBalance = this.getCurrentBalance();
      const newBalance = currentBalance + amount;
      const createdAt = Math.floor(Date.now() / 1000);

      this.ensureCardStateRow(currentBalance);
      this.sql.exec(
        `UPDATE card_state SET balance = ? WHERE singleton = 1`,
        newBalance
      );

      const rows = this.sql.exec(
        `INSERT INTO transactions (counter, amount, balance_after, created_at, note)
         VALUES (NULL, ?, ?, ?, ?)
         RETURNING id, amount, balance_after, created_at`,
        amount,
        newBalance,
        createdAt,
        note || null
      ).toArray();

      return Response.json({ ok: true, balance: newBalance, transaction: rows[0] });
    });
  }

  handleGetBalance() {
    return Response.json({ balance: this.getCurrentBalance() });
  }

  handleListTransactions(url) {
    const requestedLimit = parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 200))
      : 50;

    const transactions = this.sql.exec(
      `SELECT * FROM transactions ORDER BY id DESC LIMIT ?`,
      limit
    ).toArray();

    return Response.json({ transactions });
  }

  getCurrentBalance() {
    const rows = this.sql.exec(
      `SELECT balance FROM card_state WHERE singleton = 1`
    ).toArray();
    return rows[0]?.balance ?? 0;
  }

  ensureCardStateRow(balance = 0) {
    this.sql.exec(
      `INSERT INTO card_state (singleton, balance)
       VALUES (1, ?)
       ON CONFLICT(singleton) DO NOTHING`,
      balance
    );
  }
}
