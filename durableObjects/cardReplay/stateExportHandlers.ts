import type { CardExportData, ImportResult } from "./routes.js";
import { invalidJsonBodyResponse, parseJsonBody } from "./bodyParse.js";

/**
 * Rowid-alias bind gate (ops#42 pre-validate decision).
 *
 * `taps.counter` and `transactions.id` are INTEGER PRIMARY KEY (rowid
 * aliases); `transactions.counter` is an INTEGER column of the same
 * shape. Binding a non-integer there makes SqlStorage throw
 * `datatype mismatch: SQLITE_MISMATCH` — and in a real workerd DO that
 * jsg error ESCAPES CardReplayStore.fetch's catch and rejects the stub
 * RPC (ops#37 wave 3 parked family). Validating before the DELETE phase
 * keeps the failure inside the dispatcher as a 400 it controls, and
 * leaves existing rows intact instead of half-emptying the tables.
 *
 * Accepted shapes mirror SQLite column affinity for the rowid alias:
 * null (auto-assign), a JS integer, or a numeric string that coerces
 * losslessly to an integer ("123" → 123, the pinned coercion contract).
 * Everything else — "abc", 5.5, booleans, objects — is a contract error.
 */
function isRowidAliasCompatible(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "number") return Number.isInteger(value);
  if (typeof value === "string") {
    if (value.trim() === "") return false;
    // Number() also parses hex/octal/binary literals ("0x10" → 16),
    // which SQLite affinity does NOT convert — they stay TEXT and hit
    // the rowid-alias mismatch. Exclude them so the accepted strings
    // are exactly the losslessly-coercible decimal forms (verified
    // against the real stub: " 123 "→123, "1e2"→100, "+7"→7,
    // "5.0"→5 all agree; "0x10" is the divergent class).
    if (/^[+-]?0[xXoObB]/.test(value.trim())) return false;
    return Number.isInteger(Number(value));
  }
  return false;
}

function validateImportRowidBinds(body: CardExportData): Response | null {
  if (Array.isArray(body.taps)) {
    for (let i = 0; i < body.taps.length; i++) {
      if (!isRowidAliasCompatible(body.taps[i]?.counter)) {
        return Response.json(
          { error: `Invalid import body: taps[${i}].counter must be an integer or null` },
          { status: 400 }
        );
      }
    }
  }
  if (Array.isArray(body.transactions)) {
    for (let i = 0; i < body.transactions.length; i++) {
      if (!isRowidAliasCompatible(body.transactions[i]?.id)) {
        return Response.json(
          { error: `Invalid import body: transactions[${i}].id must be an integer or null` },
          { status: 400 }
        );
      }
      if (!isRowidAliasCompatible(body.transactions[i]?.counter)) {
        return Response.json(
          { error: `Invalid import body: transactions[${i}].counter must be an integer or null` },
          { status: 400 }
        );
      }
    }
  }
  return null;
}

/**
 * Required-field gate (ops#65 pre-validate decision).
 *
 * The NOT NULL columns whose binds receive body values verbatim are
 * validated before the DELETE phase. Verified against the real workerd
 * stub (ops#65 session): a NOT NULL violation here surfaces as
 * `jsg.Error: NOT NULL constraint failed ... SQLITE_CONSTRAINT_NOTNULL`
 * that ESCAPES CardReplayStore.fetch's catch and rejects the stub RPC —
 * the same escaped class as the SQLITE_MISMATCH family (ops#37/ops#42),
 * NOT a dispatcher-observable 500. Pre-validation gives both legs a
 * controlled 400 and keeps existing rows intact.
 *
 * NOT validated: card_state.balance (the handler defaults it `?? 0`,
 * so a null never reaches a bind — pinned: real leg 200, balance 0) and
 * columns with handler defaults or nullable binds (taps.status,
 * card_config.*). Type shape beyond null-ness is deliberately not
 * checked — SQLite affinity governs non-null binds as before.
 */
function validateImportRequiredFields(body: CardExportData): Response | null {
  const bad = (field: string): Response =>
    Response.json({ error: `Invalid import body: ${field} must not be null` }, { status: 400 });

  if (body.replay_state && body.replay_state.last_counter == null) {
    return bad("replay_state.last_counter");
  }
  if (body.card_state) {
    if (body.card_state.state == null) {
      return bad("card_state.state");
    }
    if (body.card_state.latest_issued_version == null) {
      return bad("card_state.latest_issued_version");
    }
  }
  if (Array.isArray(body.taps)) {
    for (let i = 0; i < body.taps.length; i++) {
      if (body.taps[i]?.created_at == null) {
        return bad(`taps[${i}].created_at`);
      }
      if (body.taps[i]?.updated_at == null) {
        return bad(`taps[${i}].updated_at`);
      }
    }
  }
  if (Array.isArray(body.transactions)) {
    for (let i = 0; i < body.transactions.length; i++) {
      if (body.transactions[i]?.amount == null) {
        return bad(`transactions[${i}].amount`);
      }
      if (body.transactions[i]?.balance_after == null) {
        return bad(`transactions[${i}].balance_after`);
      }
      if (body.transactions[i]?.created_at == null) {
        return bad(`transactions[${i}].created_at`);
      }
    }
  }
  return null;
}

/**
 * card_config columns get-config projects from their TYPED values (and
 * set-config strips from extras via its destructure). ops#43: they may not
 * be planted inside config_json by /import-state either.
 */
export const RESERVED_CONFIG_KEYS = ["K2", "payment_method", "pull_payment_id"] as const;

/**
 * Reserved keys present as OWN PROPERTIES of a PARSED config_json object.
 *
 * - Unparseable or non-object config_json returns [] — the raw string stays
 *   importable verbatim (pinned: export-state round-trips it raw, ops#37
 *   wave 3; get-config just warns and drops the extras).
 * - hasOwnProperty is load-bearing: falsy values count as planted
 *   ({"K2":null} / {"payment_method":""} were exactly the pernicious
 *   override cases — the get-config spread kept the key with its falsy
 *   value instead of the typed column or the fakewallet default).
 */
export function reservedKeysInConfigJson(configJson: unknown): string[] {
  if (typeof configJson !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  return RESERVED_CONFIG_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

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
  const body = await parseJsonBody<CardExportData>(request);
  if (body === null) {
    return invalidJsonBodyResponse();
  }

  if (body.version !== 1) {
    return Response.json({ error: "Unsupported export version" }, { status: 400 });
  }

  const rowidError = validateImportRowidBinds(body);
  if (rowidError !== null) {
    return rowidError;
  }

  const requiredFieldError = validateImportRequiredFields(body);
  if (requiredFieldError !== null) {
    return requiredFieldError;
  }

  // ops#43 (owner disposition: validate/strip). /import-state was the ONLY
  // path that could plant reserved keys inside config_json (set-config's
  // destructure strips them); once planted, the get-config extras spread
  // overrode the typed columns with ANY value (falsy included) and set-k2
  // could not recover. Reject with a 400-class contract error BEFORE the
  // DELETEs below so a refused import leaves existing state untouched.
  if (body.card_config) {
    const reserved = reservedKeysInConfigJson(body.card_config.config_json);
    if (reserved.length > 0) {
      return Response.json(
        {
          error: "Reserved keys in card_config.config_json are not importable",
          reserved_keys: reserved,
        },
        { status: 400 }
      );
    }
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
