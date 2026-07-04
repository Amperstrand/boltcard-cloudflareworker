import { test, expect } from "@playwright/test";

/**
 * Verifies boltcard test evidence is published to tests.tollgate.me
 * via the Nostr kind 30078 → Blossom CDN → unified dashboard pipeline.
 *
 * Pipeline: Playwright JSON → render-test-dashboard.mjs → Blossom upload →
 *           Nostr kind 30078 event (tag ["t","boltcard"]) → dashboard SPA
 */

const DASHBOARD_URL = "https://tests.tollgate.me";
const RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

test.describe("Evidence publishing pipeline → tests.tollgate.me", () => {
  test("boltcard kind 30078 event is queryable from Nostr relays", async ({ page }) => {
    const events = await page.evaluate(async (relayUrls) => {
      const results: Array<Record<string, unknown>> = [];
      await Promise.all(relayUrls.map((relayUrl: string) => new Promise<void>((resolve) => {
        let ws: WebSocket;
        try { ws = new WebSocket(relayUrl); } catch { resolve(); return; }
        const subId = "bc-verify-" + Math.random().toString(36).slice(2, 8);
        const timeout = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(); }, 10000);
        ws.onopen = () => { ws.send(JSON.stringify(["REQ", subId, { kinds: [30078], "#t": ["boltcard"], limit: 5 }])); };
        ws.onmessage = (msg) => {
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

  test("boltcard event has correct structure (d-tag, t-tag, Blossom file URLs)", async ({ page }) => {
    const events = await page.evaluate(async (relayUrls) => {
      const results: Array<Record<string, unknown>> = [];
      await Promise.all(relayUrls.map((relayUrl: string) => new Promise<void>((resolve) => {
        let ws: WebSocket;
        try { ws = new WebSocket(relayUrl); } catch { resolve(); return; }
        const subId = "bc-struct-" + Math.random().toString(36).slice(2, 8);
        const timeout = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(); }, 10000);
        ws.onopen = () => { ws.send(JSON.stringify(["REQ", subId, { kinds: [30078], "#t": ["boltcard"], limit: 1 }])); };
        ws.onmessage = (msg) => {
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
    const evt = events[0] as { tags?: Array<Array<string>> };
    const tags = evt.tags || [];

    const dTag = tags.find((t) => t[0] === "d")?.[1];
    expect(dTag).toContain("boltcard");

    const tTags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
    expect(tTags).toContain("boltcard");

    const fileTags = tags.filter((t) => t[0] === "file").map((t) => t[1]);
    expect(fileTags.length).toBeGreaterThan(0);
    expect(fileTags.some((url) => url.includes("blossom.psbt.me"))).toBe(true);
  });

  test("boltcard run is visible in 'All Nostr' tab with search", async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(20000); // relay fetch timeout

    await page.locator('button:has-text("All Nostr")').click();
    await page.waitForTimeout(2000);

    await page.locator("#search-input").fill("boltcard");
    await page.waitForTimeout(3000); // debounce (200ms) + render (500ms) + margin

    const runCards = page.locator(".run-card");
    const count = await runCards.count();
    expect(count).toBeGreaterThan(0);

    // At least one card in the first 10 must mention boltcard
    let foundBoltcard = false;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = (await runCards.nth(i).textContent()) || "";
      if (text.toLowerCase().includes("boltcard")) { foundBoltcard = true; break; }
    }
    expect(foundBoltcard).toBe(true);
  });

  test("boltcard run detail shows screenshot evidence from Blossom", async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(20000);

    await page.locator('button:has-text("All Nostr")').click();
    await page.waitForTimeout(2000);
    await page.locator("#search-input").fill("boltcard");
    await page.waitForTimeout(3000);

    // Find and click the first boltcard run card
    const runCards = page.locator(".run-card");
    const count = await runCards.count();
    let clicked = false;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = (await runCards.nth(i).textContent()) || "";
      if (text.toLowerCase().includes("boltcard")) {
        await runCards.nth(i).click();
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);

    await page.waitForTimeout(3000); // detail panel load

    // Screenshots may be lazy-loaded (data-src), in <video>, or <a> links.
    // Check for any reference to blossom.psbt.me in the detail panel.
    const blossomRefs = await page.evaluate(() => {
      const detail = document.getElementById("run-detail") || document.querySelector(".run-detail, .detail, main");
      if (!detail) return { found: false, reason: "no detail panel" };
      const html = detail.innerHTML;
      const hasBlossom = html.includes("blossom.psbt.me");
      // Count img, a, source, video elements with blossom URLs
      const imgs = detail.querySelectorAll('img[src*="blossom"], img[data-src*="blossom"]');
      const links = detail.querySelectorAll('a[href*="blossom"]');
      return {
        found: hasBlossom,
        imgCount: imgs.length,
        linkCount: links.length,
        htmlPreview: html.substring(0, 200),
      };
    });

    // At least some reference to Blossom must exist in the detail view
    expect(blossomRefs.found || blossomRefs.imgCount > 0 || blossomRefs.linkCount > 0).toBe(true);
  });
});
