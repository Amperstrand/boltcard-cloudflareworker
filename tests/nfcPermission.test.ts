import { describe, test, expect, vi } from "vitest";
import { NFC_JS } from "../static/js/exports.js";

function loadNfcJs(mockWindow: Record<string, unknown>): Record<string, (...args: unknown[]) => unknown> {
  const TOP_LEVEL_FNS = ["browserSupportsNfc", "getNfcPermissionState", "canAutoStartNfc", "normalizeNfcSerial", "extractNdefUrl", "normalizeBrowserNfcUrl", "createNfcScanner", "stateLabel", "stateColor", "provenanceLabel", "provenanceColor"];
  (mockWindow as any).TextDecoder = TextDecoder;
  (mockWindow as any).Uint8Array = Uint8Array;
  (mockWindow as any).AbortController = AbortController;
  const code = `"use strict";(function(window,navigator){${NFC_JS};return {${TOP_LEVEL_FNS.join(",")}};})`;
  const factory = eval(code);
  return factory(mockWindow, mockWindow.navigator);
}

function makeMockBrowser(opts: { hasNdef?: boolean; permState?: string; permThrows?: boolean } = {}): Record<string, unknown> {
  const { hasNdef = true, permState = "prompt", permThrows = false } = opts;
  const navigator: Record<string, unknown> = {};
  if (permThrows) {
    navigator.permissions = { query: vi.fn().mockRejectedValue(new TypeError("not supported")) };
  } else {
    navigator.permissions = { query: vi.fn().mockResolvedValue({ state: permState, onchange: null }) };
  }
  const win: Record<string, unknown> = { navigator };
  if (hasNdef) {
    win.NDEFReader = function MockNDEFReader(this: any) {
      this.scan = () => Promise.resolve();
      this.onreading = null;
      this.onreadingerror = null;
    };
  }
  return win;
}

describe("getNfcPermissionState", () => {
  test("returns 'unsupported' when NDEFReader is not in window", async () => {
    const win = makeMockBrowser({ hasNdef: false });
    const api = loadNfcJs(win);
    const state = await (api.getNfcPermissionState as (...args: unknown[]) => Promise<string>)();
    expect(state).toBe("unsupported");
  });

  test("returns 'granted' when permission state is granted", async () => {
    const win = makeMockBrowser({ hasNdef: true, permState: "granted" });
    const api = loadNfcJs(win);
    const state = await (api.getNfcPermissionState as (...args: unknown[]) => Promise<string>)();
    expect(state).toBe("granted");
  });

  test("returns 'prompt' when permission state is prompt", async () => {
    const win = makeMockBrowser({ hasNdef: true, permState: "prompt" });
    const api = loadNfcJs(win);
    const state = await (api.getNfcPermissionState as (...args: unknown[]) => Promise<string>)();
    expect(state).toBe("prompt");
  });

  test("returns 'denied' when permission state is denied", async () => {
    const win = makeMockBrowser({ hasNdef: true, permState: "denied" });
    const api = loadNfcJs(win);
    const state = await (api.getNfcPermissionState as (...args: unknown[]) => Promise<string>)();
    expect(state).toBe("denied");
  });

  test("returns 'prompt' fallback when permissions.query throws", async () => {
    const win = makeMockBrowser({ hasNdef: true, permThrows: true });
    const api = loadNfcJs(win);
    const state = await (api.getNfcPermissionState as (...args: unknown[]) => Promise<string>)();
    expect(state).toBe("prompt");
  });
});

describe("canAutoStartNfc (backward compat)", () => {
  test("returns true only when permission is granted", async () => {
    const win = makeMockBrowser({ hasNdef: true, permState: "granted" });
    const api = loadNfcJs(win);
    const result = await (api.canAutoStartNfc as (...args: unknown[]) => Promise<boolean>)();
    expect(result).toBe(true);
  });

  test("returns false when permission is prompt", async () => {
    const win = makeMockBrowser({ hasNdef: true, permState: "prompt" });
    const api = loadNfcJs(win);
    const result = await (api.canAutoStartNfc as (...args: unknown[]) => Promise<boolean>)();
    expect(result).toBe(false);
  });

  test("returns false when NDEFReader unsupported", async () => {
    const win = makeMockBrowser({ hasNdef: false });
    const api = loadNfcJs(win);
    const result = await (api.canAutoStartNfc as (...args: unknown[]) => Promise<boolean>)();
    expect(result).toBe(false);
  });
});

describe("browserSupportsNfc", () => {
  test("returns true when NDEFReader is in window", () => {
    const win = makeMockBrowser({ hasNdef: true });
    const api = loadNfcJs(win);
    expect((api.browserSupportsNfc as () => boolean)()).toBe(true);
  });

  test("returns false when NDEFReader is not in window", () => {
    const win = makeMockBrowser({ hasNdef: false });
    const api = loadNfcJs(win);
    expect((api.browserSupportsNfc as () => boolean)()).toBe(false);
  });
});
