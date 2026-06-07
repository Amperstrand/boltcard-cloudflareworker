import { test, expect } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import { operatorLogin, makeApiHelpers } from "./helpers.js";

const provider = createProvider();

test.describe(`Financial Flows (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
    expect(disc.data.tag).toBe("withdrawRequest");
  });

  test("top-up credits and verify balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const topup = await api.topUp(10000);
    expect(topup.ok).toBeTruthy();
    expect(topup.data.success || topup.data.status === "OK").toBeTruthy();
    expect(topup.data.balance).toBe(10000);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(10000);
  });

  test("POS charge with sufficient balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    expect(charge.ok).toBeTruthy();
    expect(charge.data.success).toBeTruthy();
    expect(charge.data.balance).toBe(7000);
    expect(charge.data.txnId).toBeDefined();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(7000);
  });

  test("POS charge with insufficient balance returns 402", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(1000);

    const charge = await api.charge(5000);
    expect(charge.status).toBe(402);
    expect(charge.data.success).toBeFalsy();
  });

  test("full refund restores balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);
    await api.charge(3000);

    const refund = await api.refund(3000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(10000);
  });

  test("partial refund credits proportional amount", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);
    await api.charge(3000);

    const refund = await api.refund(1000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(8000);
  });

  test("void transaction restores balance and marks original voided", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    expect(charge.ok).toBeTruthy();
    const txnId = charge.data.txnId;
    expect(txnId).toBeDefined();

    const voidResult = await api.void(txnId);
    expect(voidResult.ok, `Void failed: ${JSON.stringify(voidResult.data)}`).toBeTruthy();
    expect(voidResult.data.success).toBeTruthy();
    expect(voidResult.data.balance).toBe(10000);

    const txns = await api.voidTransactions();
    const voidedTxn = txns.data.transactions.find(
      (t: { id: number }) => t.id === txnId,
    );
    expect(voidedTxn).toBeUndefined();
  });

  test("multiple sequential charges track running balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(20000);

    const c1 = await api.charge(3000);
    expect(c1.data.balance).toBe(17000);

    const c2 = await api.charge(2000);
    expect(c2.data.balance).toBe(15000);

    const c3 = await api.charge(1000);
    expect(c3.data.balance).toBe(14000);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(14000);
  });

  test("void transactions list only shows unvoided charges", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(20000);

    const c1 = await api.charge(3000);
    const c2 = await api.charge(2000);

    await api.void(c1.data.txnId);

    const txns = await api.voidTransactions();
    expect(txns.ok).toBeTruthy();
    const ids = txns.data.transactions.map((t: { id: number }) => t.id);
    expect(ids).toContain(c2.data.txnId);
    expect(ids).not.toContain(c1.data.txnId);
  });

  test("receipt endpoint returns valid plain-text receipt", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    const txnId = charge.data.txnId;
    const keys = await provider.getCardInfo(page);

    const receipt = await api.receipt(txnId, keys.uid);
    expect(receipt.ok).toBeTruthy();
    expect(receipt.text).toContain("RECEIPT");
    expect(receipt.text).toContain(String(txnId));
  });

  test("top-up and charge both exceed single counter use", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(5000);

    const charge = await api.charge(1000);
    expect(charge.ok).toBeTruthy();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(4000);
  });
});

test.describe(`Reconciliation Page (${provider.name} provider)`, () => {
  test("reconciliation API returns transaction data after financial operations", async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);
    await api.discoverCard();

    await api.topUp(10000);
    await api.charge(3000);
    await api.refund(1000);

    const reconData = await page.evaluate(async (): Promise<{
      venueTotals: { topupTotal: number; chargeTotal: number; refundTotal: number; outstandingBalance: number };
      summaries: unknown[];
    }> => {
      const r = await fetch("/operator/reconciliation/data");
      return r.json();
    });

    expect(reconData.venueTotals).toBeDefined();
    expect(reconData.venueTotals.topupTotal).toBeGreaterThanOrEqual(10000);
    expect(reconData.venueTotals.chargeTotal).toBeGreaterThanOrEqual(3000);
    expect(reconData.venueTotals.refundTotal).toBeGreaterThanOrEqual(1000);
    expect(reconData.venueTotals.outstandingBalance).toBeGreaterThanOrEqual(6000);

    expect(reconData.summaries).toBeDefined();
    expect(reconData.summaries.length).toBeGreaterThanOrEqual(1);
  });

  test("reconciliation page renders content after JS loads", async ({ page }) => {
    await operatorLogin(page);

    await page.goto("/operator/reconciliation", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#content")).toBeVisible({ timeout: 15000 });

    const contentClass = await page.getAttribute("#content", "class");
    expect(contentClass).not.toContain("hidden");

    const topupTotal = await page.textContent("#topup-total");
    expect(topupTotal).toBeTruthy();
  });
});
