// Integration test: full card lifecycle state machine.
// Runs via miniflare with real SQLite DO + KV. Zero network egress.
// Ported from scripts/live-lifecycle-test.mjs (18 steps).

import {
  apiFetch,
  operatorLogin,
  provisionCard,
  topUp,
  posCharge,
  cardTap,
  cardInfo,
  refund,
  lnurlCallback,
  fakeInvoice,
  nextCounter,
  makeUid,
  deriveKeys,
  resetCounter,
  virtualTap,
} from "./helpers.js";

// ── Response type interfaces ──────────────────────────────────────────────────

interface WithdrawResponse {
  tag: string;
  callback: string;
  k1: string;
  maxWithdrawable: number;
  minWithdrawable: number;
}

interface CardInfoResponse {
  state: string;
  balance: number;
  reactivationAvailable?: boolean;
}

interface LockResponse {
  success: boolean;
  state: string;
}

interface ReactivateResponse {
  success: boolean;
  state: string;
  version?: number;
}

interface InvoiceResponse {
  pr: string;
}

interface CallbackResponse {
  status: string;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Card lifecycle state machine", () => {
  beforeAll(async () => {
    await operatorLogin();
  });

  // ── Main lifecycle: steps 1-15 share one card ──────────────────────────────

  describe("main card lifecycle (steps 1-15)", () => {
    const uid = makeUid();
    let k1 = "";
    let k2 = "";
    let balanceBeforeRefund = 0;
    let reactivateVersion = 0;

    // ── Step 1: Provision card via pull-payments API ─────────────────────────

    it("step 1: provision card via pull-payments API", async () => {
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);
      expect(typeof result.k1).toBe("string");
      expect(typeof result.k2).toBe("string");
      expect(result.k1.length).toBeGreaterThan(0);
      expect(result.k2.length).toBeGreaterThan(0);
      k1 = result.k1;
      k2 = result.k2;
    });

    // ── Step 2: First tap (keys_delivered → active) ──────────────────────────

    it("step 2: first tap (keys_delivered → active)", async () => {
      const resp = await cardTap(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as WithdrawResponse;
      expect(body.tag).toBe("withdrawRequest");
      expect(typeof body.callback).toBe("string");
      expect(typeof body.k1).toBe("string");
    });

    // ── Step 3: Verify card state is active or discovered ────────────────────

    it("step 3: verify card state is active or discovered", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      expect(["active", "discovered"]).toContain(body.state);
    });

    // ── Step 4: Top-up 5000 credits ──────────────────────────────────────────

    it("step 4: top-up 5000 credits", async () => {
      const resp = await topUp(uid, 5000, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
    });

    // ── Step 5: Verify balance = 5000 ────────────────────────────────────────

    it("step 5: verify balance = 5000", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      expect(body.balance).toBe(5000);
    });

    // ── Step 6: POS charge 1000 ──────────────────────────────────────────────

    it("step 6: POS charge 1000 credits", async () => {
      const resp = await posCharge(uid, 1000, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
    });

    // ── Step 7: Verify balance = 4000 after POS charge ───────────────────────

    it("step 7: verify balance = 4000 after POS charge", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      expect(body.balance).toBe(4000);
    });

    // ── Step 8: Full LNURL payment flow (tap → fake invoice → callback) ──────

    it("step 8: full LNURL payment flow (tap → invoice → callback)", async () => {
      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);

      // Tap for LNURL-withdraw response
      const tapResp = await apiFetch(`/?p=${pHex}&c=${cHex}`);
      expect(tapResp.status).toBe(200);
      const tapBody = (await tapResp.json()) as WithdrawResponse;
      expect(tapBody.tag).toBe("withdrawRequest");
      expect(typeof tapBody.maxWithdrawable).toBe("number");

      // Get fake bolt11 invoice
      const paymentAmount = 1500;
      const invResp = await fakeInvoice(paymentAmount);
      expect(invResp.status).toBe(200);
      const invBody = (await invResp.json()) as InvoiceResponse;
      expect(typeof invBody.pr).toBe("string");
      expect(invBody.pr).toMatch(/^lnbc/);

      // LNURL callback with invoice
      const cbResp = await lnurlCallback(pHex, cHex, invBody.pr, paymentAmount);
      expect(cbResp.status).toBe(200);
      const cbBody = (await cbResp.json()) as CallbackResponse;
      expect(cbBody.status).toBe("OK");
    });

