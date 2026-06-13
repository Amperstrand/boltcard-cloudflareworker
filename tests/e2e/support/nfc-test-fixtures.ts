/**
 * nfc-test-fixtures.ts
 *
 * Playwright test fixtures that install the NDEFReader mock before each test,
 * provide a separate setup page for provider operations, and expose a
 * `simulateNFCTap` helper that bridges the provider to the NFC mock.
 *
 * Usage:
 *   import { test, expect } from "./support/nfc-test-fixtures.js";
 *
 * The `test` provides three extra fixtures:
 *   - `nfcProvider` — CardProvider instance (virtual or USB, from TEST_PROVIDER)
 *   - `nfcSetupPage` — Separate browser page for provider.setup() / provider.tap()
 *   - `simulateNFCTap` — () => Promise<TapResult> — gets p/c from provider, fires mock
 *
 * The NDEFReader mock is automatically installed on the main test page via
 * `page.addInitScript()` before any navigation. Tests can call
 * `await page.goto("/card")` and the mock will be active.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { MOCK_NDEF_READER_SCRIPT, buildNfcUrl } from "./mock-ndef-reader.js";
import {
  createProvider,
  type CardProvider,
  type TapResult,
} from "../providers/index.js";
import { operatorLogin, makeApiHelpers } from "../helpers.js";

// ─── Fixture types ──────────────────────────────────────────────

interface NFCFixtures {
  /** CardProvider instance (virtual or USB based on TEST_PROVIDER env var) */
  nfcProvider: CardProvider;
  /** Separate browser page for provider operations (stays on /debug for virtual) */
  nfcSetupPage: Page;
  /**
   * Simulate an NFC tap on the test page.
   * Gets fresh p/c from the provider, constructs the NFC URL,
   * and fires the mock onreading event on the test page.
   * Returns the TapResult for assertions.
   *
   * @param overrideUrl - Optional URL override (skips provider.tap())
   */
  simulateNFCTap: (overrideUrl?: string) => Promise<TapResult>;
}

// ─── Extended test with NFC fixtures ────────────────────────────

export const test = base.extend<NFCFixtures>({
  // Create provider once per worker (cheap, no state until setup() is called)
  nfcProvider: async ({}, use) => {
    await use(createProvider());
  },

  // Separate browser page for provider.setup() and provider.tap()
  // This page stays on /debug (virtual provider) or is unused (USB provider)
  nfcSetupPage: async ({ browser }, use) => {
    const setupPage = await browser.newPage();
    await use(setupPage);
    await setupPage.close();
  },

  // Installs NDEFReader mock on the main test page and provides
  // simulateNFCTap that bridges provider -> mock event
  simulateNFCTap: async ({ page, nfcProvider, nfcSetupPage }, use) => {
    await page.addInitScript({ content: MOCK_NDEF_READER_SCRIPT });
    await page.addInitScript({
      content: `if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.resolve()};navigator.serviceWorker.getRegistrations=function(){return Promise.resolve([])};}`,
    });
    await page.route(/\/sw\.js(\?|$)/, (route) => route.abort());
    await page.route(/\/sw-register\.js(\?|$)/, (route) => route.abort());

    const doTap = async (overrideUrl?: string): Promise<TapResult> => {
      const result = await nfcProvider.tap(nfcSetupPage);

      const pageUrl = page.url();
      const hostname = new URL(pageUrl).hostname;
      const port = new URL(pageUrl).port;
      const url = overrideUrl ?? buildNfcUrl(
        `https://${hostname}${port ? ":" + port : "/"}`,
        result.p,
        result.c,
      );

      // Fire the mock onreading event on all active NDEFReader instances
      await page.evaluate((tapUrl: string) => {
        const mock = (
          window as unknown as {
            __mockNFC: { simulateTap: (u: string) => void };
          }
        ).__mockNFC;
        mock.simulateTap(tapUrl);
      }, url);

      return result;
    };

    await use(doTap);
  },
});

export { expect };
export type { NFCFixtures };

// ─── Helper: full NFC test setup ────────────────────────────────

/**
 * Complete setup for an NFC UI test:
 * 1. Login as operator on the setup page
 * 2. Setup the provider (creates virtual card)
 * 3. Discover the card via LNURLW tap
 *
 * Call this in test.beforeEach() when the test needs a discovered card.
 */
export async function setupNFCTestCard(
  setupPage: Page,
  provider: CardProvider,
): Promise<void> {
  await operatorLogin(setupPage);
  await provider.setup(setupPage);
  const api = makeApiHelpers(provider, setupPage);
  const disc = await api.discoverCard();
  expect(disc.ok).toBeTruthy();
  expect(disc.data.tag).toBe("withdrawRequest");
}

/**
 * Setup + top up the card with a given amount.
 * Useful for tests that need a card with a balance.
 */
export async function setupNFCTestCardWithBalance(
  setupPage: Page,
  provider: CardProvider,
  amount: number,
): Promise<void> {
  await setupNFCTestCard(setupPage, provider);
  const api = makeApiHelpers(provider, setupPage);
  const topup = await api.topUp(amount);
  expect(topup.ok).toBeTruthy();
}
