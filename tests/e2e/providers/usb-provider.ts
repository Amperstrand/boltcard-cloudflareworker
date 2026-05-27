import type { Page } from "@playwright/test";
import type { CardProvider, TapResult, CardInfo } from "./provider.js";

const BRIDGE_URL = process.env.PCSCD_BRIDGE_URL || "http://localhost:4321";

export class UsbProvider implements CardProvider {
  name = "usb";

  async setup(_page: Page): Promise<void> {
    const resp = await fetch(`${BRIDGE_URL}/status`);
    if (!resp.ok) {
      throw new Error(`pcscd bridge not available at ${BRIDGE_URL}/status`);
    }
  }

  async tap(_page: Page): Promise<TapResult> {
    const resp = await fetch(`${BRIDGE_URL}/tap`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      throw new Error(`pcscd bridge /tap returned ${resp.status}`);
    }
    const data: { p: string; c: string } = await resp.json();
    return { p: data.p, c: data.c };
  }

  async getCardInfo(_page: Page): Promise<CardInfo> {
    const resp = await fetch(`${BRIDGE_URL}/card-info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      throw new Error(`pcscd bridge /card-info returned ${resp.status}`);
    }
    return resp.json();
  }
}
