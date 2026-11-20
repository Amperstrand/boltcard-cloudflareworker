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
   * PLATFORM DIVERGENCE (historical, currently unused): for cases whose
   * real-DO leg is unobservable through the workerd DO stub. Last used for
   * malformed-JSON bodies (ops#27): the real dispatcher's route dispatches
   * were `return handler(...)` without `await`, so its
   * `catch (err instanceof SyntaxError)` never fired for async rejections
   * and the stub RPC rejected instead of answering the documented 400.
   * That was misdiagnosed as an uncatchable workerd jsg error; the fix
   * (`return await`, both here and mirrored in the mock) unparked those
   * cases as true parity. See the wave-2 research log.
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

  // malformed JSON — true parity since the dispatcher `return await` fix:
  // the catch now guards async rejections, so `request.json()` parse
  // failures reach the documented 400 branch on the real DO exactly like
  // the mock. (Previously parked as platformDivergence; see research log.)
  {
    name: "/check: malformed JSON body rejected 400",
    steps: [() => rawPost("/check", "{not json")],
  },
  {
    name: "/record-tap: malformed JSON body rejected 400",
    steps: [() => rawPost("/record-tap", "{not json")],
  },
  {
    name: "/claim-tap: malformed JSON body rejected 400",
    steps: [() => rawPost("/claim-tap", "{not json")],
  },
  {
    name: "/k1-issue: malformed JSON body rejected 400",
    steps: [() => rawPost("/k1-issue", "{not json")],
  },

  // unknown route
  {
    name: "/nope: unknown path GET returns 404",
    steps: [() => get("/nope")],
  },

  // -------------------------------------------------------------------------
  // wave-2 contract cases (ops#36) — list-taps / analytics / balance /
  // transactions / debit / credit / void / lifecycle / config / export+import.
  //
  // Determinism doctrine (both legs run real clocks): every case creates tap
  // rows with counters that INCREASE with creation time, so the merged
  // created_at-DESC / counter-DESC comparator is boundary-independent; a
  // pseudo-row created BEFORE all taps always sorts after them (equal-second
  // falls through to the counter tie-break, which taps win). Multi-pseudo-row
  // orderings are seeded via /import-state with FIXED timestamps.
  // -------------------------------------------------------------------------

  // /list-taps
  {
    name: "/list-taps: fresh state returns empty array",
    steps: [() => get("/list-taps")],
  },
  {
    name: "/list-taps: taps only in counter DESC order",
    steps: [
      () => post("/record-tap", { counterValue: 5 }),
      () => post("/record-tap", { counterValue: 6 }),
      () => post("/record-tap", { counterValue: 7 }),
      () => get("/list-taps"),
    ],
  },
  {
    name: "/list-taps: limit=2 with 3 taps returns newest two",
    steps: [
      () => post("/record-read", { counterValue: 3 }),
      () => post("/record-read", { counterValue: 4 }),
      () => post("/record-read", { counterValue: 5 }),
      () => get("/list-taps?limit=2"),
    ],
  },
  {
    name: "/list-taps: limit=0 clamps to 1 row",
    steps: [
      () => post("/record-read", { counterValue: 3 }),
      () => post("/record-read", { counterValue: 4 }),
      () => post("/record-read", { counterValue: 5 }),
      () => get("/list-taps?limit=0"),
    ],
  },
  {
    // 51 read rows: the NaN limit falls back to the default 50, so exactly
    // counters 51..2 come back (a clamp to 1/200 or "all rows" would differ).
    name: "/list-taps: limit=abc (NaN) falls back to default 50",
    steps: [
      ...Array.from({ length: 51 }, (_, i) => () => post("/record-read", { counterValue: i + 1 })),
      () => get("/list-taps?limit=abc"),
    ],
  },
  {
    // provisioned pseudo-row created BEFORE the taps: taps always sort ahead
    // of it regardless of where second boundaries fall (tap counter beats the
    // pseudo-row's null counter in the tie-break).
    name: "/list-taps: provisioned pseudo-row merged after taps created later",
    steps: [
      () => post("/deliver-keys"),
      () => post("/record-read", { counterValue: 5 }),
      () => post("/record-tap", { counterValue: 6, bolt11: "lnbc6" }),
      () => get("/list-taps"),
    ],
  },
  {
    // Full four-pseudo-row merge with FIXED seeded timestamps — pins the
    // version field semantics: provisioned → latest_issued_version,
    // activated/wipe_requested → active_version, terminated → null; and the
    // created_at DESC / counter DESC interleave of taps vs lifecycle rows.
    name: "/list-taps: seeded lifecycle pseudo-rows merge by created_at DESC",
    steps: [
      () =>
        post("/import-state", {
          version: 1,
          card_state: {
            state: "wipe_requested",
            latest_issued_version: 4,
            active_version: 3,
            activated_at: 200,
            terminated_at: 300,
            keys_delivered_at: 100,
            wipe_keys_fetched_at: 400,
            balance: 0,
            key_provenance: "env_issuer",
            key_fingerprint: "ff",
            key_label: "lab",
            first_seen_at: 50,
          },
          taps: [
            { counter: 5, bolt11: null, status: "read", payment_hash: null, amount_msat: null, user_agent: null, request_url: null, created_at: 250, updated_at: 250 },
            { counter: 6, bolt11: "lnbc6", status: "completed", payment_hash: null, amount_msat: 6000, user_agent: null, request_url: null, created_at: 450, updated_at: 460 },
          ],
        }),
      () => get("/list-taps"),
    ],
  },
  {
    name: "/list-taps: merged list sliced to limit=3",
    steps: [
      () =>
        post("/import-state", {
          version: 1,
          card_state: {
            state: "wipe_requested",
            latest_issued_version: 4,
            active_version: 3,
            activated_at: 200,
            terminated_at: 300,
            keys_delivered_at: 100,
            wipe_keys_fetched_at: 400,
            balance: 0,
            key_provenance: "env_issuer",
            key_fingerprint: "ff",
            key_label: "lab",
            first_seen_at: 50,
          },
          taps: [
            { counter: 5, bolt11: null, status: "read", payment_hash: null, amount_msat: null, user_agent: null, request_url: null, created_at: 250, updated_at: 250 },
            { counter: 6, bolt11: "lnbc6", status: "completed", payment_hash: null, amount_msat: 6000, user_agent: null, request_url: null, created_at: 450, updated_at: 460 },
          ],
        }),
      () => get("/list-taps?limit=3"),
    ],
  },

  // /analytics
  {
    // DO oracle: on an EMPTY table the bare SUM(CASE...) counts are SQL NULL
    // (only the COALESCE-wrapped *Msat sums and COUNT(*) come back as 0).
    name: "/analytics: empty table → null tap-count buckets, zero Msat sums",
    steps: [() => get("/analytics")],
  },
  {
    name: "/analytics: mixed completed/failed/pending plus unbucketed read",
    steps: [
      () => post("/record-read", { counterValue: 5 }),
      () => post("/record-tap", { counterValue: 6, amountMsat: 1000 }),
      () => post("/update-tap-status", { counter: 6, status: "completed" }),
      () => post("/record-tap", { counterValue: 7, amountMsat: 2000 }),
      () => post("/update-tap-status", { counter: 7, status: "failed" }),
      () => post("/claim-tap", { counter: 8, amountMsat: 4000 }),
      () => get("/analytics"),
    ],
  },
  {
    // 'paying' and 'expired' rows count ONLY in totalTaps/totalMsat; with
    // rows present the empty buckets are 0, not SQL NULL.
    name: "/analytics: paying/expired rows count only in totals, buckets 0",
    steps: [
      () => post("/record-read", { counterValue: 5 }),
      () => post("/claim-tap", { counter: 5, amountMsat: 600 }),
      () => post("/record-tap", { counterValue: 6, amountMsat: 700 }),
      () => post("/update-tap-status", { counter: 6, status: "expired" }),
      () => get("/analytics"),
    ],
  },
  {
    name: "/analytics: single completed tap",
    steps: [
      () => post("/record-tap", { counterValue: 5, amountMsat: 1000 }),
      () => post("/update-tap-status", { counter: 5, status: "completed" }),
      () => get("/analytics"),
    ],
  },

  // /balance
  {
    name: "/balance: fresh card returns 0",
    steps: [() => get("/balance")],
  },
  {
    name: "/balance: reflects credit then debit",
    steps: [
      () => post("/credit", { amount: 500 }),
      () => post("/debit", { amount: 200 }),
      () => get("/balance"),
    ],
  },

  // /transactions
  {
    name: "/transactions: fresh card returns empty array",
    steps: [() => get("/transactions")],
  },
  {
    name: "/transactions: id DESC ordering across credit/debit/credit",
    steps: [
      () => post("/credit", { amount: 10 }),
      () => post("/debit", { amount: 3 }),
      () => post("/credit", { amount: 5 }),
      () => get("/transactions"),
    ],
  },
  {
    name: "/transactions: row shape carries voided_at null and note null",
    steps: [
      () => post("/credit", { amount: 100 }),
      () => get("/transactions"),
    ],
  },
  {
    name: "/transactions: limit=2 returns newest two",
    steps: [
      () => post("/credit", { amount: 10 }),
      () => post("/debit", { amount: 3 }),
      () => post("/credit", { amount: 5 }),
      () => get("/transactions?limit=2"),
    ],
  },
  {
    name: "/transactions: limit=0 clamps to 1 row",
    steps: [
      () => post("/credit", { amount: 10 }),
      () => post("/debit", { amount: 3 }),
      () => post("/credit", { amount: 5 }),
      () => get("/transactions?limit=0"),
    ],
  },

  // /debit
  {
    // DO oracle: the transaction payload carries ONLY the RETURNING columns
    // (id, amount, balance_after, created_at) — no counter, no note.
    name: "/debit: happy path returns 4-column transaction",
    steps: [
      () => post("/credit", { amount: 1000 }),
      () => post("/debit", { counter: 9, amount: 200 }),
    ],
  },
  {
    name: "/debit: insufficient balance rejected 400 with current balance",
    steps: [
      () => post("/credit", { amount: 100 }),
      () => post("/debit", { amount: 150 }),
    ],
  },
  {
    name: "/debit: zero and negative amounts rejected 400",
    steps: [
      () => post("/credit", { amount: 100 }),
      () => post("/debit", { amount: 0 }),
      () => post("/debit", { amount: -5 }),
    ],
  },
  {
    name: "/debit: non-integer amount 2.5 rejected 400",
    steps: [
      () => post("/credit", { amount: 100 }),
      () => post("/debit", { amount: 2.5 }),
    ],
  },
  {
    // counter is stored when an integer, NULL when absent — visible through
    // the SELECT * projection of /transactions.
    name: "/debit: counter null vs integer visible via /transactions",
    steps: [
      () => post("/credit", { amount: 1000 }),
      () => post("/debit", { counter: 9, amount: 200 }),
      () => post("/debit", { amount: 300 }),
      () => get("/transactions"),
    ],
  },

  // /credit
  {
    name: "/credit: happy path persists note",
    steps: [
      () => post("/credit", { amount: 100, note: "pos-topup" }),
      () => get("/transactions"),
    ],
  },
  {
    name: "/credit: amount over MAX_BALANCE rejected 400 overflow",
    steps: [() => post("/credit", { amount: 2147483648 })],
  },
  {
    // Exactly MAX_BALANCE fits; the next sat is the overflow boundary.
    name: "/credit: MAX_BALANCE accepted then +1 rejected 400",
    steps: [
      () => post("/credit", { amount: 2147483647 }),
      () => post("/credit", { amount: 1 }),
    ],
  },
  {
    name: "/credit: zero, negative and non-integer amounts rejected 400",
    steps: [
      () => post("/credit", { amount: 0 }),
      () => post("/credit", { amount: -5 }),
      () => post("/credit", { amount: 2.5 }),
    ],
  },

  // /void
  {
    name: "/void: unknown transaction id 404",
    steps: [() => post("/void", { transactionId: 999 })],
  },
  {
    name: "/void: debit-then-void restores balance and writes void txn",
    steps: [
      () => post("/credit", { amount: 100, note: "topup" }),
      () => post("/debit", { counter: 9, amount: 40, note: "pos-1" }),
      () => post("/void", { transactionId: 2 }),
      () => get("/transactions"),
    ],
  },
  {
    name: "/void: double void rejected 400",
    steps: [
      () => post("/credit", { amount: 100 }),
      () => post("/debit", { amount: 40 }),
      () => post("/void", { transactionId: 2 }),
      () => post("/void", { transactionId: 2 }),
    ],
  },
  {
    name: "/void: voiding a credit (positive amount) rejected 400",
    steps: [
      () => post("/credit", { amount: 100 }),
      () => post("/void", { transactionId: 1 }),
    ],
  },

  // /deliver-keys
  {
    name: "/deliver-keys: fresh card → keys_delivered v1, first_seen_at set",
    steps: [() => post("/deliver-keys")],
  },
  {
    name: "/deliver-keys: repeat delivery increments version to 2",
    steps: [() => post("/deliver-keys"), () => post("/deliver-keys")],
  },
  {
    // Re-delivery after activation resets to keys_delivered: active_version
    // and activated_at are cleared, latest_issued_version keeps counting.
    name: "/deliver-keys: after activate clears activation, version 2",
    steps: [
      () => post("/deliver-keys"),
      () => post("/activate", { active_version: 1 }),
      () => post("/deliver-keys"),
    ],
  },
  {
    name: "/deliver-keys: preserves existing balance",
    steps: [
      () => post("/credit", { amount: 500 }),
      () => post("/deliver-keys"),
    ],
  },

  // /activate
  {
    name: "/activate: invalid active_version 0/-1/1.5/missing rejected 400",
    steps: [
      () => post("/activate", { active_version: 0 }),
      () => post("/activate", { active_version: -1 }),
      () => post("/activate", { active_version: 1.5 }),
      () => post("/activate", {}),
    ],
  },
  {
    // Fresh insert seeds latest_issued_version = active_version.
    name: "/activate: fresh activate sets latest_issued_version = active_version",
    steps: [() => post("/activate", { active_version: 3 })],
  },
  {
    // Conflict path leaves latest_issued_version at the delivered count.
    name: "/activate: after deliver-keys keeps latest_issued_version",
    steps: [
      () => post("/deliver-keys"),
      () => post("/activate", { active_version: 2 }),
    ],
  },
  {
    name: "/activate: re-activate after terminate clears terminated_at",
    steps: [
      () => post("/activate", { active_version: 2 }),
      () => post("/terminate"),
      () => post("/activate", { active_version: 3 }),
    ],
  },

  // /terminate
  {
    // Terminate wipes taps AND replay_state: the same counter is accepted
    // again and /list-taps shows ONLY the terminated pseudo-row (fresh
    // terminate leaves no other lifecycle timestamps set).
    name: "/terminate: clears taps + replay_state, emits only terminated event",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/record-read", { counterValue: 5 }),
      () => post("/terminate"),
      () => post("/check", { counterValue: 5 }),
      () => get("/list-taps"),
    ],
  },
  {
    name: "/terminate: keeps balance and latest_issued_version",
    steps: [
      () => post("/activate", { active_version: 2 }),
      () => post("/credit", { amount: 100 }),
      () => post("/terminate"),
    ],
  },

  // /request-wipe
  {
    name: "/request-wipe: fresh card 404 {state:'new'}",
    steps: [() => post("/request-wipe")],
  },
  {
    name: "/request-wipe: after activate returns full wipe_requested row",
    steps: [
      () => post("/activate", { active_version: 1 }),
      () => post("/request-wipe"),
    ],
  },
  {
    // mark-pending creates a card_state row with no other lifecycle
    // timestamps, so the wipe_requested pseudo-row is the ONLY merged row.
    name: "/request-wipe: wipe_requested event in /list-taps (via mark-pending)",
    steps: [
      () => post("/mark-pending", { key_provenance: "public_issuer", key_fingerprint: "abc123", key_label: "Venue A" }),
      () => post("/request-wipe"),
      () => get("/list-taps"),
    ],
  },

  // /mark-pending
  {
    name: "/mark-pending: fresh with provenance trio",
    steps: [
      () =>
        post("/mark-pending", {
          key_provenance: "public_issuer",
          key_fingerprint: "abc123",
          key_label: "Venue A",
        }),
    ],
  },
  {
    name: "/mark-pending: empty body stores null provenance",
    steps: [() => post("/mark-pending", {})],
  },
  {
    name: "/mark-pending: second call already_exists",
    steps: [
      () => post("/mark-pending", { key_provenance: "public_issuer" }),
      () => post("/mark-pending", { key_provenance: "env_issuer" }),
    ],
  },
  {
    name: "/mark-pending: on activated card already_exists with current state",
    steps: [
      () => post("/activate", { active_version: 1 }),
      () => post("/mark-pending", { key_provenance: "public_issuer" }),
    ],
  },

  // /discover
  {
    name: "/discover: fresh card → discovered with explicit version + provenance",
    steps: [
      () =>
        post("/discover", {
          key_provenance: "env_issuer",
          key_fingerprint: "abc123",
          key_label: "Venue A",
          active_version: 2,
        }),
    ],
  },
  {
    name: "/discover: fresh card without active_version defaults to 1",
    steps: [
      () => post("/discover", { key_provenance: "public_issuer", key_fingerprint: "abc123", key_label: "Venue A" }),
    ],
  },
  {
    // COALESCE overwrite direction: a non-null incoming provenance wins.
    name: "/discover: from pending upgrades with new provenance + already_exists",
    steps: [
      () => post("/mark-pending", { key_provenance: "public_issuer", key_fingerprint: "abc123", key_label: "Venue A" }),
      () =>
        post("/discover", {
          key_provenance: "env_issuer",
          key_fingerprint: "def456",
          key_label: "Venue B",
          active_version: 2,
        }),
    ],
  },
  {
    name: "/discover: from active leaves state unchanged, already_exists",
    steps: [
      () => post("/activate", { active_version: 1 }),
      () => post("/discover", { key_provenance: "env_issuer", active_version: 5 }),
    ],
  },
  {
    // COALESCE keep direction: null/absent incoming provenance preserves the
    // stored trio.
    name: "/discover: absent provenance keeps existing trio (COALESCE)",
    steps: [
      () => post("/mark-pending", { key_provenance: "public_issuer", key_fingerprint: "abc123", key_label: "Venue A" }),
      () => post("/discover", { active_version: 3 }),
    ],
  },

  // /get-config /set-config /set-k2
  {
    name: "/get-config: fresh card returns null",
    steps: [() => get("/get-config")],
  },
  {
    name: "/set-config: empty object → get returns fakewallet default",
    steps: [() => post("/set-config", {}), () => get("/get-config")],
  },
  {
    name: "/set-config: K2 null omitted from get",
    steps: [
      () => post("/set-config", { K2: null }),
      () => get("/get-config"),
    ],
  },
  {
    name: "/set-config: K2 + pull_payment_id + extras round-trip via get",
    steps: [
      () => post("/set-config", { K2: "aabbcc", pull_payment_id: "pp1", extra: "x" }),
      () => get("/get-config"),
    ],
  },
  {
    name: "/set-k2: on fresh card creates fakewallet config row",
    steps: [
      () => post("/set-k2", { K2: "ddee" }),
      () => get("/get-config"),
    ],
  },
  {
    name: "/set-k2: preserves existing payment_method",
    steps: [
      () => post("/set-config", { payment_method: "clnrest" }),
      () => post("/set-k2", { K2: "ddee" }),
      () => get("/get-config"),
    ],
  },
  {
    // The upsert replaces the whole row: an unset K2 is excluded.K2 = NULL.
    name: "/set-config: overwrite without K2 clears prior K2",
    steps: [
      () => post("/set-config", { K2: "aabbcc" }),
      () => post("/set-config", { payment_method: "proxy" }),
      () => get("/get-config"),
    ],
  },

  // /export-state + /import-state
  {
    name: "/export-state: fresh card exports nulls and empty arrays",
    steps: [() => get("/export-state")],
  },
  {
    name: "/export-state: mixed activity shape incl. singleton rows",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/record-read", { counterValue: 6 }),
      () => post("/credit", { amount: 500, note: "topup" }),
      () => post("/set-config", { K2: "aabbcc", payment_method: "clnrest" }),
      () => get("/export-state"),
    ],
  },
  {
    // Full round-trip in ONE instance: the export body from step 4 is fed
    // verbatim to /import-state on the same DO, and the re-export must
    // normalize identically (only masked _at fields and config_json key
    // order — stable for normal keys — could vary).
    name: "/export-state + /import-state: full round-trip re-exports equal body",
    steps: [
      () => post("/check", { counterValue: 4 }),
      () => post("/credit", { amount: 500, note: "topup" }),
      () => post("/set-config", { K2: "aabbcc", payment_method: "clnrest", pull_payment_id: "pp1", extra: "x" }),
      () => post("/record-read", { counterValue: 3 }),
      () => get("/export-state"),
      (ctx) => post("/import-state", ctx[4]),
      () => get("/export-state"),
    ],
  },
  {
    // Import DELETEs every table BEFORE re-inserting: a body with no
    // sections leaves the card factory-fresh.
    name: "/import-state: version-1-only body deletes all prior state",
    steps: [
      () => post("/check", { counterValue: 5 }),
      () => post("/credit", { amount: 100 }),
      () => post("/import-state", { version: 1 }),
      () => post("/check", { counterValue: 5 }),
      () => get("/balance"),
    ],
  },
  {
    name: "/import-state: version 2 rejected 400",
    steps: [() => post("/import-state", { version: 2 })],
  },
  {
    // AUTOINCREMENT parity: sqlite_sequence only grows — a /credit after the
    // import continues beyond the largest restored id.
    name: "/import-state: credit after import continues txn ids past max",
    steps: [
      () =>
        post("/import-state", {
          version: 1,
          card_state: { state: "active", latest_issued_version: 1, balance: 100 },
          transactions: [
            { id: 7, counter: null, amount: 100, balance_after: 100, created_at: 1000, note: "seed", voided_at: null },
          ],
        }),
      () => post("/credit", { amount: 50 }),
    ],
  },
  {
    name: "/import-state: restores replay_state counter for /check",
    steps: [
      () => post("/import-state", { version: 1, replay_state: { singleton: 1, last_counter: 9 } }),
      () => post("/check", { counterValue: 9 }),
      () => post("/check", { counterValue: 10 }),
    ],
  },

  // malformed JSON — true parity since the dispatcher `return await` fix
  // (same unpark as the wave-1 block above), plus the throw-path cases the
  // fix makes assertable: non-SyntaxError handler throws land in the
  // sanitized generic 500 branch on BOTH legs.
  {
    name: "/debit: malformed JSON body rejected 400",
    steps: [() => rawPost("/debit", "{not json")],
  },
  {
    name: "/activate: malformed JSON body rejected 400",
    steps: [() => rawPost("/activate", "{not json")],
  },
  {
    name: "/check: empty body rejected 400 as invalid JSON",
    steps: [() => rawPost("/check", "")],
  },
  {
    // json() parses "null" fine; destructuring null inside the handler is
    // a TypeError → the generic branch → sanitized 500 on both legs.
    name: "/check: JSON null body lands in the generic 500 branch",
    steps: [() => rawPost("/check", "null")],
  },
  {
    // Async SQLite throw: a tap row missing its NOT NULL created_at
    // rejects the INSERT — with the await fix this surfaces as the
    // documented {error:"Internal error"} 500 instead of a raw RPC
    // rejection carrying the constraint text.
    name: "/import-state: NOT NULL violation → sanitized 500 Internal error",
    steps: [() => post("/import-state", { version: 1, taps: [{ counter: 5, status: "read" }] })],
  },
];
