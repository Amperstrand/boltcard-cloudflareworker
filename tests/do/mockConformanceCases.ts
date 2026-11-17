export interface StepReq {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  rawBody?: string;
}

export interface Verdict {
  status: number;
  body: unknown;
}

export interface ContractCase {
  name: string;
  steps: Array<(ctx: unknown[]) => StepReq>;
  /**
   * PLATFORM DIVERGENCE (parked): on these cases the real-DO leg is
   * unobservable through the workerd DO stub — a malformed JSON body makes
   * `request.json()` throw a jsg.SyntaxError that escapes
   * CardReplayStore.fetch's `catch (err instanceof SyntaxError)` and rejects
   * the stub RPC, so the dispatcher's documented 400 branch never runs in
   * the test pool. The mock (node pool) executes the dispatcher contract
   * faithfully; these cases pin the mock to that documented oracle instead
   * of cross-implementation parity. Revisit if workerd ever makes the JSON
   * parse error catchable inside the DO (see ops session #27 log).
   */
  platformDivergence?: { expected: Verdict[] };
}

const post = (path: string, body: unknown = {}): StepReq => ({ method: "POST", path, body });
const get = (path: string): StepReq => ({ method: "GET", path });
const rawPost = (path: string, rawBody: string): StepReq => ({ method: "POST", path, rawBody });

function k1From(prior: unknown): string {
  if (typeof prior === "object" && prior !== null && "k1" in prior) {
    const k1 = (prior as Record<string, unknown>).k1;
    if (typeof k1 === "string") return k1;
  }
  throw new Error("contract step ctx: expected an issued k1");
}

export function normalizeVerdict(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(normalizeVerdict);
  if (typeof body === "object" && body !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (/_at$/.test(key)) {
        out[key] = "<ts>";
      } else if (typeof value === "string" && /^[0-9a-f]{32}$/.test(value)) {
        out[key] = "<k1hex>";
      } else {
        out[key] = normalizeVerdict(value);
      }
    }
    return out;
  }
  return body;
}

