import { describe, it, expect } from "vitest";
import {
  NFC_JS,
  NFC_GATE_JS,
  VIRTUAL_CARD_SIM_JS,
  VIRTUAL_CARD_PAGE_JS,
  CLIENT_ERROR_JS,
  HELPERS_JS,
  CSRF_JS,
  CARD_DASHBOARD_JS,
  DEBUG_JS,
  LOGIN_JS,
  ACTIVATE_JS,
  ANALYTICS_JS,
  CARD_AUDIT_JS,
  MENU_EDITOR_JS,
  WIPE_JS,
  BULK_WIPE_JS,
  TWO_FACTOR_JS,
  BOLT11_DECODE_JS,
  POS_JS,
  TOPUP_JS,
  REFUND_JS,
  IDENTITY_JS,
} from "../static/js/exports.js";

const ALL_EXPORTS: [string, string][] = [
  ["nfc.js", NFC_JS],
  ["nfc-gate.js", NFC_GATE_JS],
  ["virtual-card-sim.js", VIRTUAL_CARD_SIM_JS],
  ["virtual-card-page.js", VIRTUAL_CARD_PAGE_JS],
  ["client-error.js", CLIENT_ERROR_JS],
  ["helpers.js", HELPERS_JS],
  ["csrf.js", CSRF_JS],
  ["card-dashboard.js", CARD_DASHBOARD_JS],
  ["debug.js", DEBUG_JS],
  ["login.js", LOGIN_JS],
  ["activate.js", ACTIVATE_JS],
  ["analytics.js", ANALYTICS_JS],
  ["card-audit.js", CARD_AUDIT_JS],
  ["menu-editor.js", MENU_EDITOR_JS],
  ["wipe.js", WIPE_JS],
  ["bulk-wipe.js", BULK_WIPE_JS],
  ["two-factor.js", TWO_FACTOR_JS],
  ["bolt11-decode.js", BOLT11_DECODE_JS],
  ["pos.js", POS_JS],
  ["topup.js", TOPUP_JS],
  ["refund.js", REFUND_JS],
  ["identity.js", IDENTITY_JS],
];

describe("JS exports parse validation", () => {
  it.each(ALL_EXPORTS)("%s round-trips as valid JavaScript", (_name, content) => {
    // If the template literal in exports.ts corrupts the content
    // (e.g., stripping backslashes from regex like /^http:\/\//),
    // new Function() will throw a SyntaxError.
    expect(() => new Function(content)).not.toThrow();
  });

  it("all exports are non-empty strings", () => {
    for (const [name, content] of ALL_EXPORTS) {
      expect(content.length, `${name} should be non-empty`).toBeGreaterThan(0);
    }
  });
});
