import { test, expect, type Page } from "@playwright/test";
import { createProvider, type BurnParams } from "./providers/index.js";
import { operatorLogin, makeApiHelpers, type ApiResult } from "./helpers.js";

const provider = createProvider();

interface FullKeys {
  k0: string; k1: string; k2: string; k3: string; k4: string; cardKey: string;
}

interface ExtendedCardProvider {
  name: string;
  setup(page: Page): Promise<void>;
  tap(page: Page): Promise<{ p: string; c: string }>;
  getCardInfo(page?: Page): Promise<{ uid: string; k1: string; k2: string; version: number }>;
  burn(params: BurnParams): Promise<{ uid: string }>;
  wipe(keys: [string, string, string, string, string]): Promise<{ uid: string }>;
  getAllKeys(version?: number): Promise<FullKeys>;
}

const extProvider = provider as unknown as ExtendedCardProvider;
const isUsb = provider.name === "usb";
const FACTORY_KEY = "00000000000000000000000000000000";
const CARD_URL = process.env.PLAYWRIGHT_BASE_URL || "https://boltcardpoc.psbt.me";

function burnParams(keys: FullKeys, version: number, currentKey: string): BurnParams {
  return {
    urlTemplate: CARD_URL + "/?p=********************************&c=****************",
    keys: [keys.k0, keys.k1, keys.k2, keys.k3, keys.k4],
    keyVersion: version,
    currentKey,
  };
}

async function sendTap(page: Page, tap: { p: string; c: string }): Promise<ApiResult> {
  return page.evaluate(
    async (url: string) => {
      const r = await fetch(url);
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    "/?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
  );
}

async function getCardInfo(page: Page, tap: { p: string; c: string }): Promise<ApiResult> {
  return page.evaluate(
    async (url: string) => {
      const r = await fetch(url);
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    "/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c),
  );
}

async function tryTap(): Promise<boolean> {
  try {
    const tap = await provider.tap(undefined as unknown as Page);
    const resp = await fetch(
      `${CARD_URL}/?p=${encodeURIComponent(tap.p)}&c=${encodeURIComponent(tap.c)}`,
    );
    const data: Record<string, unknown> = await resp.json();
    return resp.ok && data.tag === "withdrawRequest";
  } catch {
    return false;
  }
}

async function restoreCard() {
  if (!isUsb) return;
  try {
    const keys = await extProvider.getAllKeys(1);
    await extProvider.wipe([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]);
    await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
  } catch {
  }
}

test.describe(`Hardware Card Lifecycle (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
  });

  test("tap returns valid LNURL-withdraw response", async ({ page }) => {
    const tap = await provider.tap(page);
    const res = await sendTap(page, tap);
    expect(res.ok).toBeTruthy();
    expect(res.data.tag).toBe("withdrawRequest");
    expect(res.data.callback).toBeDefined();
    expect(res.data.k1).toBeDefined();
  });

  test("card info shows discovered or active state", async ({ page }) => {
    const tap = await provider.tap(page);
    await sendTap(page, tap);
    const info = await getCardInfo(page, tap);
    expect(info.ok).toBeTruthy();
    expect(info.data.uid).toBeDefined();
    expect(["discovered", "active"]).toContain(info.data.state);
  });

  test("top-up then charge respects balance delta", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.discoverCard();
    const before = await api.balanceCheck();
    const startBalance = before.data.balance;

    await api.topUp(5000);
    const afterTopup = await api.balanceCheck();
    expect(afterTopup.data.balance).toBe(startBalance + 5000);

    await api.charge(2000);
    const afterCharge = await api.balanceCheck();
    expect(afterCharge.data.balance).toBe(startBalance + 3000);
  });

  test("multiple sequential taps each return valid withdraw response", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.discoverCard();
    await api.topUp(50000);

    for (let i = 0; i < 3; i++) {
      const tapResult = await api.tap();
      const res = await sendTap(page, tapResult);
      expect(res.ok, `Tap ${i + 1} failed`).toBeTruthy();
      expect(res.data.tag).toBe("withdrawRequest");
    }
  });
});

test.describe(`Hardware Physical Write/Wipe (${provider.name} provider)`, () => {
  let canPhysicallyWipe = false;

  test.beforeAll(async () => {
    if (!extProvider.burn || !extProvider.wipe) return;
    if (!isUsb) { canPhysicallyWipe = true; return; }
    try {
      const keys = await extProvider.getAllKeys(1);
      await extProvider.wipe([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]);
      await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
      canPhysicallyWipe = true;
    } catch {
      canPhysicallyWipe = false;
    }
  });

  test.afterAll(async () => {
    if (canPhysicallyWipe) await restoreCard();
  });

  test.beforeEach(async ({ page }) => {
    if (!extProvider.burn || !extProvider.wipe) test.skip();
    if (!canPhysicallyWipe) test.skip(true, "Card K0 unknown — cannot physically wipe");
    await operatorLogin(page);
    await provider.setup(page);
  });

  test("full burn cycle: wipe → burn → verify tap → wipe → verify broken → re-burn", async ({ page }) => {
    const keys = await extProvider.getAllKeys(1);

    await extProvider.wipe([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]);
    expect(await tryTap()).toBe(false);

    await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
    expect(await tryTap()).toBe(true);

    const tap = await provider.tap(page);
    const res = await sendTap(page, tap);
    expect(res.ok).toBeTruthy();
    expect(res.data.tag).toBe("withdrawRequest");

    await extProvider.wipe([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]);
    expect(await tryTap()).toBe(false);

    await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
    expect(await tryTap()).toBe(true);
  });

  test("key version advancement: v1 → wipe → v2", async ({ page }) => {
    const keysV1 = await extProvider.getAllKeys(1);

    await extProvider.wipe([keysV1.k0, keysV1.k1, keysV1.k2, keysV1.k3, keysV1.k4]);
    await extProvider.burn(burnParams(keysV1, 1, FACTORY_KEY));
    expect(await tryTap()).toBe(true);

    const keysV2 = await extProvider.getAllKeys(2);
    await extProvider.wipe([keysV1.k0, keysV1.k1, keysV1.k2, keysV1.k3, keysV1.k4]);
    await extProvider.burn(burnParams(keysV2, 2, keysV1.k0));
    expect(await tryTap()).toBe(true);

    const tap = await provider.tap(page);
    const res = await sendTap(page, tap);
    expect(res.ok).toBeTruthy();
    expect(res.data.tag).toBe("withdrawRequest");

    await extProvider.wipe([keysV2.k0, keysV2.k1, keysV2.k2, keysV2.k3, keysV2.k4]);
    await extProvider.burn(burnParams(keysV1, 1, FACTORY_KEY));
  });

  test("card survives 3 consecutive write/wipe cycles", async ({ page }) => {
    const keys = await extProvider.getAllKeys(1);

    for (let i = 0; i < 3; i++) {
      await extProvider.wipe([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]);
      expect(await tryTap(), `Cycle ${i + 1}: tap should fail after wipe`).toBe(false);

      await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
      expect(await tryTap(), `Cycle ${i + 1}: tap should succeed after burn`).toBe(true);
    }
  });

  test("tap after wipe returns no valid withdraw response", async ({ page }) => {
    const keys = await extProvider.getAllKeys(1);

    await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
    expect(await tryTap()).toBe(true);

    await extProvider.wipe([keys.k0, keys.k1, keys.k2, keys.k3, keys.k4]);

    if (isUsb) {
      const works = await tryTap();
      expect(works).toBe(false);
    }

    await extProvider.burn(burnParams(keys, 1, FACTORY_KEY));
  });
});
