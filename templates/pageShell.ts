import { rawHtml, safe } from "../utils/rawTemplate.js";
import { getDeployRevision, getJsFingerprint } from "../utils/deployInfo.js";

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
  const deployRevision = getDeployRevision();
  const jsFingerprint = getJsFingerprint();
  const deployVersion = encodeURIComponent(deployRevision);
  return rawHtml`<!DOCTYPE html>
<html lang="en" class="${htmlClass}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaRobots ? safe(rawHtml`<meta name="robots" content="${metaRobots}" />`) : ""}
    <link rel="manifest" href="/static/manifest.webmanifest" />
    <meta name="theme-color" content="#10b981" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Bolt Card" />
    <link rel="apple-touch-icon" href="/static/icons/bolt.svg" />
    <title>${title}</title>
    <meta name="deploy-revision" content="${deployRevision}" />
    <meta name="js-fingerprint" content="${jsFingerprint}" />
    <script src="/static/js/client-error.js?v=${deployVersion}"></script>
    <script src="/static/js/virtual-card-sim.js?v=${deployVersion}"></script>
    <script src="/static/js/nfc.js?v=${deployVersion}"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    ${safe(headScripts)}
    ${styles ? safe(rawHtml`<style>${styles}</style>`) : ""}
    ${csrf ? safe(rawHtml`<script src="/static/js/csrf.js?v=${deployVersion}"></script>`) : ""}
  </head>
  <body class="${bodyClass}">
${safe(content)}
    <script src="/static/js/nfc-gate.js?v=${deployVersion}"></script>
  </body>
</html>`;
}
