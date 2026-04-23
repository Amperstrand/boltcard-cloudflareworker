const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(str) {
  if (typeof str !== "string") return escapeHtml(String(str));
  return str.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

export class SafeHtml {
  constructor(html) {
    this.html = html;
  }
}

export function safe(html) {
  if (html instanceof SafeHtml) return html;
  return new SafeHtml(html);
}

export function jsString(str) {
  const json = JSON.stringify(typeof str === "string" ? str : String(str));
  return safe(json.replace(/<\/script/gi, "<\\/script"));
}
