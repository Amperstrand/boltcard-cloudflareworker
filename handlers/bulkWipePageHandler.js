import { renderBulkWipePage } from "../templates/bulkWipePage.js";
import { ISSUER_KEYS_BY_DOMAIN } from '../utils/generatedKeyData.js';
import { htmlResponse } from "../utils/responses.js";
import { fingerprintHex } from "../utils/keyLookup.js";

const KEY_FINGERPRINTS = new Map();

async function computeFingerprints() {
  if (KEY_FINGERPRINTS.size > 0) return;
  for (const keys of Object.values(ISSUER_KEYS_BY_DOMAIN)) {
    for (const key of keys) {
      const hex = key.hex.toLowerCase();
      if (!KEY_FINGERPRINTS.has(hex)) {
        KEY_FINGERPRINTS.set(hex, await fingerprintHex(hex));
      }
    }
  }
}

export async function handleBulkWipePage(request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await computeFingerprints();

  let keyOptionsHtml = '';
  for (const [domain, keys] of Object.entries(ISSUER_KEYS_BY_DOMAIN)) {
    const label = domain === '_default' ? 'Default / Shared' : domain;
    keyOptionsHtml += `<optgroup label="${label}">\n`;
    for (const key of keys) {
      const fp = KEY_FINGERPRINTS.get(key.hex.toLowerCase()) || '';
      keyOptionsHtml += `                <option value="${key.hex}" data-fingerprint="${fp}">${key.label} (${key.hex.slice(0, 8)}...)</option>\n`;
    }
    keyOptionsHtml += `              </optgroup>\n`;
  }

  return htmlResponse(renderBulkWipePage({ baseUrl, keyOptionsHtml }));
}
