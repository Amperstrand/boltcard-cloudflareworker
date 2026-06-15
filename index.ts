import { Router } from "itty-router";
import type { IRequest } from "itty-router";
import type { Env, SessionPayload } from "./types/core.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { fetchBoltCardKeys } from "./handlers/fetchBoltCardKeys.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleLnurlw } from "./handlers/lnurlwHandler.js";
import { handleLnurlPayCallback } from "./handlers/lnurlPayHandler.js";
import { handleDebugPage } from "./handlers/debugHandler.js";
import { handleIdentityPage, handleIdentityProfileUpdate, handleIdentityVerify } from "./handlers/identityHandler.js";
import { handleActivateCardPage as handleActivateForm, handleActivateCardSubmit } from "./handlers/activateCardHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleActivatePage } from "./handlers/activatePageHandler.js";
import { handleTwoFactor } from "./handlers/twoFactorHandler.js";
import { handleLoginPage, handleLoginVerify } from "./handlers/loginHandler.js";
import { handleCardPage, handleCardInfo, handleCardLock, handleCardReactivate } from "./handlers/cardDashboardHandler.js";
import { handlePosPage } from "./handlers/posHandler.js";
import { handleWipePage } from "./handlers/wipePageHandler.js";
import { handleGetKeys } from "./handlers/getKeysHandler.js";
import { handleBulkWipeKeys } from "./handlers/bulkWipeHandler.js";
import { handleBulkWipePage } from "./handlers/bulkWipePageHandler.js";
import { handleAnalyticsPage, handleAnalyticsData } from "./handlers/analyticsHandler.js";
import { handleFakeInvoice } from "./handlers/fakeInvoiceHandler.js";
import { logger, getErrorMessage } from "./utils/logger.js";
import { jsonResponse, errorResponse, redirect } from "./utils/responses.js";
import { REQUEST_ID_LENGTH } from "./utils/constants.js";
import { checkRateLimit } from "./rateLimiter.js";
import { requireOperator, buildCsrfCookie, CSRF_COOKIE_NAME } from "./middleware/operatorAuth.js";
import { getRequestOrigin } from "./utils/validation.js";
import { getCookieValue, constantTimeEqual } from "./utils/cookies.js";
import { handleOperatorLoginPage, handleOperatorLogin, handleOperatorLogout } from "./handlers/operatorLoginHandler.js";
import { handleTopupPage, handleTopupApply } from "./handlers/topupHandler.js";
import { handlePosCharge } from "./handlers/posChargeHandler.js";
import { handleRefundPage, handleRefundApply } from "./handlers/refundHandler.js";
import { handleBalanceCheck } from "./handlers/balanceCheckHandler.js";
import { handleReceipt } from "./handlers/receiptHandler.js";
import { handleMenuEditorPage, handleMenuGet, handleMenuPut } from "./handlers/menuEditorHandler.js";
import { handleIdentifyCard } from "./handlers/identifyCardHandler.js";
import { handleIdentifyIssuerKey } from "./handlers/identifyIssuerKeyHandler.js";
import { handleVirtualCardKeys } from "./handlers/virtualCardHandler.js";
import { handleCardAuditPage, handleCardAuditData, handleIndexRepair } from "./handlers/cardAuditHandler.js";
import { handleCardExport, handleCardRestore } from "./handlers/cardBackupHandler.js";
import { handleCardBatchAction } from "./handlers/cardBatchHandler.js";
import { handleReconciliationPage, handleReconciliationData } from "./handlers/reconciliationHandler.js";
import { handleHealthPage, handleHealthData } from "./handlers/healthHandler.js";
import { handleVoidPage, handleVoidApply, handleVoidTransactions } from "./handlers/voidHandler.js";
import { handleDecodePage, handleDecodeApi } from "./handlers/bolt11DecodeHandler.js";
import { handleClientError } from "./handlers/clientErrorHandler.js";
import { handleTestErrorPage } from "./handlers/testErrorHandler.js";
import { serveStaticJs } from "./static/js/registry.js";
import { MANIFEST_JSON, SW_JS, BOLT_ICON_SVG } from "./static/pwa-assets.js";
import { initDeployInfo } from "./utils/deployInfo.js";

const router = Router<IRequest, [env: Env]>();

