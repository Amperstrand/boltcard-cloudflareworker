import { test, expect, type Page } from "@playwright/test";

const OPERATOR_PIN = "1234";

async function operatorLogin(page: Page) {
  await page.goto("/operator/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="pin"]').fill(OPERATOR_PIN);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/operator/pos**", { timeout: 15000 });
}

async function createVirtualCard(page: Page) {
  await page.goto("/debug", { waitUntil: "domcontentloaded" });
  await page.locator('button[data-tab="virtual"]').click();
  await expect(page.locator("#panel-virtual")).toBeVisible();
  await page.locator("#vc-create-btn").click();
  await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
}

async function vcTap(page: Page): Promise<{ p: string; c: string }> {
  return page.evaluate(() => {
    const result = (window as any)._vcTap();
    return result;
  });
}

async function vcGetKeys(page: Page) {
  return page.evaluate(() => (window as any)._vcGetKeys());
}

interface ApiResult {
  ok: boolean;
  status: number;
  data: Record<string, any>;
}

async function discoverCard(page: Page): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(async (t: { p: string; c: string }) => {
    const r = await fetch("/?p=" + encodeURIComponent(t.p) + "&c=" + encodeURIComponent(t.c));
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, tap);
}

async function apiTopUp(page: Page, amount: number): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(
    async ({ t, amount }: { t: { p: string; c: string }; amount: number }) => {
      const r = await fetch("/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: t.p, c: t.c, amount }),
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    { t: tap, amount },
  );
}

async function apiCharge(page: Page, amount: number): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(
    async ({ t, amount }: { t: { p: string; c: string }; amount: number }) => {
      const r = await fetch("/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: t.p, c: t.c, amount }),
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    { t: tap, amount },
  );
}

async function apiRefund(page: Page, amount: number): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(
    async ({ t, amount }: { t: { p: string; c: string }; amount: number }) => {
      const r = await fetch("/operator/refund/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: t.p, c: t.c, amount }),
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    { t: tap, amount },
  );
}

async function apiBalanceCheck(page: Page): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(async (t: { p: string; c: string }) => {
    const r = await fetch("/api/balance-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: t.p, c: t.c }),
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, tap);
}

async function apiVoid(page: Page, transactionId: number): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(
    async ({ t, transactionId }: { t: { p: string; c: string }; transactionId: number }) => {
      const r = await fetch("/operator/void/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: t.p, c: t.c, transactionId }),
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    { t: tap, transactionId },
  );
}

async function apiVoidTransactions(page: Page): Promise<ApiResult> {
  const tap = await vcTap(page);
  return page.evaluate(async (t: { p: string; c: string }) => {
    const r = await fetch(
      "/operator/void/transactions?p=" + encodeURIComponent(t.p) + "&c=" + encodeURIComponent(t.c),
    );
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, tap);
}

async function apiReceipt(page: Page, txnId: number, uid: string): Promise<{ ok: boolean; status: number; text: string }> {
  return page.evaluate(
    async ({ txnId, uid }: { txnId: number; uid: string }) => {
      const r = await fetch("/api/receipt/" + txnId + "?uid=" + encodeURIComponent(uid));
      return { ok: r.ok, status: r.status, text: await r.text() };
    },
    { txnId, uid },
  );
}

test.describe("Financial Flows with Virtual Card", () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await createVirtualCard(page);
    const disc = await discoverCard(page);
    expect(disc.ok).toBeTruthy();
    expect(disc.data.tag).toBe("withdrawRequest");
  });

  test("top-up credits and verify balance", async ({ page }) => {
    const topup = await apiTopUp(page, 10000);
    expect(topup.ok).toBeTruthy();
    expect(topup.data.success || topup.data.status === "OK").toBeTruthy();
    expect(topup.data.balance).toBe(10000);

    const bal = await apiBalanceCheck(page);
    expect(bal.data.balance).toBe(10000);
  });

  test("POS charge with sufficient balance", async ({ page }) => {
    await apiTopUp(page, 10000);

    const charge = await apiCharge(page, 3000);
    expect(charge.ok).toBeTruthy();
    expect(charge.data.success).toBeTruthy();
    expect(charge.data.balance).toBe(7000);
    expect(charge.data.txnId).toBeDefined();

    const bal = await apiBalanceCheck(page);
    expect(bal.data.balance).toBe(7000);
  });

  test("POS charge with insufficient balance returns 402", async ({ page }) => {
    await apiTopUp(page, 1000);

    const charge = await apiCharge(page, 5000);
    expect(charge.status).toBe(402);
    expect(charge.data.success).toBeFalsy();
  });

  test("full refund restores balance", async ({ page }) => {
    await apiTopUp(page, 10000);
    await apiCharge(page, 3000);

    const refund = await apiRefund(page, 3000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(10000);
  });

  test("partial refund credits proportional amount", async ({ page }) => {
    await apiTopUp(page, 10000);
    await apiCharge(page, 3000);

    const refund = await apiRefund(page, 1000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(8000);
  });

  test("void transaction restores balance and marks original voided", async ({ page }) => {
    await apiTopUp(page, 10000);

    const charge = await apiCharge(page, 3000);
    expect(charge.ok).toBeTruthy();
    const txnId = charge.data.txnId;
    expect(txnId).toBeDefined();

    const voidResult = await apiVoid(page, txnId);
    expect(voidResult.ok, `Void failed: ${JSON.stringify(voidResult.data)}`).toBeTruthy();
    expect(voidResult.data.success).toBeTruthy();
    expect(voidResult.data.balance).toBe(10000);

    const txns = await apiVoidTransactions(page);
    const voidedTxn = txns.data.transactions.find(
      (t: { id: number }) => t.id === txnId,
    );
    expect(voidedTxn).toBeUndefined();
  });

  test("multiple sequential charges track running balance", async ({ page }) => {
    await apiTopUp(page, 20000);

    const c1 = await apiCharge(page, 3000);
    expect(c1.data.balance).toBe(17000);

    const c2 = await apiCharge(page, 2000);
    expect(c2.data.balance).toBe(15000);

    const c3 = await apiCharge(page, 1000);
    expect(c3.data.balance).toBe(14000);

    const bal = await apiBalanceCheck(page);
    expect(bal.data.balance).toBe(14000);
  });

  test("void transactions list only shows unvoided charges", async ({ page }) => {
    await apiTopUp(page, 20000);

    const c1 = await apiCharge(page, 3000);
    const c2 = await apiCharge(page, 2000);

    await apiVoid(page, c1.data.txnId);

    const txns = await apiVoidTransactions(page);
    expect(txns.ok).toBeTruthy();
    const ids = txns.data.transactions.map((t: { id: number }) => t.id);
    expect(ids).toContain(c2.data.txnId);
    expect(ids).not.toContain(c1.data.txnId);
  });

  test("receipt endpoint returns valid plain-text receipt", async ({ page }) => {
    await apiTopUp(page, 10000);

    const charge = await apiCharge(page, 3000);
    const txnId = charge.data.txnId;
    const keys = await vcGetKeys(page);

    const receipt = await apiReceipt(page, txnId, keys.uid);
    expect(receipt.ok).toBeTruthy();
    expect(receipt.text).toContain("RECEIPT");
    expect(receipt.text).toContain(String(txnId));
  });

  test("top-up and charge both exceed single counter use", async ({ page }) => {
    await apiTopUp(page, 5000);

    const charge = await apiCharge(page, 1000);
    expect(charge.ok).toBeTruthy();

    const bal = await apiBalanceCheck(page);
    expect(bal.data.balance).toBe(4000);
  });
});

test.describe("Reconciliation Page with Virtual Card", () => {
  test("reconciliation API returns transaction data after financial operations", async ({ page }) => {
    await operatorLogin(page);
    await createVirtualCard(page);
    await discoverCard(page);

    await apiTopUp(page, 10000);
    await apiCharge(page, 3000);
    await apiRefund(page, 1000);

    const reconData = await page.evaluate(async () => {
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
});
