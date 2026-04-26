export const makeReplayNamespace = (initialCounters = {}, initialCards = {}) => {
  const counters = new Map(
    Object.entries(initialCounters).map(([uid, value]) => [uid.toLowerCase(), value])
  );
  const taps = new Map();
  const cardStates = new Map();
  const cardConfigs = new Map();
  const transactions = new Map();

  // Pre-activate cards from initialCards: { uid: version }
  // If a UID has counters but no explicit card entry, default to active version 1
  const allUids = new Set([
    ...counters.keys(),
    ...Object.keys(initialCards).map(u => u.toLowerCase()),
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

  const getDefaultState = () => ({
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

  return {
    idFromName: (name) => name.toLowerCase(),
    get: (id) => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        const idStr = String(id).toLowerCase();

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
          const config = await request.json();
          cardConfigs.set(idStr, config);
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
          const txs = (transactions.get(idStr) || []).slice().sort((a, b) => b.id - a.id).slice(0, limit);
          return Response.json({ transactions: txs });
        }

        if (request.method === "POST" && url.pathname === "/debit") {
          const { counter, amount, note } = await request.json();
          if (!Number.isInteger(amount) || amount <= 0) {
            return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
          }

          const current = cardStates.get(idStr) || getDefaultState();
          const newBalance = (current.balance ?? 0) - amount;
          const now = Math.floor(Date.now() / 1000);
          cardStates.set(idStr, { ...current, balance: newBalance });

          const existing = transactions.get(idStr) || [];
          const transaction = {
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
          const { amount, note } = await request.json();
          if (!Number.isInteger(amount) || amount <= 0) {
            return Response.json({ ok: false, reason: "Amount must be a positive integer" }, { status: 400 });
          }

          const current = cardStates.get(idStr) || getDefaultState();
          const newBalance = (current.balance ?? 0) + amount;
          const now = Math.floor(Date.now() / 1000);
          cardStates.set(idStr, { ...current, balance: newBalance });

          const existing = transactions.get(idStr) || [];
          const transaction = {
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
          const newState = {
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
          return Response.json(newState);
        }

        if (request.method === "POST" && url.pathname === "/activate") {
          const { active_version } = await request.json();
          const current = cardStates.get(idStr) || getDefaultState();
          const now = Math.floor(Date.now() / 1000);
          const newState = {
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
          const newState = {
            ...current,
            state: "terminated",
            terminated_at: now,
            balance: current.balance ?? 0,
          };
          cardStates.set(idStr, newState);
          counters.delete(idStr);
          for (const [key] of taps) {
            if (key.startsWith(`${idStr}:`)) {
              taps.delete(key);
            }
          }
          return Response.json(newState);
        }

        if (request.method === "POST" && url.pathname === "/reset") {
          counters.delete(idStr);
          for (const [key] of taps) {
            if (key.startsWith(`${idStr}:`)) {
              taps.delete(key);
            }
          }
          return Response.json({ reset: true });
        }

        if (request.method === "POST" && url.pathname === "/check") {
          const { counterValue } = await request.json();
          const lastCounter = counters.has(idStr) ? counters.get(idStr) : null;

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
          const { counterValue } = await request.json();
          const lastCounter = counters.has(idStr) ? counters.get(idStr) : null;

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

          // read-only check does NOT advance the counter
          // (the real DO distinguishes readOnly vs non-readonly)
          return Response.json({ accepted: true, lastCounter });
        }

        if (request.method === "POST" && url.pathname === "/record-read") {
          const { counterValue, userAgent, requestUrl } = await request.json();
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
          const { counterValue, bolt11, amountMsat, userAgent, requestUrl } = await request.json();
          const lastCounter = counters.has(idStr) ? counters.get(idStr) : null;
          const tapKey = `${idStr}:${counterValue}`;
          const existingTap = taps.get(tapKey);

          // Allow recording if this is upgrading a "read" entry from Step 1
          // (Step 1 uses record-read which creates a tap with status="read", no bolt11)
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

        if (request.method === "POST" && url.pathname === "/update-tap-status") {
          const { counter, status, bolt11, amountMsat } = await request.json();

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
          let totalMsat = 0, completedMsat = 0, failedMsat = 0, pendingMsat = 0;
          let totalTaps = 0, completedTaps = 0, failedTaps = 0, pendingTaps = 0;
          for (const [key, tap] of taps) {
            if (key.startsWith(`${idStr}:`)) {
              totalTaps++;
              const amt = tap.amount_msat || 0;
              totalMsat += amt;
              if (tap.status === 'completed') { completedTaps++; completedMsat += amt; }
              else if (tap.status === 'failed') { failedTaps++; failedMsat += amt; }
              else { pendingTaps++; pendingMsat += amt; }
            }
          }
          return Response.json({ totalMsat, completedMsat, failedMsat, pendingMsat, totalTaps, completedTaps, failedTaps, pendingTaps });
        }

        if (request.method === "GET" && url.pathname === "/list-taps") {
          const limit = parseInt(url.searchParams.get("limit") || "50", 10);
          const tapList = [];
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
          const { key_provenance, key_fingerprint, key_label } = await request.json();
          if (cardStates.has(idStr)) {
            return Response.json({
              state: cardStates.get(idStr).state,
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
          const { key_provenance, key_fingerprint, key_label, active_version } = await request.json();
          const version = active_version || 1;
          const now = Math.floor(Date.now() / 1000);

          if (cardStates.has(idStr)) {
            const current = cardStates.get(idStr);
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
            return Response.json({ ...cardStates.get(idStr), already_exists: true });
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

        return new Response("Not found", { status: 404 });
      },
    }),
    __counters: counters,
    __taps: taps,
    __cardStates: cardStates,
    __cardConfigs: cardConfigs,
    __transactions: transactions,
    __activate(uid, version = 1) {
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