export const CONTRACT_CASES: ContractCase[] = [
  // /check
  {
    name: "/check: first counter accepted",
    steps: [() => post("/check", { counterValue: 5 })],
  },
  {
    name: "/check: replay of same counter rejected 409",
    steps: [() => post("/check", { counterValue: 5 }), () => post("/check", { counterValue: 5 })],
  },
  {
    name: "/check: lower counter rejected 409",
    steps: [() => post("/check", { counterValue: 5 }), () => post("/check", { counterValue: 3 })],
  },
  {
    name: "/check: higher counter after previous accepted",
    steps: [() => post("/check", { counterValue: 5 }), () => post("/check", { counterValue: 6 })],
  },
  {
    name: "/check: non-integer counter 3.5 rejected 400",
    steps: [() => post("/check", { counterValue: 3.5 })],
  },
  {
    name: "/check: negative counter rejected 400",
    steps: [() => post("/check", { counterValue: -2 })],
  },
  {
    name: "/check: invalid counter on fresh state rejected 400",
    steps: [() => post("/check", { counterValue: -1 })],
  },
  {
    name: "/check: mixed sequence of replays and advances",
    steps: [
      () => post("/check", { counterValue: 10 }),
      () => post("/check", { counterValue: 7 }),
      () => post("/check", { counterValue: 10 }),
      () => post("/check", { counterValue: 11 }),
      () => post("/check", { counterValue: 3 }),
    ],
  },

  // /check-readonly
  {
    name: "/check-readonly: fresh state accepted with null lastCounter",
    steps: [() => post("/check-readonly", { counterValue: 1 })],
  },
  {
    name: "/check-readonly: equal counter after check 5 rejected 409",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/check-readonly", { counterValue: 5 }),
    ],
  },
  {
    name: "/check-readonly: lower counter after check 5 rejected 409",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/check-readonly", { counterValue: 3 }),
    ],
  },
  {
    name: "/check-readonly: does not advance counter (check 5, ro 10, check 6)",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/check-readonly", { counterValue: 10 }),
      () => post("/check", { counterValue: 6 }),
    ],
  },
  {
    name: "/check-readonly: invalid counter rejected 400",
    steps: [() => post("/check-readonly", { counterValue: -4 })],
  },

  // /record-read
  {
    name: "/record-read: valid counter recorded",
    steps: [
      () => post("/record-read", { counterValue: 4, userAgent: "vitest", requestUrl: "http://tap" }),
    ],
  },
  {
    name: "/record-read: repeat same counter idempotent",
    steps: [
      () => post("/record-read", { counterValue: 4 }),
      () => post("/record-read", { counterValue: 4 }),
    ],
  },
  {
    name: "/record-read: null counterValue falls back to timestamp",
    steps: [() => post("/record-read", { counterValue: null })],
  },

  // /record-tap
  {
    name: "/record-tap: fresh counter accepted and recorded",
    steps: [() => post("/record-tap", { counterValue: 6, bolt11: "lnbc6", amountMsat: 6000 })],
  },
  {
    name: "/record-tap: higher counter after check 5 accepted",
    steps: [() => post("/check", { counterValue: 5 }), () => post("/record-tap", { counterValue: 6 })],
  },
  {
    // Step-1 invariant: /check already advanced the counter, so the callback's
    // /record-tap at the same counter must 409 — the tap rides /claim-tap's
    // read-row path instead (durableObjects/cardReplay/tapHandlers.ts).
    name: "/record-tap: step-1 shape (check 5, record-read 5) rejected 409",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/record-read", { counterValue: 5 }),
      () => post("/record-tap", { counterValue: 5 }),
    ],
  },
  {
    name: "/record-tap: lower counter after check 5 rejected 409",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/record-tap", { counterValue: 3 }),
    ],
  },
  {
    name: "/record-tap: invalid counter rejected 400",
    steps: [() => post("/record-tap", { counterValue: -1 })],
  },
  {
    name: "/record-tap: double tap same fresh counter accepted then 409",
    steps: [
      () => post("/record-tap", { counterValue: 6 }),
      () => post("/record-tap", { counterValue: 6 }),
    ],
  },

  // /claim-tap
  {
    name: "/claim-tap: no-row claim with bolt11 inserts and claims",
    steps: [() => post("/claim-tap", { counter: 5, bolt11: "lnbc50", amountMsat: 50000 })],
  },
  {
    name: "/claim-tap: read-row claim after check and record-read claims",
    steps: [
      () => post("/check", { counterValue: 7 }),
      () => post("/record-read", { counterValue: 7 }),
      () => post("/claim-tap", { counter: 7, bolt11: "lnbc100" }),
    ],
  },
  {
    name: "/claim-tap: pr-path replay of bolt11 row 409 carries bolt11",
    steps: [
      () => post("/claim-tap", { counter: 5, bolt11: "lnbc1" }),
      () => post("/claim-tap", { counter: 5, bolt11: "lnbc2" }),
    ],
  },
  {
    // #85 first-callback-wins: an amount-only callback (bolt11 null) still
    // consumes the tap — the inserted 'pending' row is a callback attempt,
    // never claimable again.
    name: "/claim-tap: amount-only first claim (#85 guard) claims",
    steps: [() => post("/claim-tap", { counter: 8, amountMsat: 8000 })],
  },
  {
    name: "/claim-tap: amount-only replay rejected 409 (#85 guard)",
    steps: [
      () => post("/claim-tap", { counter: 8, amountMsat: 8000 }),
      () => post("/claim-tap", { counter: 8, amountMsat: 8000 }),
    ],
  },
  {
    name: "/claim-tap: read-row amount-only claim (bolt11 null) claims",
    steps: [
      () => post("/record-read", { counterValue: 7 }),
      () => post("/claim-tap", { counter: 7, amountMsat: 7000 }),
    ],
  },
  {
    // Only a 'read' row (the withdraw REQUEST) is claimable; every status a
    // callback attempt can leave behind must 409 on replay (#85 guard).
    name: "/claim-tap: status taxonomy — read claims, callback statuses 409",
    steps: [
      () => post("/record-read", { counterValue: 10 }),
      () => post("/record-tap", { counterValue: 11 }),
      () => post("/claim-tap", { counter: 12, amountMsat: 1200 }),
      () => post("/update-tap-status", { counter: 12, status: "paying" }),
      () => post("/record-tap", { counterValue: 13 }),
      () => post("/update-tap-status", { counter: 13, status: "completed" }),
      () => post("/record-tap", { counterValue: 14 }),
      () => post("/update-tap-status", { counter: 14, status: "failed" }),
      () => post("/record-tap", { counterValue: 15 }),
      () => post("/update-tap-status", { counter: 15, status: "expired" }),
      () => post("/claim-tap", { counter: 10 }),
      () => post("/claim-tap", { counter: 11 }),
      () => post("/claim-tap", { counter: 12 }),
      () => post("/claim-tap", { counter: 13 }),
      () => post("/claim-tap", { counter: 14 }),
      () => post("/claim-tap", { counter: 15 }),
    ],
  },
  {
    name: "/claim-tap: negative counter rejected 400",
    steps: [() => post("/claim-tap", { counter: -1 })],
  },
  {
    name: "/claim-tap: non-integer counter 2.5 rejected 400",
    steps: [() => post("/claim-tap", { counter: 2.5 })],
  },
  {
    name: "/claim-tap: end-to-end production shape (step1, read, tap 409, claim, reclaim 409)",
    steps: [
      () => post("/check", { counterValue: 9 }),
      () => post("/record-read", { counterValue: 9 }),
      () => post("/record-tap", { counterValue: 9 }),
      () => post("/claim-tap", { counter: 9, bolt11: "lnbc9" }),
      () => post("/claim-tap", { counter: 9 }),
    ],
  },

  // /update-tap-status
  {
    name: "/update-tap-status: completed after record-tap updates",
    steps: [
      () => post("/record-tap", { counterValue: 5, bolt11: "lnbc1" }),
      () => post("/update-tap-status", { counter: 5, status: "completed" }),
    ],
  },
  {
    name: "/update-tap-status: missing row returns updated false",
    steps: [() => post("/update-tap-status", { counter: 999, status: "completed" })],
  },
  {
    name: "/update-tap-status: missing status rejected 400",
    steps: [
      () => post("/record-tap", { counterValue: 5 }),
      () => post("/update-tap-status", { counter: 5 }),
    ],
  },
  {
    name: "/update-tap-status: invalid status rejected 400",
    steps: [() => post("/update-tap-status", { counter: 5, status: "bogus" })],
  },
  {
    name: "/update-tap-status: counter 0 missing row returns updated false",
    steps: [() => post("/update-tap-status", { counter: 0, status: "completed" })],
  },
  {
    // bolt11 COALESCE: a provided bolt11 overwrites; a null bolt11 keeps the
    // stored one — proven by the 409 claim body carrying the NEW bolt11.
    name: "/update-tap-status: bolt11 coalesce keeps stored value on null",
    steps: [
      () => post("/record-tap", { counterValue: 5 }),
      () => post("/update-tap-status", { counter: 5, status: "completed", bolt11: "lnbc-new" }),
      () => post("/update-tap-status", { counter: 5, status: "failed" }),
      () => post("/claim-tap", { counter: 5, bolt11: "lnbc-other" }),
    ],
  },

  // /k1-issue + /k1-verify
  {
    name: "/k1-verify: right counter with ttl 60 valid",
    steps: [
      () => post("/k1-issue", { counterValue: 8, maxAgeSec: 60 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 8, ttlSeconds: 60 }),
    ],
  },
  {
    name: "/k1-verify: single-use — re-verify same k1 unknown-or-used",
    steps: [
      () => post("/k1-issue", { counterValue: 8, maxAgeSec: 60 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 8, ttlSeconds: 60 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 8, ttlSeconds: 60 }),
    ],
  },
  {
    // Counter mismatch belongs to a different outstanding tap of the same
    // card: the challenge is kept for its rightful counter.
    name: "/k1-verify: counter mismatch keeps challenge, right counter then valid",
    steps: [
      () => post("/k1-issue", { counterValue: 9, maxAgeSec: 60 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 10, ttlSeconds: 60 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 9, ttlSeconds: 60 }),
    ],
  },
  {
    name: "/k1-verify: unknown k1 unknown-or-used",
    steps: [
      () =>
        post("/k1-verify", { k1: "deadbeefdeadbeefdeadbeefdeadbeef", counterValue: 1, ttlSeconds: 60 }),
    ],
  },
  {
    name: "/k1-verify: empty k1 rejected 400",
    steps: [() => post("/k1-verify", { k1: "", counterValue: 1, ttlSeconds: 60 })],
  },
  {
    name: "/k1-verify: missing counterValue rejected 400",
    steps: [
      () => post("/k1-verify", { k1: "ffeeddccbbaa99887766554433221100", ttlSeconds: 60 }),
    ],
  },
  {
    name: "/k1-issue: negative counterValue rejected 400",
    steps: [() => post("/k1-issue", { counterValue: -1 })],
  },
  {
    name: "/k1-issue: non-integer counterValue rejected 400",
    steps: [() => post("/k1-issue", { counterValue: 1.5 })],
  },
  {
    // TTL determinism trick: created_at + 0 <= now always holds, so a 0 TTL
    // is an unconditional expiry without any sleep.
    name: "/k1-verify: ttl 0 always expired",
    steps: [
      () => post("/k1-issue", { counterValue: 11 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 11, ttlSeconds: 0 }),
    ],
  },
  {
    name: "/k1-verify: two outstanding challenges independently valid",
    steps: [
      () => post("/k1-issue", { counterValue: 21 }),
      () => post("/k1-issue", { counterValue: 22 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[1]), counterValue: 22, ttlSeconds: 60 }),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 21, ttlSeconds: 60 }),
    ],
  },

  // /reset
  {
    name: "/reset: check 5 then reset then check 5 accepted",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/reset"),
      () => post("/check", { counterValue: 5 }),
    ],
  },
  {
    name: "/reset: claim insert then reset then same claim claims again",
    steps: [
      () => post("/claim-tap", { counter: 5, bolt11: "lnbc1" }),
      () => post("/reset"),
      () => post("/claim-tap", { counter: 5, bolt11: "lnbc2" }),
    ],
  },
  {
    name: "/reset: outstanding k1 challenge cleared",
    steps: [
      () => post("/k1-issue", { counterValue: 3, maxAgeSec: 60 }),
      () => post("/reset"),
      (ctx) => post("/k1-verify", { k1: k1From(ctx[0]), counterValue: 3, ttlSeconds: 60 }),
    ],
  },

  // malformed JSON — PLATFORM DIVERGENCE (parked): real DO stub fetch
  // rejects with an uncatchable workerd jsg SyntaxError (request.json()
  // parse failure escapes CardReplayStore.fetch's catch), so its 400
  // {error:"Invalid JSON body"} branch is unobservable in the test pool.
  // The mock must keep delivering the dispatcher's documented 400.
  {
    name: "/check: malformed JSON body rejected 400",
    steps: [() => rawPost("/check", "{not json")],
    platformDivergence: { expected: [{ status: 400, body: { error: "Invalid JSON body" } }] },
  },
  {
    name: "/record-tap: malformed JSON body rejected 400",
    steps: [() => rawPost("/record-tap", "{not json")],
    platformDivergence: { expected: [{ status: 400, body: { error: "Invalid JSON body" } }] },
  },
  {
    name: "/claim-tap: malformed JSON body rejected 400",
    steps: [() => rawPost("/claim-tap", "{not json")],
    platformDivergence: { expected: [{ status: 400, body: { error: "Invalid JSON body" } }] },
  },
  {
    name: "/k1-issue: malformed JSON body rejected 400",
    steps: [() => rawPost("/k1-issue", "{not json")],
    platformDivergence: { expected: [{ status: 400, body: { error: "Invalid JSON body" } }] },
  },

  // unknown route
  {
    name: "/nope: unknown path GET returns 404",
    steps: [() => get("/nope")],
  },
];
