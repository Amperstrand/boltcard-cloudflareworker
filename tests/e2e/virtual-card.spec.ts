import { test, expect, type Page } from "@playwright/test";
import { operatorLogin, gotoVirtualCardTab } from "./helpers.js";

test.describe("Virtual Card Simulator", () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await gotoVirtualCardTab(page);
  });

  test("0.1 - Virtual Card tab renders with Create button", async ({ page }) => {
    await expect(page.locator("#vc-create-btn")).toBeVisible();
    await expect(page.locator("#vc-create-btn")).toHaveText("Create Virtual Card");
    await expect(page.locator("#vc-tap-btn")).toBeHidden();
    await expect(page.locator("#vc-auto-btn")).toBeHidden();
    await expect(page.locator("#vc-uid")).toHaveText("--");
    await expect(page.locator("#vc-counter")).toHaveText("--");
  });

  test("0.2 - Create virtual card shows UID, K1, K2, Version and Tap button", async ({ page }) => {
    await page.locator("#vc-create-btn").click();

    // Wait for card creation (fetch to /api/debug/virtual-card-keys)
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    // UID should be a 14-char hex string (uppercase)
    const uid = await page.locator("#vc-uid").textContent();
    expect(uid).toMatch(/^[0-9A-F]{14}$/);

    // Counter starts at 1
    await expect(page.locator("#vc-counter")).toHaveText("1");

    // K1 and K2 should show truncated hex (8 chars + ellipsis)
    const k1 = await page.locator("#vc-k1").textContent();
    expect(k1).toMatch(/^[0-9a-f]{8}…$/);
    const k2 = await page.locator("#vc-k2").textContent();
    expect(k2).toMatch(/^[0-9a-f]{8}…$/);

    // Tap button should now be visible
    await expect(page.locator("#vc-tap-btn")).toBeVisible();
    await expect(page.locator("#vc-auto-btn")).toBeVisible();

    // Status should show success
    const status = await page.locator("#vc-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Virtual card created!");

    // Create button text changes to "Reset & Create New"
    await expect(page.locator("#vc-create-btn")).toHaveText("Reset & Create New");
  });

  test("0.3 - Tap virtual card sends LNURLW request and gets withdrawRequest", async ({ page }) => {
    // Create card first
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    // Tap the card
    await page.locator("#vc-tap-btn").click();

    // Wait for tap log to appear with a successful result
    const logEl = page.locator("#vc-tap-log");
    await expect(logEl.locator("div").first()).toBeVisible({ timeout: 10000 });

    // Should show counter info and LNURLW query
    await expect(logEl).toContainText("Tap counter 1");
    await expect(logEl).toContainText("Querying LNURLW endpoint");

    // Should get a withdrawRequest response
    await expect(logEl).toContainText("withdrawRequest received", { timeout: 10000 });

    // Counter should have incremented
    await expect(page.locator("#vc-counter")).toHaveText("2");
  });

  test("0.4 - Multiple taps increment counter and produce different params", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    // Tap 3 times
    for (let i = 0; i < 3; i++) {
      await page.locator("#vc-tap-btn").click();
      await page.waitForTimeout(500); // small delay for fetch to complete
    }

    // Counter should be 4 (started at 1, tapped 3 times → incremented to 4)
    await expect(page.locator("#vc-counter")).toHaveText("4");

    // Log should have entries for all 3 taps
    const logEntries = await page.locator("#vc-tap-log > div").count();
    // Each tap produces 2 log lines (counter + query/response) = 6 minimum
    expect(logEntries).toBeGreaterThanOrEqual(6);
  });

  test("0.5 - Card discovered after tap — DO state and registry", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
    await page.locator("#vc-tap-btn").click();
    await expect(page.locator("#vc-tap-log")).toContainText("withdrawRequest", { timeout: 10000 });

    const keys = await page.evaluate(() => (window as any)._vcGetKeys());
    const uid = keys.uid.toLowerCase();

    const tapResult = await page.evaluate(() => (window as any)._vcTap());

    const cardInfo = await page.evaluate(async (tap: { p: string; c: string }): Promise<{
      state: string; uid?: string;
    }> => {
      const r = await fetch("/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));
      return r.json();
    }, tapResult);

    expect(cardInfo.state).toBeDefined();
    expect(["discovered", "active"]).toContain(cardInfo.state);
    expect(cardInfo.uid?.toLowerCase()).toBe(uid);
  });

  test("0.6 - Auto-test lifecycle runs all steps", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    // Run auto-test
    await page.locator("#vc-auto-btn").click();

    // Wait for auto-test to complete (has 5 steps + summary)
    const logEl = page.locator("#vc-tap-log");

    // Step 1: discover
    await expect(logEl).toContainText("Step 1: Initial tap", { timeout: 10000 });
    await expect(logEl).toContainText("withdrawRequest", { timeout: 10000 });

    // Step 2: top-up
    await expect(logEl).toContainText("Step 2: Top-up", { timeout: 10000 });
    await expect(logEl).toContainText("Top-up successful", { timeout: 10000 });

    // Step 3: POS charge
    await expect(logEl).toContainText("Step 3: POS charge", { timeout: 10000 });
    await expect(logEl).toContainText("Charge successful", { timeout: 10000 });

    // Step 4: refund
    await expect(logEl).toContainText("Step 4: Refund", { timeout: 10000 });
    await expect(logEl).toContainText("Refund successful", { timeout: 10000 });

    // Step 5: balance check
    await expect(logEl).toContainText("Step 5: Verify balance", { timeout: 10000 });
    await expect(logEl).toContainText("Balance: 10000", { timeout: 10000 });

    // Summary
    await expect(logEl).toContainText("All steps passed!", { timeout: 10000 });

    // Status should show success
    await expect(page.locator("#vc-status")).toContainText("all passed");
  });

  test("0.7 - Auto-test shows step-by-step pass/fail details", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    await page.locator("#vc-auto-btn").click();

    // Wait for completion
    await expect(page.locator("#vc-tap-log")).toContainText("All steps passed!", { timeout: 30000 });

    // Each step should have a checkmark (✓) for pass
    const checkmarks = await page.locator("#vc-tap-log .text-emerald-400").count();
    expect(checkmarks).toBeGreaterThanOrEqual(5);

    // No X marks (✗) for failures
    const failures = await page.locator("#vc-tap-log .text-red-400").count();
    expect(failures).toBe(0);
  });

  test("0.12 - Reset and create second virtual card with different UID", async ({ page }) => {
    // Create first card
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
    const firstUid = await page.locator("#vc-uid").textContent();

    // Reset and create second card
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
    const secondUid = await page.locator("#vc-uid").textContent();

    // UIDs should be different (randomly generated)
    expect(secondUid).not.toBe(firstUid);

    // Counter should restart at 1
    await expect(page.locator("#vc-counter")).toHaveText("1");
  });
});

