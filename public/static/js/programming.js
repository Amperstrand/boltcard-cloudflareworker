// programming.js — classic script (no import/export)
// Depends on: helpers.js (relativeTime)

/**
 * Build a boltcard programming deeplink URL.
 * @param {string} endpointUrl - The programming endpoint URL
 * @returns {string} boltcard://program?url=... deeplink
 */
function buildProgrammingDeeplink(endpointUrl) {
  return 'boltcard://program?url=' + encodeURIComponent(endpointUrl);
}

/**
 * Render a QR code into a container element, replacing any existing content.
 * @param {string} containerId - Element ID to render QR into
 * @param {string} text - QR code content
 */
function renderQrCode(containerId, text) {
  if (typeof QRCode === 'undefined') return;
  var el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  new QRCode(el, { text: text, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
}

/**
 * Build wipe JSON from key cells in a table.
 * @param {string} tableId - tbody element ID containing key rows
 * @returns {string} JSON string of wipe data
 */
function buildWipeJson(tableId) {
  var cells = document.querySelectorAll('#' + tableId + ' td:last-child');
  var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
  return JSON.stringify({
    k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '',
    k3: vals[3] || '', k4: vals[4] || '',
    action: 'wipe', version: '1'
  }, null, 2);
}
