import { test, expect } from "@playwright/test";
import { operatorLogin, OPERATOR_PIN } from "./helpers.js";

test.describe("Operator UI", () => {
  test.describe("Operator Login Flow", () => {
    test("should display login form with PIN input and submit button", async ({ page }) => {
      await page.goto("/operator/login", { waitUntil: "domcontentloaded" });

      await expect(page.locator('input[name="pin"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expect(page.locator('label[for="pin"]')).toHaveText("PIN");
    });

    test("should login with valid PIN and redirect to POS", async ({ page }) => {
      await page.goto("/operator/login", { waitUntil: "domcontentloaded" });

      await page.locator('input[name="pin"]').fill(OPERATOR_PIN);
      await page.locator('button[type="submit"]').click();

      await page.waitForURL("**/operator/pos**", { timeout: 15000 });
      await expect(page.locator("#pos-root")).toBeVisible();
    });

    test("should show error on incorrect PIN", async ({ page }) => {
      await page.goto("/operator/login", { waitUntil: "domcontentloaded" });

      await page.locator('input[name="pin"]').fill("0000");
      await page.locator('button[type="submit"]').click();

      // Stays on login page with error
      await expect(page).toHaveURL(/\/operator\/login/);
      await expect(page.locator(".bg-red-900\\/30")).toBeVisible();
    });
  });

  test.describe("Authenticated Operator Pages", () => {
    test.beforeEach(async ({ page }) => {
      await operatorLogin(page);
    });

    test("POS Terminal Page - renders keypad and charge button", async ({ page }) => {
      await page.goto("/operator/pos", { waitUntil: "domcontentloaded" });

      // POS root container
      await expect(page.locator("#pos-root")).toBeVisible();

      // Keypad buttons
      await expect(page.locator("#keypad")).toBeVisible();
      await expect(page.locator('button[data-key="1"]')).toBeVisible();
      await expect(page.locator('button[data-key="5"]')).toBeVisible();
      await expect(page.locator('button[data-key="0"]')).toBeVisible();

      // Charge button
      await expect(page.locator("#charge-btn")).toBeVisible();
      await expect(page.locator("#charge-btn")).toHaveText("CHARGE");

      // Amount display
      await expect(page.locator("#amount-display")).toBeVisible();

      // Mode toggle
      await expect(page.locator("#mode-toggle")).toBeVisible();
    });

    test("POS Terminal Page - entering amount via keypad", async ({ page }) => {
      await page.goto("/operator/pos", { waitUntil: "domcontentloaded" });

      // Tap 5, 0, 0 on keypad
      await page.locator('button[data-key="5"]').click();
      await page.locator('button[data-key="0"]').click();
      await page.locator('button[data-key="0"]').click();

      // Amount display should show 500
      await expect(page.locator("#amount-display")).toHaveText("500");

      // Tap overlay should not be visible yet (needs charge click)
      await expect(page.locator("#tap-overlay")).not.toHaveClass(/visible/);
    });

     test("POS Terminal Page - charge triggers NFC scan overlay", async ({ page }) => {
       await page.goto("/operator/pos", { waitUntil: "domcontentloaded" });

       // Enter amount
       await page.locator('button[data-key="5"]').click();
       await page.locator('button[data-key="0"]').click();
       await page.locator('button[data-key="0"]').click();

       // Click charge
       await page.locator("#charge-btn").click();

       // NFC scan overlay should appear
       await expect(page.locator("#tap-overlay")).toHaveClass(/visible/);
       await expect(page.locator("#overlay-status")).toHaveText("TAP CARD TO PAY");
       await expect(page.locator("#overlay-amount")).toContainText("500");

       await page.screenshot({ path: "test-results/pos-nfc-overlay.png" });
     });

     test("Top-Up Page - renders keypad and scan button", async ({ page }) => {
       await page.goto("/operator/topup", { waitUntil: "domcontentloaded" });

       // Page header
       await expect(page.locator("text=TOP-UP").first()).toBeVisible();

       // Amount display
       await expect(page.locator("#amount-display")).toBeVisible();

       // Keypad
       await expect(page.locator("#keypad")).toBeVisible();

        // Enter amount via keypad
        await page.locator('button[data-key="5"]').click();
        await page.locator('button[data-key="0"]').click();
        await page.locator('button[data-key="0"]').click();

        // Amount display updates (headless Chromium has no Web NFC,
        // so page auto-switches to USB reader mode — check amount instead of NFC btn)
        await expect(page.locator("#amount-display")).toContainText("500");

        // Navigation links
        await expect(page.locator('a[href="/operator/refund"]').first()).toBeVisible();
        await expect(page.locator('a[href="/operator/pos"]').first()).toBeVisible();

       await page.screenshot({ path: "test-results/topup-page.png" });
     });

    test("Refund Page - renders card info area and scan button", async ({ page }) => {
      await page.goto("/operator/refund", { waitUntil: "domcontentloaded" });

      // Page header
      await expect(page.locator("text=REFUND").first()).toBeVisible();

      // NFC scan button
      await expect(page.locator("#nfc-tap-btn")).toBeVisible();

      // Card info and refund options (hidden until card scanned)
      await expect(page.locator("#card-info")).toBeHidden();
      await expect(page.locator("#refund-options")).toBeHidden();

      // Navigation links
      await expect(page.locator('a[href="/operator/topup"]')).toBeVisible();
      await expect(page.locator('a[href="/operator/pos"]')).toBeVisible();

      await page.screenshot({ path: "test-results/refund-page.png" });
    });

     test("Card Audit Page - renders filter buttons and table area", async ({ page }) => {
       await page.goto("/operator/cards", { waitUntil: "domcontentloaded" });

       // Title
       await expect(page.locator('h1:text-is("CARD REGISTRY")')).toBeVisible();

       // Filter buttons
       await expect(page.locator('button[data-filter=""]')).toBeVisible();
       await expect(page.locator('button[data-filter="active"]')).toBeVisible();
       await expect(page.locator('button[data-filter="terminated"]')).toBeVisible();

       // Repair and refresh buttons
       await expect(page.locator("#btn-repair")).toBeVisible();
       await expect(page.locator("#btn-refresh")).toBeVisible();

        // Either cards table, empty state, or loading indicator
        const hasTable = await page.locator("#cards-table").isVisible().catch(() => false);
        const hasEmpty = await page.locator("#no-cards").isVisible().catch(() => false);
        const hasLoading = await page.locator("text=Loading card registry").isVisible().catch(() => false);
        expect(hasTable || hasEmpty || hasLoading).toBeTruthy();

       await page.screenshot({ path: "test-results/card-audit-page.png" });
     });

    test("Debug Console - renders all tab buttons", async ({ page }) => {
      await page.goto("/debug", { waitUntil: "domcontentloaded" });

      // Tab buttons
      await expect(page.locator('button[data-tab="console"]')).toBeVisible();
      await expect(page.locator('button[data-tab="identify"]')).toBeVisible();
      await expect(page.locator('button[data-tab="wipe"]')).toBeVisible();
      await expect(page.locator('button[data-tab="twofa"]')).toBeVisible();
      await expect(page.locator('button[data-tab="identity"]')).toBeVisible();
      await expect(page.locator('button[data-tab="pos"]')).toBeVisible();

      // Card info panel
      await expect(page.locator("#card-info-panel")).toBeVisible();

      // NFC scan button
      await expect(page.locator("#nfc-scan-btn")).toBeVisible();

      await page.screenshot({ path: "test-results/debug-console.png" });
    });

    test("Logout clears session and redirects to login", async ({ page }) => {
      // Verify we're authenticated
      await page.goto("/operator/pos", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#pos-root")).toBeVisible();

      // Click logout from topup page (has logout button)
      await page.goto("/operator/topup", { waitUntil: "domcontentloaded" });
      await page.locator("#logout-btn").click();

      // Should redirect to login page
      await page.waitForURL("**/operator/login**", { timeout: 15000 });
      await expect(page.locator('input[name="pin"]')).toBeVisible();

      // Trying to access protected page should redirect to login
      await page.goto("/operator/pos", { waitUntil: "domcontentloaded" });
      await page.waitForURL("**/operator/login**", { timeout: 15000 });
      await expect(page.locator('input[name="pin"]')).toBeVisible();
    });
  });

  test.describe("Auth Protection", () => {
    test("unauthenticated access to /operator/topup redirects to login", async ({ page }) => {
      // Fresh context — no cookies
      await page.goto("/operator/topup", { waitUntil: "domcontentloaded" });

      await page.waitForURL("**/operator/login**", { timeout: 15000 });
      await expect(page.locator('input[name="pin"]')).toBeVisible();
    });

    test("unauthenticated access to /operator/pos redirects to login", async ({ page }) => {
      await page.goto("/operator/pos", { waitUntil: "domcontentloaded" });

      await page.waitForURL("**/operator/login**", { timeout: 15000 });
      await expect(page.locator('input[name="pin"]')).toBeVisible();
    });

    test("unauthenticated access to /operator/cards redirects to login", async ({ page }) => {
      await page.goto("/operator/cards", { waitUntil: "domcontentloaded" });

      await page.waitForURL("**/operator/login**", { timeout: 15000 });
      await expect(page.locator('input[name="pin"]')).toBeVisible();
    });

     test("login preserves return URL and redirects back", async ({ page }) => {
       // Navigate to protected page — should redirect with ?return= param
       await page.goto("/operator/topup", { waitUntil: "domcontentloaded" });
       await page.waitForURL(/\/operator\/login\?return=/, { timeout: 15000 });

       // Login
       await page.locator('input[name="pin"]').fill(OPERATOR_PIN);
       await page.locator('button[type="submit"]').click();

       // Should redirect back to /operator/topup
       await page.waitForURL("**/operator/topup", { timeout: 15000 });

       // Verify the top-up page loaded correctly (amount display visible)
       await expect(page.locator("#amount-display")).toBeVisible();
     });
  });
});
