import {
  NFC_JS, NFC_JS_HASH,
  NFC_GATE_JS, NFC_GATE_JS_HASH,
  CLIENT_ERROR_JS, CLIENT_ERROR_JS_HASH,
  HELPERS_JS, HELPERS_JS_HASH,
  CSRF_JS, CSRF_JS_HASH,
  CARD_DASHBOARD_JS, CARD_DASHBOARD_JS_HASH,
  DEBUG_JS, DEBUG_JS_HASH,
  LOGIN_JS, LOGIN_JS_HASH,
  ACTIVATE_JS, ACTIVATE_JS_HASH,
  ANALYTICS_JS, ANALYTICS_JS_HASH,
  CARD_AUDIT_JS, CARD_AUDIT_JS_HASH,
  MENU_EDITOR_JS, MENU_EDITOR_JS_HASH,
  WIPE_JS, WIPE_JS_HASH,
  BULK_WIPE_JS, BULK_WIPE_JS_HASH,
  TWO_FACTOR_JS, TWO_FACTOR_JS_HASH,
  BOLT11_DECODE_JS, BOLT11_DECODE_JS_HASH,
  POS_JS, POS_JS_HASH,
  TOPUP_JS, TOPUP_JS_HASH,
  REFUND_JS, REFUND_JS_HASH,
  IDENTITY_JS, IDENTITY_JS_HASH,
} from "./exports.js";
import { errorResponse } from "../../utils/responses.js";

interface StaticFileEntry {
  content: string;
  hash: string;
}

const STATIC_JS_FILES: Record<string, StaticFileEntry> = {
  "nfc.js": { content: NFC_JS, hash: NFC_JS_HASH },
  "nfc-gate.js": { content: NFC_GATE_JS, hash: NFC_GATE_JS_HASH },
  "client-error.js": { content: CLIENT_ERROR_JS, hash: CLIENT_ERROR_JS_HASH },
  "helpers.js": { content: HELPERS_JS, hash: HELPERS_JS_HASH },
  "csrf.js": { content: CSRF_JS, hash: CSRF_JS_HASH },
  "debug.js": { content: DEBUG_JS, hash: DEBUG_JS_HASH },
  "card-dashboard.js": { content: CARD_DASHBOARD_JS, hash: CARD_DASHBOARD_JS_HASH },
  "login.js": { content: LOGIN_JS, hash: LOGIN_JS_HASH },
  "activate.js": { content: ACTIVATE_JS, hash: ACTIVATE_JS_HASH },
  "analytics.js": { content: ANALYTICS_JS, hash: ANALYTICS_JS_HASH },
  "card-audit.js": { content: CARD_AUDIT_JS, hash: CARD_AUDIT_JS_HASH },
  "menu-editor.js": { content: MENU_EDITOR_JS, hash: MENU_EDITOR_JS_HASH },
  "wipe.js": { content: WIPE_JS, hash: WIPE_JS_HASH },
  "bulk-wipe.js": { content: BULK_WIPE_JS, hash: BULK_WIPE_JS_HASH },
  "two-factor.js": { content: TWO_FACTOR_JS, hash: TWO_FACTOR_JS_HASH },
  "bolt11-decode.js": { content: BOLT11_DECODE_JS, hash: BOLT11_DECODE_JS_HASH },
  "pos.js": { content: POS_JS, hash: POS_JS_HASH },
  "topup.js": { content: TOPUP_JS, hash: TOPUP_JS_HASH },
  "refund.js": { content: REFUND_JS, hash: REFUND_JS_HASH },
  "identity.js": { content: IDENTITY_JS, hash: IDENTITY_JS_HASH },
};

export function serveStaticJs(file: string | undefined, ifNoneMatch: string | null): Response {
  if (!file) return errorResponse("Not found", 404);

  const entry = STATIC_JS_FILES[file];
  if (!entry) return errorResponse("Not found", 404);

  if (ifNoneMatch === `"${entry.hash}"`) {
    return new Response(null, { status: 304 });
  }

  return new Response(entry.content, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "ETag": `"${entry.hash}"`,
    },
  });
}
