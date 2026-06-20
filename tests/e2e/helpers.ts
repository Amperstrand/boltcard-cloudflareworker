import { expect, type Page } from "@playwright/test";
import { type CardProvider, type TapResult } from "./providers/index.js";

// --- Constants ---
export const OPERATOR_PIN = "1234";

// --- Playwright Helpers ---
export async function operatorLogin(page: Page): Promise<void> {
  await page.goto("/operator/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="pin"]').fill(OPERATOR_PIN);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/operator/pos**", { timeout: 15000 });
}

export async function gotoVirtualCardTab(page: Page): Promise<void> {
  await page.goto("/debug", { waitUntil: "domcontentloaded" });
  await page.locator('button[data-tab="virtual"]').click();
  await expect(page.locator("#panel-virtual")).toBeVisible();
}

// --- Financial API Helpers ---
export interface ApiResult {
  ok: boolean;
  status: number;
  data: Record<string, any>;
}

async function providerFetch(
  page: Page,
  path: string,
  method: "GET" | "POST",
  tap: TapResult,
  extraBody?: Record<string, unknown>,
): Promise<ApiResult> {
  return page.evaluate(
    async ({ path, method, t, extraBody }: { path: string; method: string; t: { p: string; c: string }; extraBody?: Record<string, unknown> }) => {
      const body = { ...t, ...extraBody };
      const csrfMatch = document.cookie.match(/op_csrf=([^;]+)/);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfMatch) headers["X-CSRF-Token"] = csrfMatch[1];
      const r = await fetch(path, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body) : undefined,
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    { path, method, t: tap, extraBody },
  );
}

async function providerGetFetch(
  page: Page,
  url: string,
): Promise<ApiResult> {
  return page.evaluate(async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, url);
}

export function makeApiHelpers(provider: CardProvider, page: Page) {
  const tap = () => provider.tap(page);

  return {
    tap,
    discoverCard: async (): Promise<ApiResult> => {
      const t = await tap();
      return providerGetFetch(page, "/?p=" + encodeURIComponent(t.p) + "&c=" + encodeURIComponent(t.c));
    },
    topUp: async (amount: number): Promise<ApiResult> => {
      const t = await tap();
      return providerFetch(page, "/operator/topup/apply", "POST", t, { amount });
    },
    charge: async (amount: number): Promise<ApiResult> => {
      const t = await tap();
      return providerFetch(page, "/operator/pos/charge", "POST", t, { amount });
    },
    refund: async (amount: number): Promise<ApiResult> => {
      const t = await tap();
      return providerFetch(page, "/operator/refund/apply", "POST", t, { amount });
    },
    balanceCheck: async (): Promise<ApiResult> => {
      const t = await tap();
      return providerFetch(page, "/api/balance-check", "POST", t);
    },
    void: async (transactionId: number): Promise<ApiResult> => {
      const t = await tap();
      return providerFetch(page, "/operator/void/apply", "POST", t, { transactionId });
    },
    voidTransactions: async (): Promise<ApiResult> => {
      const t = await tap();
      return providerGetFetch(page, "/operator/void/transactions?p=" + encodeURIComponent(t.p) + "&c=" + encodeURIComponent(t.c));
    },
    receipt: async (txnId: number, uid: string): Promise<{ ok: boolean; status: number; text: string }> => {
      return page.evaluate(
        async ({ txnId, uid }: { txnId: number; uid: string }) => {
          const r = await fetch("/api/receipt/" + txnId + "?uid=" + encodeURIComponent(uid));
          return { ok: r.ok, status: r.status, text: await r.text() };
        },
        { txnId, uid },
      );
    },
  };
}
