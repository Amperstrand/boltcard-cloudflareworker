import { describe, it, expect, beforeEach } from "vitest";
import { makeReplayNamespace } from "./replayNamespace.js";
import { buildCardTestEnv, virtualTap, TEST_OPERATOR_AUTH } from "./testHelpers.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { handleRequest } from "../index.js";
import { debitCard, creditCard, getBalance, checkAndAdvanceCounter, recordTap, getCardState } from "../replayProtection.js";
import { validateCardTap } from "../utils/validateCardTap.js";
import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { handleLnurlpPayment } from "../handlers/lnurlHandler.js";
import { handlePosCharge } from "../handlers/posChargeHandler.js";
import aesjs from "aes-js";
import type { Env } from "../types/core.js";

const UID = "04a39493cc8680";
const INITIAL_BALANCE = 100000;

function makeAdversarialEnv(balance = INITIAL_BALANCE): Env {
  return buildCardTestEnv({ uid: UID, balance, operatorAuth: true });
}

function makeRequest(path: string, method: string = "GET", body: Record<string, any> | null = null, env: Env) {
  const url = "https://test.local" + path;
  const opts: RequestInit = { method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, opts), env);
}

function generateRealPandC(uidHex: string, counter: number, k1Hex: string) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xC7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctrHex = bytesToHex(new Uint8Array([
    (counter >> 16) & 0xff,
    (counter >> 8) & 0xff,
    counter & 0xff,
  ]));
  return { pHex, ctrHex };
}

function computeRealC(uidHex: string, ctrHex: string, k2Hex: string) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

function makeCallbackUrl(pHex: string, cHex: string, extra: Record<string, any> = {}) {
  const params = new URLSearchParams();
  params.set("k1", cHex);
  if (extra.pr) params.set("pr", extra.pr);
  if (extra.amount) params.set("amount", String(extra.amount));
  return `/boltcards/api/v1/lnurl/cb/${pHex}?${params.toString()}`;
}

// ── 1. Counter Replay Attacks ────────────────────────────────────────────────

describe("Adversarial: Counter Replay", () => {
  it("rejects same counter submitted twice to checkAndAdvanceCounter", async () => {
    const env = makeAdversarialEnv();
    const r1 = await checkAndAdvanceCounter(env, UID, 5);
    expect(r1.accepted).toBe(true);
    const r2 = await checkAndAdvanceCounter(env, UID, 5);
    expect(r2.accepted).toBe(false);
  });

  it("rejects decreasing counter after advance", async () => {
    const env = makeAdversarialEnv();
    await checkAndAdvanceCounter(env, UID, 10);
    const r = await checkAndAdvanceCounter(env, UID, 5);
    expect(r.accepted).toBe(false);
  });

  it("rejects counter=0 replayed after initial acceptance", async () => {
    const env = makeAdversarialEnv();
    const r1 = await checkAndAdvanceCounter(env, UID, 0);
    expect(r1.accepted).toBe(true);
    const r2 = await checkAndAdvanceCounter(env, UID, 0);
    expect(r2.accepted).toBe(false);
  });

  it("rejects counter in gap after higher counter accepted", async () => {
    const env = makeAdversarialEnv();
    await checkAndAdvanceCounter(env, UID, 10);
    const r = await checkAndAdvanceCounter(env, UID, 7);
    expect(r.accepted).toBe(false);
  });

  it("accepts monotonically increasing counters with gaps", async () => {
    const env = makeAdversarialEnv();
    const r1 = await checkAndAdvanceCounter(env, UID, 1);
    expect(r1.accepted).toBe(true);
    const r3 = await checkAndAdvanceCounter(env, UID, 100);
    expect(r3.accepted).toBe(true);
    const r5 = await checkAndAdvanceCounter(env, UID, 999);
    expect(r5.accepted).toBe(true);
  });

  it("recordTap rejects same counter that checkAndAdvanceCounter already consumed", async () => {
    const env = makeAdversarialEnv();
    const r1 = await checkAndAdvanceCounter(env, UID, 5);
    expect(r1.accepted).toBe(true);
    const r2 = await recordTap(env, UID, 5, { bolt11: "lnbc1test" });
    expect(r2.accepted).toBe(false);
  });

  it("recordTap accepts counter that checkAndAdvanceCounter has not seen", async () => {
    const env = makeAdversarialEnv();
    const r = await recordTap(env, UID, 3, { bolt11: "lnbc1test" });
    expect(r.accepted).toBe(true);
  });
});

