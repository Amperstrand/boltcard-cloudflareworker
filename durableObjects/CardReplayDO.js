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
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/check") {
      const { counterValue } = await request.json();

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
        return Response.json({ accepted: true, lastCounter: updated[0].last_counter });
      }

      const existing = this.sql.exec(
        "SELECT last_counter FROM replay_state WHERE singleton = 1"
      ).toArray();
      const lastCounter = existing[0]?.last_counter ?? null;

      return Response.json(
        {
          accepted: false,
          reason: "Counter replay detected — tap rejected",
          lastCounter,
        },
        { status: 409 }
      );
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      this.sql.exec("DELETE FROM replay_state WHERE singleton = 1");
      return Response.json({ reset: true });
    }

    return new Response("Not found", { status: 404 });
  }
}
