import { expect, type Page } from "@playwright/test";
import type {
  CardProvider,
  TapResult,
  CardInfo,
  BurnParams,
  InspectResult,
} from "./provider.js";

const AES_JS_URL = "https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js";

export class SimProvider implements CardProvider {
  name = "sim";

  private cachedCardInfo: CardInfo | null = null;

  async setup(page: Page): Promise<void> {
    await page.goto("/virtual", { waitUntil: "domcontentloaded" });
    await page.locator("#vc-create-btn").click();
    await expect(page.locator("#vc-uid")).not.toHaveText("--", { timeout: 10000 });

    this.cachedCardInfo = await page.evaluate((): CardInfo => {
      const raw = localStorage.getItem("virtual_boltcard");
      const card = raw ? JSON.parse(raw) : null;
      return { uid: card.uid, k1: card.k1, k2: card.k2, version: 1 };
    });
  }

  async tap(page: Page): Promise<TapResult> {
    return page.evaluate(async (aesJsUrl: string): Promise<TapResult> => {
      if (!(window as any).aesjs) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = aesJsUrl;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load aes-js"));
          document.head.appendChild(s);
        });
      }

      function hexToBytes(hex: string): Uint8Array {
        const b = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        return b;
      }
      function bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      const aesjs = (window as any).aesjs;
      function aesEcbEncrypt(key: Uint8Array, pt: Uint8Array): Uint8Array {
        return new Uint8Array(new aesjs.ModeOfOperation.ecb(key).encrypt(pt));
      }
      function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
        const r = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) r[i] = a[i] ^ b[i]; return r;
      }
      function shl(src: Uint8Array): { shifted: Uint8Array; carry: number } {
        const s = new Uint8Array(src.length); let c = 0;
        for (let i = src.length - 1; i >= 0; i--) { const m = src[i] >> 7; s[i] = ((src[i] << 1) & 0xff) | c; c = m; }
        return { shifted: s, carry: c };
      }
      function subkey(input: Uint8Array): Uint8Array {
        const r = shl(input); const sk = new Uint8Array(r.shifted); if (r.carry) sk[sk.length - 1] ^= 0x87; return sk;
      }
      function cmac(msg: Uint8Array, key: Uint8Array): Uint8Array {
        const L = aesEcbEncrypt(key, new Uint8Array(16));
        const K1 = subkey(L);
        let M: Uint8Array;
        if (msg.length === 16) M = xor(msg, K1);
        else { const p = new Uint8Array(16); p.set(msg); p[msg.length] = 0x80; M = xor(p, subkey(K1)); }
        return aesEcbEncrypt(key, M);
      }

      const card = JSON.parse(localStorage.getItem("virtual_boltcard")!);
      const k1 = hexToBytes(card.k1);
      const uid = hexToBytes(card.uid);
      const ctr = card.counter;
      const pt = new Uint8Array(16);
      pt[0] = 0xc7; pt.set(uid, 1);
      pt[8] = ctr & 0xff; pt[9] = (ctr >> 8) & 0xff; pt[10] = (ctr >> 16) & 0xff;
      const pHex = bytesToHex(aesEcbEncrypt(k1, pt));

      const ctrB = new Uint8Array([(ctr >> 16) & 0xff, (ctr >> 8) & 0xff, ctr & 0xff]);
      const sv2 = new Uint8Array(16);
      sv2[0] = 0x3c; sv2[1] = 0xc3; sv2[2] = 0x00; sv2[3] = 0x01; sv2[4] = 0x00; sv2[5] = 0x80;
      sv2.set(uid, 6); sv2[13] = ctrB[2]; sv2[14] = ctrB[1]; sv2[15] = ctrB[0];
      const ks = cmac(sv2, hexToBytes(card.k2));
      const Lp = aesEcbEncrypt(ks, new Uint8Array(16));
      const K1p = subkey(Lp);
      const hk1 = subkey(K1p);
      const h = new Uint8Array(hk1); h[0] ^= 0x80;
      const cm = aesEcbEncrypt(ks, h);
      const cHex = bytesToHex(new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]));

      card.counter++;
      localStorage.setItem("virtual_boltcard", JSON.stringify(card));
      return { p: pHex, c: cHex };
    }, AES_JS_URL);
  }

  async getCardInfo(page?: Page): Promise<CardInfo> {
    if (!page) {
      if (!this.cachedCardInfo) throw new Error("Card info not loaded. Call setup() first.");
      return this.cachedCardInfo;
    }
    const info = await page.evaluate((): CardInfo => {
      const raw = localStorage.getItem("virtual_boltcard");
      const card = raw ? JSON.parse(raw) : null;
      return { uid: card.uid, k1: card.k1, k2: card.k2, version: 1 };
    });
    this.cachedCardInfo = info;
    return info;
  }

  async burn(_params: BurnParams): Promise<{ uid: string }> {
    if (!this.cachedCardInfo) throw new Error("Card info not loaded.");
    return { uid: this.cachedCardInfo.uid };
  }

  async wipe(_keys: [string, string, string, string, string]): Promise<{ uid: string }> {
    if (!this.cachedCardInfo) throw new Error("Card info not loaded.");
    return { uid: this.cachedCardInfo.uid };
  }

  async inspect(): Promise<InspectResult> {
    if (!this.cachedCardInfo) throw new Error("Card info not loaded.");
    return { uid: this.cachedCardInfo.uid, ndefUrl: null, keyVersions: [1], hasSdm: false };
  }

  async getUid(): Promise<string> {
    if (!this.cachedCardInfo) throw new Error("Card info not loaded.");
    return this.cachedCardInfo.uid;
  }
}
