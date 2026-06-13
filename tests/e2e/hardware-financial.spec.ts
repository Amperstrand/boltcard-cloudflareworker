import { test, expect } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import { operatorLogin, makeApiHelpers } from "./helpers.js";

const provider = createProvider();

test.skip(provider.name !== "usb", "Hardware tests require TEST_PROVIDER=usb");

test.describe(`Hardware: Financial Flow (physical card)`, () => {
  let initialBalance = 0;

  test.beforeAll(async () => {
    if (provider.ensureReady) {
      try { await provider.ensureReady(); } catch { /* best-effort recovery */ }
    }
  });

  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);

    const bal = await api.balanceCheck();
    expect(bal.ok).toBeTruthy();
    initialBalance = bal.data.balance;

    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
    expect(disc.data.tag).toBe("withdrawRequest");
  });

  test("top-up increases balance by exact amount", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const amount = 1000;

    const result = await api.topUp(amount);
    expect(result.ok).toBeTruthy();
    expect(result.data.balance).toBe(initialBalance + amount);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(initialBalance + amount);
  });

  test("POS charge decreases balance by exact amount", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const topupAmt = 2000;
    const chargeAmt = 500;

    await api.topUp(topupAmt);

    const charge = await api.charge(chargeAmt);
    expect(charge.ok).toBeTruthy();
    expect(charge.data.balance).toBe(initialBalance + topupAmt - chargeAmt);
    expect(charge.data.txnId).toBeDefined();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(initialBalance + topupAmt - chargeAmt);
  });

  test("overdraft charge returns 402", async ({ page }) => {
    const api = makeApiHelpers(provider, page);

    const charge = await api.charge(999999999);
    expect(charge.status).toBe(402);
    expect(charge.data.success).toBeFalsy();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(initialBalance);
  });

  test("refund credits back after charge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const topupAmt = 2000;
    const chargeAmt = 800;
    const refundAmt = 300;

    await api.topUp(topupAmt);
    await api.charge(chargeAmt);

    const refund = await api.refund(refundAmt);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(initialBalance + topupAmt - chargeAmt + refundAmt);
  });

  test("void restores balance after charge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const topupAmt = 1500;
    const chargeAmt = 600;

    await api.topUp(topupAmt);
    const charge = await api.charge(chargeAmt);
    expect(charge.ok).toBeTruthy();
    const txnId = charge.data.txnId;

    const voidResult = await api.void(txnId);
    expect(voidResult.ok).toBeTruthy();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(initialBalance + topupAmt);
  });

  test("multiple sequential charges track running balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const topupAmt = 5000;
    const charges = [500, 300, 200];

    await api.topUp(topupAmt);

    let expected = initialBalance + topupAmt;
    for (const amt of charges) {
      const charge = await api.charge(amt);
      expect(charge.ok).toBeTruthy();
      expected -= amt;
      expect(charge.data.balance).toBe(expected);
    }

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(expected);
  });

  test("card info returns valid state and history", async ({ page }) => {
    const t = await provider.tap(page);
    const response = await page.goto(
      `/card/info?p=${encodeURIComponent(t.p)}&c=${encodeURIComponent(t.c)}`,
    );
    expect(response?.status()).toBe(200);

    const data = await response!.json();
    expect(data.uid).toBeDefined();
    expect(data.state).toMatch(/active|discovered/);
    expect(typeof data.balance).toBe("number");
    expect(Array.isArray(data.history)).toBeTruthy();
  });
});
