// Audit #13 gate: K1_FRESH (docs/security-audit-2026-11-13.md).
// Default OFF keeps the k1=c convention (the boltcard-POS/HIL convention —
// AGENTS.md). When the flag is on, the fakewallet/clnrest withdraw response
// carries k1 = a random 16-byte server-stored challenge (per-card DO,
// single-use, TTL per K1_FRESH_TTL_SECONDS, Go default 60s — Go parity:
// crypto.Create_k1 + lnurlw_request_timeout_sec + Paid_flag single-use),
// and the callback authorizes on possession of that challenge (CMAC skip)
// exactly like the Go reference (lnurlw_callback.go Get_payment_k1).

import { describe, it, expect } from "vitest";
import { handleLnurlw } from "../handlers/lnurlwHandler.js";
import { handleLnurlpPayment } from "../handlers/lnurlHandler.js";
import { issueK1Challenge, verifyK1Challenge, k1FreshTtlSeconds } from "../replayProtection.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildCardTestEnv, virtualTap, type TestEnv } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv(extra: Record<string, unknown> = {}) {
  return buildCardTestEnv({
    uid: UID,
    issuerKey: ISSUER_KEY,
    paymentMethod: "fakewallet",
    balance: 100000,
    extraEnv: extra as Partial<TestEnv>,
  });
}

function tap(counter: number): { pHex: string; cHex: string } {
  const keys = getDeterministicKeys(UID, { ISSUER_KEY } as unknown as Env, 1);
  return virtualTap(UID, counter, keys.k1, keys.k2);
}

function tapUrl(counter: number): string {
  const { pHex, cHex } = tap(counter);
  return `/?p=${pHex}&c=${cHex}`;
}

function callbackUrl(counter: number, k1: string, params: Record<string, string | number>): string {
  const { pHex } = tap(counter);
  const url = new URL(`https://test.local/boltcards/api/v1/lnurl/cb/${pHex}`);
  url.searchParams.set("k1", k1);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  return url.toString();
}

const K1_HEX = /^[0-9a-f]{32}$/;

describe("K1_FRESH — withdraw response (step 1)", () => {
  it("default: k1 === c (convention unchanged)", async () => {
    const env = buildEnv();
    const { cHex } = tap(60);
    const res = await handleLnurlw(new Request(`https://test.local${tapUrl(60)}`), env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.k1).toBe(cHex);
  });

  it("K1_FRESH: k1 is a fresh 32-hex challenge, NOT the CMAC; differs per fetch", async () => {
    const env = buildEnv({ K1_FRESH: "on" });
    const { cHex } = tap(61);
    const first = await handleLnurlw(new Request(`https://test.local${tapUrl(61)}`), env);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as Record<string, unknown>;
    expect(firstBody.k1).toMatch(K1_HEX);
    expect(firstBody.k1).not.toBe(cHex);
    expect(firstBody.callback).toContain("/boltcards/api/v1/lnurl/cb/");

    // Wallet re-query of step 1 (idempotent by design) gets its own
    // outstanding challenge; the earlier one stays valid (Go keeps one
    // payment row per Response()).
    const second = await handleLnurlw(new Request(`https://test.local${tapUrl(61)}`), env);
    const secondBody = await second.json() as Record<string, unknown>;
    expect(second.status).toBe(200);
    expect(secondBody.k1).toMatch(K1_HEX);
    expect(secondBody.k1).not.toBe(firstBody.k1);
  });
});