    // ── Step 9: Verify balance decreased after LNURL payment ─────────────────

    it("step 9: verify balance decreased after LNURL payment", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      balanceBeforeRefund = body.balance;
      expect(typeof body.balance).toBe("number");
      expect(body.balance).toBeLessThan(4000);
    });

    // ── Step 10: Refund 500 credits ──────────────────────────────────────────

    it("step 10: refund 500 credits (cash-out)", async () => {
      const resp = await refund(uid, 500, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
    });

    // ── Step 11: Verify balance increased by 500 after refund ────────────────

    it("step 11: verify balance increased by 500 after refund", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      expect(body.balance).toBe(balanceBeforeRefund + 500);
    });

    // ── Step 12: Terminate card (cardholder self-lock) ───────────────────────

    it("step 12: terminate card via self-service lock", async () => {
      const { pHex, cHex } = virtualTap(uid, nextCounter(), k1, k2);
      const resp = await apiFetch("/api/card/lock", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: pHex, c: cHex }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as LockResponse;
      expect(body.success).toBe(true);
      expect(body.state).toBe("terminated");
    });

    // ── Step 13: Terminated card rejected on tap ─────────────────────────────

    it("step 13: terminated card rejected on tap (403)", async () => {
      const resp = await cardTap(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(403);
    });

    it("step 13b: card info shows terminated state with reactivation available", async () => {
      const resp = await cardInfo(uid, k1, k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      expect(body.state).toBe("terminated");
      expect(body.reactivationAvailable).toBe(true);
    });

    // ── Step 14: Reactivate terminated card ──────────────────────────────────

    it("step 14: reactivate terminated card", async () => {
      const { pHex, cHex } = virtualTap(uid, nextCounter(), k1, k2);
      const resp = await apiFetch("/api/card/reactivate", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: pHex, c: cHex }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as ReactivateResponse;
      expect(body.success).toBe(true);
      expect(body.state).toBe("keys_delivered");
      reactivateVersion = body.version || 0;
    });

    // ── Step 15: Reactivated card works after re-tap ─────────────────────────

    it("step 15: reactivated card works after re-tap", async () => {
      // Try with original provisioned keys first
      let resp = await cardTap(uid, k1, k2, nextCounter());

      if (resp.status !== 200 && reactivateVersion > 0) {
        // Fall back to new-version keys (reactivation may advance key version)
        const ver = reactivateVersion > 1 ? reactivateVersion : 2;
        const newKeys = deriveKeys(uid, ver);
        resp = await cardTap(uid, newKeys.k1, newKeys.k2, nextCounter());
      }

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as WithdrawResponse;
      expect(body.tag).toBe("withdrawRequest");
    });
  });

  // ── Step 16: Pending state (provisioned but never tapped) ──────────────────

  describe("pending state", () => {
    it("step 16: provisioned but never tapped shows pending or keys_delivered", async () => {
      const uid = makeUid();

      const result = await provisionCard(uid);
      expect(result.status).toBe(200);
      expect(typeof result.k1).toBe("string");
      expect(typeof result.k2).toBe("string");

      // Card has been provisioned but never tapped — state should reflect that
      const resp = await cardInfo(uid, result.k1, result.k2, nextCounter());
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as CardInfoResponse;
      expect(["pending", "keys_delivered"]).toContain(body.state);
    });
  });

  // ── Steps 17-18: Counter edge cases ───────────────────────────────────────

  describe("counter edge cases", () => {
    it("step 17: counter=0 tap works", async () => {
      const uid = makeUid();
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);

      // Tap with counter=0 (minimum valid counter)
      const resp = await cardTap(uid, result.k1, result.k2, 0);
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as WithdrawResponse;
      expect(body.tag).toBe("withdrawRequest");
    });

    it("step 18: counter=0xFFFFFF (16777215) tap works", async () => {
      const uid = makeUid();
      const result = await provisionCard(uid);
      expect(result.status).toBe(200);

      // Tap with max counter 0xFFFFFF (16777215)
      const resp = await cardTap(uid, result.k1, result.k2, 0xffffff);
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as WithdrawResponse;
      expect(body.tag).toBe("withdrawRequest");
    });
  });
});