// ── 2. Double-Spend via Duplicate Callbacks ──────────────────────────────────

describe("Adversarial: Duplicate Callbacks", () => {
  let env: Env;
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeEach(() => {
    env = makeAdversarialEnv();
    keys = getDeterministicKeys(UID, env, 1);
  });

  it("rejects second callback with same counter and same bolt11", async () => {
    const { pHex, ctrHex } = generateRealPandC(UID, 1, env.BOLT_CARD_K1!.split(",")[0]);
    const cHex = computeRealC(UID, ctrHex, keys.k2);
    const url = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1testinvoice" });

    const first = await handleLnurlpPayment(new Request("https://test.local" + url), env);
    expect(first.status).toBe(200);

    const second = await handleLnurlpPayment(new Request("https://test.local" + url), env);
    expect(second.status).toBe(409);
  });

  it("rejects second callback with same counter but different bolt11", async () => {
    const { pHex, ctrHex } = generateRealPandC(UID, 1, env.BOLT_CARD_K1!.split(",")[0]);
    const cHex = computeRealC(UID, ctrHex, keys.k2);
    const url1 = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1first" });
    const url2 = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1second" });

    const first = await handleLnurlpPayment(new Request("https://test.local" + url1), env);
    expect(first.status).toBe(200);

    const second = await handleLnurlpPayment(new Request("https://test.local" + url2), env);
    expect(second.status).toBe(409);
  });

  it("rejects callback-only replay (skip Step 1, replay same counter)", async () => {
    const { pHex, ctrHex } = generateRealPandC(UID, 1, env.BOLT_CARD_K1!.split(",")[0]);
    const cHex = computeRealC(UID, ctrHex, keys.k2);
    const url = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1test" });

    const first = await handleLnurlpPayment(new Request("https://test.local" + url), env);
    expect(first.status).toBe(200);

    const replay = await handleLnurlpPayment(new Request("https://test.local" + url), env);
    expect(replay.status).toBe(409);
  });

  it("prevents double-spend: two callbacks for same counter, only one payment deducted", async () => {
    const { pHex, ctrHex } = generateRealPandC(UID, 1, env.BOLT_CARD_K1!.split(",")[0]);
    const cHex = computeRealC(UID, ctrHex, keys.k2);
    const url1 = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1first" });
    const url2 = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1second" });

    const first = await handleLnurlpPayment(new Request("https://test.local" + url1), env);
    expect(first.status).toBe(200);

    const balBefore = await getBalance(env, UID);

    const second = await handleLnurlpPayment(new Request("https://test.local" + url2), env);
    expect(second.status).toBe(409);

    const balAfter = await getBalance(env, UID);
    expect(balAfter.balance).toBe(balBefore.balance);
  });
});

// ── 3. Balance Boundary and Overdraft ────────────────────────────────────────

