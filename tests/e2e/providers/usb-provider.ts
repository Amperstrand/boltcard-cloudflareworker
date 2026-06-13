import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { deriveKeysFromHex } from "@ntag424/crypto";
import type {
  CardProvider,
  TapResult,
  CardInfo,
  BurnParams,
  InspectResult,
} from "./provider.js";

const BRIDGE_URL = process.env.PCSCD_BRIDGE_URL || "http://localhost:4321";
const ISSUER_KEY = process.env.TEST_ISSUER_KEY || "00000000000000000000000000000001";
const SERVER_URL = process.env.PLAYWRIGHT_BASE_URL || "https://boltcardpoc.psbt.me";
const BOLTY_CLI = process.env.BOLTY_CLI || "/Users/macbook/src/bolty-rs/target/debug/bolty-cli";

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

  private async resolveUid(): Promise<string> {
    const tap = await this.tap(undefined as unknown as Page);
    const resp = await fetch(
      `${SERVER_URL}/card/info?p=${encodeURIComponent(tap.p)}&c=${encodeURIComponent(tap.c)}`,
    );
    if (!resp.ok) {
      throw new Error(`server /card/info returned ${resp.status}`);
    }
    const data: Record<string, unknown> = await resp.json();
    if (!data.uid) {
      throw new Error(`server /card/info did not return uid: ${JSON.stringify(data)}`);
    }
    return data.uid as string;
  }

  async getCardInfo(_page?: Page): Promise<CardInfo> {
    const uid = await this.resolveUid();
    const keys = deriveKeysFromHex(uid, ISSUER_KEY, 1);
    return {
      uid,
      k1: keys.k1,
      k2: keys.k2,
      version: 1,
    };
  }

  async getAllKeys(version: number = 1) {
    const uid = await this.resolveUid();
    return deriveKeysFromHex(uid, ISSUER_KEY, version);
  }

  async burn(params: BurnParams): Promise<{ uid: string }> {
    const url = `${SERVER_URL}/?p={picc:uid+ctr}&c=[[{mac}`;
    const out = execFileSync(
      BOLTY_CLI,
      ["burn", "--issuer-key", ISSUER_KEY, "--url", url, "--version", String(params.keyVersion)],
      { timeout: 30000, encoding: "utf-8" },
    );
    if (!out.includes("successfully")) {
      throw new Error(`bolty-cli burn failed: ${out}`);
    }
    const m = out.match(/Card UID:\s*([0-9a-fA-F]+)/);
    if (!m) throw new Error(`could not parse UID from bolty-cli output: ${out}`);
    return { uid: m[1] };
  }

  async wipe(keys: [string, string, string, string, string]): Promise<{ uid: string }> {
    const resp = await fetch(`${BRIDGE_URL}/wipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`pcscd bridge /wipe returned ${resp.status}: ${errBody}`);
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
    return this.resolveUid();
  }

  async ensureReady(): Promise<void> {
    try {
      const tap = await this.tap(undefined as unknown as Page);
      const resp = await fetch(
        `${SERVER_URL}/?p=${encodeURIComponent(tap.p)}&c=${encodeURIComponent(tap.c)}`,
      );
      if (resp.ok) {
        const data: Record<string, unknown> = await resp.json();
        if (data.tag === "withdrawRequest") return;
      }
    } catch {
    }

    const url = `${SERVER_URL}/?p={picc:uid+ctr}&c=[[{mac}`;
    for (const v of [1, 2, 3, 4, 0]) {
      try {
        execFileSync(
          BOLTY_CLI,
          ["wipe", "--issuer-key", ISSUER_KEY, "--version", String(v)],
          { timeout: 30000, encoding: "utf-8" },
        );
        break;
      } catch {
      }
    }
    execFileSync(
      BOLTY_CLI,
      ["burn", "--issuer-key", ISSUER_KEY, "--url", url, "--version", "1"],
      { timeout: 30000, encoding: "utf-8" },
    );
  }
}
