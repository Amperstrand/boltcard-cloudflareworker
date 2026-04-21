/**
 * Tagged template literal for HTML that preserves backslashes in inline JavaScript.
 *
 * Regular template literals consume backslash sequences (\d becomes d, \/ becomes /),
 * which breaks regex patterns in inline <script> blocks. This tag uses the raw template
 * strings to preserve all backslashes, then restores escaped backticks and ${} syntax
 * that String.raw would leave with literal backslashes.
 *
 * Usage:
 *   import { rawHtml } from "../utils/rawTemplate.js";
 *   return rawHtml`<script>const r = /\d+/;</script>`;
 *
 * What this preserves:
 *   - Regex backslashes: \d \w \s \b \B \/ etc. stay as-is
 *   - Escaped backticks: \` produces a literal backtick in output
 *   - Escaped interpolation: \${ produces ${ in output (for inner template literals)
 *   - Dynamic values: ${variable} still interpolates normally
 */
export function rawHtml(strings, ...values) {
  let result = "";
  for (let i = 0; i < strings.raw.length; i++) {
    result += strings.raw[i]
      .replace(/\\`/g, "`")
      .replace(/\\\$\{/g, "${");
    if (i < values.length) {
      result += String(values[i]);
    }
  }
  return result;
}
