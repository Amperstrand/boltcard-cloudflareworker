import { describe, expect, test } from "@jest/globals";
import { buildErrorPayload, errorResponse } from "../utils/responses.js";
import { renderTailwindPage } from "../templates/pageShell.js";
import { BROWSER_NFC_HELPERS } from "../templates/browserNfc.js";
import { renderBulkWipePage } from "../templates/bulkWipePage.js";
import { renderActivatePage, renderActivateCardPage } from "../templates/activatePage.js";
import { renderAnalyticsPage } from "../templates/analyticsPage.js";
import { renderWipePage } from "../templates/wipePage.js";

describe("response helpers", () => {
  test("buildErrorPayload preserves backward-compatible fields", () => {
    expect(buildErrorPayload("boom", { uid: "abc" })).toEqual({
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

  test("browser NFC helper snippet exports shared primitives", () => {
    expect(BROWSER_NFC_HELPERS).toContain("function browserSupportsNfc()");
    expect(BROWSER_NFC_HELPERS).toContain("function normalizeNfcSerial(serialNumber)");
    expect(BROWSER_NFC_HELPERS).toContain("async function extractNdefUrl(records, prefixes)");
    expect(BROWSER_NFC_HELPERS).toContain("function normalizeBrowserNfcUrl(rawUrl)");
  });
});

describe("refactored page renderers", () => {
  test("analytics page uses shared shell and validation helper", () => {
    const html = renderAnalyticsPage();
    expect(html).toContain("Bolt Card Analytics");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("function validateUid");
  });

  test("wipe page uses shared shell and NFC helpers", () => {
    const html = renderWipePage({
      baseUrl: "https://test.local",
      resetApiUrl: "https://test.local/api/v1/pull-payments/example/boltcards?onExisting=KeepVersion",
    });
    expect(html).toContain("BoltCard Wipe Utility");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("function browserSupportsNfc()");
    expect(html).toContain("normalizeNfcSerial(event.serialNumber)");
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

  test("activate card page uses shared NFC helpers", () => {
    const html = renderActivateCardPage();
    expect(html).toContain("function browserSupportsNfc()");
    expect(html).toContain("normalizeNfcSerial(event.serialNumber)");
  });
});
