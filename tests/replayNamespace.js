export const makeReplayNamespace = (initialCounters = {}) => {
  const counters = new Map(
    Object.entries(initialCounters).map(([uid, value]) => [uid.toLowerCase(), value])
  );

  return {
    idFromName: (name) => name.toLowerCase(),
    get: (id) => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/reset") {
          counters.delete(String(id).toLowerCase());
          return Response.json({ reset: true });
        }

        if (request.method !== "POST" || url.pathname !== "/check") {
          return new Response("Not found", { status: 404 });
        }

        const { counterValue } = await request.json();
        const key = String(id).toLowerCase();
        const lastCounter = counters.has(key) ? counters.get(key) : null;

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

        counters.set(key, counterValue);
        return Response.json({ accepted: true, lastCounter: counterValue });
      },
    }),
    __counters: counters,
  };
};