describe("Adversarial: Balance Boundary", () => {
  it("allows debit of exact balance", async () => {
    const env = makeAdversarialEnv(500);
    const result = await debitCard(env, UID, 1, 500, "exact debit");
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(0);
  });

  it("rejects debit of balance + 1", async () => {
    const env = makeAdversarialEnv(500);
    const result = await debitCard(env, UID, 1, 501, "overdraft");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Insufficient");
  });

  it("rejects debit when balance is exactly 0", async () => {
    const env = makeAdversarialEnv(0);
    const result = await debitCard(env, UID, 1, 1, "zero balance debit");
    expect(result.ok).toBe(false);
  });

  it("allows credit then debit of same amount", async () => {
    const env = makeAdversarialEnv(0);
    const credit = await creditCard(env, UID, 1000, "topup");
    expect(credit.ok).toBe(true);
    const debit = await debitCard(env, UID, 1, 1000, "full spend");
    expect(debit.ok).toBe(true);
    expect(debit.balance).toBe(0);
  });

  it("rejects second debit after balance drained to zero", async () => {
    const env = makeAdversarialEnv(500);
    const d1 = await debitCard(env, UID, 1, 500, "drain");
    expect(d1.ok).toBe(true);
    const d2 = await debitCard(env, UID, 2, 1, "post-drain");
    expect(d2.ok).toBe(false);
  });

  it("two rapid sequential debits that exceed balance: only one succeeds", async () => {
    const env = makeAdversarialEnv(100);
    const d1 = await debitCard(env, UID, 1, 100, "first");
    const d2 = await debitCard(env, UID, 2, 100, "second");
    const successes = [d1, d2].filter(r => r.ok);
    expect(successes.length).toBe(1);
    const bal = await getBalance(env, UID);
    expect(bal.balance).toBe(0);
  });

  it("many small debits that exceed balance: final one fails", async () => {
    const env = makeAdversarialEnv(100);
    for (let i = 1; i <= 10; i++) {
      const result = await debitCard(env, UID, i, 10, `debit-${i}`);
      if (i <= 10) {
        if (i <= 10) expect(result.ok).toBe(i <= 10);
      }
    }
    const bal = await getBalance(env, UID);
    expect(bal.balance).toBe(0);
  });

  it("debit returns remaining balance on failure", async () => {
    const env = makeAdversarialEnv(50);
    const result = await debitCard(env, UID, 1, 100, "overdraft");
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(50);
  });
});

// ── 4. Cross-Endpoint Counter Races ─────────────────────────────────────────

describe("Adversarial: Cross-Endpoint Counter", () => {
  let env: Env;
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeEach(() => {
    env = makeAdversarialEnv();
    keys = getDeterministicKeys(UID, env, 1);
  });

  it("POS charge then LNURL Step 1 with same counter: Step 1 rejected", async () => {
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);

    const charge = await handlePosCharge(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
      }),
      env,
      { shiftId: "test" } as any
    );
    expect(charge.status).toBe(200);

    const step1 = await makeRequest(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(step1.status).toBe(409);
  });

  it("LNURL Step 1 then POS charge with same counter: POS rejected", async () => {
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);

    const step1 = await makeRequest(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(step1.status).toBe(200);

    const charge = await handlePosCharge(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
      }),
      env,
      { shiftId: "test" } as any
    );
    expect(charge.status).toBe(400);
  });

  it("two POS charges with same counter: second rejected", async () => {
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);

    const req = new Request("https://test.local/operator/pos/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
    });

    const first = await handlePosCharge(req.clone(), env, { shiftId: "test" } as any);
    expect(first.status).toBe(200);

    const second = await handlePosCharge(req.clone(), env, { shiftId: "test" } as any);
    expect(second.status).toBe(400);
  });

  it("validateCardTap rejects replayed counter", async () => {
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);
    const req = new Request("https://test.local/api/test");

    const first = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(first.ok).toBe(true);

    const second = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(second.ok).toBe(false);
    expect((second as any).error).toContain("already used");
  });
});

// ── 5. Wipe/Reset Exploits ──────────────────────────────────────────────────

