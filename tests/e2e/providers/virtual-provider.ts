import { expect, type Page } from "@playwright/test";
import type {
  CardProvider,
  TapResult,
  CardInfo,
  BurnParams,
  InspectResult,
} from "./provider.js";

export class VirtualProvider implements CardProvider {
  name = "virtual";

  private cachedCardInfo: CardInfo | null = null;

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

  async getCardInfo(page?: Page): Promise<CardInfo> {
    if (!page) {
      if (!this.cachedCardInfo) {
        throw new Error("Card info not loaded. Call setup() first or provide page parameter.");
      }
      return this.cachedCardInfo;
    }
    const info = await page.evaluate(() => (window as any)._vcGetKeys());
    this.cachedCardInfo = info;
    return info;
  }

  async burn(_params: BurnParams): Promise<{ uid: string }> {
    if (!this.cachedCardInfo) {
      throw new Error("Card info not loaded. Call getCardInfo first.");
    }
    return { uid: this.cachedCardInfo.uid };
  }

  async wipe(_keys: [string, string, string, string, string]): Promise<{ uid: string }> {
    if (!this.cachedCardInfo) {
      throw new Error("Card info not loaded. Call getCardInfo first.");
    }
    return { uid: this.cachedCardInfo.uid };
  }

  async inspect(): Promise<InspectResult> {
    if (!this.cachedCardInfo) {
      throw new Error("Card info not loaded. Call getCardInfo first.");
    }
    let keyVersions = this.cachedCardInfo.k1 ? 1 : 0;
    if (this.cachedCardInfo.k2) keyVersions += 1;
    return {
      uid: this.cachedCardInfo.uid,
      ndefUrl: null,
      keyVersions: [keyVersions],
      hasSdm: false,
    };
  }

  async getUid(): Promise<string> {
    if (!this.cachedCardInfo) {
      throw new Error("Card info not loaded. Call getCardInfo first.");
    }
    return this.cachedCardInfo.uid;
  }
}
