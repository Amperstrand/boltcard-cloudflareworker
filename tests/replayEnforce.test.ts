// Audit #10 gate: REPLAY_ENFORCE (docs/security-audit-2026-11-13.md).
// Default OFF keeps the documented idempotent posture at all three
// log-and-continue sites (validateCardTap, lnurlwHandler step 1,
// lnurlPayHandler callback). With the flag on, a rejected counter is a
// hard 409 — SPEC.md:39 "must only accept an increasing counter value"
// (Go reference behavior). The callback-level bolt11 claim machinery is
// flag-independent and keeps guarding payments either way.

import { handleLnurlw } from "../handlers/lnurlwHandler.js";
import { handleLnurlpPayment } from "../handlers/lnurlHandler.js";
import { handleRequest } from "../index.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { isFlagOn } from "../utils/envFlags.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { buildCardTestEnv, virtualTap, type TestEnv } from "./testHelpers.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import type { Env } from "../types/core.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

// Pre-computed tap for UID 04d070fa967380 (lnurlpay card fixture, mirrors
// tests/lnurlPay.test.ts so the /lnurlp/cb replay case needs no crypto).
const PAY_UID = "04d070fa967380";
const PAY_UID_CONFIG = {
  K2: "6DA6F8D39F574BDF304FEFFA896D9B99",
  payment_method: "lnurlpay",
  lnurlpay: {
    lightning_address: "test@getalby.com",
    min_sendable: 1000,
    max_sendable: 1000,
  },
} as Record<string, unknown>;
const PAY_COUNTER_1 = "5737314e568ac8d16fe910a3a865be46";
const PAY_CMAC_1 = "9c5fac2622562c63";
const FAKE_INVOICE = "lnbc10n1p3knh2rpp5j3testinvoice";

function keys() {
  return getDeterministicKeys(UID, { ISSUER_KEY } as unknown as Env, 1);
}

function tapUrl(counter: number): string {
  const k = keys();
  const { pHex, cHex } = virtualTap(UID, counter, k.k1, k.k2);
  return `/?p=${pHex}&c=${cHex}`;
}

function callbackUrl(counter: number, params: Record<string, string | number>): string {
  const k = keys();
  const { pHex, cHex } = virtualTap(UID, counter, k.k1, k.k2);
  const url = new URL(`https://test.local/boltcards/api/v1/lnurl/cb/${pHex}`);
  url.searchParams.set("k1", cHex);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  return url.toString();
}

function buildEnv(extra: Record<string, unknown> = {}) {
  return buildCardTestEnv({
    uid: UID,
    issuerKey: ISSUER_KEY,
    paymentMethod: "fakewallet",
    balance: 100000,
    extraEnv: extra as Partial<TestEnv>,
  });
}

function makePayEnv(extra: Record<string, unknown> = {}) {
  const replay = makeReplayNamespace();
  (replay as any).__cardConfigs.set(PAY_UID, PAY_UID_CONFIG);
  return {
    BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async (uid: string) => (uid === PAY_UID ? PAY_UID_CONFIG : null),
      put: async () => {},
    },
    ...extra,
  } as unknown as Env;
}

describe("isFlagOn", () => {
  it("accepts the documented truthy spellings, case-insensitive", () => {
    for (const on of ["1", "true", "on", "enforce", "ON", "Enforce", " true "]) {
      expect(isFlagOn(on)).toBe(true);
    }
    for (const off of [undefined, "", "off", "open", "false", "0", "yes-but-not-this"]) {
      expect(isFlagOn(off)).toBe(false);
    }
  });
});

describe("REPLAY_ENFORCE — LNURL step 1 (lnurlwHandler)", () => {
  it("default: same-counter replay stays idempotent (200 both times)", async () => {
    const env = buildEnv();
    const first = await handleLnurlw(new Request(`https://test.local${tapUrl(10)}`), env);
    expect(first.status).toBe(200);
    const second = await handleLnurlw(new Request(`https://test.local${tapUrl(10)}`), env);
    expect(second.status).toBe(200);
    expect(((await second.json()) as Record<string, unknown>).tag).toBe("withdrawRequest");
  });

  it("REPLAY_ENFORCE: same-counter replay → 409", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    const first = await handleLnurlw(new Request(`https://test.local${tapUrl(11)}`), env);
    expect(first.status).toBe(200);
    const second = await handleLnurlw(new Request(`https://test.local${tapUrl(11)}`), env);
    expect(second.status).toBe(409);
  });

  it("REPLAY_ENFORCE: lower-counter replay → 409", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    const first = await handleLnurlw(new Request(`https://test.local${tapUrl(20)}`), env);
    expect(first.status).toBe(200);
    const replay = await handleLnurlw(new Request(`https://test.local${tapUrl(15)}`), env);
    expect(replay.status).toBe(409);
  });

  it("REPLAY_ENFORCE: fresh increasing counter still accepted", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    expect((await handleLnurlw(new Request(`https://test.local${tapUrl(30)}`), env)).status).toBe(200);
    expect((await handleLnurlw(new Request(`https://test.local${tapUrl(31)}`), env)).status).toBe(200);
  });
});

