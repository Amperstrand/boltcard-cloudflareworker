import { Router } from "itty-router";
import type { IRequest } from "itty-router";
import type { Env } from "./types/core.js";
import { logger, getErrorMessage } from "./utils/logger.js";
import { jsonResponse, errorResponse, redirect } from "./utils/responses.js";
import { REQUEST_ID_LENGTH } from "./utils/constants.js";
import { checkRateLimit } from "./rateLimiter.js";
import type { AppRouter } from "./middleware/withOperatorAuth.js";
import { registerStaticRoutes } from "./routes/static.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerOperatorRoutes } from "./routes/operator.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerAdminRoutes } from "./routes/admin.js";

const router: AppRouter = Router<IRequest, [env: Env]>();

registerStaticRoutes(router);
registerPublicRoutes(router);
registerOperatorRoutes(router);
registerApiRoutes(router);
registerAdminRoutes(router);

router.all("*", (request) => {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const noisePaths = ["/favicon.ico", "/robots.txt", "/.well-known/", "/apple-touch-icon"];
  if (noisePaths.some(p => pathname.startsWith(p))) {
    return new Response(null, { status: 204 });
  }

  const SCAN_PATTERNS = [
    "/.env", "/.git", "/.aws", "/.ssh", "/backup/", "/config/", "/db.sql",
    "/wp-", "/xmlrpc", "/vendor/", "/composer.", "/docker-compose",
    "/serviceaccount", "/terraform", "/sendgrid", "/idea/",
    "/azure-pipelines", "/settings.ini", "/settings.php", "/secrets",
    "/application.yml", "/infra/", "/devops/", "/v1/keys",
  ];
  if (SCAN_PATTERNS.some(p => pathname.includes(p))) {
    return new Response(null, { status: 404 });
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/static/") || pathname.startsWith("/boltcards/")) {
    logger.warn("API route not found", { pathname, method: request.method });
    return errorResponse("Not found", 404);
  }
  logger.info("Unknown page redirect", { pathname, method: request.method });
  return redirect(url.origin + "/", 302);
});

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function withSecurityHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return router.fetch(request, env);
}

export { CardReplayDO } from "./durableObjects/CardReplayDO.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID().slice(0, REQUEST_ID_LENGTH);
    const startTime = Date.now();
    const url = new URL(request.url);

    logger.setRequestId(requestId);
    logger.info("Request started", {
      requestId,
      method: request.method,
      pathname: url.pathname,
      ip: request.headers.get("CF-Connecting-IP") || null,
    });

    void ctx;

    try {
      const { allowed, remaining, resetAt } = await checkRateLimit(request, env);
      if (!allowed) {
        const response = jsonResponse({ status: "ERROR", reason: "Rate limit exceeded" }, 429);
        response.headers.set("Retry-After", String(Math.ceil((resetAt - Date.now()) / 1000)));
        response.headers.set("X-RateLimit-Remaining", "0");
        logger.info("Request completed", { requestId, status: 429, duration: Date.now() - startTime, pathname: url.pathname });
        return withSecurityHeaders(response);
      }

      env.ctx = ctx;
      const response = await router.fetch(request, env, ctx);
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-Request-Id", requestId);
      logger.info("Request completed", { requestId, status: response.status, duration: Date.now() - startTime, pathname: url.pathname });
      return withSecurityHeaders(response);
    } catch (error: unknown) {
      logger.error("Unhandled request error", { requestId, error: getErrorMessage(error), url: request.url, duration: Date.now() - startTime });
      return withSecurityHeaders(jsonResponse({ status: "ERROR", reason: "Internal server error" }, 500));
    }
  },
};
