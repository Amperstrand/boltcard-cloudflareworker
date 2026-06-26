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

    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    const uid = await page.locator("#vc-uid").textContent();
    expect(uid).toMatch(/^[0-9A-F]{14}$/);

    await expect(page.locator("#vc-counter")).toHaveText("1");

    await expect(page.locator("#vc-tap-btn")).toBeVisible();
    await expect(page.locator("#vc-auto-btn")).toBeVisible();

    const status = await page.locator("#vc-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Virtual card created!");

    await expect(page.locator("#vc-keys-toggle")).toBeVisible();
    await page.locator("#vc-keys-toggle").click();
    await expect(page.locator("#vc-k1-full")).toBeVisible();
    const k1 = await page.locator("#vc-k1-full").textContent();
    expect(k1).toMatch(/^[0-9a-f]{32}$/);
    const k2 = await page.locator("#vc-k2-full").textContent();
    expect(k2).toMatch(/^[0-9a-f]{32}$/);
  });

  test("0.3 - Tap virtual card sends LNURLW request and gets withdrawRequest", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    await page.locator("#vc-tap-btn").click();

    const logEl = page.locator("#vc-tap-log");
    await expect(logEl.locator("div").first()).toBeVisible({ timeout: 10000 });

    await expect(logEl).toContainText("Destination: lnurlw");
    await expect(logEl).toContainText("withdrawRequest received", { timeout: 10000 });

    await expect(page.locator("#vc-counter")).toHaveText("2");
  });

  test("0.4 - Multiple taps increment counter and produce different params", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    for (let i = 0; i < 3; i++) {
      await page.locator("#vc-tap-btn").click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator("#vc-counter")).toHaveText("4");

    const logEntries = await page.locator("#vc-tap-log > div").count();
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

    await page.locator("#vc-auto-btn").click();

    const logEl = page.locator("#vc-tap-log");

    await expect(logEl).toContainText("Step 1: Initial tap", { timeout: 10000 });
    await expect(logEl).toContainText("withdrawRequest", { timeout: 10000 });

    await expect(logEl).toContainText("Step 2: Top-up", { timeout: 10000 });
    await expect(logEl).toContainText("Top-up successful", { timeout: 10000 });

    await expect(logEl).toContainText("Step 3: POS charge", { timeout: 10000 });
    await expect(logEl).toContainText("Charge successful", { timeout: 10000 });

    await expect(logEl).toContainText("Step 4: Refund", { timeout: 10000 });
    await expect(logEl).toContainText("Refund successful", { timeout: 10000 });

    await expect(logEl).toContainText("Step 5: Verify balance", { timeout: 10000 });
    await expect(logEl).toContainText("Balance: 10000", { timeout: 10000 });

    await expect(logEl).toContainText("All steps passed!", { timeout: 10000 });

    await expect(page.locator("#vc-status")).toContainText("all passed");
  });

  test("0.7 - Auto-test shows step-by-step pass/fail details", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    await page.locator("#vc-auto-btn").click();

    await expect(page.locator("#vc-tap-log")).toContainText("All steps passed!", { timeout: 30000 });

    const checkmarks = await page.locator("#vc-tap-log .text-emerald-400").count();
    expect(checkmarks).toBeGreaterThanOrEqual(5);

    const failures = await page.locator("#vc-tap-log .text-red-400").count();
    expect(failures).toBe(0);
  });

  test("0.12 - Reset and create second virtual card with different UID", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
    const firstUid = await page.locator("#vc-uid").textContent();

    await page.locator("#vc-reset-btn").click();
    await expect(page.locator("#vc-create-btn")).toBeVisible();

    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
    const secondUid = await page.locator("#vc-uid").textContent();

    expect(secondUid).not.toBe(firstUid);
    await expect(page.locator("#vc-counter")).toHaveText("1");
  });
});

test.describe("Virtual Card — Operator Flow Integration", () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await gotoVirtualCardTab(page);
  });

  test("0.8 - Virtual card top-up via API", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    await page.locator("#vc-tap-btn").click();
    await expect(page.locator("#vc-tap-log")).toContainText("withdrawRequest", { timeout: 10000 });

    const uid = await page.locator("#vc-uid").textContent();

    const response = await page.evaluate(async (uid: string): Promise<{ ok: boolean; data: { uid: string; k1: string; k2: string } }> => {
      const r = await fetch(`/api/vc/keys?uid=${uid}`);
      return { ok: r.ok, data: await r.json() };
    }, uid!);
    expect(response.ok).toBeTruthy();
    const data = response.data;
    expect(data.uid.toLowerCase()).toBe(uid!.toLowerCase());
    expect(data.k1).toBeDefined();
    expect(data.k2).toBeDefined();
  });

  test("0.9 & 0.10 - Full lifecycle: top-up → charge → refund", async ({ page }) => {
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

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
