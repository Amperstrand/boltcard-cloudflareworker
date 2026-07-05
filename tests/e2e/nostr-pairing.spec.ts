import { test, expect, type Page } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import type { TapResult } from "./providers/index.js";

const provider = createProvider();

const TEST_NPUB = "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq987654";

async function injectNostrMock(page: Page, npub: string): Promise<void> {
  await page.addInitScript((testNpub: string) => {
    (window as any).nostr = {
      getPublicKey: async () => testNpub,
      signEvent: async (event: any) => ({ ...event, sig: "mock-sig" }),
      getRelays: async () => ({}),
      nip04: {
        encrypt: async () => "mock-encrypted",
        decrypt: async () => "mock-decrypted",
      },
    };
  }, npub);
}

test.describe("Nostr Pairing — NIP-07 UI Flow", () => {
  test.beforeEach(async ({ page }) => {
    await provider.setup(page);
  });

  test("full pairing flow: connect NIP-07 → tap card → paired", async ({ page }) => {
    await injectNostrMock(page, TEST_NPUB);
    const tap = await provider.tap(page);

    await page.goto("/pair-nostr", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#pair-idle")).toBeVisible();

    await page.locator("#btn-connect-nostr").click();

    await expect(page.locator("#nostr-connected")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#nostr-npub")).toHaveText(TEST_NPUB);

    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapPair(t.p, t.c);
    }, tap);

    await expect(page.locator("#pair-success")).toBeVisible({ timeout: 10000 });
  });

  test.skip("pairing page shows error without NIP-07 extension", async ({ page }) => {
    await page.goto("/pair-nostr", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#pair-idle")).toBeVisible();

    await page.locator("#btn-connect-nostr").click();

    await expect(page.locator("#pair-error")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#pair-error-msg")).toContainText(/nostr|NIP-07|extension/i);
  });

  test("paired card VC includes Nostr npub via UI flow", async ({ page }) => {
    await injectNostrMock(page, TEST_NPUB);
    const tap = await provider.tap(page);

    await page.goto("/pair-nostr", { waitUntil: "domcontentloaded" });
    await page.locator("#btn-connect-nostr").click();
    await expect(page.locator("#nostr-connected")).toBeVisible({ timeout: 5000 });

    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapPair(t.p, t.c);
    }, tap);
    await expect(page.locator("#pair-success")).toBeVisible({ timeout: 10000 });

    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapCredential(t.p, t.c);
    }, tap);

    await expect(page.locator("#state-issued")).toBeVisible({ timeout: 10000 });

    const jwt = await page.locator("#vc-jwt-display").textContent();
    expect(jwt).toBeTruthy();

    const decoded = await page.evaluate(async (jwtStr: string) => {
      const parts = jwtStr.split(".");
      const payload = JSON.parse(atob(parts[1]!));
      return payload;
    }, jwt!);

    expect(decoded.vc?.credentialSubject?.nostrNpub).toBe(TEST_NPUB);
  });

  test("unpair removes Nostr identity from card", async ({ page }) => {
    await injectNostrMock(page, TEST_NPUB);
    const tap = await provider.tap(page);

    await page.goto("/pair-nostr", { waitUntil: "domcontentloaded" });
    await page.locator("#btn-connect-nostr").click();
    await expect(page.locator("#nostr-connected")).toBeVisible({ timeout: 5000 });

    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapPair(t.p, t.c);
    }, tap);
    await expect(page.locator("#pair-success")).toBeVisible({ timeout: 10000 });

    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapPair(t.p, t.c);
    }, tap);

    const result = await page.evaluate(async (t: TapResult): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/unpair-nostr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: t.p, c: t.c }),
      });
      return r.json();
    }, tap);

    expect(result.success).toBe(true);
  });
});
