import { test, expect, type Page } from "@playwright/test";
import { operatorLogin } from "./helpers.js";

interface HealthData {
  system: { kv: string; durableObject: string; overall: string };
  latency: { kvMs: number; doMs: number | null };
  seen: { last1h: number; last24h: number; last7d: number };
  topBalances: { uid: string; balance: number; state: string; updatedAt: number }[];
  cards: Record<string, number>;
  version: string;
}

async function fetchHealthData(page: Page): Promise<HealthData> {
  const resp = await page.request.get("/operator/health/data");
  expect(resp.status()).toBe(200);
  return (await resp.json()) as HealthData;
}

test.describe("/operator/health dashboard (#38)", () => {
  test.describe("Auth Protection", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("unauthenticated page access redirects to login", async ({ page }) => {
      await page.goto("/operator/health", { waitUntil: "domcontentloaded" });
      await page.waitForURL("**/operator/login**", { timeout: 15000 });
      await expect(page.locator('input[name="pin"]')).toBeVisible();
    });

    test("unauthenticated data endpoint is rejected", async ({ playwright }) => {
      const ctx = await playwright.request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://boltcardpoc.psbt.me",
      });
      const resp = await ctx.get("/operator/health/data", { maxRedirects: 0 });
      expect([401, 302, 403]).toContain(resp.status());
      await ctx.dispose();
    });
  });

  test.describe("Data endpoint", () => {
    test.beforeEach(async ({ page }) => {
      await operatorLogin(page);
    });

    test("returns the extended payload: latency, seen buckets, capped sorted top balances", async ({ page }) => {
      const data = await fetchHealthData(page);

      expect(["ok", "error"]).toContain(data.system.kv);
      expect(["healthy", "degraded", "down"]).toContain(data.system.overall);
      expect(typeof data.latency.kvMs).toBe("number");
      expect(data.latency.kvMs).toBeGreaterThanOrEqual(0);

      for (const bucket of [data.seen.last1h, data.seen.last24h, data.seen.last7d]) {
        expect(Number.isInteger(bucket)).toBe(true);
      }
      expect(data.seen.last24h).toBeGreaterThanOrEqual(data.seen.last1h);
      expect(data.seen.last7d).toBeGreaterThanOrEqual(data.seen.last24h);

      expect(Array.isArray(data.topBalances)).toBe(true);
      expect(data.topBalances.length).toBeLessThanOrEqual(10);
      const balances = data.topBalances.map((c) => c.balance);
      const sorted = [...balances].sort((a, b) => b - a);
      expect(balances).toEqual(sorted);
      for (const card of data.topBalances) {
        expect(card.balance).toBeGreaterThan(0);
        expect(card.uid).toMatch(/^[0-9a-f]{14}$/);
      }

      expect(data.cards.total).toBeGreaterThanOrEqual(data.topBalances.length);
    });
  });

  test.describe("Page rendering", () => {
    test.beforeEach(async ({ page }) => {
      await operatorLogin(page);
    });

    test("renders status, latency, activity, and top balances consistent with the API", async ({ page }) => {
      await page.goto("/operator/health", { waitUntil: "domcontentloaded" });

      const badge = page.locator("#status-badge");
      await expect(badge).not.toHaveText("CHECKING", { timeout: 20000 });
      await expect(badge).toHaveText(/HEALTHY|DEGRADED|DOWN/);

      await expect(page.locator("#kv-status")).toHaveText(/OK|ERROR/);
      await expect(page.locator("#kv-latency")).toHaveText(/\d+ ms/);
      await expect(page.locator("#do-latency")).toHaveText(/(\d+ ms|n\/a)/);

      for (const id of ["seen-1h", "seen-24h", "seen-7d"]) {
        await expect(page.locator(`#${id}`)).toHaveText(/^\d[\d,]*$/);
      }

      const data = await fetchHealthData(page);
      const rows = page.locator("#top-balances-tbody tr");
      if (data.topBalances.length === 0) {
        await expect(page.locator("#no-top-balances")).toBeVisible();
        await expect(rows).toHaveCount(0);
      } else {
        await expect(page.locator("#no-top-balances")).toBeHidden();
        await expect(rows).toHaveCount(data.topBalances.length, { timeout: 15000 });
        await expect(rows.first()).toContainText(data.topBalances[0]!.balance.toLocaleString("en-US"));
        await expect(rows.first().locator("td").first()).toContainText(
          data.topBalances[0]!.uid.slice(0, 10),
        );
      }

      await expect(page.locator("#version")).not.toHaveText("—");
    });

    test("manual refresh reloads data without errors", async ({ page }) => {
      await page.goto("/operator/health", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#status-badge")).not.toHaveText("CHECKING", { timeout: 20000 });

      await page.locator("#refresh-btn").click();
      await expect(page.locator("#status-badge")).not.toHaveText("CHECKING");
      await expect(page.locator("#last-updated")).toHaveText(/^Updated \d{2}:\d{2}:\d{2}$/);
      await expect(page.locator("#error-box")).toBeHidden();
    });
  });
});
