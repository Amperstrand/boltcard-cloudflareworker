import type { CardConfig } from "../types/core.js";
import { MAX_BALANCE } from "../utils/constants.js";

interface CardState {
  state: string;
  latest_issued_version: number;
  active_version: number | null;
  activated_at: number | null;
  terminated_at: number | null;
  keys_delivered_at: number | null;
  wipe_keys_fetched_at: number | null;
  balance: number;
  key_provenance?: string | null;
  key_fingerprint?: string | null;
  key_label?: string | null;
  first_seen_at?: number | null;
}

interface TapRecord {
  counter: number;
  bolt11: string | null;
  status: string;
  payment_hash: string | null;
  amount_msat: number | null;
  user_agent: string | null;
  request_url: string | null;
  created_at: number;
  updated_at: number;
}

interface Transaction {
  id: number;
  counter: number | null;
  amount: number;
  balance_after: number;
  created_at: number;
  note: string | null;
  voided_at?: number | null;
}

interface K1Challenge {
  counter: number;
  created_at: number;
}

/**
 * Faithful mirror of the DO's card_config TABLE row (typed columns + raw
 * config_json string). Route writes (set-config / set-k2 / import-state)
 * keep this row so get-config / export-state can project EXACTLY like
 * durableObjects/cardReplay/configHandlers.ts — including the reserved-
 * key override semantics where config_json extras (K2 / payment_method /
 * pull_payment_id planted by /import-state) spread OVER the typed columns
 * with falsy extras values keeping their keys present. The logical
 * __cardConfigs map stays in sync for external unit-test readers.
 */
interface ConfigRow {
  K2: string | null;
  payment_method: string;
  config_json: string | null;
  pull_payment_id: string | null;
}

// Real DO (configHandlers.handleGetConfig): typed columns first (K2 /
// pull_payment_id only when truthy), then config_json extras spread on
// top — extras keys win, even with falsy values (key stays present).
const projectConfigRow = (row: ConfigRow): Record<string, unknown> => {
  let config: Record<string, unknown> = { payment_method: row.payment_method };
  if (row.K2) config.K2 = row.K2;
  if (row.pull_payment_id) config.pull_payment_id = row.pull_payment_id;
  if (row.config_json) {
    try {
      const extra = JSON.parse(row.config_json) as Record<string, unknown>;
      config = { ...config, ...extra };
    } catch {
      // Real DO: logger.warn + extras dropped; typed columns survive.
    }
  }
  return config;
};

export interface ReplayNamespace {
  newUniqueId: (options?: DurableObjectNamespaceNewUniqueIdOptions) => DurableObjectId;
  idFromName: (name: string) => DurableObjectId;
  idFromString: (id: string) => DurableObjectId;
  get: (id: DurableObjectId, options?: DurableObjectNamespaceGetDurableObjectOptions) => DurableObjectStub<undefined>;
  getByName: (name: string, options?: DurableObjectNamespaceGetDurableObjectOptions) => DurableObjectStub<undefined>;
  jurisdiction: (jurisdiction: DurableObjectJurisdiction) => DurableObjectNamespace<undefined>;
  __counters: Map<string, number>;
  __taps: Map<string, TapRecord>;
  __cardStates: Map<string, CardState>;
  __cardConfigs: Map<string, CardConfig>;
  __transactions: Map<string, Transaction[]>;
  __k1Challenges: Map<string, Map<string, K1Challenge>>;
  __activate: (uid: string, version?: number) => void;
}

