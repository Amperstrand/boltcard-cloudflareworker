import { test, expect } from "@playwright/test";

const DASHBOARD_URL = "https://tests.tollgate.me";
const RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

test.describe("Evidence publishing pipeline → relay verification", () => {
  test("boltcard kind 30078 event is queryable from Nostr relays", async ({ page }) => {
    const events = await page.evaluate(async (relayUrls) => {
      const results: Array<Record<string, unknown>> = [];
      await Promise.all(relayUrls.map((relayUrl: string) => new Promise<void>((resolve) => {
        let ws: any;
        try { ws = new WebSocket(relayUrl); } catch { resolve(); return; }
        const subId = "bc-verify-" + Math.random().toString(36).slice(2, 8);
        const timeout = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(); }, 10000);
        ws.onopen = () => { ws.send(JSON.stringify(["REQ", subId, { kinds: [30078], "#t": ["boltcard"], limit: 5 }])); };
        ws.onmessage = (msg: MessageEvent) => {
          try {
            const data = JSON.parse(msg.data);
            if (data[0] === "EVENT" && data[1] === subId && data[2]) { results.push(data[2]); }
            else if (data[0] === "EOSE" && data[1] === subId) { clearTimeout(timeout); try { ws.close(); } catch { /* */ } resolve(); }
          } catch { /* */ }
        };
        ws.onerror = () => { clearTimeout(timeout); resolve(); };
        ws.onclose = () => { clearTimeout(timeout); resolve(); };
      })));
      return results.map((e) => ({
        kind: e.kind,
        d: (e.tags as Array<Array<string>>)?.find((t) => t[0] === "d")?.[1],
        tTags: (e.tags as Array<Array<string>>)?.filter((t) => t[0] === "t").map((t) => t[1]),
      }));
    }, RELAYS);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe(30078);
    expect(events[0]?.d).toContain("boltcard");
    expect(events[0]?.tTags).toContain("boltcard");
  });

  test("boltcard event has correct structure with pass/fail counts and Blossom URLs", async ({ page }) => {
    const events = await page.evaluate(async (relayUrls) => {
      const results: Array<Record<string, unknown>> = [];
      await Promise.all(relayUrls.map((relayUrl: string) => new Promise<void>((resolve) => {
        let ws: any;
        try { ws = new WebSocket(relayUrl); } catch { resolve(); return; }
        const subId = "bc-struct-" + Math.random().toString(36).slice(2, 8);
        const timeout = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(); }, 10000);
        ws.onopen = () => { ws.send(JSON.stringify(["REQ", subId, { kinds: [30078], "#t": ["boltcard"], limit: 5 }])); };
        ws.onmessage = (msg: MessageEvent) => {
          try {
            const data = JSON.parse(msg.data);
            if (data[0] === "EVENT" && data[1] === subId && data[2]) { results.push(data[2]); }
            else if (data[0] === "EOSE" && data[1] === subId) { clearTimeout(timeout); try { ws.close(); } catch { /* */ } resolve(); }
          } catch { /* */ }
        };
        ws.onerror = () => { clearTimeout(timeout); resolve(); };
        ws.onclose = () => { clearTimeout(timeout); resolve(); };
      })));
      return results;
    }, RELAYS);

    expect(events.length).toBeGreaterThan(0);

    const latest = events[0] as { tags?: Array<Array<string>>; content?: string };
    const tags = latest.tags || [];

    const dTag = tags.find((t) => t[0] === "d")?.[1];
    expect(dTag).toContain("boltcard");

    const tTags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
    expect(tTags).toContain("boltcard");

    const fileTags = tags.filter((t) => t[0] === "file").map((t) => t[1]);
    expect(fileTags.length).toBeGreaterThan(0);
    expect(fileTags.some((url) => url?.includes("blossom.psbt.me"))).toBe(true);

    const content = JSON.parse(latest.content || "{}");
    expect(content.passed).toBeGreaterThan(0);
    expect(content.failed).toBeGreaterThanOrEqual(0);
    expect(content.total).toBe(content.passed + (content.failed || 0) + (content.skipped || 0));
  });
});

test.describe("Evidence publishing pipeline → dashboard UI", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(DASHBOARD_URL);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
    await page.reload();
    await page.locator(".project-tab").first().waitFor({ timeout: 15000 });
    await page.locator(".runs-count").first().waitFor({ timeout: 30000 });
  });

  test("boltcard run is visible in Boltcard tab", async ({ page }) => {
    await page.locator('button[data-project="boltcard"]').click();
    await page.waitForSelector(".run-card", { timeout: 20000 });
    expect(await page.locator(".run-card").count()).toBeGreaterThan(0);
  });

  test("boltcard run detail shows Blossom screenshot evidence", async ({ page }) => {
    await page.locator('button[data-project="boltcard"]').click();
    await page.waitForSelector(".run-card", { timeout: 10000 });
    await page.locator(".run-card").first().click();
    await page.waitForFunction(
      () => document.body.innerHTML.includes("blossom.psbt.me"),
      { timeout: 15000 }
    );
    expect(true).toBe(true);
  });
});
