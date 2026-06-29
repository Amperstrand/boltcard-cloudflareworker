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
    <style>
      html.dark{background:#0f172a;color:#f1f5f9}
      html.dark body{background:#0f172a;color:#f1f5f9;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:0}
      html.dark a{color:#8b5cf6}
      html.dark button{cursor:pointer;border:none;padding:.5rem 1rem;border-radius:.5rem;font-weight:600}
      html.dark input,html.dark textarea{background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:.5rem;border-radius:.5rem}
      html.dark .hidden{display:none!important}
      html.dark [class*="min-h-screen"]{min-height:100vh}
      html.dark [class*="max-w-md"]{max-width:28rem;margin:0 auto;padding:1rem}
      @keyframes spin{to{transform:rotate(360deg)}}
      html.dark [class*="animate-spin"]{animation:spin 1s linear infinite}
      html.dark [class*="animate-ping"]{animation:ping 1s cubic-bezier(0,0,.2,1) infinite}
      @keyframes ping{75%,100%{transform:scale(2);opacity:0}}
      html.dark [class*="animate-pulse"]{animation:pulse 2s cubic-bezier(.4,0,.6,1) infinite}
      @keyframes pulse{50%{opacity:.5}}
    </style>
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