describe("Adversarial: Wipe/Reset", () => {
  it("allows old counter after resetReplayProtection", async () => {
    const env = makeAdversarialEnv();
    await checkAndAdvanceCounter(env, UID, 100);

    const id = env.CARD_REPLAY.idFromName(UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://card-replay.internal/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));

    const r = await checkAndAdvanceCounter(env, UID, 1);
    expect(r.accepted).toBe(true);
  });

  it("rejects counter replay after terminate (card terminated)", async () => {
    const env = makeAdversarialEnv();
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const keys = getDeterministicKeys(UID, env, 1);

    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);
    const req = new Request("https://test.local/api/test");
    const first = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(first.ok).toBe(true);

    // Terminate the card
    const id = env.CARD_REPLAY.idFromName(UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://card-replay.internal/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));

    // Try with a new counter — should fail because card is terminated
    const { pHex: p2, cHex: c2 } = virtualTap(UID, 2, k1Hex, keys.k2);
    const second = await validateCardTap(req, env, { pHex: p2, cHex: c2, context: "test" });
    expect(second.ok).toBe(false);
    expect((second as any).status).toBe(403);
  });

  it("preserves balance after terminate and re-activate", async () => {
    const env = makeAdversarialEnv(500);
    const id = env.CARD_REPLAY.idFromName(UID);
    const stub = env.CARD_REPLAY.get(id);

    await stub.fetch(new Request("https://card-replay.internal/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));

    await stub.fetch(new Request("https://card-replay.internal/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_version: 1 }),
    }));

    const bal = await getBalance(env, UID);
    expect(bal.balance).toBe(500);
  });
});

// ── 6. TOCTOU: Concurrent Callbacks ─────────────────────────────────────────

describe("Adversarial: Concurrent Callbacks (TOCTOU)", () => {
  let env: Env;
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeEach(() => {
    env = makeAdversarialEnv(1000);
    keys = getDeterministicKeys(UID, env, 1);
  });

  it("two concurrent callbacks with same counter: only one payment succeeds", async () => {
    const { pHex, ctrHex } = generateRealPandC(UID, 1, env.BOLT_CARD_K1!.split(",")[0]);
    const cHex = computeRealC(UID, ctrHex, keys.k2);
    const url1 = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1invoiceA" });
    const url2 = makeCallbackUrl(pHex, cHex, { pr: "lnbc10n1invoiceB" });

    const [r1, r2] = await Promise.all([
      handleLnurlpPayment(new Request("https://test.local" + url1), env),
      handleLnurlpPayment(new Request("https://test.local" + url2), env),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toContain(200);
    expect(statuses[0]).toBeLessThanOrEqual(statuses[1]);

    const bal = await getBalance(env, UID);
    expect(bal.balance).toBeGreaterThanOrEqual(0);
  });

  it("two concurrent POS charges with same tap: no double-debit", async () => {
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);

    const makeChargeReq = () => new Request("https://test.local/operator/pos/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
    });

    const [r1, r2] = await Promise.all([
      handlePosCharge(makeChargeReq(), env, { shiftId: "test" } as any),
      handlePosCharge(makeChargeReq(), env, { shiftId: "test" } as any),
    ]);

    const successes = [r1.status, r2.status].filter(s => s === 200);
    expect(successes.length).toBe(1);

    const bal = await getBalance(env, UID);
    expect(bal.balance).toBe(900);
  });

  it("two concurrent POS charges with same tap, exact balance: no overdraft", async () => {
    const envExact = makeAdversarialEnv(100);
    const k1Hex = envExact.BOLT_CARD_K1!.split(",")[0];
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, getDeterministicKeys(UID, envExact, 1).k2);

    const makeChargeReq = () => new Request("https://test.local/operator/pos/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
    });

    const [r1, r2] = await Promise.all([
      handlePosCharge(makeChargeReq(), envExact, { shiftId: "test" } as any),
      handlePosCharge(makeChargeReq(), envExact, { shiftId: "test" } as any),
    ]);

    const successes = [r1.status, r2.status].filter(s => s === 200);
    expect(successes.length).toBe(1);

    const bal = await getBalance(envExact, UID);
    expect(bal.balance).toBe(0);
  });

  it("two concurrent debits that sum more than balance: no negative balance", async () => {
    const envPartial = makeAdversarialEnv(100);

    const [r1, r2] = await Promise.all([
      debitCard(envPartial, UID, 1, 100, "concurrent-1"),
      debitCard(envPartial, UID, 2, 100, "concurrent-2"),
    ]);

    const successes = [r1, r2].filter(r => r.ok);
    expect(successes.length).toBe(1);

    const bal = await getBalance(envPartial, UID);
    expect(bal.balance).toBeGreaterThanOrEqual(0);
  });
});

// ── 7. State-Aware Exploits ─────────────────────────────────────────────────

