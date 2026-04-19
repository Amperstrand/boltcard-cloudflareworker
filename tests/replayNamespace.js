export const makeReplayNamespace = (initialCounters = {}) => {
  const counters = new Map(
    Object.entries(initialCounters).map(([uid, value]) => [uid.toLowerCase(), value])
  );
  const taps = new Map();

  return {
    idFromName: (name) => name.toLowerCase(),
    get: (id) => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        const idStr = String(id).toLowerCase();

        if (request.method === "POST" && url.pathname === "/reset") {
          counters.delete(idStr);
          // Also clear all taps for this id
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

          // Read-only: don't record the counter
          return Response.json({ accepted: true, lastCounter });
        }

        if (request.method === "POST" && url.pathname === "/record-tap") {
          const { counterValue, bolt11, userAgent, requestUrl } = await request.json();
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

          // Record the counter and tap metadata atomically
          counters.set(idStr, counterValue);
          const tapKey = `${idStr}:${counterValue}`;
          const now = Math.floor(Date.now() / 1000);
          taps.set(tapKey, {
            counter: counterValue,
            bolt11: bolt11 || null,
            status: "pending",
            payment_hash: null,
            amount_msat: null,
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

          const validStatuses = ["pending", "paying", "completed", "failed", "expired"];
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

        if (request.method === "GET" && url.pathname === "/list-taps") {
          const limit = parseInt(url.searchParams.get("limit") || "50", 10);
          const tapList = [];
          let count = 0;

          // Get all taps for this id, sorted by counter DESC
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
  };
};
