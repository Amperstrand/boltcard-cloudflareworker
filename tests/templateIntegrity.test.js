import { renderLoginPage } from "../templates/loginPage.js";
import { renderBulkWipePage } from "../templates/bulkWipePage.js";
import { renderPosPage } from "../templates/posPage.js";
import { renderTopupPage } from "../templates/topupPage.js";
import { renderRefundPage } from "../templates/refundPage.js";
import { renderWipePage } from "../templates/wipePage.js";
import { renderMenuEditorPage } from "../templates/menuEditorPage.js";
import { renderActivatePage } from "../templates/activatePage.js";
import { renderIdentityPage } from "../templates/identityPage.js";
import { renderDebugConsolePage } from "../templates/debugConsolePage.js";
import { renderAnalyticsPage } from "../templates/analyticsPage.js";
import { renderOperatorLoginPage } from "../templates/operatorLoginPage.js";

const CSRF_REQUIRED = [
  { name: "loginPage", render: () => renderLoginPage({ host: "https://test.com", defaultProgrammingEndpoint: "https://test.com/api/v1/pull-payments/test/boltcards" }) },
  { name: "bulkWipePage", render: () => renderBulkWipePage({ baseUrl: "https://test.com", keyOptionsHtml: "<option>test</option>" }) },
  { name: "posPage", render: () => renderPosPage({ host: "https://test.com", csrfToken: "test-token", operatorSession: JSON.stringify({ iat: 0, exp: 9999999999, shiftId: "test" }) }) },
  { name: "topupPage", render: () => renderTopupPage({ host: "https://test.com", csrfToken: "test-token", operatorSession: JSON.stringify({ iat: 0, exp: 9999999999, shiftId: "test" }) }) },
  { name: "refundPage", render: () => renderRefundPage({ host: "https://test.com", csrfToken: "test-token", operatorSession: JSON.stringify({ iat: 0, exp: 9999999999, shiftId: "test" }) }) },
  { name: "wipePage", render: () => renderWipePage({ host: "https://test.com", csrfToken: "test-token", operatorSession: JSON.stringify({ iat: 0, exp: 9999999999, shiftId: "test" }) }) },
  { name: "menuEditorPage", render: () => renderMenuEditorPage({ host: "https://test.com", csrfToken: "test-token", terminalId: "t1", menu: { items: [] } }) },
  { name: "activatePage", render: () => renderActivatePage({ apiUrl: "https://test.com", programDeepLink: "bolt://x", resetDeepLink: "bolt://y", programUrl: "https://test.com", resetUrl: "https://test.com" }) },
  { name: "identityPage", render: () => renderIdentityPage({ host: "https://test.com" }) },
  { name: "debugConsolePage", render: () => renderDebugConsolePage({ host: "https://test.com", baseUrl: "https://test.com" }) },
];

const CSRF_NOT_REQUIRED = [
  { name: "analyticsPage", render: () => renderAnalyticsPage() },
  { name: "operatorLoginPage", render: () => renderOperatorLoginPage({}) },
];

describe("template integrity", () => {
  describe("CSRF script injection", () => {
    for (const { name, render } of CSRF_REQUIRED) {
      test(`${name}: renders <script> tag with CSRF helper (not HTML-escaped)`, () => {
        const html = render();
        expect(html).toContain("<script>");
        expect(html).toContain("getCsrfToken");
        expect(html).toContain("_origFetch");
        expect(html).toContain("op_csrf");
        expect(html).not.toContain("&lt;script&gt;");
        expect(html).not.toContain("&lt;/script&gt;");
      });
    }
  });

  describe("pages without CSRF should not have CSRF helper", () => {
    for (const { name, render } of CSRF_NOT_REQUIRED) {
      test(`${name}: does not inject CSRF helper`, () => {
        const html = render();
        expect(html).not.toContain("getCsrfToken");
      });
    }
  });

  describe("all pages render valid HTML structure", () => {
    const allPages = [...CSRF_REQUIRED, ...CSRF_NOT_REQUIRED];
    for (const { name, render } of allPages) {
      test(`${name}: has <head>, <body>, DOCTYPE, and tailwind`, () => {
        const html = render();
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("<head>");
        expect(html).toContain("</head>");
        expect(html).toContain("<body");
        expect(html).toContain("</body>");
        expect(html).toContain("tailwindcss");
      });
    }
  });

});
