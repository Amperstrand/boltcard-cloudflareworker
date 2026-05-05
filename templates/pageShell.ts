import { rawHtml, safe } from "../utils/rawTemplate.js";

interface RenderTailwindPageOptions {
  title: string;
  content: string;
  bodyClass?: string;
  htmlClass?: string;
  styles?: string;
  headScripts?: string;
  metaRobots?: string;
  csrf?: boolean;
}

export function renderTailwindPage({
  title,
  content,
  bodyClass = "",
  htmlClass = "dark",
  styles = "",
  headScripts = "",
  metaRobots = "",
  csrf = false,
}: RenderTailwindPageOptions): string {
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
    ${csrf ? safe('<script src="/static/js/csrf.js"></script>') : ""}
  </head>
  <body class="${bodyClass}">
${safe(content)}
  </body>
</html>`;
}
