import { test, expect, type Page } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import { operatorLogin, makeApiHelpers, type ApiResult } from "./helpers.js";

const provider = createProvider();

interface FetchJson {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

async function postJson(page: Page, path: string, body: unknown): Promise<FetchJson> {
  return page.evaluate(
    async ({ path, body }: { path: string; body: unknown }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    { path, body },
  );
}

async function getJson(page: Page, url: string): Promise<FetchJson> {
  return page.evaluate(
    async (url: string) => {
      const r = await fetch(url);
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    url,
  );
}

async function sendTap(page: Page, tap: { p: string; c: string }): Promise<ApiResult> {
  return getJson(page, "/?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));
}

async function ensureCardActive(page: Page): Promise<number> {
  const api = makeApiHelpers(provider, page);
  await api.discoverCard();
  const bal = await api.balanceCheck();
  return bal.data.balance as number;
}

test.describe(`Hardware Cardholder Self-Service (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
  });

  test("card info returns valid state, uid, and payment method", async ({ page }) => {
    const startBalance = await ensureCardActive(page);

    const tap = await provider.tap(page);
    const info = await getJson(page, "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));

    expect(info.ok).toBeTruthy();
    expect(info.data.state).toBeDefined();
    expect(["discovered", "active"]).toContain(info.data.state);
    expect(info.data.uid).toBeDefined();
    expect(info.data.paymentMethod).toBeDefined();
    expect(typeof info.data.balance).toBe("number");
  });

  test("card info returns transaction history", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await ensureCardActive(page);
    await api.topUp(1000);

    const tap = await provider.tap(page);
    const info = await getJson(page, "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));

    expect(Array.isArray(info.data.history)).toBeTruthy();
    expect((info.data.history as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  test("card lock terminates card and blocks charges", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await ensureCardActive(page);
    await api.topUp(5000);

    const tap = await provider.tap(page);
    const lock = await postJson(page, "/api/card/lock", tap);
    expect(lock.ok, `Lock failed: ${JSON.stringify(lock.data)}`).toBeTruthy();
    expect(lock.data.success).toBeTruthy();

    const info = await getJson(page, "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));
    expect(info.data.state).toBe("terminated");

    const charge = await api.charge(1000);
    expect(charge.ok).toBeFalsy();
  });

  test("card reactivate restores active state", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const startBalance = await ensureCardActive(page);
    await api.topUp(3000);
    const expectedBalance = startBalance + 3000;

    const lockTap = await provider.tap(page);
    await postJson(page, "/api/card/lock", lockTap);

    const reactivateTap = await provider.tap(page);
    const reactivate = await postJson(page, "/api/card/reactivate", reactivateTap);
    expect(reactivate.ok, `Reactivate failed: ${JSON.stringify(reactivate.data)}`).toBeTruthy();

    const activateTap = await provider.tap(page);
    await sendTap(page, activateTap);

    const infoTap = await provider.tap(page);
    const info = await getJson(page, "/card/info?p=" + encodeURIComponent(infoTap.p) + "&c=" + encodeURIComponent(infoTap.c));
    expect(["active", "discovered", "keys_delivered"]).toContain(info.data.state);
  });

  test("balance preserved through lock/reactivate cycle", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const startBalance = await ensureCardActive(page);
    await api.topUp(2000);
    const expectedBalance = startBalance + 2000;

    const lockTap = await provider.tap(page);
    await postJson(page, "/api/card/lock", lockTap);

    const reactivateTap = await provider.tap(page);
    await postJson(page, "/api/card/reactivate", reactivateTap);

    const activateTap = await provider.tap(page);
    await sendTap(page, activateTap);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(expectedBalance);
  });

  test("receipt API returns formatted receipt for a charge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await ensureCardActive(page);

    const charge = await api.charge(500);
    expect(charge.ok).toBeTruthy();
    const txnId = charge.data.txnId;

    const cardInfo = await provider.getCardInfo(page);
    const receipt = await page.evaluate(
      async ({ txnId, uid }: { txnId: number; uid: string }) => {
        const r = await fetch("/api/receipt/" + txnId + "?uid=" + encodeURIComponent(uid));
        return { ok: r.ok, status: r.status, text: await r.text() };
      },
      { txnId, uid: cardInfo.uid },
    );

    expect(receipt.ok).toBeTruthy();
    expect(receipt.text).toContain("RECEIPT");
    expect(receipt.text).toContain(String(txnId));
  });
});
