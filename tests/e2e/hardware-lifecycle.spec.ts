import { test, expect } from "@playwright/test";
import { createProvider, type BurnParams, type InspectResult } from "./providers/index.js";
import { operatorLogin, makeApiHelpers } from "./helpers.js";

const provider = createProvider();

interface ExtendedCardProvider {
  name: string;
  setup(page: import("@playwright/test").Page): Promise<void>;
  tap(page: import("@playwright/test").Page): Promise<{ p: string; c: string }>;
  getCardInfo(page?: import("@playwright/test").Page): Promise<{ uid: string; k1: string; k2: string; version: number }>;
  burn(params: BurnParams): Promise<{ uid: string }>;
  wipe(keys: [string, string, string, string, string]): Promise<{ uid: string }>;
  inspect(): Promise<InspectResult>;
  getUid(): Promise<string>;
}

const extProvider = provider as unknown as ExtendedCardProvider;

const FACTORY_KEY = "00000000000000000000000000000000";

// ─── Helpers ───

/** Send a card tap (p, c) to the LNURL-withdraw endpoint. */
async function sendTap(
  page: import("@playwright/test").Page,
  tap: { p: string; c: string },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  return page.evaluate(
    async (url: string) => {
      const r = await fetch(url);
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    "/?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
  );
}

/** Fetch card info from the server (state, balance, etc.). */
async function fetchCardInfo(
  page: import("@playwright/test").Page,
  tap: { p: string; c: string },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  return page.evaluate(
    async (url: string) => {
      const r = await fetch(url);
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
  );
}

// ─── Test Suite ───

test.describe(`Hardware Card Lifecycle (${provider.name} provider)`, () => {
  // ── 1. Inspect blank card ──

  test("inspect blank card", async ({ page }) => {
    if (!extProvider.inspect) test.skip();
    await extProvider.setup(page);

    const result = await extProvider.inspect();
    expect(result.hasSdm).toBe(false);
    expect(result.keyVersions).toBeDefined();
  });

  // ── 2. Burn card and verify ──

  test("burn card and verify", async ({ page }) => {
    if (!extProvider.burn) test.skip();
    await extProvider.setup(page);

    const info = await extProvider.getCardInfo();
    const urlTemplate = "https://boltcardpoc.psbt.me/";
    await extProvider.burn({
      urlTemplate,
      keys: [info.k1, info.k2, "", "", ""] as [string, string, string, string, string],
      keyVersion: 1,
      currentKey: FACTORY_KEY,
    });

    // Tap the freshly burned card
    const tap = await extProvider.tap(page);
    const res = await sendTap(page, tap);
    expect(res.ok).toBeTruthy();
    expect(res.data.tag).toBe("withdrawRequest");
  });

  // ── 3. Tap after burn triggers auto-discovery ──

  test("tap after burn triggers auto-discovery", async ({ page }) => {
    if (!extProvider.burn) test.skip();
    await extProvider.setup(page);
    const info = await extProvider.getCardInfo();

    // Burn first so the card has keys
    await extProvider.burn({
      urlTemplate: "https://boltcardpoc.psbt.me/",
      keys: [info.k1, info.k2, "", "", ""] as [string, string, string, string, string],
      keyVersion: 1,
      currentKey: FACTORY_KEY,
    });

    // First tap → server auto-discovers the card
    const tap = await extProvider.tap(page);
    await sendTap(page, tap);

    // Check card info → should be discovered or active
    const cardInfo = await fetchCardInfo(page, tap);
    expect(cardInfo.ok).toBeTruthy();
    const state = cardInfo.data.state as string;
    expect(["discovered", "active"]).toContain(state);
  });

  // ── 4. Full financial cycle: topup → charge → refund ──

  test("full financial cycle: topup → charge → refund", async ({ page }) => {
    await operatorLogin(page);
    await extProvider.setup(page);
    const api = makeApiHelpers(provider, page);

    // Discover card first
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();

    // Top up 10000 credits
    const topup = await api.topUp(10000);
    expect(topup.ok).toBeTruthy();
    expect(topup.data.balance).toBe(10000);

    // POS charge 3000 credits
    const charge = await api.charge(3000);
    expect(charge.ok).toBeTruthy();
    expect(charge.data.success).toBeTruthy();
    expect(charge.data.balance).toBe(7000);

    // Verify balance is 7000
    const bal1 = await api.balanceCheck();
    expect(bal1.data.balance).toBe(7000);

    // Refund 2000 credits
    const refund = await api.refund(2000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(9000);

    // Verify final balance is 9000
    const bal2 = await api.balanceCheck();
    expect(bal2.data.balance).toBe(9000);
  });

  // ── 5. Multiple taps increment counter ──

  test("multiple taps increment counter", async ({ page }) => {
    await operatorLogin(page);
    await extProvider.setup(page);
    const api = makeApiHelpers(provider, page);

    // Discover and top up
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
    await api.topUp(50000);

    // Three sequential taps — each should succeed
    for (let i = 0; i < 3; i++) {
      const tapResult = await api.tap();
      const res = await sendTap(page, tapResult);
      expect(res.ok, `Tap ${i + 1} failed: ${JSON.stringify(res.data)}`).toBeTruthy();
      expect(res.data.tag).toBe("withdrawRequest");
      expect(res.data.k1).toBeDefined();
    }
  });

  // ── 6. Wipe card and verify factory state ──

  test("wipe card and verify factory state", async ({ page }) => {
    if (!extProvider.wipe) test.skip();
    await operatorLogin(page);
    await extProvider.setup(page);
    const api = makeApiHelpers(provider, page);

    // Discover card to create server-side record
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();

    const info = await extProvider.getCardInfo();

    // Wipe the card
    await extProvider.wipe([info.k1, info.k2, "", "", ""] as [string, string, string, string, string]);

    // After wipe, inspect should show factory state
    if (extProvider.inspect) {
      const inspectResult = await extProvider.inspect();
      expect(inspectResult.hasSdm).toBe(false);
    }

    // A tap with the old keys should fail on the server
    // (the card no longer generates valid p/c for the server's stored keys)
    // Note: virtual provider still generates valid p/c from in-memory state,
    // but the card's physical state is wiped. The USB provider would produce
    // different output after a real wipe.
    if (extProvider.name === "usb") {
      const tapAfter = await extProvider.tap(page);
      const res = await sendTap(page, tapAfter);
      // After physical wipe, the card can't produce valid encrypted data
      expect(res.ok).toBeFalsy();
    }
  });

  // ── 7. Re-burn wiped card ──

  test("re-burn wiped card", async ({ page }) => {
    if (!extProvider.burn || !extProvider.wipe) test.skip();
    await operatorLogin(page);
    await extProvider.setup(page);
    const api = makeApiHelpers(provider, page);

    const info = await extProvider.getCardInfo();
    const originalK1 = info.k1;
    const originalK2 = info.k2;

    // First burn with original keys
    await extProvider.burn({
      urlTemplate: "https://boltcardpoc.psbt.me/",
      keys: [originalK1, originalK2, "", "", ""] as [string, string, string, string, string],
      keyVersion: 1,
      currentKey: FACTORY_KEY,
    });

    // Verify first burn works
    const tap1 = await extProvider.tap(page);
    const res1 = await sendTap(page, tap1);
    expect(res1.ok).toBeTruthy();

    // Wipe the card
    await extProvider.wipe([originalK1, originalK2, "", "", ""] as [string, string, string, string, string]);

    // Fetch new keys for the same UID (server will generate different keys
    // via key version advancement)
    const newInfo = await extProvider.getCardInfo();

    // Re-burn with new keys
    await extProvider.burn({
      urlTemplate: "https://boltcardpoc.psbt.me/",
      keys: [newInfo.k1, newInfo.k2, "", "", ""] as [string, string, string, string, string],
      keyVersion: 2,
      currentKey: originalK1,
    });

    // Verify new tap works with new keys
    const tap2 = await extProvider.tap(page);
    const res2 = await sendTap(page, tap2);
    expect(res2.ok, `Re-burned tap failed: ${JSON.stringify(res2.data)}`).toBeTruthy();
    expect(res2.data.tag).toBe("withdrawRequest");
  });
});
