// Integration tests for boltcard NFC activity simulation.
// Runs via @cloudflare/vitest-pool-workers (miniflare) with real SQLite DO + KV.
// Zero network egress — all HTTP goes through exports.default.fetch().

import {
  apiFetch,
  operatorLogin,
  provisionCard,
  topUp,
  cardTap,
  cardInfo,
  lnurlCallback,
  fakeInvoice,
  nextCounter,
  makeUid,
  deriveKeys,
  virtualTap,
} from "./helpers.js";

// ════════════════════════════════════════════════════════════════════════════════

describe("NFC Flow Integration Tests", () => {
  beforeAll(async () => {
    await operatorLogin();
  });

  // ── a. Card Discovery ─────────────────────────────────────────────────────

  describe("Card Discovery", () => {
    it("auto-discovers unknown card on first tap with valid CMAC for ISSUER_KEY", async () => {
      const uid = makeUid();
      const { k1, k2 } = deriveKeys(uid);

      const resp = await cardTap(uid, k1, k2, nextCounter());

      expect(resp.status).toBe(200);
      const json: { tag?: string; callback?: string; k1?: string; minWithdrawable?: number } = await resp.json();
      expect(json.tag).toBe("withdrawRequest");
      expect(typeof json.callback).toBe("string");
      expect(typeof json.k1).toBe("string");
      expect(typeof json.minWithdrawable).toBe("number");
    });
  });

  // ── b. Provisioned Card Flow ──────────────────────────────────────────────

  describe("Provisioned Card Flow", () => {
    let uid: string;
    let k1: string;
    let k2: string;

    beforeAll(async () => {
      uid = makeUid();
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);
      expect(result.k1).toBeTruthy();
      expect(result.k2).toBeTruthy();
      k1 = result.k1;
      k2 = result.k2;
    });

    it("activates card on first tap and returns withdrawRequest", async () => {
      const resp = await cardTap(uid, k1, k2, nextCounter());

      expect(resp.status).toBe(200);
      const json: { tag?: string } = await resp.json();
      expect(json.tag).toBe("withdrawRequest");
    });

    it("credits balance on top-up", async () => {
      const resp = await topUp(uid, 1000, k1, k2, nextCounter());

      expect(resp.status).toBe(200);
      const json: { balance?: number } = await resp.json();
      expect(typeof json.balance).toBe("number");
      expect(json.balance!).toBeGreaterThanOrEqual(1000);
    });

    it("reports correct balance and state via card/info", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());

      expect(resp.status).toBe(200);
      const json: { balance?: number; state?: string } = await resp.json();
      expect(typeof json.balance).toBe("number");
      expect(json.balance!).toBeGreaterThanOrEqual(1000);
      expect(typeof json.state).toBe("string");
    });
  });

  // ── c. Full LNURL-withdraw Flow ──────────────────────────────────────────

  describe("Full LNURL-withdraw Flow", () => {
    let uid: string;
    let k1: string;
    let k2: string;
    const topUpAmount = 5000;
    const payAmount = 1000;

    beforeAll(async () => {
      uid = makeUid();
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);
      k1 = result.k1;
      k2 = result.k2;

      // Activate card with first tap
      const activateResp = await cardTap(uid, k1, k2, nextCounter());
      expect(activateResp.status).toBe(200);

      // Top up with credits
      const topUpResp = await topUp(uid, topUpAmount, k1, k2, nextCounter());
      expect(topUpResp.status).toBe(200);
    });

    it("processes complete tap→invoice→callback→debit cycle", async () => {
      // Step 1: Tap card → withdrawRequest with callback URL and k1
      const counter = nextCounter();
      const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
      const tapResp = await apiFetch(`/?p=${pHex}&c=${cHex}`);

      expect(tapResp.status).toBe(200);
      const tapJson: { tag?: string; callback?: string; k1?: string; maxWithdrawable?: number } = await tapResp.json();
      expect(tapJson.tag).toBe("withdrawRequest");
      expect(typeof tapJson.callback).toBe("string");
      expect(typeof tapJson.k1).toBe("string");

      // Step 2: Get fake bolt11 invoice
      const invResp = await fakeInvoice(payAmount);

      expect(invResp.status).toBe(200);
      const invJson: { pr?: string } = await invResp.json();
      expect(typeof invJson.pr).toBe("string");

      // Step 3: Fire LNURL callback with invoice → payment processed
      const cbResp = await lnurlCallback(pHex, cHex, invJson.pr!, payAmount);

      expect(cbResp.status).toBe(200);
      const cbJson: { status?: string; balance?: number } = await cbResp.json();
      expect(cbJson.status).toBe("OK");

      // Step 4: Verify balance decreased by payment amount
      expect(typeof cbJson.balance).toBe("number");
      expect(cbJson.balance).toBe(topUpAmount - payAmount);
    });
  });

  // ── d. Multiple Sequential Taps ──────────────────────────────────────────

  describe("Multiple Sequential Taps", () => {
    let uid: string;
    let k1: string;
    let k2: string;
    const initialBalance = 10000;

    beforeAll(async () => {
      uid = makeUid();
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);
      k1 = result.k1;
      k2 = result.k2;

      // Activate + top-up
      const activateResp = await cardTap(uid, k1, k2, nextCounter());
      expect(activateResp.status).toBe(200);
      const topUpResp = await topUp(uid, initialBalance, k1, k2, nextCounter());
      expect(topUpResp.status).toBe(200);
    });

    it("handles multiple taps with incrementing counters and cumulative balance deduction", async () => {
      const payments = [1000, 2000, 1500];
      const totalSpent = payments.reduce((a, b) => a + b, 0);
      let expectedBalance = initialBalance;

      for (const amount of payments) {
        const counter = nextCounter();
        const { pHex, cHex } = virtualTap(uid, counter, k1, k2);

        // Tap → withdrawRequest
        const tapResp = await apiFetch(`/?p=${pHex}&c=${cHex}`);
        expect(tapResp.status).toBe(200);
        const tapJson: { tag?: string } = await tapResp.json();
        expect(tapJson.tag).toBe("withdrawRequest");

        // Get invoice
        const invResp = await fakeInvoice(amount);
        expect(invResp.status).toBe(200);
        const invJson: { pr?: string } = await invResp.json();
        expect(typeof invJson.pr).toBe("string");

        // Callback → payment processed
        const cbResp = await lnurlCallback(pHex, cHex, invJson.pr!, amount);
        expect(cbResp.status).toBe(200);
        const cbJson: { status?: string; balance?: number } = await cbResp.json();
        expect(cbJson.status).toBe("OK");

        expectedBalance -= amount;
        expect(cbJson.balance).toBe(expectedBalance);
      }

      // Verify final balance via card/info
      const infoResp = await cardInfo(uid, k1, k2, nextCounter());
      expect(infoResp.status).toBe(200);
      const infoJson: { balance?: number } = await infoResp.json();
      expect(infoJson.balance).toBe(initialBalance - totalSpent);
    });
  });

  // ── e. Tap with Wrong Parameters ─────────────────────────────────────────

  describe("Invalid Tap Parameters", () => {
    it("rejects zero-filled p/c parameters", async () => {
      const zeroHex = "00".repeat(16);
      const resp = await apiFetch(`/?p=${zeroHex}&c=${zeroHex}`);

      expect([400, 403]).toContain(resp.status);
    });

    it("rejects valid p with invalid CMAC (wrong c)", async () => {
      const uid = makeUid();
      const { k1, k2 } = deriveKeys(uid);
      const counter = nextCounter();
      const { pHex } = virtualTap(uid, counter, k1, k2);
      const fakeC = "deadbeefdeadbeefdeadbeefdeadbeef";

      const resp = await apiFetch(`/?p=${pHex}&c=${fakeC}`);
      expect(resp.status).toBe(403);
    });

    it("rejects missing c parameter", async () => {
      const uid = makeUid();
      const { k1, k2 } = deriveKeys(uid);
      const counter = nextCounter();
      const { pHex } = virtualTap(uid, counter, k1, k2);

      const resp = await apiFetch(`/?p=${pHex}`);
      expect([400, 403]).toContain(resp.status);
    });
  });

  // ── f. Health and Status Endpoints ───────────────────────────────────────

  describe("Health and Status Endpoints", () => {
    it("GET /status returns 200", async () => {
      const resp = await apiFetch("/status");
      expect(resp.status).toBe(200);
    });

    it("GET /login returns 200", async () => {
      const resp = await apiFetch("/login");
      expect(resp.status).toBe(200);
    });

    it("GET /card returns 200", async () => {
      const resp = await apiFetch("/card");
      expect(resp.status).toBe(200);
    });

    it("GET /identity returns 200", async () => {
      const resp = await apiFetch("/identity");
      expect(resp.status).toBe(200);
    });
  });

  // ── g. Fake Invoice Generation ───────────────────────────────────────────

  describe("Fake Invoice Generation", () => {
    it("generates bolt11 invoice for valid amount", async () => {
      const resp = await fakeInvoice(1000);

      expect(resp.status).toBe(200);
      const json: { pr?: string } = await resp.json();
      expect(typeof json.pr).toBe("string");
    });

    it("rejects missing or negative amount", async () => {
      // Missing amount
      const missingResp = await apiFetch("/api/fake-invoice");
      expect(missingResp.status).toBe(400);

      // Negative amount
      const negResp = await fakeInvoice(-100);
      expect(negResp.status).toBe(400);
    });
  });
});
