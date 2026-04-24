import { rawHtml } from "../utils/rawTemplate.js";

export const CSRF_FETCH_HELPER = rawHtml`
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\\s*)op_csrf=([^;]*)/);
  return match ? match[1] : '';
}
var _origFetch = window.fetch;
window.fetch = function(input, init) {
  init = init || {};
  init.headers = init.headers || {};
  if (typeof init.headers.set === 'function') {
    if (!init.headers.has('X-CSRF-Token')) init.headers.set('X-CSRF-Token', getCsrfToken());
  } else {
    if (!init.headers['X-CSRF-Token']) init.headers['X-CSRF-Token'] = getCsrfToken();
  }
  return _origFetch.call(this, input, init);
};
`;

export const BROWSER_NFC_HELPERS = rawHtml`
function browserSupportsNfc() {
  return 'NDEFReader' in window;
}

function normalizeNfcSerial(serialNumber) {
  return serialNumber ? serialNumber.replace(/:/g, '').toLowerCase() : '';
}

async function extractNdefUrl(records, prefixes) {
  const acceptedPrefixes = prefixes || ['lnurlw://', 'lnurlp://', 'https://'];
  const decoder = new TextDecoder();
  for (const record of records) {
    if (record.recordType !== 'url' && record.recordType !== 'text') {
      continue;
    }
    const text = record.recordType === 'url'
      ? await new Response(record.data).text()
      : decoder.decode(record.data);
    const lower = text.toLowerCase();
    if (acceptedPrefixes.some(prefix => lower.startsWith(prefix))) {
      return text;
    }
  }
  return '';
}

function normalizeBrowserNfcUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('lnurlw://') || rawUrl.startsWith('lnurlp://')) {
    return 'https://' + rawUrl.substring(rawUrl.indexOf('://') + 3);
  }
  return rawUrl.replace(/^http:\/\//i, 'https://');
}
`;
