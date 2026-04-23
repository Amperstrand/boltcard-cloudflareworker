import { SafeHtml, escapeHtml } from "./escapeHtml.js";

export function rawHtml(strings, ...values) {
  let result = "";
  for (let i = 0; i < strings.raw.length; i++) {
    result += strings.raw[i]
      .replace(/\\`/g, "`")
      .replace(/\\\$\{/g, "${");
    if (i < values.length) {
      const v = values[i];
      result += v instanceof SafeHtml ? v.html : escapeHtml(v);
    }
  }
  return result;
}

export { escapeHtml, SafeHtml, safe, jsString } from "./escapeHtml.js";
