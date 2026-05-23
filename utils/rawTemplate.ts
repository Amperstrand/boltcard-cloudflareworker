import { SafeHtml, escapeHtml, safe } from "./escapeHtml.js";
import { getDeployRevision } from "./deployInfo.js";

export function rawHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = "";
  for (let i = 0; i < strings.raw.length; i++) {
    result += strings.raw[i]!
      .replace(/\\`/g, "`")
      .replace(/\\\$\{/g, "${");
    if (i < values.length) {
      const v = values[i];
      result += v instanceof SafeHtml ? v.html : escapeHtml(v);
    }
  }
  return result;
}

/**
 * Generate a cache-busted `<script>` tag for a static JS asset.
 * Usage: staticScript("helpers.js") → `<script src="/static/js/helpers.js?v=abc1234"></script>`
 */
export function staticScript(filename: string): SafeHtml {
  const v = encodeURIComponent(getDeployRevision());
  return safe(rawHtml`<script src="/static/js/${filename}?v=${v}"></script>`);
}

export { escapeHtml, SafeHtml, safe, jsString } from "./escapeHtml.js";
