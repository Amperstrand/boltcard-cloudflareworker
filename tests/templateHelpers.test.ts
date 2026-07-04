import { _buildErrorPayload, errorResponse } from "../utils/responses.js";
import { renderTailwindPage } from "../templates/pageShell.js";
import { NFC_JS, VIRTUAL_CARD_SIM_JS } from "../static/js/exports.js";
import { renderBulkWipePage } from "../templates/bulkWipePage.js";
import { renderActivatePage, renderActivateCardPage } from "../templates/activatePage.js";
import { renderAnalyticsPage } from "../templates/analyticsPage.js";
import { renderWipePage } from "../templates/wipePage.js";
import { rawHtml, safe, jsString, escapeHtml } from "../utils/rawTemplate.js";
import { renderOperatorLoginPage } from "../templates/operatorLoginPage.js";
import { renderCardDashboardPage } from "../templates/cardDashboardPage.js";
import { renderLoginPage } from "../templates/loginPage.js";

describe("response helpers", () => {
  test("_buildErrorPayload preserves backward-compatible fields", () => {
    expect(_buildErrorPayload("boom", { uid: "abc" })).toEqual({
      status: "ERROR",
      reason: "boom",
      error: "boom",
      success: false,
      uid: "abc",
    });
  });

  test("errorResponse returns JSON response with standard payload", async () => {
    const response = errorResponse("bad request", 400, { uid: "abc" });
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      status: "ERROR",
      reason: "bad request",
      error: "bad request",
      success: false,
      uid: "abc",
    });
  });
});

