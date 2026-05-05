import { DurableObject } from "cloudflare:workers";
import { logger, getErrorMessage } from "../utils/logger.js";
import type { CardConfig } from "../types/core.js";

interface CheckCounterPayload {
  counterValue: number;
}

interface RecordTapPayload {
  counterValue: number;
  bolt11: string;
  amountMsat: number;
  userAgent: string;
  requestUrl: string;
}

interface RecordReadPayload {
  counterValue: number;
  userAgent: string;
  requestUrl: string;
}

interface ClaimTapPayload {
  counter: number;
  status: string;
  bolt11: string;
  amountMsat: number;
}

interface ClaimTapNoBolt11Payload {
  counter: number;
  bolt11: string;
  amountMsat: number;
}

interface DeliverKeysPayload {
  active_version: number;
}

interface SetK2Payload {
  K2: string;
}

interface CreditPayload {
  amount: number;
  note: string;
}

interface DebitPayload {
  counter: number;
  amount: number;
  note: string;
}

interface SetProvenancePayload {
  key_provenance: string;
  key_fingerprint: string;
  key_label: string;
}

interface DiscoverPayload {
  key_provenance: string;
  key_fingerprint: string;
  key_label: string;
  active_version: number;
}

interface DoCardStateRow {
  state?: string;
  latest_issued_version?: number;
  active_version?: number | null;
  activated_at?: number | null;
  terminated_at?: number | null;
  keys_delivered_at?: number | null;
  wipe_keys_fetched_at?: number | null;
  key_provenance?: string | null;
  key_fingerprint?: string | null;
  key_label?: string | null;
  first_seen_at?: number | null;
  balance?: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const CARD_STATE_COLS = "state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, balance, key_provenance, key_fingerprint, key_label, first_seen_at";
export class CardReplayDO extends DurableObject<Env> {
  declare state: DurableObjectState;
  declare env: Env;
  sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
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
          wipe_keys_fetched_at INTEGER,
          balance INTEGER NOT NULL DEFAULT 0,
          key_provenance TEXT,
          key_fingerprint TEXT,
          key_label TEXT,
          first_seen_at INTEGER
        )
      `);
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
      try { this.sql.exec(`ALTER TABLE card_state ADD COLUMN key_provenance TEXT`); } catch (_e: unknown) {}
      try { this.sql.exec(`ALTER TABLE card_state ADD COLUMN key_fingerprint TEXT`); } catch (_e: unknown) {}
      try { this.sql.exec(`ALTER TABLE card_state ADD COLUMN key_label TEXT`); } catch (_e: unknown) {}
      try { this.sql.exec(`ALTER TABLE card_state ADD COLUMN first_seen_at INTEGER`); } catch (_e: unknown) {}
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {

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

    if (request.method === "POST" && url.pathname === "/claim-tap") {
      return this.handleClaimTap(request);
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
      return this.handleReset();
    }

    if (request.method === "POST" && url.pathname === "/mark-pending") {
      return this.handleMarkPending(request);
    }

    if (request.method === "POST" && url.pathname === "/discover") {
      return this.handleDiscover(request);
    }

    if (request.method === "POST" && url.pathname === "/set-k2") {
      return this.handleSetK2(request);
    }

    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      logger.error("Unhandled DO error", { path: url.pathname, error: getErrorMessage(err) });
      return Response.json({ error: "Internal error" }, { status: 500 });
    }

    return new Response("Not found", { status: 404 });
  }

  async handleCheck(request: Request, readOnly: boolean): Promise<Response> {
    const { counterValue } = await request.json() as CheckCounterPayload;
    if (!Number.isInteger(counterValue) || counterValue < 0) {
      return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
    }

    if (readOnly) {
      const existing = this.sql.exec(
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
      return Response.json({ accepted: true, lastCounter: updated[0]!.last_counter as number });
    }

    const existing = this.sql.exec(
      "SELECT last_counter FROM replay_state WHERE singleton = 1"
    ).toArray();
    const lastCounter: number | null = (existing[0]?.last_counter as number) ?? null;

    return Response.json(
      { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
      { status: 409 }
    );
  }

  async handleRecordTap(request: Request): Promise<Response> {
    const { counterValue, bolt11, amountMsat, userAgent, requestUrl } = await request.json() as RecordTapPayload;
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
      const now = nowSec();
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

      return Response.json({ accepted: true, lastCounter: updated[0]!.last_counter as number, tapRecorded: true });
    }

    const existing = this.sql.exec(
      "SELECT last_counter FROM replay_state WHERE singleton = 1"
    ).toArray();
    const lastCounter: number | null = (existing[0]?.last_counter as number) ?? null;

    return Response.json(
      { accepted: false, reason: "Counter replay detected — tap rejected", lastCounter },
      { status: 409 }
    );
  }

  async handleRecordRead(request: Request): Promise<Response> {
    const { counterValue, userAgent, requestUrl } = await request.json() as RecordReadPayload;
    const counter: number = (Number.isInteger(counterValue) && counterValue >= 0)
      ? counterValue
      : Date.now();

    const now = nowSec();
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
  }

  async handleUpdateTapStatus(request: Request): Promise<Response> {
    const { counter, status, bolt11, amountMsat } = await request.json() as ClaimTapPayload;
    if (counter == null || !status) {
      return Response.json({ error: "Missing counter or status" }, { status: 400 });
    }

    const validStatuses = ["read", "pending", "paying", "completed", "failed", "expired"];
    if (!validStatuses.includes(status)) {
      return Response.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    const now = nowSec();
    const updated = this.sql.exec(
      `UPDATE taps SET status = ?, updated_at = ?, bolt11 = COALESCE(?, bolt11), amount_msat = COALESCE(?, amount_msat) WHERE counter = ? RETURNING counter`,
      status,
      now,
      bolt11 ?? null,
      amountMsat ?? null,
      counter
    ).toArray();

    return Response.json({ updated: updated.length > 0 });
  }

  async handleClaimTap(request: Request): Promise<Response> {
    const { counter, bolt11, amountMsat } = await request.json() as ClaimTapNoBolt11Payload;
    if (!Number.isInteger(counter) || counter < 0) {
      return Response.json({ claimed: false, reason: "Invalid counter" }, { status: 400 });
    }

    const rows = this.sql.exec(
      `SELECT bolt11, status FROM taps WHERE counter = ?`,
      counter
    ).toArray();

    if (rows.length === 0) {
      const now = nowSec();
      this.sql.exec(
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
    this.sql.exec(
      `UPDATE taps SET bolt11 = ?, amount_msat = COALESCE(?, amount_msat), status = 'pending', updated_at = ? WHERE counter = ?`,
      bolt11 || null,
      amountMsat ?? null,
      now,
      counter
    );

    return Response.json({ claimed: true });
  }

  handleListTaps(url: URL): Response {
    let rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
    if (!Number.isFinite(rawLimit)) rawLimit = 50;
    const limit = Math.max(1, Math.min(rawLimit, 200));
    const taps = this.sql.exec(
      `SELECT counter, bolt11, status, payment_hash, amount_msat, user_agent, request_url, created_at, updated_at
       FROM taps ORDER BY counter DESC LIMIT ?`,
      limit
    ).toArray();

    const stateRows = this.sql.exec(
      `SELECT state, latest_issued_version, active_version, activated_at, terminated_at, keys_delivered_at, wipe_keys_fetched_at, key_provenance, key_fingerprint, key_label, first_seen_at
       FROM card_state WHERE singleton = 1`
    ).toArray();
    const cardState: DoCardStateRow | null = (stateRows[0] as DoCardStateRow) || null;

    const events: Record<string, unknown>[] = [];

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
      const timeDiff = ((b.created_at as number) || 0) - ((a.created_at as number) || 0);
      if (timeDiff !== 0) return timeDiff;
      return ((b.counter as number) || 0) - ((a.counter as number) || 0);
    });

    return Response.json({ taps: merged.slice(0, limit) });
  }

  handleAnalytics(): Response {
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

  handleGetCardState(): Response {
    const rows = this.sql.exec(
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

  handleDeliverKeys(): Response {
    const now = nowSec();
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

  async handleActivate(request: Request): Promise<Response> {
    const { active_version } = await request.json() as DeliverKeysPayload;
    if (!Number.isInteger(active_version) || active_version < 1) {
      return Response.json({ error: "Invalid active_version" }, { status: 400 });
    }
    const now = nowSec();
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
        RETURNING ${CARD_STATE_COLS}`,
      active_version,
      active_version,
      now
    );
    return Response.json(rows.toArray()[0]);
  }

  handleRequestWipe(): Response {
    const now = nowSec();
    const rows = this.sql.exec(
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

  handleTerminate(): Response {
    const now = nowSec();
    const rows = this.sql.exec(
      `INSERT INTO card_state (singleton, state, latest_issued_version, terminated_at, balance)
       VALUES (1, 'terminated', 0, ?, 0)
       ON CONFLICT(singleton) DO UPDATE SET
            state = 'terminated',
            terminated_at = excluded.terminated_at
        RETURNING ${CARD_STATE_COLS}`,
      now
    );
    this.sql.exec("DELETE FROM taps");
    this.sql.exec("DELETE FROM replay_state WHERE singleton = 1");
    return Response.json(rows.toArray()[0]);
  }

  handleGetConfig(): Response {
    const rows = this.sql.exec(
      `SELECT K2, payment_method, config_json, pull_payment_id, updated_at FROM card_config WHERE singleton = 1`
    ).toArray();
    if (rows.length === 0) {
      return Response.json(null);
    }
    const row = rows[0] as Record<string, unknown>;
    let config: Record<string, unknown> = { payment_method: row.payment_method };
    if (row.K2) config.K2 = row.K2;
    if (row.pull_payment_id) config.pull_payment_id = row.pull_payment_id;
    if (row.config_json) {
      try {
        const extra = JSON.parse(row.config_json as string) as Record<string, unknown>;
        config = { ...config, ...extra };
      } catch (e: unknown) {
        logger.warn("Failed to parse card_config.config_json", { error: getErrorMessage(e) });
      }
    }
    return Response.json(config);
  }

  async handleSetConfig(request: Request): Promise<Response> {
    const config = await request.json() as CardConfig;
    const { K2, payment_method, pull_payment_id, ...rest } = config;
    const method: string = payment_method || "fakewallet";
    const k2: string | null = K2 || null;
    const pullPaymentId: string | null = pull_payment_id || null;
    const configJson: string | null = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
    const now = nowSec();

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
  }

  async handleSetK2(request: Request): Promise<Response> {
    const { K2 } = await request.json() as SetK2Payload;
    const k2: string | null = K2 || null;
    const now = nowSec();
    const existing = this.sql.exec(
      `SELECT 1 FROM card_config WHERE singleton = 1`
    ).toArray();
    if (existing.length > 0) {
      this.sql.exec(
        `UPDATE card_config SET K2 = ?, updated_at = ? WHERE singleton = 1`,
        k2, now
      );
    } else {
      this.sql.exec(
        `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
         VALUES (1, ?, 'fakewallet', NULL, NULL, ?)`,
        k2, now
      );
    }
    return Response.json({ ok: true });
  }

  async handleDebit(request: Request): Promise<Response> {
    const { counter, amount, note } = await request.json() as DebitPayload;
    if (!Number.isInteger(amount) || amount <= 0) {
      return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
    }

    const currentBalance: number = this.getCurrentBalance();
    if (currentBalance < amount) {
      return Response.json({ ok: false, reason: "Insufficient balance", balance: currentBalance }, { status: 400 });
    }

    const newBalance = currentBalance - amount;
    const createdAt = nowSec();

    this.ensureCardStateRow(currentBalance);
    this.sql.exec(
      `UPDATE card_state SET balance = ? WHERE singleton = 1 AND balance >= ?`,
      newBalance, amount
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
  }

  async handleCredit(request: Request): Promise<Response> {
    const { amount, note } = await request.json() as CreditPayload;
    if (!Number.isInteger(amount) || amount <= 0) {
      return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
    }

    const currentBalance: number = this.getCurrentBalance();
    const newBalance = currentBalance + amount;
    const createdAt = nowSec();

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
  }

  handleGetBalance(): Response {
    return Response.json({ balance: this.getCurrentBalance() });
  }

  handleReset(): Response {
    this.sql.exec("DELETE FROM taps");
    this.sql.exec("DELETE FROM replay_state WHERE singleton = 1");
    return Response.json({ reset: true });
  }

  handleListTransactions(url: URL): Response {
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

  getCurrentBalance(): number {
    const rows = this.sql.exec(
      `SELECT balance FROM card_state WHERE singleton = 1`
    ).toArray();
    return (rows[0]?.balance as number) ?? 0;
  }

  ensureCardStateRow(balance: number = 0): void {
    this.sql.exec(
      `INSERT INTO card_state (singleton, balance)
       VALUES (1, ?)
       ON CONFLICT(singleton) DO NOTHING`,
      balance
    );
  }

  async handleMarkPending(request: Request): Promise<Response> {
    const { key_provenance, key_fingerprint, key_label } = await request.json() as SetProvenancePayload;
    const now = nowSec();
    const existing = this.sql.exec(
      `SELECT state FROM card_state WHERE singleton = 1`
    ).toArray();

    if (existing.length > 0) {
      return Response.json({
        state: existing[0]!.state,
        already_exists: true,
      });
    }

    this.sql.exec(
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

  async handleDiscover(request: Request): Promise<Response> {
    const { key_provenance, key_fingerprint, key_label, active_version } = await request.json() as DiscoverPayload;
    const now = nowSec();
    const version: number = active_version || 1;

    const existing = this.sql.exec(
      `SELECT state, key_provenance, key_fingerprint, key_label, first_seen_at FROM card_state WHERE singleton = 1`
    ).toArray();

    if (existing.length > 0) {
      const current = existing[0] as Record<string, unknown>;
      if (current.state === "pending" || current.state === "new" || current.state === "legacy") {
        this.sql.exec(
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
      const updated = this.sql.exec(
        `SELECT ${CARD_STATE_COLS} FROM card_state WHERE singleton = 1`
      ).toArray();
      return Response.json({ ...updated[0], already_exists: true });
    }

    this.sql.exec(
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
}
