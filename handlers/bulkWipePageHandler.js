import { renderBulkWipePage } from "../templates/bulkWipePage.js";
import { ISSUER_KEYS_BY_DOMAIN } from '../utils/generatedKeyData.js';
import { htmlResponse } from "../utils/responses.js";

export function handleBulkWipePage(request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  let keyOptionsHtml = '';
  for (const [domain, keys] of Object.entries(ISSUER_KEYS_BY_DOMAIN)) {
    const label = domain === '_default' ? 'Default / Shared' : domain;
    keyOptionsHtml += `<optgroup label="${label}">\n`;
    for (const key of keys) {
      keyOptionsHtml += `                <option value="${key.hex}">${key.label} (${key.hex.slice(0, 8)}...)</option>\n`;
    }
    keyOptionsHtml += `              </optgroup>\n`;
  }

  return htmlResponse(renderBulkWipePage({ baseUrl, keyOptionsHtml }));
}
