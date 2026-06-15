/**
 * nfc-ui.spec.ts
 *
 * Tests the NFC scanning UI flow on pages that use WebNFC.
 * Uses the NDEFReader mock from support/mock-ndef-reader.ts to
 * simulate NFC taps without requiring physical hardware or Android Chrome.
 *
 * Provider: virtual (default) or USB (TEST_PROVIDER=usb)
 * Runs against live production: https://boltcardpoc.psbt.me
 */

import { test, expect } from "./support/nfc-test-fixtures.js";
import { setupNFCTestCard, setupNFCTestCardWithBalance } from "./support/nfc-test-fixtures.js";

test.describe("NFC Scanning UI", () => {
  test.beforeEach(async ({ nfcSetupPage, nfcProvider }) => {
    await setupNFCTestCard(nfcSetupPage, nfcProvider);
  });

  // ─── /card — Cardholder Dashboard ─────────────────────────────

  test("/card — NFC tap shows card info with state and balance", async ({
    page,
    nfcSetupPage,
    nfcProvider,
    simulateNFCTap,
  }) => {
    // Top up so the card has a non-zero balance to display
    await setupNFCTestCardWithBalance(nfcSetupPage, nfcProvider, 5000);

    // Navigate to card dashboard (mock NDEFReader is auto-installed)
    await page.goto("/card", { waitUntil: "domcontentloaded" });

    // Wait for NFC scanner to become ready (status text changes)
    await expect(page.locator("#scan-status")).toContainText("tap your card", {
      timeout: 5000,
    });

    // Simulate an NFC tap
    await simulateNFCTap();

    // Card info panel should become visible
    await expect(page.locator("#card-info")).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: "test-results/card-dashboard-after-tap.png" });

    await expect(page.locator("#card-state")).toHaveText(/Active|Discovered/);

    // Balance should show the top-up amount (formatted as "5000 credits")
    await expect(page.locator("#card-balance")).toContainText("5,000");

    // UID should be displayed (masked or full)
    const uid = await page.locator("#card-uid").textContent();
    expect(uid).toBeTruthy();
    expect(uid!.length).toBeGreaterThan(0);
  });

  // ─── /card — re-scan ──────────────────────────────────────────

  test("/card — re-scan button resets to scanner view", async ({
    page,
    nfcSetupPage,
    nfcProvider,
    simulateNFCTap,
  }) => {
    const tap = await nfcProvider.tap(nfcSetupPage);

    await page.goto("/card", { waitUntil: "domcontentloaded" });
    await page.evaluate(({ p, c }) => {
      localStorage.setItem("boltcard_params", JSON.stringify({ p, c, savedAt: Date.now() }));
    }, tap);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#saved-card")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#card-info")).toBeVisible({ timeout: 15000 });

    await page.locator("#btn-scan-different").click();

    await expect(page.locator("#scan-section")).toBeVisible();
    await expect(page.locator("#saved-card")).toBeHidden();
    await expect(page.locator("#scan-status")).toContainText("tap your card", {
      timeout: 5000,
    });
  });

  // ─── /identity — Identity Verification ────────────────────────

  test("/identity — NFC tap triggers identity verification flow", async ({
    page,
    simulateNFCTap,
  }) => {
    await page.goto("/identity", { waitUntil: "domcontentloaded" });

    // The identity page auto-starts scanning when NFC is available.
    // Wait for the scanning state to appear (panel border changes to blue).
    await expect(page.locator("#state-scanning")).toBeVisible({ timeout: 5000 });

    // Simulate NFC tap
    await simulateNFCTap();

    // In local dev, /api/verify-identity always returns verified:true (demo mode).
    // The page should show the verified state.
    await expect(page.locator("#state-verified")).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: "test-results/identity-verified.png" });
  });

  // ─── /2fa — Two-Factor Authentication ─────────────────────────

  test("/2fa — NFC tap on landing page redirects to OTP view", async ({
    page,
    simulateNFCTap,
  }) => {
    await page.goto("/2fa", { waitUntil: "domcontentloaded" });

    // Wait for the NFC scanner to start (the landing page auto-starts
    // and shows "Scanning for boltcard payload" text)
    await expect(page.locator("#scan-status")).toContainText("Scanning", {
      timeout: 5000,
    });

    // Simulate NFC tap — this should trigger a redirect to /2fa?p=...&c=...
    await simulateNFCTap();

    // Wait for navigation to the OTP page (URL now has p and c params)
    await page.waitForURL(/\/2fa\?p=.+&c=.+/, { timeout: 10000 });

    // OTP page should be rendered with TOTP timer
    await expect(page.locator("#otp-root")).toBeVisible({ timeout: 10000 });

    // TOTP code should be displayed
    const code = await page.locator("#totp-code").textContent();
    expect(code).toBeTruthy();
    // TOTP codes are 6 digits
    expect(code!.trim().replace(/\s/g, "").length).toBeGreaterThanOrEqual(6);

    await page.screenshot({ path: "test-results/2fa-otp-codes.png" });
  });

  // ─── /login — Key Recovery ────────────────────────────────────

  test("/login — NFC tap shows card key recovery info", async ({
    page,
    simulateNFCTap,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // Wait for NFC scanner to start
    await expect(page.locator("#scan-status")).toContainText("tap your card", {
      timeout: 5000,
    });

    // Simulate NFC tap
    await simulateNFCTap();

    // The login page validates the card with the server and shows
    // one of several views depending on key provenance and card state.
    // Virtual cards with public issuer key show the "public" view.
    // Cards discovered as active show the "private" view.
    const publicView = page.locator("#public-view");
    const privateView = page.locator("#private-view");
    const undeployedView = page.locator("#undeployed-view");

    await expect(
      publicView.or(privateView).or(undeployedView).filter({ visible: true }),
    ).toBeVisible({ timeout: 10000 });

    const ndef = await page.locator("#pub-ndef, #priv-ndef").filter({ visible: true }).textContent();
    expect(ndef).toBeTruthy();

    await page.screenshot({ path: "test-results/login-key-recovery.png" });
  });

  // ─── /login — NDEF display ────────────────────────────────────

  test("/login — scanned card displays UID and card state", async ({
    page,
    simulateNFCTap,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#scan-status")).toContainText("tap your card", {
      timeout: 5000,
    });

    await simulateNFCTap();

    // Wait for a card view to appear
    const publicView = page.locator("#public-view");
    const privateView = page.locator("#private-view");
    await expect(publicView.or(privateView).filter({ visible: true })).toBeVisible({ timeout: 10000 });

    // Card state should be shown (discovered or active)
    const stateText = await page
      .locator("#pub-state, #priv-state")
      .filter({ visible: true })
      .textContent();
    expect(stateText).toMatch(/discovered|active/i);
  });
});
