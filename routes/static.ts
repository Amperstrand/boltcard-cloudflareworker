import type { AppRouter } from "../middleware/withOperatorAuth.js";
import { serveStaticJs } from "../static/js/registry.js";
import { SW_JS, MANIFEST_JSON, BOLT_ICON_SVG } from "../static/pwa-assets.js";

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
}
