import type { AppRouter } from "../middleware/withOperatorAuth.js";
import { serveStaticJs } from "../static/js/registry.js";
import { SW_JS, MANIFEST_JSON, BOLT_ICON_SVG } from "../static/pwa-assets.js";
import { TAILWIND_CSS } from "../static/tailwind-css.js";

export function registerStaticRoutes(router: AppRouter): void {
  router.get("/static/js/:file", (request) => {
    return serveStaticJs(request.params.file, request.headers.get("If-None-Match"));
  });
  router.head("/static/js/:file", (request) => {
    return serveStaticJs(request.params.file, request.headers.get("If-None-Match"));
  });
  router.get("/sw.js", () => {
    return new Response(SW_JS, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=0",
        "Service-Worker-Allowed": "/",
      },
    });
  });
  router.get("/static/manifest.webmanifest", () => {
    return new Response(MANIFEST_JSON, {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
  router.get("/static/icons/bolt.svg", () => {
    return new Response(BOLT_ICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
  router.get("/favicon.ico", () => new Response(null, { status: 204 }));
  router.get("/static/css/tailwind.css", () => {
    return new Response(TAILWIND_CSS, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
  router.get("/sw-clear", () => new Response(
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0f172a;color:#10b981;font-family:system-ui;padding:2rem;text-align:center}</style></head><body><h1>Cache Cleared</h1><p>Service workers unregistered. Cached data cleared.</p><a href="/credential" style="color:#8b5cf6;font-size:1.2rem">Go to Credential Page &rarr;</a><script>if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(s){s.unregister()});location.reload()})}else{location.href="/credential"}</script></body></html>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  ));
}