export const makeReplayNamespace = (
  initialCounters: Record<string, number> = {},
  initialCards: Record<string, number> = {}
): ReplayNamespace => {
  const counters = new Map<string, number>(
    Object.entries(initialCounters).map(([uid, value]) => [uid.toLowerCase(), value])
  );
  const taps = new Map<string, TapRecord>();
  const cardStates = new Map<string, CardState>();
  const transactions = new Map<string, Transaction[]>();
  const k1Challenges = new Map<string, Map<string, K1Challenge>>();
  const configRows = new Map<string, ConfigRow>();
  // External unit tests seed __cardConfigs directly with LOGICAL configs;
  // such a write bypasses the route layer, so any route-written row is
  // dropped (the external value becomes the whole truth). Internal route
  // writes go through setLogicalConfig to keep row + logical in sync.
  class LogicalConfigMap extends Map<string, CardConfig> {
    override set(key: string, value: CardConfig): this {
      configRows.delete(key);
      return super.set(key, value);
    }
  }
  const cardConfigs = new LogicalConfigMap();
  const setLogicalConfig = (uid: string, value: CardConfig): void => {
    Map.prototype.set.call(cardConfigs, uid, value);
  };
  // AUTOINCREMENT parity (balanceHandlers): SQLite's sqlite_sequence only
  // ever grows — DELETE + re-INSERT keeps handing out ids beyond any id the
  // table has ever held (import-state DELETEs all rows, then restores
  // explicit ids). Track the high-water mark per uid.
  const txnSeq = new Map<string, number>();

  const nextTxnId = (uid: string): number => {
    const seq = Math.max(txnSeq.get(uid) ?? 0, ...(transactions.get(uid) ?? []).map((t) => t.id));
    txnSeq.set(uid, seq + 1);
    return seq + 1;
  };

  const challengesFor = (uid: string): Map<string, K1Challenge> => {
    let m = k1Challenges.get(uid);
    if (!m) {
      m = new Map<string, K1Challenge>();
      k1Challenges.set(uid, m);
    }
    return m;
  };

  const allUids = new Set<string>([
    ...counters.keys(),
    ...Object.keys(initialCards).map((u) => u.toLowerCase()),
  ]);
  for (const uid of allUids) {
    const version = initialCards[uid] ?? 1;
    cardStates.set(uid, {
      state: "active",
      latest_issued_version: version,
      active_version: version,
      activated_at: Math.floor(Date.now() / 1000),
      terminated_at: null,
      keys_delivered_at: null,
      wipe_keys_fetched_at: null,
      balance: 0,
    });
  }

  const getDefaultState = (): CardState => ({
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

  const toId = (name: string): DurableObjectId => name.toLowerCase() as unknown as DurableObjectId;
  const fromId = (id: DurableObjectId): string => String(id).toLowerCase();

  const routeRequest = async (idStr: string, request: Request): Promise<Response> => {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/card-state") {
        if (!cardStates.has(idStr)) {
          return Response.json(getDefaultState());
        }
        return Response.json(cardStates.get(idStr));
      }

      if (request.method === "GET" && url.pathname === "/get-config") {
        // Route-written configs project from the faithful card_config row
        // (reserved-key extras override typed columns — see ConfigRow).
        // Externally seeded logical configs (unit tests writing
        // __cardConfigs directly) keep the legacy projection.
        const row = configRows.get(idStr);
        if (row) {
          return Response.json(projectConfigRow(row));
        }
        if (!cardConfigs.has(idStr)) {
          return Response.json(null);
        }
        // Real DO (configHandlers.handleGetConfig): no row → null; a row is
        // projected as {payment_method (defaulted 'fakewallet')} + K2 only
        // when truthy + pull_payment_id only when truthy + config_json
        // extras spread on top. The mock stores the logical config; project
        // it the same way (falsy K2/pull_payment_id must NOT appear).
        const stored = cardConfigs.get(idStr) as unknown as Record<string, unknown>;
        const projected: Record<string, unknown> = {
          payment_method: stored.payment_method || "fakewallet",
        };
        if (stored.K2) projected.K2 = stored.K2;
        if (stored.pull_payment_id) projected.pull_payment_id = stored.pull_payment_id;
        for (const [key, value] of Object.entries(stored)) {
          if (key === "K2" || key === "payment_method" || key === "pull_payment_id") continue;
          projected[key] = value;
        }
        return Response.json(projected);
      }

      if (request.method === "POST" && url.pathname === "/set-config") {
        const config = (await request.json()) as CardConfig;
        // Real DO (configHandlers.handleSetConfig): reserved keys are
        // destructured into typed columns and NEVER land in config_json;
        // the remaining extras are stringified. The whole row is replaced
        // (upsert), so an unset K2 column becomes NULL.
        const { K2, payment_method, pull_payment_id, ...rest } = config as unknown as Record<string, unknown>;
        const row: ConfigRow = {
          K2: (K2 as string) || null,
          payment_method: (payment_method as string) || "fakewallet",
          config_json: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
          pull_payment_id: (pull_payment_id as string) || null,
        };
        configRows.set(idStr, row);
        setLogicalConfig(idStr, projectConfigRow(row) as unknown as CardConfig);
        return Response.json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/set-k2") {
        const { K2 } = (await request.json()) as { K2: string };
        // Real DO (configHandlers.handleSetK2): UPDATEs ONLY the K2 column
        // — config_json (and any reserved-key extras inside it) is
        // untouched, so extras keep overriding the new typed K2.
        const row = configRows.get(idStr);
        if (row) {
          const updated: ConfigRow = { ...row, K2: K2 || null };
          configRows.set(idStr, updated);
          setLogicalConfig(idStr, projectConfigRow(updated) as unknown as CardConfig);
          return Response.json({ ok: true });
        }
        const existing = cardConfigs.get(idStr);
        if (existing) {
          setLogicalConfig(idStr, { ...existing, K2: K2 || null });
        } else {
          const fresh: ConfigRow = { K2: K2 || null, payment_method: "fakewallet", config_json: null, pull_payment_id: null };
          configRows.set(idStr, fresh);
          setLogicalConfig(idStr, projectConfigRow(fresh) as unknown as CardConfig);
        }
        return Response.json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/balance") {
        const state = cardStates.get(idStr) || getDefaultState();
        return Response.json({ balance: state.balance ?? 0 });
      }

      if (request.method === "GET" && url.pathname === "/transactions") {
        const requestedLimit = parseInt(url.searchParams.get("limit") || "50", 10);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(requestedLimit, 200))
          : 50;
        // Real DO: SELECT * (7 columns incl. voided_at) ORDER BY id DESC.
        const txs = (transactions.get(idStr) || [])
          .slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, limit)
          .map((t) => ({
            id: t.id,
            counter: t.counter,
            amount: t.amount,
            balance_after: t.balance_after,
            created_at: t.created_at,
            note: t.note,
            voided_at: t.voided_at ?? null,
          }));
        return Response.json({ transactions: txs });
      }

      if (request.method === "POST" && url.pathname === "/debit") {
        const { counter, amount, note } = (await request.json()) as {
          counter: number;
          amount: number;
          note: string;
        };
        if (!Number.isInteger(amount) || amount <= 0) {
          return Response.json(
            { ok: false, reason: "Amount must be a positive integer" },
            { status: 400 }
          );
        }

        const current = cardStates.get(idStr) || getDefaultState();
        const currentBalance = current.balance ?? 0;
        if (currentBalance < amount) {
          return Response.json(
            { ok: false, reason: "Insufficient balance", balance: currentBalance },
            { status: 400 }
          );
        }
        const newBalance = currentBalance - amount;
        const now = Math.floor(Date.now() / 1000);
        cardStates.set(idStr, { ...current, balance: newBalance });

        const existing = transactions.get(idStr) || [];
        const transaction: Transaction = {
          id: nextTxnId(idStr),
          counter: Number.isInteger(counter) ? counter : null,
          amount: -amount,
          balance_after: newBalance,
          created_at: now,
          note: note || null,
          voided_at: null,
        };
        transactions.set(idStr, [...existing, transaction]);

        // Real DO (balanceHandlers.handleDebit): the response carries only
        // the RETURNING columns — id, amount, balance_after, created_at.
        return Response.json({
          ok: true,
          balance: newBalance,
          transaction: {
            id: transaction.id,
            amount: transaction.amount,
            balance_after: transaction.balance_after,
            created_at: transaction.created_at,
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/credit") {
        const { amount, note } = (await request.json()) as {
          amount: number;
          note: string;
        };
        if (!Number.isInteger(amount) || amount <= 0) {
          return Response.json(
            { ok: false, reason: "Amount must be a positive integer" },
            { status: 400 }
          );
        }

        const current = cardStates.get(idStr) || getDefaultState();
        const currentBalance = current.balance ?? 0;
        if (currentBalance + amount > MAX_BALANCE) {
          return Response.json(
            { ok: false, reason: "Balance would exceed maximum", balance: currentBalance },
            { status: 400 }
          );
        }
        const newBalance = currentBalance + amount;
        const now = Math.floor(Date.now() / 1000);
        cardStates.set(idStr, { ...current, balance: newBalance });

        const existing = transactions.get(idStr) || [];
        const transaction: Transaction = {
          id: nextTxnId(idStr),
          counter: null,
          amount,
          balance_after: newBalance,
          created_at: now,
          note: note || null,
          voided_at: null,
        };
        transactions.set(idStr, [...existing, transaction]);

        // Real DO (balanceHandlers.handleCredit): RETURNING columns only.
        return Response.json({
          ok: true,
          balance: newBalance,
          transaction: {
            id: transaction.id,
            amount: transaction.amount,
            balance_after: transaction.balance_after,
            created_at: transaction.created_at,
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/void") {
        // Real DO (balanceHandlers.handleVoid): unknown id → 404; already
        // voided → 400; non-debit → 400; else mark voided_at, credit the
        // amount back, insert the compensating txn (note `void:<id>`).
        const { transactionId } = (await request.json()) as { transactionId: number };
        const existing = transactions.get(idStr) || [];
        const txn = existing.find((t) => t.id === transactionId);

        if (!txn) {
          return Response.json({ ok: false, reason: "Transaction not found" }, { status: 404 });
        }
        if (txn.voided_at != null) {
          return Response.json({ ok: false, reason: "Transaction already voided" }, { status: 400 });
        }
        if (txn.amount >= 0) {
          return Response.json({ ok: false, reason: "Can only void charges (debits)" }, { status: 400 });
        }

        const voidAmount = Math.abs(txn.amount);
        const current = cardStates.get(idStr) || getDefaultState();
        const currentBalance = current.balance ?? 0;
        const newBalance = currentBalance + voidAmount;
        const now = Math.floor(Date.now() / 1000);

        txn.voided_at = now;
        cardStates.set(idStr, { ...current, balance: newBalance });

        const newTransaction: Transaction = {
          id: nextTxnId(idStr),
          counter: null,
          amount: voidAmount,
          balance_after: newBalance,
          created_at: now,
          note: `void:${transactionId}`,
          voided_at: null,
        };
        transactions.set(idStr, [...existing, newTransaction]);

        return Response.json({
          ok: true,
          balance: newBalance,
          voidedTransaction: {
            id: txn.id,
            amount: txn.amount,
            balance_after: txn.balance_after,
            note: txn.note,
          },
          newTransaction: {
            id: newTransaction.id,
            amount: newTransaction.amount,
            balance_after: newTransaction.balance_after,
            created_at: newTransaction.created_at,
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/deliver-keys") {
        const current = cardStates.get(idStr) || getDefaultState();
        const now = Math.floor(Date.now() / 1000);
        const newState: CardState = {
          ...current,
          state: "keys_delivered",
          latest_issued_version: current.latest_issued_version + 1,
          keys_delivered_at: now,
          active_version: null,
          activated_at: null,
          terminated_at: null,
          // Real DO (cardStateHandlers.handleDeliverKeys): the conflict
          // UPDATE clears wipe_keys_fetched_at, and first_seen_at is
          // COALESCE(existing, now) — set on the fresh insert path.
          wipe_keys_fetched_at: null,
          balance: current.balance ?? 0,
          first_seen_at: current.first_seen_at ?? now,
        };
        cardStates.set(idStr, newState);
        return Response.json({ ...newState, version: newState.latest_issued_version });
      }

      if (request.method === "POST" && url.pathname === "/activate") {
        const { active_version } = (await request.json()) as { active_version: number };
        // Real DO (cardStateHandlers.handleActivate): integer >= 1 or 400.
        if (!Number.isInteger(active_version) || (active_version as number) < 1) {
          return Response.json({ error: "Invalid active_version" }, { status: 400 });
        }
        const current = cardStates.get(idStr) || getDefaultState();
        const now = Math.floor(Date.now() / 1000);
        const newState: CardState = {
          ...current,
          state: "active",
          // Real DO: fresh INSERT seeds latest_issued_version = active_version;
          // the conflict UPDATE leaves latest_issued_version (and
          // keys_delivered_at / wipe_keys_fetched_at) untouched and only
          // clears terminated_at.
          latest_issued_version: cardStates.has(idStr) ? current.latest_issued_version : active_version,
          active_version,
          activated_at: now,
          terminated_at: null,
          balance: current.balance ?? 0,
        };
        cardStates.set(idStr, newState);
        return Response.json(newState);
      }

      if (request.method === "POST" && url.pathname === "/terminate") {
        const current = cardStates.get(idStr) || getDefaultState();
        const now = Math.floor(Date.now() / 1000);
        const newState: CardState = {
          ...current,
          state: "terminated",
          terminated_at: now,
          balance: current.balance ?? 0,
        };
        cardStates.set(idStr, newState);
        counters.delete(idStr);
        for (const key of [...taps.keys()]) {
          if (key.startsWith(`${idStr}:`)) {
            taps.delete(key);
          }
        }
        return Response.json(newState);
      }

      if (request.method === "POST" && url.pathname === "/request-wipe") {
        // Real DO (cardStateHandlers.handleRequestWipe): UPDATE ... RETURNING
        // the full card_state row; no row → 404 {state:"new"}.
        const current = cardStates.get(idStr);
        if (!current) {
          return Response.json({ state: "new" }, { status: 404 });
        }
        const now = Math.floor(Date.now() / 1000);
        const newState: CardState = {
          ...current,
          state: "wipe_requested",
          wipe_keys_fetched_at: now,
          balance: current.balance ?? 0,
        };
        cardStates.set(idStr, newState);
        return Response.json(newState);
      }

      if (request.method === "POST" && url.pathname === "/k1-issue") {
        const { counterValue, maxAgeSec } = (await request.json()) as { counterValue: number; maxAgeSec?: number };
        if (!Number.isInteger(counterValue) || counterValue < 0) {
          return Response.json({ error: "Invalid counter value" }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        const challenges = challengesFor(idStr);
        if (Number.isInteger(maxAgeSec) && (maxAgeSec as number) > 0) {
          for (const [k1, ch] of challenges) {
            if (ch.created_at < now - (maxAgeSec as number)) challenges.delete(k1);
          }
        }
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const k1 = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
        challenges.set(k1, { counter: counterValue, created_at: now });
        return Response.json({ k1 });
      }

      if (request.method === "POST" && url.pathname === "/k1-verify") {
        const { k1, counterValue, ttlSeconds } = (await request.json()) as { k1: string; counterValue: number; ttlSeconds?: number };
        if (typeof k1 !== "string" || k1.length === 0 || !Number.isInteger(counterValue) || counterValue < 0) {
          return Response.json({ valid: false, reason: "Invalid k1 verify request" }, { status: 400 });
        }
        const challenges = challengesFor(idStr);
        const row = challenges.get(k1);
        if (!row) {
          return Response.json({ valid: false, reason: "Unknown or already used k1" });
        }
        if (row.counter !== counterValue) {
          return Response.json({ valid: false, reason: "k1 does not match this card tap" });
        }
        const ttl = Number.isInteger(ttlSeconds) && (ttlSeconds as number) > 0 ? (ttlSeconds as number) : 0;
        const expired = row.created_at + ttl <= Math.floor(Date.now() / 1000);
        challenges.delete(k1);
        if (expired) {
          return Response.json({ valid: false, reason: "k1 challenge expired" });
        }
        return Response.json({ valid: true });
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        counters.delete(idStr);
        k1Challenges.delete(idStr);
        for (const key of [...taps.keys()]) {
          if (key.startsWith(`${idStr}:`)) {
            taps.delete(key);
          }
        }
        return Response.json({ reset: true });
      }

      if (request.method === "POST" && url.pathname === "/check") {
        const { counterValue } = (await request.json()) as { counterValue: number };
        if (!Number.isInteger(counterValue) || counterValue < 0) {
          return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
        }
        const lastCounter = counters.has(idStr) ? counters.get(idStr)! : null;

        if (lastCounter !== null && counterValue <= lastCounter) {
          return Response.json(
            {
              accepted: false,
              reason: "Counter replay detected — tap rejected",
              lastCounter,
            },
            { status: 409 }
          );
        }

        counters.set(idStr, counterValue);
        return Response.json({ accepted: true, lastCounter: counterValue });
      }

      if (request.method === "POST" && url.pathname === "/check-readonly") {
        const { counterValue } = (await request.json()) as { counterValue: number };
        if (!Number.isInteger(counterValue) || counterValue < 0) {
          return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
        }
        const lastCounter = counters.has(idStr) ? counters.get(idStr)! : null;

        if (lastCounter !== null && counterValue <= lastCounter) {
          return Response.json(
            {
              accepted: false,
              reason: "Counter replay detected — tap rejected",
              lastCounter,
            },
            { status: 409 }
          );
        }

        return Response.json({ accepted: true, lastCounter });
      }

      if (request.method === "POST" && url.pathname === "/record-read") {
        const { counterValue, userAgent, requestUrl } = (await request.json()) as {
          counterValue: number;
          userAgent?: string;
          requestUrl?: string;
        };
        // Real DO (tapHandlers.handleRecordRead): invalid/absent counter
        // falls back to Date.now() so the read row is still recorded.
        const counter: number =
          Number.isInteger(counterValue) && counterValue >= 0 ? counterValue : Date.now();
        const tapKey = `${idStr}:${counter}`;
        if (!taps.has(tapKey)) {
          const now = Math.floor(Date.now() / 1000);
          taps.set(tapKey, {
            counter,
            bolt11: null,
            status: "read",
            payment_hash: null,
            amount_msat: null,
            user_agent: userAgent || null,
            request_url: requestUrl || null,
            created_at: now,
            updated_at: now,
          });
        }
        return Response.json({ recorded: true });
      }

      if (request.method === "POST" && url.pathname === "/record-tap") {
        const { counterValue, bolt11, amountMsat, userAgent, requestUrl } = (await request.json()) as {
          counterValue: number;
          bolt11?: string;
          amountMsat?: number;
          userAgent?: string;
          requestUrl?: string;
        };
        if (!Number.isInteger(counterValue) || counterValue < 0) {
          return Response.json({ accepted: false, reason: "Invalid counter value" }, { status: 400 });
        }
        const lastCounter = counters.has(idStr) ? counters.get(idStr)! : null;

        // Real DO (tapHandlers.handleRecordTap): the tap is recorded only
        // when the counter STRICTLY advances; a step-1-advanced counter
        // (check at step 1 wrote last_counter == counterValue) is a 409
        // here and the callback proceeds via /claim-tap's read-row path.
        if (lastCounter !== null && counterValue <= lastCounter) {
          return Response.json(
            {
              accepted: false,
              reason: "Counter replay detected — tap rejected",
              lastCounter,
            },
            { status: 409 }
          );
        }

        counters.set(idStr, counterValue);
        const now = Math.floor(Date.now() / 1000);
        // INSERT OR REPLACE: the row (and its created_at) is fresh.
        taps.set(`${idStr}:${counterValue}`, {
          counter: counterValue,
          bolt11: bolt11 || null,
          status: "pending",
          payment_hash: null,
          amount_msat: amountMsat || null,
          user_agent: userAgent || null,
          request_url: requestUrl || null,
          created_at: now,
          updated_at: now,
        });

        return Response.json({ accepted: true, lastCounter: counterValue, tapRecorded: true });
      }

      if (request.method === "POST" && url.pathname === "/claim-tap") {
        const { counter, bolt11, amountMsat } = (await request.json()) as {
          counter: number;
          bolt11?: string;
          amountMsat?: number;
        };
        if (!Number.isInteger(counter) || counter < 0) {
          return Response.json({ claimed: false, reason: "Invalid counter" }, { status: 400 });
        }
        const tapKey = `${idStr}:${counter}`;
        const tap = taps.get(tapKey);

        if (!tap) {
          const now = Math.floor(Date.now() / 1000);
          taps.set(tapKey, {
            counter,
            bolt11: bolt11 || null,
            status: "pending",
            payment_hash: null,
            amount_msat: amountMsat ?? null,
            user_agent: null,
            request_url: null,
            created_at: now,
            updated_at: now,
          });
          return Response.json({ claimed: true });
        }

        if (tap.bolt11) {
          return Response.json(
            { claimed: false, reason: "Tap already claimed", bolt11: tap.bolt11 },
            { status: 409 }
          );
        }

        // Mirror the real DO's #85 first-callback-wins guard
        // (durableObjects/cardReplay/tapHandlers.ts): only a 'read' row (the
        // withdraw REQUEST, never a callback attempt) may be claimed. Any
        // 'pending'/'paying'/'completed'/'failed' row means a callback was
        // already attempted — replay must 409 even amount-only (bolt11 NULL).
        if (tap.status !== "read") {
          return Response.json(
            { claimed: false, reason: "Tap already claimed" },
            { status: 409 }
          );
        }

        const now = Math.floor(Date.now() / 1000);
        tap.bolt11 = bolt11 || null;
        tap.amount_msat = amountMsat ?? tap.amount_msat;
        tap.status = "paying";
        tap.updated_at = now;
        taps.set(tapKey, tap);

        return Response.json({ claimed: true });
      }

      if (request.method === "POST" && url.pathname === "/update-tap-status") {
        const { counter, status, bolt11, amountMsat } = (await request.json()) as {
          counter: number;
          status: string;
          bolt11?: string;
          amountMsat?: number;
        };

        if (counter == null || !status) {
          return Response.json({ error: "Missing counter or status" }, { status: 400 });
        }

        const validStatuses = ["read", "pending", "paying", "completed", "failed", "expired"];
        if (!validStatuses.includes(status)) {
          return Response.json({ error: `Invalid status: ${status}` }, { status: 400 });
        }

        const tapKey = `${idStr}:${counter}`;
        const tap = taps.get(tapKey);

        if (!tap) {
          return Response.json({ updated: false });
        }

        const now = Math.floor(Date.now() / 1000);
        tap.status = status;
        tap.updated_at = now;
        if (bolt11 != null) tap.bolt11 = bolt11;
        if (amountMsat != null) tap.amount_msat = amountMsat;
        taps.set(tapKey, tap);

        return Response.json({ updated: true });
      }

      if (request.method === "GET" && url.pathname === "/analytics") {
        // Real DO (tapHandlers.handleAnalytics): one SQL aggregate.
        // COALESCE wraps only the *Msat sums (→ 0 on empty); the *Taps
        // counts are bare SUM(CASE...) → SQL NULL on an empty table, and
        // 'read'/'paying'/'expired' rows count in NO status bucket (only
        // totalTaps/totalMsat).
        let totalMsat = 0,
          completedMsat = 0,
          failedMsat = 0,
          pendingMsat = 0;
        let totalTaps = 0,
          completedTaps = 0,
          failedTaps = 0,
          pendingTaps = 0;
        for (const [key, tap] of taps) {
          if (key.startsWith(`${idStr}:`)) {
            totalTaps++;
            const amt = tap.amount_msat || 0;
            totalMsat += amt;
            if (tap.status === "completed") {
              completedTaps++;
              completedMsat += amt;
            } else if (tap.status === "failed") {
              failedTaps++;
              failedMsat += amt;
            } else if (tap.status === "pending") {
              pendingTaps++;
              pendingMsat += amt;
            }
          }
        }
        return Response.json({
          totalMsat,
          completedMsat,
          failedMsat,
          pendingMsat,
          totalTaps,
          completedTaps: totalTaps === 0 ? null : completedTaps,
          failedTaps: totalTaps === 0 ? null : failedTaps,
          pendingTaps: totalTaps === 0 ? null : pendingTaps,
        });
      }

      if (request.method === "GET" && url.pathname === "/list-taps") {
        // Real DO (tapHandlers.handleListTaps): limit parsed with a
        // non-finite fallback of 50 then clamped to [1,200]; tap rows are
        // fetched ORDER BY counter DESC LIMIT ?; card-lifecycle pseudo-rows
        // (provisioned/activated/terminated/wipe_requested, sourced from
        // card_state timestamps) are merged in; the merged list is sorted
        // created_at DESC with counter DESC tie-break, then sliced to
        // limit.
        let rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
        if (!Number.isFinite(rawLimit)) rawLimit = 50;
        const limit = Math.max(1, Math.min(rawLimit, 200));

        const tapRows = Array.from(taps.entries())
          .filter(([key]) => key.startsWith(`${idStr}:`))
          .map(([, t]) => t)
          .sort((a, b) => b.counter - a.counter)
          .slice(0, limit);

        const cardState = cardStates.get(idStr);
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

        const merged = [...tapRows, ...events].sort((a, b) => {
          const timeDiff = ((b.created_at as number) || 0) - ((a.created_at as number) || 0);
          if (timeDiff !== 0) return timeDiff;
          return ((b.counter as number) || 0) - ((a.counter as number) || 0);
        });

        return Response.json({ taps: merged.slice(0, limit) });
      }

      if (request.method === "POST" && url.pathname === "/mark-pending") {
        const { key_provenance, key_fingerprint, key_label } = (await request.json()) as {
          key_provenance?: string;
          key_fingerprint?: string;
          key_label?: string;
        };
        if (cardStates.has(idStr)) {
          return Response.json({
            state: cardStates.get(idStr)!.state,
            already_exists: true,
          });
        }
        const now = Math.floor(Date.now() / 1000);
        cardStates.set(idStr, {
          ...getDefaultState(),
          state: "pending",
          key_provenance: key_provenance || null,
          key_fingerprint: key_fingerprint || null,
          key_label: key_label || null,
          first_seen_at: now,
        });
        return Response.json({
          state: "pending",
          key_provenance: key_provenance || null,
          key_fingerprint: key_fingerprint || null,
          key_label: key_label || null,
          first_seen_at: now,
        });
      }

      if (request.method === "POST" && url.pathname === "/discover") {
        const { key_provenance, key_fingerprint, key_label, active_version } = (await request.json()) as {
          key_provenance?: string;
          key_fingerprint?: string;
          key_label?: string;
          active_version?: number;
        };
        const version = active_version || 1;
        const now = Math.floor(Date.now() / 1000);

        if (cardStates.has(idStr)) {
          const current = cardStates.get(idStr)!;
          if (current.state === "pending" || current.state === "legacy" || current.state === "new") {
            cardStates.set(idStr, {
              ...current,
              state: "discovered",
              active_version: version,
              key_provenance: key_provenance || current.key_provenance,
              key_fingerprint: key_fingerprint || current.key_fingerprint,
              key_label: key_label || current.key_label,
            });
          }
          return Response.json({ ...cardStates.get(idStr)!, already_exists: true });
        }

        cardStates.set(idStr, {
          ...getDefaultState(),
          state: "discovered",
          latest_issued_version: version,
          active_version: version,
          key_provenance: key_provenance || null,
          key_fingerprint: key_fingerprint || null,
          key_label: key_label || null,
          first_seen_at: now,
        });
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

      if (request.method === "GET" && url.pathname === "/export-state") {
        // Real DO (stateExportHandlers.handleExportState): table rows or
        // null when the (singleton) row is absent; taps scan in rowid
        // order (= counter ASC, counter IS the rowid alias) and
        // transactions in id ASC; card_config is the raw table row with
        // config_json as a STRING.
        const state = cardStates.get(idStr);
        const config = cardConfigs.get(idStr) as unknown as Record<string, unknown> | undefined;
        const counter = counters.get(idStr);
        const cardTaps = Array.from(taps.entries())
          .filter(([key]) => key.startsWith(`${idStr}:`))
          .map(([, t]) => ({
            counter: t.counter,
            bolt11: t.bolt11,
            status: t.status,
            payment_hash: t.payment_hash,
            amount_msat: t.amount_msat,
            user_agent: t.user_agent,
            request_url: t.request_url,
            created_at: t.created_at,
            updated_at: t.updated_at,
          }))
          .sort((a, b) => a.counter - b.counter);
        const cardTxns = (transactions.get(idStr) || [])
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((t) => ({
            id: t.id,
            counter: t.counter,
            amount: t.amount,
            balance_after: t.balance_after,
            created_at: t.created_at,
            note: t.note,
            voided_at: t.voided_at ?? null,
          }));
        // Route-written configs export the RAW card_config row — the real
        // DO round-trips the stored config_json string verbatim (reserved
        // keys inside, invalid JSON and all); only externally seeded
        // logical configs synthesize a row.
        const rawRow = configRows.get(idStr);
        const configRow = rawRow
          ? {
              singleton: 1,
              K2: rawRow.K2,
              payment_method: rawRow.payment_method,
              config_json: rawRow.config_json,
              pull_payment_id: rawRow.pull_payment_id,
              updated_at: Math.floor(Date.now() / 1000),
            }
          : config
            ? (() => {
                const { K2, payment_method, pull_payment_id, ...rest } = config;
                return {
                  singleton: 1,
                  K2: K2 || null,
                  payment_method: payment_method || "fakewallet",
                  config_json: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
                  pull_payment_id: pull_payment_id || null,
                  updated_at: Math.floor(Date.now() / 1000),
                };
              })()
            : null;
        return Response.json({
          version: 1,
          exported_at: Date.now(),
          replay_state: counter !== undefined ? { singleton: 1, last_counter: counter } : null,
          card_state: state ? { singleton: 1, ...state } : null,
          card_config: configRow,
          taps: cardTaps,
          transactions: cardTxns,
        });
      }

      if (request.method === "POST" && url.pathname === "/import-state") {
        const body = await request.json() as Record<string, unknown>;
        if (body.version !== 1) {
          return Response.json({ error: "Unsupported export version" }, { status: 400 });
        }
        const importedState = body.card_state as Record<string, unknown> | null;
        const importedConfig = body.card_config as Record<string, unknown> | null;
        const importedReplay = body.replay_state as Record<string, unknown> | null;
        const importedTaps = body.taps as Array<Record<string, unknown>> | undefined;
        const importedTxns = body.transactions as Array<Record<string, unknown>> | undefined;

        // Real DO: DELETEs every table FIRST (a failed import still leaves
        // the tables cleared), then re-inserts; a NOT NULL violation on any
        // insert surfaces as the dispatcher's 500 {error:"Internal error"}.
        const internalError = Response.json({ error: "Internal error" }, { status: 500 });
        counters.delete(idStr);
        cardStates.delete(idStr);
        cardConfigs.delete(idStr);
        configRows.delete(idStr);
        for (const key of [...taps.keys()]) {
          if (key.startsWith(`${idStr}:`)) taps.delete(key);
        }
        transactions.set(idStr, []);

        if (importedReplay) {
          if (importedReplay.last_counter == null) return internalError;
          counters.set(idStr, Number(importedReplay.last_counter) || 0);
        }
        if (importedState) {
          if (importedState.state == null || importedState.latest_issued_version == null || importedState.balance == null) {
            return internalError;
          }
          cardStates.set(idStr, {
            state: String(importedState.state),
            latest_issued_version: Number(importedState.latest_issued_version) || 0,
            active_version: importedState.active_version != null ? Number(importedState.active_version) : null,
            activated_at: importedState.activated_at != null ? Number(importedState.activated_at) : null,
            terminated_at: importedState.terminated_at != null ? Number(importedState.terminated_at) : null,
            keys_delivered_at: importedState.keys_delivered_at != null ? Number(importedState.keys_delivered_at) : null,
            wipe_keys_fetched_at: importedState.wipe_keys_fetched_at != null ? Number(importedState.wipe_keys_fetched_at) : null,
            balance: Number(importedState.balance) || 0,
            key_provenance: (importedState.key_provenance as string) || null,
            key_fingerprint: (importedState.key_fingerprint as string) || null,
            key_label: (importedState.key_label as string) || null,
            first_seen_at: importedState.first_seen_at != null ? Number(importedState.first_seen_at) : null,
          });
        }
        if (importedConfig) {
          // Real DO: the card_config row is restored verbatim — typed
          // columns with their own ?? fallbacks, config_json as the RAW
          // string. Reserved keys inside config_json are legal here (the
          // only production path that can plant them) and resurface via
          // get-config's extras spread overriding the typed columns.
          const row: ConfigRow = {
            K2: (importedConfig.K2 as string) ?? null,
            payment_method: String(importedConfig.payment_method ?? "fakewallet"),
            config_json: (importedConfig.config_json as string) ?? null,
            pull_payment_id: (importedConfig.pull_payment_id as string) ?? null,
          };
          configRows.set(idStr, row);
          setLogicalConfig(idStr, projectConfigRow(row) as unknown as CardConfig);
        }
        if (Array.isArray(importedTaps)) {
          for (const t of importedTaps) {
            if (t.created_at == null || t.updated_at == null) return internalError;
            // INTEGER PRIMARY KEY parity: a NULL counter is auto-assigned
            // (max rowid + 1), not a constraint failure; a non-numeric
            // counter is a datatype mismatch → the dispatcher's 500, and
            // so is a NON-INTEGER numeric (SQLite rowid aliases reject
            // fractional values with the same datatype-mismatch error).
            let tCounter = Number(t.counter);
            if (t.counter != null && (!Number.isInteger(tCounter) || Number.isNaN(tCounter))) return internalError;
            if (t.counter == null) {
              let max = 0;
              for (const key of taps.keys()) {
                if (key.startsWith(`${idStr}:`)) max = Math.max(max, Number(key.slice(idStr.length + 1)) || 0);
              }
              tCounter = max + 1;
            }
            taps.set(`${idStr}:${tCounter}`, {
              counter: tCounter,
              bolt11: (t.bolt11 as string) || null,
              status: String(t.status || "pending"),
              payment_hash: (t.payment_hash as string) || null,
              amount_msat: t.amount_msat != null ? Number(t.amount_msat) : null,
              user_agent: (t.user_agent as string) || null,
              request_url: (t.request_url as string) || null,
              created_at: Number(t.created_at) || 0,
              updated_at: Number(t.updated_at) || 0,
            });
          }
        }
        if (Array.isArray(importedTxns)) {
          for (const t of importedTxns) {
            if (t.amount == null || t.balance_after == null || t.created_at == null) return internalError;
          }
          const txns: Transaction[] = importedTxns.map((t) => ({
            id: Number(t.id) || 0,
            counter: t.counter != null ? Number(t.counter) : null,
            amount: Number(t.amount) || 0,
            balance_after: Number(t.balance_after) || 0,
            created_at: Number(t.created_at) || 0,
            note: (t.note as string) || null,
            voided_at: t.voided_at != null ? Number(t.voided_at) : null,
          }));
          transactions.set(idStr, txns);
          // AUTOINCREMENT parity: sqlite_sequence only grows.
          const maxId = txns.reduce((m, t) => Math.max(m, t.id), 0);
          txnSeq.set(idStr, Math.max(txnSeq.get(idStr) ?? 0, maxId));
        }

        return Response.json({
          restored: true,
          tables: {
            replay_state: importedReplay ? 1 : 0,
            card_state: importedState ? 1 : 0,
            card_config: importedConfig ? 1 : 0,
            taps: Array.isArray(importedTaps) ? importedTaps.length : 0,
            transactions: Array.isArray(importedTxns) ? importedTxns.length : 0,
          },
        });
      }

      return new Response("Not found", { status: 404 });
  };

  const makeStub = (idStr: string): DurableObjectStub<undefined> => ({
    fetch: async (request: Request): Promise<Response> => {
      // Mirror the real DO dispatcher (durableObjects/CardReplayStore.ts):
      // a malformed JSON body is a 400, not an unhandled rejection.
      try {
        return await routeRequest(idStr, request);
      } catch (err: unknown) {
        if (err instanceof SyntaxError) {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        throw err;
      }
    },
  }) as DurableObjectStub<undefined>;

  return {
    newUniqueId: () => toId(`unique-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    idFromName: (name: string) => toId(name),
    idFromString: (id: string) => toId(id),
    get: (id: DurableObjectId) => makeStub(fromId(id)),
    getByName: (name: string) => makeStub(name.toLowerCase()),
    jurisdiction: () => makeReplayNamespace({}, {}) as unknown as DurableObjectNamespace<undefined>,
    __counters: counters,
    __taps: taps,
    __cardStates: cardStates,
    __cardConfigs: cardConfigs,
    __transactions: transactions,
    __k1Challenges: k1Challenges,
    __activate(uid: string, version: number = 1) {
      cardStates.set(uid.toLowerCase(), {
        state: "active",
        latest_issued_version: version,
        active_version: version,
        activated_at: Math.floor(Date.now() / 1000),
        terminated_at: null,
        keys_delivered_at: null,
        wipe_keys_fetched_at: null,
        balance: 0,
        key_provenance: null,
        key_fingerprint: null,
        key_label: null,
        first_seen_at: null,
      });
    },
  };
};
