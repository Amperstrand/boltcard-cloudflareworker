import { DurableObject } from "cloudflare:workers";

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
      if (!Number.isInteger(counterValue) || counterValue < 0) {
        return Response.json({ recorded: false }, { status: 400 });
      }

      const now = Math.floor(Date.now() / 1000);
      this.sql.exec(
        `INSERT OR IGNORE INTO taps (counter, bolt11, status, amount_msat, user_agent, request_url, created_at, updated_at)
         VALUES (?, NULL, 'read', NULL, ?, ?, ?, ?)`,
        counterValue,
        userAgent || null,
        requestUrl || null,
        now,
        now
      );

      return Response.json({ recorded: true });
    });
  }

  handleUpdateTapStatus(request) {
    return request.json().then(({ counter, status }) => {
      if (!counter || !status) {
        return Response.json({ error: "Missing counter or status" }, { status: 400 });
      }

      const validStatuses = ["read", "pending", "paying", "completed", "failed", "expired"];
      if (!validStatuses.includes(status)) {
        return Response.json({ error: `Invalid status: ${status}` }, { status: 400 });
      }

      const now = Math.floor(Date.now() / 1000);
      const result = this.sql.exec(
        `UPDATE taps SET status = ?, updated_at = ? WHERE counter = ?`,
        status,
        now,
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

    return Response.json({ taps });
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
}
