import type { Page } from "@playwright/test";
import type {
  CardProvider,
  TapResult,
  CardInfo,
  BurnParams,
  InspectResult,
} from "./provider.js";

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

  async getCardInfo(_page?: Page): Promise<CardInfo> {
    const resp = await fetch(`${BRIDGE_URL}/card-info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      throw new Error(`pcscd bridge /card-info returned ${resp.status}`);
    }
    return resp.json();
  }

  async burn(params: BurnParams): Promise<{ uid: string }> {
    const resp = await fetch(`${BRIDGE_URL}/burn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      throw new Error(`pcscd bridge /burn returned ${resp.status}`);
    }
    return resp.json();
  }

  async wipe(keys: [string, string, string, string, string]): Promise<{ uid: string }> {
    const resp = await fetch(`${BRIDGE_URL}/wipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      throw new Error(`pcscd bridge /wipe returned ${resp.status}`);
    }
    return resp.json();
  }

  async inspect(): Promise<InspectResult> {
    const resp = await fetch(`${BRIDGE_URL}/inspect`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      throw new Error(`pcscd bridge /inspect returned ${resp.status}`);
    }
    return resp.json();
  }

  async getUid(): Promise<string> {
    const result = await this.inspect();
    return result.uid;
  }
}
