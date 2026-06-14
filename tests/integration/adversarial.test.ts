// Adversarial integration tests — proves DO-level balance enforcement,
// counter replay protection, and double-spend prevention via miniflare
// (real SQLite DO + KV, zero network egress).
//
// Run: npx vitest --config vitest.integration.config.js tests/integration/adversarial.test.ts

import {
  apiFetch,
  operatorLogin,
  provisionCard,
  topUp,
  posCharge,
  cardTap,
  cardInfo,
  lnurlCallback,
  fakeInvoice,
  nextCounter,
  makeUid,
  virtualTap,
  resetAll,
  resetSession,
} from "./helpers.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

describe("Adversarial integration tests", () => {
  beforeAll(async () => {
    resetAll();
    await operatorLogin();
  });

  // ── 1. Counter Replay ────────────────────────────────────────────────────────

  describe("counter replay", () => {
    let pHex: string;
    let cHex: string;

    beforeAll(async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await topUp(uid, 10000, k1, k2, nextCounter());

      const ctr = nextCounter();
      const tap = virtualTap(uid, ctr, k1, k2);
      pHex = tap.pHex;
      cHex = tap.cHex;

      // First tap — returns LNURL-withdraw response
      const r1 = await apiFetch(`/?p=${pHex}&c=${cHex}`);
      expect(r1.status).toBe(200);

      // Replayed step 1 still returns 200 — replay is caught at callback step
      const r2 = await apiFetch(`/?p=${pHex}&c=${cHex}`);
      expect(r2.status).toBe(200);
    });

    it("first callback succeeds", async () => {
      const cb1 = await lnurlCallback(pHex, cHex, "lnbc10n1first", 1000);
      expect(cb1.status).toBe(200);
    });

    it("replayed callback returns 409", async () => {
      const cbReplay = await lnurlCallback(pHex, cHex, "lnbc10n1replay", 1000);
      expect(cbReplay.status).toBe(409);
    });
  });

  // ── 2. Double-Spend via Callback ─────────────────────────────────────────────

  describe("double-spend via callback", () => {
    let uid: string;
    let k1: string;
    let k2: string;
    let pHex: string;
    let cHex: string;

    beforeAll(async () => {
      uid = makeUid();
      const prov = await provisionCard(uid);
      k1 = prov.k1;
      k2 = prov.k2;
      expect(k1).toBeTruthy();

      const topUpResp = await topUp(uid, 10000, k1, k2, nextCounter());
      expect(topUpResp.status).toBe(200);

      const ctr = nextCounter();
      const tap = virtualTap(uid, ctr, k1, k2);
      pHex = tap.pHex;
      cHex = tap.cHex;

      const step1 = await apiFetch(`/?p=${pHex}&c=${cHex}`);
      expect(step1.status).toBe(200);
    });

    it("first callback accepted", async () => {
      const cb1 = await lnurlCallback(pHex, cHex, "lnbc10n1invoiceA", 1000);
      expect(cb1.status).toBe(200);
    });

    it("second callback returns 409", async () => {
      const cb2 = await lnurlCallback(pHex, cHex, "lnbc10n1invoiceB", 1000);
      expect(cb2.status).toBe(409);
    });

    it("balance only decremented once", async () => {
      const infoResp = await cardInfo(uid, k1, k2, nextCounter());
      expect(infoResp.status).toBe(200);
      const info = (await infoResp.json()) as { balance: number };
      expect(info.balance).toBe(9000);
    });
  });

  // ── 3. Balance Overdraft ─────────────────────────────────────────────────────

  it("rejects callback exceeding balance (402)", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    await topUp(uid, 500, k1, k2, nextCounter());

    const ctr = nextCounter();
    const tap = virtualTap(uid, ctr, k1, k2);
    await apiFetch(`/?p=${tap.pHex}&c=${tap.cHex}`);

    const cb = await lnurlCallback(tap.pHex, tap.cHex, "lnbc10n1big", 99999);
    expect(cb.status).toBe(402);
    const body = (await cb.json()) as { status: string };
    expect(body.status).toBe("ERROR");
  });

  // ── 4. Exact Balance Drain ───────────────────────────────────────────────────

  it("drains exact balance then rejects further debit", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    await topUp(uid, 500, k1, k2, nextCounter());

    // First tap + callback: drain exactly 500
    const ctr1 = nextCounter();
    const tap1 = virtualTap(uid, ctr1, k1, k2);
    await apiFetch(`/?p=${tap1.pHex}&c=${tap1.cHex}`);
    const cb1 = await lnurlCallback(tap1.pHex, tap1.cHex, "lnbc10n1drain", 500);
    expect(cb1.status).toBe(200);

    // Second tap + callback: try to debit 1 more
    const ctr2 = nextCounter();
    const tap2 = virtualTap(uid, ctr2, k1, k2);
    await apiFetch(`/?p=${tap2.pHex}&c=${tap2.cHex}`);
    const cb2 = await lnurlCallback(tap2.pHex, tap2.cHex, "lnbc10n1over", 1);
    expect(cb2.status).toBe(402);
  });

  // ── 5. POS Charge Overdraft ──────────────────────────────────────────────────

  it("rejects POS charge exceeding balance (402)", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    await topUp(uid, 100, k1, k2, nextCounter());

    const resp = await posCharge(uid, 9999, k1, k2, nextCounter());
    expect(resp.status).toBe(402);
  });

  // ── 6. POS Counter Replay ────────────────────────────────────────────────────

  it("POS same-counter charge succeeds and debits correctly", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    await topUp(uid, 10000, k1, k2, nextCounter());

    const ctr = nextCounter();

    // First POS charge
    const r1 = await posCharge(uid, 100, k1, k2, ctr);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { balance: number };

    // Same counter — POS charges record counter for audit but don't enforce
    // replay uniqueness; balance is the real protection
    const r2 = await posCharge(uid, 100, k1, k2, ctr);
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { balance: number };

    expect(b2.balance).toBe(b1.balance - 100);
  });

  // ── 7. Invalid CMAC ──────────────────────────────────────────────────────────

  it("rejects tap with invalid CMAC (403)", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    // First tap activates the card (keys_delivered → active)
    const activateCtr = nextCounter();
    const activateTap = virtualTap(uid, activateCtr, k1, k2);
    const activateResp = await apiFetch(`/?p=${activateTap.pHex}&c=${activateTap.cHex}`);
    expect(activateResp.status).toBe(200);

    // Now try with invalid CMAC
    const badCtr = nextCounter();
    const badTap = virtualTap(uid, badCtr, k1, k2);
    const resp = await apiFetch(`/?p=${badTap.pHex}&c=AABBCCDDEEFF0011`);
    expect(resp.status).toBe(403);
  });

  // ── 8. Card Info + Balance ────────────────────────────────────────────────────

  it("card/info returns balance after top-up", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    const topUpResp = await topUp(uid, 1000, k1, k2, nextCounter());
    expect(topUpResp.status).toBe(200);

    const resp = await cardInfo(uid, k1, k2, nextCounter());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { balance: number };
    expect(body.balance).toBe(1000);
  });

  // ── 9. Concurrent POS Charges ────────────────────────────────────────────────

  it("exactly one concurrent charge succeeds, balance is 0", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    await topUp(uid, 100, k1, k2, nextCounter());

    const ctr = nextCounter();
    const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
    const body = JSON.stringify({ p: pHex, c: cHex, amount: 100 });

    const [r1, r2] = await Promise.all([
      apiFetch("/operator/pos/charge", {
        method: "POST",
        contentType: "application/json",
        body,
      }),
      apiFetch("/operator/pos/charge", {
        method: "POST",
        contentType: "application/json",
        body,
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    const successes = statuses.filter((s) => s === 200).length;
    expect(successes).toBe(1);

    const infoResp = await cardInfo(uid, k1, k2, nextCounter());
    expect(infoResp.status).toBe(200);
    const info = (await infoResp.json()) as { balance: number };
    expect(info.balance).toBe(0);
  });

  // ── 5. Security: Key Retrieval Auth ─────────────────────────────────────────

  describe("security: key retrieval auth", () => {
    it("rejects unauthenticated key retrieval with 302 redirect", async () => {
      resetSession();
      const resp = await apiFetch(
        "/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion",
        {
          method: "POST",
          contentType: "application/json",
          body: JSON.stringify({ UID: makeUid() }),
        },
      );
      expect(resp.status).toBe(302);
      // Restore session for subsequent tests
      await operatorLogin();
    });

    it("allows authenticated key retrieval with 200", async () => {
      const uid = makeUid();
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);
      expect(result.k1).toBeTruthy();
      expect(result.k2).toBeTruthy();
    });
  });
});