describe("template helpers", () => {
  test("renderTailwindPage builds common shell", () => {
    const html = renderTailwindPage({
      title: "Example Page",
      bodyClass: "min-h-screen",
      styles: "body { color: red; }",
      metaRobots: "noindex,nofollow",
      content: "<main>Hello</main>",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Example Page</title>");
    expect(html).toContain('class="min-h-screen"');
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain('meta name="robots" content="noindex,nofollow"');
    expect(html).toContain("<main>Hello</main>");
  });

  test("renderTailwindPage loads virtual-card-sim.js before nfc.js", () => {
    const html = renderTailwindPage({ title: "Test", content: "<p>test</p>" });
    const simIdx = html.indexOf("virtual-card-sim.js");
    const nfcIdx = html.indexOf("nfc.js");
    expect(simIdx).toBeGreaterThan(-1);
    expect(nfcIdx).toBeGreaterThan(-1);
    expect(simIdx).toBeLessThan(nfcIdx);
  });

  test("static NFC JS exports shared primitives", () => {
    expect(NFC_JS).toContain("function browserSupportsNfc()");
    expect(NFC_JS).toContain("function normalizeNfcSerial(serialNumber)");
    expect(NFC_JS).toContain("async function extractNdefUrl(records, prefixes)");
    expect(NFC_JS).toContain("function normalizeBrowserNfcUrl(rawUrl)");
  });

  test("NFC JS exports permission-aware helpers", () => {
    expect(NFC_JS).toContain("function getNfcPermissionState()");
    expect(NFC_JS).toContain("function canAutoStartNfc()");
  });

  test("static NFC JS exports virtual card simulation helpers", () => {
    expect(VIRTUAL_CARD_SIM_JS).toContain("_virtualSim");
    expect(VIRTUAL_CARD_SIM_JS).toContain("virtual_boltcard");
  });
});

describe("NFC permission-aware UI elements", () => {
  test("card dashboard includes Start NFC button for permission prompt flow", () => {
    const html = renderCardDashboardPage();
    expect(html).toContain('id="nfc-start-btn"');
    expect(html).toContain("Start NFC");
    expect(html).toMatch(/id="nfc-start-btn"[^>]*class="[^"]*hidden/);
  });

  test("login page includes Start NFC button for permission prompt flow", () => {
    const html = renderLoginPage({ host: "https://test.local", defaultProgrammingEndpoint: "https://test.local/api" });
    expect(html).toContain('id="nfc-start-btn"');
    expect(html).toContain("Start NFC");
  });

  test("card dashboard still includes NFC unsupported fallback", () => {
    const html = renderCardDashboardPage();
    expect(html).toContain('id="nfc-unsupported"');
  });
});

describe("refactored page renderers", () => {
  test("analytics page uses shared shell and loads static JS", () => {
    const html = renderAnalyticsPage();
    expect(html).toContain("Bolt Card Analytics");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("analytics.js");
  });

  test("wipe page uses shared shell and NFC helpers", () => {
    const html = renderWipePage({
      baseUrl: "https://test.local",
      resetApiUrl: "https://test.local/api/v1/pull-payments/example/boltcards?onExisting=KeepVersion",
    });
    expect(html).toContain("BoltCard Wipe Utility");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain('/static/js/nfc.js');
    expect(html).toContain('/static/js/wipe.js');
    expect(html).toContain('data-base-url="https://test.local"');
    expect(html).toContain('data-reset-api-url="https://test.local/api/v1/pull-payments/example/boltcards?onExisting=KeepVersion"');
  });

  test("bulk wipe page uses shared shell", () => {
    const html = renderBulkWipePage({
      baseUrl: "https://test.local",
      keyOptionsHtml: '<option value="deadbeef">deadbeef</option>',
    });
    expect(html).toContain("Bulk Card Wipe");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("deadbeef");
  });

  test("activate operator page uses shared shell", () => {
    const html = renderActivatePage({
      apiUrl: "https://test.local/api/v1/pull-payments/example/boltcards?onExisting=UpdateVersion",
      programDeepLink: "boltcard://program?url=https%3A%2F%2Ftest.local%2Fapi",
      resetDeepLink: "boltcard://reset?url=https%3A%2F%2Ftest.local%2Fapi",
      programUrl: "https://test.local/api/program",
      resetUrl: "https://test.local/api/reset",
    });
    expect(html).toContain("BoltCard Activate");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("CARD ACTIVATION");
  });

  test("activate card page loads NFC helpers via static JS", () => {
    const html = renderActivateCardPage();
    expect(html).toContain("activate.js");
    expect(html).toContain("nfc.js");
  });
});

describe("XSS auto-escape", () => {
  test("rawHtml auto-escapes interpolated values", () => {
    const html = rawHtml`<div>${'<script>alert(1)</script>'}</div>`;
    expect(html).toBe("<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>");
  });

  test("safe() bypasses escaping", () => {
    const html = rawHtml`<div>${safe('<b>bold</b>')}</div>`;
    expect(html).toBe("<div><b>bold</b></div>");
  });

  test("escapeHtml escapes all dangerous characters", () => {
    expect(escapeHtml('<>&"\'')).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  test("jsString produces JSON-safe string", () => {
    const html = rawHtml`const x = ${jsString('hello "world"')};`;
    expect(html).toBe('const x = "hello \\"world\\"";');
  });

  test("jsString escapes script injection", () => {
    const html = rawHtml`const x = ${jsString('</script><script>alert(1)</script>')};`;
    expect(html).not.toContain("</script>");
  });

  test("operator login page escapes returnTo parameter", () => {
    const html = renderOperatorLoginPage({ returnTo: '"><script>alert(1)</script>' });
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;");
  });

  test("operator login page escapes error messages", () => {
    const html = renderOperatorLoginPage({ error: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("pageShell escapes title and bodyClass", () => {
    const html = renderTailwindPage({
      title: '<script>alert("xss")</script>',
      bodyClass: '"><script>alert(1)</script>',
      content: "<p>safe content</p>",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("pageShell marks content as safe (pre-rendered HTML)", () => {
    const html = renderTailwindPage({
      title: "Test",
      content: "<div class='custom'>Hello</div>",
    });
    expect(html).toContain("<div class='custom'>Hello</div>");
  });
});