describe("REPLAY_ENFORCE — operator handlers (validateCardTap)", () => {
  it("default: same tap works twice (top-up then charge posture)", async () => {
    const env = buildEnv();
    const k = keys();
    const { pHex, cHex } = virtualTap(UID, 40, k.k1, k.k2);
    const first = await validateCardTap(new Request("https://test.local/op"), env, { pHex, cHex, context: "test" });
    expect(first.ok).toBe(true);
    const second = await validateCardTap(new Request("https://test.local/op"), env, { pHex, cHex, context: "test" });
    expect(second.ok).toBe(true);
  });

  it("REPLAY_ENFORCE: same tap twice → 409 on the second", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    const k = keys();
    const { pHex, cHex } = virtualTap(UID, 41, k.k1, k.k2);
    const first = await validateCardTap(new Request("https://test.local/op"), env, { pHex, cHex, context: "test" });
    expect(first.ok).toBe(true);
    const second = await validateCardTap(new Request("https://test.local/op"), env, { pHex, cHex, context: "test" });
    expect(second.ok).toBe(false);
    expect((second as { status: number }).status).toBe(409);
  });
});

describe("REPLAY_ENFORCE — LNURL-pay callback (/lnurlp/cb)", () => {
  const withInvoiceFetch = <T>(fn: () => Promise<T>): Promise<T> => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes(".well-known/lnurlp")) {
        return new Response(JSON.stringify({
          callback: "https://minibits.cash/lnurlp/callback",
          tag: "payRequest",
          minSendable: 1000,
          maxSendable: 100000000,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (urlStr.includes("callback") && urlStr.includes("amount=")) {
        return new Response(JSON.stringify({ pr: FAKE_INVOICE, routes: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    });
    const restore = () => { globalThis.fetch = original; };
    return fn().then(
      (value) => { restore(); return value; },
      (error) => { restore(); throw error; },
    );
  };

  it("default: replayed callback counter still served (wallet-retry posture)", async () => {
    const env = makePayEnv();
    const path = `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`;
    await withInvoiceFetch(async () => {
      expect((await handleRequest(new Request(`https://test.local${path}`), env)).status).toBe(200);
      const replay = await handleRequest(new Request(`https://test.local${path}`), env);
      expect(replay.status).toBe(200);
    });
  });

  it("REPLAY_ENFORCE: replayed callback counter → 409", async () => {
    const env = makePayEnv({ REPLAY_ENFORCE: "on" });
    const path = `/lnurlp/cb?p=${PAY_COUNTER_1}&c=${PAY_CMAC_1}&amount=1000`;
    await withInvoiceFetch(async () => {
      expect((await handleRequest(new Request(`https://test.local${path}`), env)).status).toBe(200);
      const replay = await handleRequest(new Request(`https://test.local${path}`), env);
      expect(replay.status).toBe(409);
    });
  });
});

describe("REPLAY_ENFORCE — withdraw callback claim machinery is flag-independent", () => {
  it("replayed counter with pr → 409 (first-callback-wins, pr path)", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    await handleLnurlw(new Request(`https://test.local${tapUrl(50)}`), env);
    const url = callbackUrl(50, { pr: "lnbc10n1test" });
    const first = await handleLnurlpPayment(new Request(url), env);
    expect(first.status).toBe(200);
    const replay = await handleLnurlpPayment(new Request(url), env);
    expect(replay.status).toBe(409);
  });

  it("replayed counter amount-only → 409 (exactly-once per counter)", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    await handleLnurlw(new Request(`https://test.local${tapUrl(51)}`), env);
    const url = callbackUrl(51, { amount: 1000 });
    const first = await handleLnurlpPayment(new Request(url), env);
    expect(first.status).toBe(200);
    const replay = await handleLnurlpPayment(new Request(url), env);
    expect(replay.status).toBe(409);
  });

  it("first legitimate callback still passes with the flag on (step 1 advanced the counter)", async () => {
    const env = buildEnv({ REPLAY_ENFORCE: "on" });
    await handleLnurlw(new Request(`https://test.local${tapUrl(52)}`), env);
    const first = await handleLnurlpPayment(new Request(callbackUrl(52, { amount: 1000 })), env);
    expect(first.status).toBe(200);
  });
});
