const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return escapeHtml(String(str));
  return str.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]!);
}

export class SafeHtml {
  html: string;
  constructor(html: string) {
    this.html = html;
  }
}

export function safe(html: string | SafeHtml): SafeHtml {
  if (html instanceof SafeHtml) return html;
  return new SafeHtml(html);
}

export function jsString(str: unknown): SafeHtml {
  const json = JSON.stringify(typeof str === "string" ? str : String(str));
  return safe(json.replace(/<\/script/gi, "<\\/script"));
}
