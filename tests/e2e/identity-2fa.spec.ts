import { test, expect } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import { operatorLogin, makeApiHelpers } from "./helpers.js";

const provider = createProvider();

interface ApiResult {
  ok: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

test.describe(`Identity & 2FA (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
  });

  // ─── Identity Verification ───

  test("identity verify API validates card tap", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    const result = await page.evaluate(
      async (url: string): Promise<ApiResult> => {
        const r = await fetch(url);
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      "/api/verify-identity?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
    );

    expect(result.ok).toBeTruthy();
    // Card is in discovered/active state — identity check should return uid info
    expect(result.data.uid).toBeDefined();
    expect(result.data.maskedUid).toBeDefined();
  });

  test("identity page renders with status indicators", async ({ page }) => {
    await page.goto("/identity", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#state-idle")).toBeVisible({ timeout: 15000 });
  });

  // ─── 2FA ───

  test("2FA page renders with code display area", async ({ page }) => {
    await page.goto("/2fa", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#scan-status")).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: "test-results/twofa-page.png" });
  });

  test("2FA endpoint with valid p/c returns OTP codes", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    const result = await page.evaluate(
      async (url: string): Promise<ApiResult> => {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      "/2fa?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
    );

    expect(result.ok).toBeTruthy();
    expect(result.data.totpCode).toBeDefined();
    expect(result.data.totpCode.length).toBeGreaterThanOrEqual(6);
  });

  // ─── Card Identification (operator) ───

  test("identify-card API returns card details", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    const result = await page.evaluate(
      async (body: { p: string; c: string }): Promise<ApiResult> => {
        const r = await fetch("/api/identify-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      tap,
    );

    expect(result.ok).toBeTruthy();
    expect(result.data.uid).toBeDefined();
    expect(result.data.card_state).toBeDefined();
    expect(["discovered", "active"]).toContain(result.data.card_state);
  });

  test("identify-issuer-key API detects card issuer", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();

    const result = await page.evaluate(
      async (body: { p: string; c: string }): Promise<ApiResult> => {
        const r = await fetch("/api/identify-issuer-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      tap,
    );

    expect(result.ok).toBeTruthy();
    expect(result.data.matched).toBe(true);
    expect(result.data.issuerKeyFingerprint).toBeDefined();
  });
});

test.describe(`Identity Edge Cases (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
  });

  test("identity verify with invalid p falls back to demo mode", async ({ page }) => {
    const result = await page.evaluate(async (): Promise<ApiResult> => {
      const r = await fetch("/api/verify-identity?p=invalid&c=invalid");
      return { ok: r.ok, status: r.status, data: await r.json() };
    });

    expect(result.ok).toBeTruthy();
    expect(result.data.demoMode).toBe(true);
    expect(result.data.fallbackReason).toBeDefined();
  });

  test("identify-card with tampered c returns error", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const tap = await api.tap();
    // Tamper with the CMAC
    const tampered = { p: tap.p, c: "deadbeefdeadbeef" };

    const result = await page.evaluate(
      async (body: { p: string; c: string }): Promise<ApiResult> => {
        const r = await fetch("/api/identify-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: r.ok, status: r.status, data: await r.json() };
      },
      tampered,
    );

    expect(result.ok).toBeTruthy();
    const matched = result.data.matched;
    expect(matched).toBeNull();
  });
});