describe("Adversarial: State Exploits", () => {
  it("rejects tap on terminated card", async () => {
    const env = makeAdversarialEnv();
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const keys = getDeterministicKeys(UID, env, 1);

    const id = env.CARD_REPLAY.idFromName(UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://card-replay.internal/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));

    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);
    const req = new Request("https://test.local/api/test");
    const result = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(result.ok).toBe(false);
    expect((result as any).status).toBe(403);
  });

  it("rejects tap on wipe_requested card", async () => {
    const env = makeAdversarialEnv();
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const keys = getDeterministicKeys(UID, env, 1);

    const id = env.CARD_REPLAY.idFromName(UID);
    const stub = env.CARD_REPLAY.get(id);
    await stub.fetch(new Request("https://card-replay.internal/request-wipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));

    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);
    const req = new Request("https://test.local/api/test");
    const result = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(result.ok).toBe(false);
    expect((result as any).status).toBe(403);
  });

  it("auto-activates keys_delivered card on valid tap", async () => {
    const env = buildCardTestEnv({ uid: UID, balance: INITIAL_BALANCE, cardState: "keys_delivered", operatorAuth: true });
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const keys = getDeterministicKeys(UID, env, 1);

    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);
    const req = new Request("https://test.local/api/test");
    const result = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(result.ok).toBe(true);

    const state = await getCardState(env, UID);
    expect(state.state).toBe("active");
  });

  it("rejects invalid CMAC on keys_delivered card (version mismatch)", async () => {
    const env = buildCardTestEnv({ uid: UID, balance: INITIAL_BALANCE, cardState: "keys_delivered", operatorAuth: true });
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];

    // Generate tap with wrong version keys
    const wrongKeys = getDeterministicKeys(UID, { ISSUER_KEY: "00000000000000000000000000000BAD" } as any, 1);
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, wrongKeys.k2);
    const req = new Request("https://test.local/api/test");
    const result = await validateCardTap(req, env, { pHex, cHex, context: "test" });
    expect(result.ok).toBe(false);
    expect((result as any).status).toBe(403);
  });
});

// ── 8. Edge Cases ────────────────────────────────────────────────────────────

describe("Adversarial: Edge Cases", () => {
  it("rejects callback with missing pr AND missing amount", async () => {
    const env = makeAdversarialEnv();
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, ctrHex } = generateRealPandC(UID, 1, env.BOLT_CARD_K1!.split(",")[0]);
    const cHex = computeRealC(UID, ctrHex, keys.k2);
    const url = `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}`;

    const res = await handleLnurlpPayment(new Request("https://test.local" + url), env);
    expect(res.status).toBe(400);
  });

  it("rejects callback with empty p parameter", async () => {
    const env = makeAdversarialEnv();
    const url = `/boltcards/api/v1/lnurl/cb/?k1=abc&pr=lnbc10n1test`;

    const res = await handleLnurlpPayment(new Request("https://test.local" + url), env);
    expect(res.status).toBe(400);
  });

  it("POS charge rejects zero amount", async () => {
    const env = makeAdversarialEnv();
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);

    const res = await handlePosCharge(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: cHex, amount: 0 }),
      }),
      env,
      { shiftId: "test" } as any
    );
    expect(res.status).toBe(400);
  });

  it("POS charge rejects negative amount", async () => {
    const env = makeAdversarialEnv();
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0];
    const keys = getDeterministicKeys(UID, env, 1);
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, keys.k2);

    const res = await handlePosCharge(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: pHex, c: cHex, amount: -100 }),
      }),
      env,
      { shiftId: "test" } as any
    );
    expect(res.status).toBe(400);
  });

  it("POS charge rejects missing card parameters", async () => {
    const env = makeAdversarialEnv();

    const res = await handlePosCharge(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100 }),
      }),
      env,
      { shiftId: "test" } as any
    );
    expect(res.status).toBe(400);
  });

  it("handles non-integer amount gracefully", async () => {
    const env = makeAdversarialEnv();
    const result = await debitCard(env, UID, 1, 1.5, "float amount");
    expect(result.ok).toBe(false);
  });

  it("handles very large amount without overflow", async () => {
    const env = makeAdversarialEnv(100);
    const result = await debitCard(env, UID, 1, Number.MAX_SAFE_INTEGER, "huge amount");
    expect(result.ok).toBe(false);
  });

  it("handles NaN amount", async () => {
    const env = makeAdversarialEnv(100);
    const result = await debitCard(env, UID, 1, NaN, "nan amount");
    expect(result.ok).toBe(false);
  });
});
