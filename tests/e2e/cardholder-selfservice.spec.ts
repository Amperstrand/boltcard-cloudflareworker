import { test, expect } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import { operatorLogin, makeApiHelpers } from "./helpers.js";

const provider = createProvider();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchJson = { ok: boolean; status: number; data: Record<string, any> };
type FetchText = { ok: boolean; status: number; text: string };

test.describe(`Cardholder Self-Service (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);
    // Discover and top-up so card has balance
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
    const topup = await api.topUp(10000);
    expect(topup.ok).toBeTruthy();
  });

  test("card info API returns balance, state, and UID", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();
    const info = await page.evaluate<FetchJson, string>(
      async (url) => {
        const r = await fetch(url);
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
    );

    expect(info.ok).toBeTruthy();
    expect(info.data.state).toBeDefined();
    expect(["discovered", "active"]).toContain(info.data.state);
    expect(info.data.balance).toBe(10000);
    expect(info.data.uid).toBeDefined();
    expect(info.data.paymentMethod).toBeDefined();
  });

  test("card info API returns transaction history", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.charge(3000);

    const tap = await api.tap();
    const info = await page.evaluate<FetchJson, string>(
      async (url) => {
        const r = await fetch(url);
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
    );

    expect(info.data.history).toBeDefined();
    expect(Array.isArray(info.data.history)).toBeTruthy();
    // Should have: top-up + charge = at least 2 entries
    expect(info.data.history.length).toBeGreaterThanOrEqual(2);
  });

  test("balance check API returns correct balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.charge(2000);

    const bal = await api.balanceCheck();
    expect(bal.ok).toBeTruthy();
    expect(bal.data.balance).toBe(8000);
  });

  test("card lock prevents further transactions", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    // Lock the card
    const lock = await page.evaluate<FetchJson, { p: string; c: string }>(
      async (body) => {
        const r = await fetch("/api/card/lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      tap,
    );

    expect(lock.ok, `Lock failed: ${JSON.stringify(lock.data)}`).toBeTruthy();
    expect(lock.data.success).toBeTruthy();

    // Verify card is now locked
    const info = await page.evaluate<FetchJson, string>(
      async (url) => {
        const r = await fetch(url);
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
    );

    expect(info.data.state).toBe("locked");

    // POS charge should fail on locked card
    const charge = await api.charge(1000);
    expect(charge.ok).toBeFalsy();
  });

  test("card reactivate restores card to active state", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    // Lock first
    await page.evaluate<void, { p: string; c: string }>(
      async (body) => {
        await fetch("/api/card/lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      },
      tap,
    );

    // Reactivate with a fresh tap (new counter value)
    const freshTap = await api.tap();
    const reactivate = await page.evaluate<FetchJson, { p: string; c: string }>(
      async (body) => {
        const r = await fetch("/api/card/reactivate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      freshTap,
    );

    expect(reactivate.ok, `Reactivate failed: ${JSON.stringify(reactivate.data)}`).toBeTruthy();

    // Verify card is active again
    const infoTap = await api.tap();
    const info = await page.evaluate<FetchJson, string>(
      async (url) => {
        const r = await fetch(url);
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      "/card/info?p=" + encodeURIComponent(infoTap.p) + "&c=" + encodeURIComponent(infoTap.c),
    );

    expect(["active", "discovered"]).toContain(info.data.state);
  });

  test("balance is preserved after lock/reactivate cycle", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    // Lock
    await page.evaluate<void, { p: string; c: string }>(
      async (body) => {
        await fetch("/api/card/lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      },
      tap,
    );

    // Reactivate
    const freshTap = await api.tap();
    await page.evaluate<void, { p: string; c: string }>(
      async (body) => {
        await fetch("/api/card/reactivate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      },
      freshTap,
    );

    // Balance should still be 10000
    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(10000);
  });

  test("receipt API returns formatted receipt for a charge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const charge = await api.charge(3500);
    expect(charge.ok).toBeTruthy();
    const txnId = charge.data.txnId;

    const keys = await provider.getCardInfo(page);
    const receipt = await page.evaluate<FetchText, { txnId: number; uid: string }>(
      async ({ txnId, uid }) => {
        const r = await fetch("/api/receipt/" + txnId + "?uid=" + encodeURIComponent(uid));
        return { ok: r.ok, status: r.status, text: await r.text() };
      },
      { txnId, uid: keys.uid },
    );

    expect(receipt.ok).toBeTruthy();
    expect(receipt.text).toContain("RECEIPT");
    expect(receipt.text).toContain(String(txnId));
    expect(receipt.text).toContain("3500");
  });
});
