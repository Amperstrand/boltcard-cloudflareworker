import { rawHtml, safe } from "../utils/rawTemplate.js";
import { CSRF_FETCH_HELPER } from "./browserNfc.js";

export function renderTailwindPage({
  title,
  content,
  bodyClass = "",
  htmlClass = "dark",
  styles = "",
  headScripts = "",
  metaRobots = "",
  csrf = false,
}) {
  return rawHtml`<!DOCTYPE html>
<html lang="en" class="${htmlClass}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaRobots ? safe(rawHtml`<meta name="robots" content="${metaRobots}" />`) : ""}
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    ${safe(headScripts)}
    ${styles ? safe(rawHtml`<style>${styles}</style>`) : ""}
    ${csrf ? safe(rawHtml`<script>${safe(CSRF_FETCH_HELPER)}</script>`) : ""}
  </head>
  <body class="${bodyClass}">
${safe(content)}
  </body>
</html>`;
}