function withOperatorAuth(handler: (request: IRequest, env: Env, session: SessionPayload) => Promise<Response> | Response) {
  return async (request: IRequest, env: Env) => {
    const auth = requireOperator(request, env);
    if (!auth.authorized) return auth.response;

    const method = request.method.toUpperCase();
    const isMutating = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";

    if (isMutating) {
      const cookieHeader = request.headers.get("Cookie") || "";
      const csrfCookie = getCookieValue(cookieHeader, CSRF_COOKIE_NAME);
      const csrfHeader = request.headers.get("X-CSRF-Token");

      const skipCsrf = env && env.__TEST_OPERATOR_SESSION && env.WORKER_ENV !== "production";
      if (!skipCsrf && (!csrfCookie || !csrfHeader || !constantTimeEqual(csrfCookie, csrfHeader))) {
        return errorResponse("CSRF validation failed", 403);
      }
    }

    const response = await handler(request, env, auth.session);

    if (response && !isMutating) {
      const existingCsrf = request.headers.get("Cookie") || "";
      const hasCsrf = !!getCookieValue(existingCsrf, CSRF_COOKIE_NAME);
      if (!hasCsrf) {
        const token = crypto.randomUUID();
        const newResponse = new Response(response.body, response);
        newResponse.headers.append("Set-Cookie", buildCsrfCookie(token));
        return newResponse;
      }
    }

    return response;
  };
}

router.get("/api/fake-invoice", (request, env) => handleFakeInvoice(request, env));
router.get("/status", (request, env) => handleStatus(request, env));
router.all("/boltcards/api/v1/lnurl/cb*", (request, env) => handleLnurlpPayment(request, env));
router.get("/2fa", (request, env) => handleTwoFactor(request, env));
router.get("/login", (request) => handleLoginPage(request));
router.post("/login", (request, env) => handleLoginVerify(request, env));
router.get("/pos", () => redirect("/operator/pos"));
router.get("/operator/pos", withOperatorAuth((request, env) => handlePosPage(request, env)));
router.post("/operator/pos/charge", withOperatorAuth((request, env, session) => handlePosCharge(request, env, session)));
router.get("/operator/pos/menu", withOperatorAuth((request, env) => handleMenuEditorPage(request, env)));
router.put("/operator/pos/menu", withOperatorAuth((request, env) => handleMenuPut(request, env)));
router.get("/api/pos/menu", withOperatorAuth((request, env) => handleMenuGet(request, env)));
router.get("/api/receipt/:txnId", withOperatorAuth((request, env) => handleReceipt(request, env)));
router.post("/activate/form", withOperatorAuth((request, env) => handleActivateCardSubmit(request, env)));
router.get("/lnurlp/cb", (request, env) => handleLnurlPayCallback(request, env));
router.get("/api/verify-identity", (request, env) => handleIdentityVerify(request, env));
router.post("/api/identity/profile", (request, env) => handleIdentityProfileUpdate(request, env));
router.get("/operator/login", (request) => handleOperatorLoginPage(request));
router.post("/operator/login", (request, env) => handleOperatorLogin(request, env));
router.post("/api/identify-card", withOperatorAuth((request, env) => handleIdentifyCard(request, env)));
  router.post("/api/identify-issuer-key", withOperatorAuth((request, env) => handleIdentifyIssuerKey(request, env)));
  router.get("/api/debug/virtual-card-keys", withOperatorAuth((request, env) => handleVirtualCardKeys(request, env)));
  router.get("/api/vc/keys", withOperatorAuth((request, env) => handleVirtualCardKeys(request, env)));
router.post("/operator/logout", (request, env) => handleOperatorLogout(request, env));
router.get("/operator", withOperatorAuth(() => redirect("/operator/pos")));
router.get("/operator/cards", withOperatorAuth((request, env) => handleCardAuditPage(request, env)));
router.get("/operator/cards/data", withOperatorAuth((request, env) => handleCardAuditData(request, env)));
router.post("/operator/cards/batch", withOperatorAuth((request, env, session) => handleCardBatchAction(request, env, session)));
router.post("/operator/cards/repair", withOperatorAuth((request, env) => handleIndexRepair(request, env)));
router.get("/operator/cards/:uid/export", withOperatorAuth((request, env) => handleCardExport(request, env)));
router.post("/operator/cards/:uid/restore", withOperatorAuth((request, env, session) => handleCardRestore(request, env, session)));
router.get("/operator/topup", withOperatorAuth((request, env) => handleTopupPage(request, env)));
router.post("/operator/topup/apply", withOperatorAuth((request, env, session) => handleTopupApply(request, env, session)));
router.get("/operator/refund", withOperatorAuth((request, env) => handleRefundPage(request, env)));
router.post("/operator/refund/apply", withOperatorAuth((request, env, session) => handleRefundApply(request, env, session)));
router.get("/operator/reconciliation", withOperatorAuth((request, env) => handleReconciliationPage(request, env)));
router.get("/operator/reconciliation/data", withOperatorAuth((request, env) => handleReconciliationData(request, env)));
router.get("/operator/health", withOperatorAuth((request, env) => handleHealthPage(request, env)));
router.get("/operator/health/data", withOperatorAuth((request, env) => handleHealthData(request, env)));
router.get("/operator/void", withOperatorAuth((request, env) => handleVoidPage(request, env)));
router.post("/operator/void/apply", withOperatorAuth((request, env, session) => handleVoidApply(request, env, session)));
router.get("/operator/void/transactions", withOperatorAuth((request, env) => handleVoidTransactions(request, env)));
router.post("/api/balance-check", (request, env) => handleBalanceCheck(request, env));
router.post("/api/client-error", (request, env) => handleClientError(request, env));
router.get("/test-error", withOperatorAuth((request, env) => handleTestErrorPage(request, env)));

