import { renderBulkWipePage } from "../templates/bulkWipePage.js";
import { ISSUER_KEYS_BY_DOMAIN } from '../utils/generatedKeyData.js';
import { htmlResponse } from "../utils/responses.js";
import { fingerprintHex } from "../utils/keyLookup.js";
import { getRequestOrigin } from "../utils/validation.js";
import { rawHtml, safe } from "../utils/rawTemplate.js";

const KEY_FINGERPRINTS: Map<string, string> = new Map();

async function computeFingerprints(): Promise<void> {
  if (KEY_FINGERPRINTS.size > 0) return;
  for (const keys of Object.values(ISSUER_KEYS_BY_DOMAIN)) {
    for (const key of keys) {
      const hex: string = key.hex.toLowerCase();
      if (!KEY_FINGERPRINTS.has(hex)) {
        KEY_FINGERPRINTS.set(hex, fingerprintHex(hex));
      }
    }
  }
}

export async function handleBulkWipePage(request: Request): Promise<Response> {
  const baseUrl: string = getRequestOrigin(request);

  await computeFingerprints();

  let keyOptionsHtml: string = '';
  for (const [domain, keys] of Object.entries(ISSUER_KEYS_BY_DOMAIN)) {
    const label: string = domain === '_default' ? 'Default / Shared' : domain;
    keyOptionsHtml += rawHtml`<optgroup label="${label}">` + '\n';
    for (const key of keys) {
      const fp: string = KEY_FINGERPRINTS.get(key.hex.toLowerCase()) || '';
      keyOptionsHtml += rawHtml`<option value="${key.hex}" data-fingerprint="${fp}">${key.label} (${key.hex.slice(0, 8)}...)</option>` + '\n';
    }
    keyOptionsHtml += `</optgroup>\n`;
  }

  return htmlResponse(renderBulkWipePage({ baseUrl, keyOptionsHtml: safe(keyOptionsHtml).html }));
}