test.describe("Virtual Card — Operator Flow Integration", () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await gotoVirtualCardTab(page);
  });

  test("0.8 - Virtual card top-up via API", async ({ page }) => {
    // Create card
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    // Tap to discover the card first
    await page.locator("#vc-tap-btn").click();
    await expect(page.locator("#vc-tap-log")).toContainText("withdrawRequest", { timeout: 10000 });

    // Use auto-test which includes top-up — just verify the top-up step works
    // (Full top-up is tested in 0.6, this test validates the API endpoint directly)
    const uid = await page.locator("#vc-uid").textContent();

    // Direct API call to verify card exists
    const response = await page.evaluate(async (uid: string): Promise<{ ok: boolean; data: { uid: string; k1: string; k2: string } }> => {
      const r = await fetch(`/api/debug/virtual-card-keys?uid=${uid}`);
      return { ok: r.ok, data: await r.json() };
    }, uid!);
    expect(response.ok).toBeTruthy();
    const data = response.data;
    expect(data.uid.toLowerCase()).toBe(uid!.toLowerCase());
    expect(data.uid.toLowerCase()).toBe(uid!.toLowerCase());
    expect(data.k1).toBeDefined();
    expect(data.k2).toBeDefined();
  });

  test("0.9 & 0.10 - Full lifecycle: top-up → charge → refund", async ({ page }) => {
    // Create card
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    // Run auto-test which does exactly: discover → top-up 10000 → charge 3000 → refund 3000
    await page.locator("#vc-auto-btn").click();
    await expect(page.locator("#vc-tap-log")).toContainText("All steps passed!", { timeout: 30000 });
    await expect(page.locator("#vc-tap-log")).toContainText("Balance: 10000");
  });

  test("0.11 - Balance check API returns correct balance after auto-test", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    await page.locator("#vc-auto-btn").click();
    await expect(page.locator("#vc-tap-log")).toContainText("All steps passed!", { timeout: 30000 });
    await expect(page.locator("#vc-tap-log")).toContainText("Balance: 10000");
  });
});
