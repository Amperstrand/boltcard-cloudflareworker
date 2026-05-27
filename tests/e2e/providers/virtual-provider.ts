import { expect, type Page } from "@playwright/test";
import type { CardProvider, TapResult, CardInfo } from "./provider.js";

export class VirtualProvider implements CardProvider {
  name = "virtual";

  async setup(page: Page): Promise<void> {
    await page.goto("/debug", { waitUntil: "domcontentloaded" });
    await page.locator('button[data-tab="virtual"]').click();
    await page.locator("#panel-virtual").waitFor({ state: "visible" });
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });
  }

  async tap(page: Page): Promise<TapResult> {
    return page.evaluate(() => {
      const result = (window as any)._vcTap();
      return result;
    });
  }

  async getCardInfo(page: Page): Promise<CardInfo> {
    return page.evaluate(() => (window as any)._vcGetKeys());
  }
}
