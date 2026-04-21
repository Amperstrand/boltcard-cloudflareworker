import { rawHtml } from "../utils/rawTemplate.js";

export function renderTailwindPage({
  title,
  content,
  bodyClass = "",
  htmlClass = "dark",
  styles = "",
  headScripts = "",
  metaRobots = "",
}) {
  return rawHtml`<!DOCTYPE html>
<html lang="en" class="${htmlClass}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaRobots ? rawHtml`<meta name="robots" content="${metaRobots}" />` : ""}
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    ${headScripts}
    ${styles ? rawHtml`<style>${styles}</style>` : ""}
  </head>
  <body class="${bodyClass}">
${content}
  </body>
</html>`;
}