describe("K1_FRESH — callback round-trip", () => {
  it("callback with the issued challenge pays; replay is refused on the consumed k1 (Go parity: single-use)", async () => {
    const env = buildEnv({ K1_FRESH: "on" });
    const step1 = await handleLnurlw(new Request(`https://test.local${tapUrl(62)}`), env);
    const { k1 } = await step1.json() as { k1: string };

    const paid = await handleLnurlpPayment(new Request(callbackUrl(62, k1, { amount: 1000 })), env);
    expect(paid.status).toBe(200);
    const body = await paid.json() as Record<string, unknown>;
    expect(body.status).toBe("OK");

    // Second callback presents an already-used k1 → refused at the challenge
    // gate (the Go reference fails Get_payment_k1 the same way); the claim
    // machinery backs this up for any path that somehow passes a live k1.
    const replay = await handleLnurlpPayment(new Request(callbackUrl(62, k1, { amount: 1000 })), env);
    expect(replay.status).toBe(400);
    const replayBody = await replay.json() as Record<string, unknown>;
    expect(replayBody.reason).toContain("already used");
  });

  it("callback with the OLD k1=c convention is refused under the flag (k1 must be the challenge)", async () => {
    const env = buildEnv({ K1_FRESH: "on" });
    await handleLnurlw(new Request(`https://test.local${tapUrl(63)}`), env);
    const { cHex } = tap(63);
    const res = await handleLnurlpPayment(new Request(callbackUrl(63, cHex, { amount: 1000 })), env);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.reason).toContain("k1");
  });

  it("callback with a wrong random k1 → 400", async () => {
    const env = buildEnv({ K1_FRESH: "on" });
    await handleLnurlw(new Request(`https://test.local${tapUrl(64)}`), env);
    const forged = "0123456789abcdef0123456789abcdef";
    const res = await handleLnurlpPayment(new Request(callbackUrl(64, forged, { amount: 1000 })), env);
    expect(res.status).toBe(400);
  });

  it("a challenge issued for another counter of the same card does not verify", async () => {
    const env = buildEnv({ K1_FRESH: "on" });
    const step1 = await handleLnurlw(new Request(`https://test.local${tapUrl(65)}`), env);
    const { k1 } = await step1.json() as { k1: string };
    // Present the counter-65 challenge against a forged counter-66 p with
    // the same card: counter mismatch → refuse.
    const res = await handleLnurlpPayment(new Request(callbackUrl(66, k1, { amount: 1000 })), env);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.reason).toContain("does not match");
  });

  it("challenge expires after the TTL window → 400 (clock advanced past 60s default)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
      const env = buildEnv({ K1_FRESH: "on" });
      const step1 = await handleLnurlw(new Request(`https://test.local${tapUrl(67)}`), env);
      const { k1 } = await step1.json() as { k1: string };

      vi.setSystemTime(new Date("2026-11-17T12:01:01Z")); // 61s later
      const res = await handleLnurlpPayment(new Request(callbackUrl(67, k1, { amount: 1000 })), env);
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.reason).toContain("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("challenge inside the TTL window still verifies after re-query (both outstanding k1s live)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
      const env = buildEnv({ K1_FRESH: "on" });
      await handleLnurlw(new Request(`https://test.local${tapUrl(69)}`), env); // k1_a issued
      const second = await handleLnurlw(new Request(`https://test.local${tapUrl(69)}`), env); // k1_b issued
      const { k1: k1B } = await second.json() as { k1: string };

      vi.setSystemTime(new Date("2026-11-17T12:00:30Z")); // 30s later, inside 60s
      const res = await handleLnurlpPayment(new Request(callbackUrl(69, k1B, { amount: 1000 })), env);
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("default: callback still honors k1=c (HIL/bench path unchanged)", async () => {
    const env = buildEnv();
    await handleLnurlw(new Request(`https://test.local${tapUrl(68)}`), env);
    const { cHex } = tap(68);
    const res = await handleLnurlpPayment(new Request(callbackUrl(68, cHex, { amount: 1000 })), env);
    expect(res.status).toBe(200);
  });
});

describe("k1 challenge facade (DO contract)", () => {
  it("issued challenges verify exactly once", async () => {
    const env = buildEnv();
    const { k1 } = await issueK1Challenge(env, UID, 100, 60);
    expect(k1).toMatch(K1_HEX);
    expect((await verifyK1Challenge(env, UID, k1, 100, 60)).valid).toBe(true);
    const second = await verifyK1Challenge(env, UID, k1, 100, 60);
    expect(second.valid).toBe(false);
    expect(second.reason).toContain("Unknown or already used");
  });

  it("verify with ttl 0 treats the challenge as expired", async () => {
    const env = buildEnv();
    const { k1 } = await issueK1Challenge(env, UID, 101, 60);
    const verdict = await verifyK1Challenge(env, UID, k1, 101, 0);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain("expired");
  });

  it("k1FreshTtlSeconds: default 60 (Go), positive override honored, garbage/zero → default", async () => {
    expect(k1FreshTtlSeconds({} as Env)).toBe(60);
    expect(k1FreshTtlSeconds({ K1_FRESH_TTL_SECONDS: "300" } as Env)).toBe(300);
    expect(k1FreshTtlSeconds({ K1_FRESH_TTL_SECONDS: "-5" } as Env)).toBe(60);
    expect(k1FreshTtlSeconds({ K1_FRESH_TTL_SECONDS: "0" } as Env)).toBe(60);
    expect(k1FreshTtlSeconds({ K1_FRESH_TTL_SECONDS: "abc" } as Env)).toBe(60);
  });
});
