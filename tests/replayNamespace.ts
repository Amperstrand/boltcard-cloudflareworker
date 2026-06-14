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
}

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
  const cardConfigs = new Map<string, CardConfig>();
  const transactions = new Map<string, Transaction[]>();

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

  const makeStub = (idStr: string): DurableObjectStub<undefined> => ({
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/card-state") {
        if (!cardStates.has(idStr)) {
          return Response.json(getDefaultState());
        }
        return Response.json(cardStates.get(idStr));
      }

      if (request.method === "GET" && url.pathname === "/get-config") {
        if (!cardConfigs.has(idStr)) {
          return Response.json(null);
        }
        return Response.json(cardConfigs.get(idStr));
      }

      if (request.method === "POST" && url.pathname === "/set-config") {
        const config = (await request.json()) as CardConfig;
        cardConfigs.set(idStr, config);
        return Response.json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/set-k2") {
        const { K2 } = (await request.json()) as { K2: string };
        const existing = cardConfigs.get(idStr);
        if (existing) {
          cardConfigs.set(idStr, { ...existing, K2: K2 || null });
        } else {
          cardConfigs.set(idStr, { payment_method: "fakewallet", K2: K2 || null });
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
        const txs = (transactions.get(idStr) || [])
          .slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, limit);
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
          id: existing.length + 1,
          counter: Number.isInteger(counter) ? counter : null,
          amount: -amount,
          balance_after: newBalance,
          created_at: now,
          note: note || null,
        };
        transactions.set(idStr, [...existing, transaction]);

        return Response.json({ ok: true, balance: newBalance, transaction });
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
          id: existing.length + 1,
          counter: null,
          amount,
          balance_after: newBalance,
          created_at: now,
          note: note || null,
        };
        transactions.set(idStr, [...existing, transaction]);

        return Response.json({ ok: true, balance: newBalance, transaction });
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
          wipe_keys_fetched_at: current.wipe_keys_fetched_at ?? null,
          balance: current.balance ?? 0,
        };
        cardStates.set(idStr, newState);
        return Response.json({ ...newState, version: newState.latest_issued_version });
      }

      if (request.method === "POST" && url.pathname === "/activate") {
        const { active_version } = (await request.json()) as { active_version: number };
        const current = cardStates.get(idStr) || getDefaultState();
        const now = Math.floor(Date.now() / 1000);
        const newState: CardState = {
          ...current,
          state: "active",
          active_version,
          activated_at: now,
          wipe_keys_fetched_at: null,
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
        const current = cardStates.get(idStr) || getDefaultState();
        const now = Math.floor(Date.now() / 1000);
        cardStates.set(idStr, {
          ...current,
          state: "wipe_requested",
          wipe_keys_fetched_at: now,
          balance: current.balance ?? 0,
        });
        return Response.json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        counters.delete(idStr);
        for (const key of [...taps.keys()]) {
          if (key.startsWith(`${idStr}:`)) {
            taps.delete(key);
          }
        }
        return Response.json({ reset: true });
      }

      if (request.method === "POST" && url.pathname === "/check") {
        const { counterValue } = (await request.json()) as { counterValue: number };
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
        const tapKey = `${idStr}:${counterValue}`;
        if (!taps.has(tapKey)) {
          const now = Math.floor(Date.now() / 1000);
          taps.set(tapKey, {
            counter: counterValue,
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
        const lastCounter = counters.has(idStr) ? counters.get(idStr)! : null;
        const tapKey = `${idStr}:${counterValue}`;
        const existingTap = taps.get(tapKey);

        if (existingTap && existingTap.status === "read" && !existingTap.bolt11) {
          const now = Math.floor(Date.now() / 1000);
          counters.set(idStr, counterValue);
          taps.set(tapKey, {
            ...existingTap,
            bolt11: bolt11 || null,
            amount_msat: amountMsat || null,
            status: "pending",
            updated_at: now,
          });
          return Response.json({ accepted: true, lastCounter: counterValue, tapRecorded: true });
        }

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
        taps.set(tapKey, {
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

        const now = Math.floor(Date.now() / 1000);
        tap.bolt11 = bolt11 || null;
        tap.amount_msat = amountMsat ?? tap.amount_msat;
        tap.status = "pending";
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

        if (!counter || !status) {
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
            } else {
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
          completedTaps,
          failedTaps,
          pendingTaps,
        });
      }

      if (request.method === "GET" && url.pathname === "/list-taps") {
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const tapList: TapRecord[] = [];
        let count = 0;

        for (const [key, tap] of taps) {
          if (key.startsWith(`${idStr}:`)) {
            tapList.push(tap);
            count++;
            if (count >= limit) break;
          }
        }

        tapList.sort((a, b) => b.counter - a.counter);

        return Response.json({ taps: tapList });
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
        const state = cardStates.get(idStr);
        const config = cardConfigs.get(idStr);
        const counter = counters.get(idStr) ?? 0;
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
          }));
        const cardTxns = (transactions.get(idStr) || []).map((t) => ({
          id: t.id,
          counter: t.counter,
          amount: t.amount,
          balance_after: t.balance_after,
          created_at: t.created_at,
          note: t.note,
          voided_at: (t as unknown as Record<string, unknown>).voided_at ?? null,
        }));
        return Response.json({
          version: 1,
          exported_at: Date.now(),
          replay_state: { singleton: 1, last_counter: counter },
          card_state: state ? { singleton: 1, ...state } : null,
          card_config: config ? { singleton: 1, ...config, updated_at: null } : null,
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

        if (importedReplay) {
          counters.set(idStr, Number(importedReplay.last_counter) || 0);
        }
        if (importedState) {
          cardStates.set(idStr, {
            state: String(importedState.state || "active"),
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
            cardConfigs.set(idStr, {
              K2: (importedConfig.K2 as string) || null,
              payment_method: String(importedConfig.payment_method || "fakewallet") as CardConfig["payment_method"],
              config_json: (importedConfig.config_json as string) || undefined,
              pull_payment_id: (importedConfig.pull_payment_id as string) || undefined,
            });
          }
        taps.clear();
        if (Array.isArray(importedTaps)) {
          for (const t of importedTaps) {
            const tCounter = Number(t.counter);
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
        transactions.set(idStr, []);
        if (Array.isArray(importedTxns)) {
          const txns: Transaction[] = importedTxns.map((t, i) => ({
            id: Number(t.id) || i + 1,
            counter: t.counter != null ? Number(t.counter) : null,
            amount: Number(t.amount) || 0,
            balance_after: Number(t.balance_after) || 0,
            created_at: Number(t.created_at) || 0,
            note: (t.note as string) || null,
          }));
          transactions.set(idStr, txns);
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
