export const makeReplayNamespace = (initialCounters = {}, initialCards = {}) => {
  const counters = new Map(
    Object.entries(initialCounters).map(([uid, value]) => [uid.toLowerCase(), value])
  );
  const taps = new Map();
  const cardStates = new Map();

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
    });
  }

  const getDefaultState = () => ({
    state: "new",
    latest_issued_version: 0,
    active_version: null,
    activated_at: null,
    terminated_at: null,
    keys_delivered_at: null,
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
          const tapKey = `${idStr}:${counterValue}`;
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
          const { counter, status } = await request.json();

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

        return new Response("Not found", { status: 404 });
      },
    }),
    __counters: counters,
    __taps: taps,
    __cardStates: cardStates,
    __activate(uid, version = 1) {
      cardStates.set(uid.toLowerCase(), {
        state: "active",
        latest_issued_version: version,
        active_version: version,
        activated_at: Math.floor(Date.now() / 1000),
        terminated_at: null,
        keys_delivered_at: null,
      });
    },
  };
};