router.get("/decode", (request) => handleDecodePage(request));
router.get("/api/decode", (request) => handleDecodeApi(request));

router.get("/debug", withOperatorAuth((request) => handleDebugPage(request)));
router.get("/experimental/nfc", (request) => {
  return redirect(new URL(request.url).origin + "/debug#console", 302);
});
router.get("/experimental/activate", withOperatorAuth((request, env) => handleActivatePage(request, env)));
router.get("/experimental/activate/form", withOperatorAuth(() => handleActivateForm()));
router.post("/experimental/activate/form", withOperatorAuth((request, env) => handleActivateCardSubmit(request, env)));
router.get("/experimental/wipe", withOperatorAuth((request, env) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  if (uid) return handleReset(uid, env, getRequestOrigin(request));
  return handleWipePage(request, env);
}));
router.get("/experimental/bulkwipe", withOperatorAuth((request) => handleBulkWipePage(request)));
router.get("/experimental/analytics", withOperatorAuth(() => handleAnalyticsPage()));
router.get("/experimental/analytics/data", withOperatorAuth((request, env) => handleAnalyticsData(request, env)));
router.get("/api/keys", withOperatorAuth((request, env) => handleGetKeys(request, env)));
router.post("/api/keys", withOperatorAuth((request, env) => handleGetKeys(request, env)));
router.all("/api/v1/pull-payments/:pullPaymentId/boltcards", withOperatorAuth((request, env) => fetchBoltCardKeys(request, env)));
router.get("/api/bulk-wipe-keys", withOperatorAuth((request) => handleBulkWipeKeys(request)));
router.post("/api/bulk-wipe-keys", withOperatorAuth((request) => handleBulkWipeKeys(request)));
router.get("/identity", (request) => handleIdentityPage(request));

router.get("/card", (request, env) => handleCardPage(request, env));
router.get("/card/info", (request, env) => handleCardInfo(request, env));
router.post("/api/card/lock", (request, env) => handleCardLock(request, env));
router.post("/api/card/reactivate", (request, env) => handleCardReactivate(request, env));

router.get("/nfc", (request) => {
  return redirect(new URL(request.url).origin + "/debug#console", 302);
});
router.get("/activate", (request) => {
  return redirect(new URL(request.url).origin + "/experimental/activate", 302);
});
router.get("/activate/form", (request) => {
  return redirect(new URL(request.url).origin + "/experimental/activate/form", 302);
});
router.get("/wipe", withOperatorAuth((request, env) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  if (uid) return handleReset(uid, env, getRequestOrigin(request));
  return redirect(url.origin + "/experimental/wipe", 302);
}));
router.get("/bulkwipe", (request) => {
  return redirect(new URL(request.url).origin + "/experimental/bulkwipe", 302);
});
router.get("/analytics", (request) => {
  return redirect(new URL(request.url).origin + "/experimental/analytics", 302);
});
router.get("/analytics/data", withOperatorAuth((request, env) => handleAnalyticsData(request, env)));
router.get("/favicon.ico", () => new Response(null, { status: 204 }));
router.get("/", (request, env) => {
  const { searchParams } = new URL(request.url);
  const hasP = searchParams.has("p");
  const hasC = searchParams.has("c");
  if (hasP && hasC) {
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("text/html")) {
      return handleIdentityPage(request);
    }
    return handleLnurlw(request, env);
  }
  if (hasP || hasC) {
    return errorResponse("Missing card parameters — both p and c are required", 400);
  }
  return handleLoginPage(request);
});
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
