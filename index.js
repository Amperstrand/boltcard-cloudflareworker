// index.js
import { Router } from "itty-router";
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
import { handlePosPage } from "./handlers/posHandler.js";
import { handleWipePage } from "./handlers/wipePageHandler.js";
import { handleGetKeys } from "./handlers/getKeysHandler.js";
import { handleBulkWipeKeys } from "./handlers/bulkWipeHandler.js";
import { handleBulkWipePage } from "./handlers/bulkWipePageHandler.js";
import { handleAnalyticsPage, handleAnalyticsData } from "./handlers/analyticsHandler.js";
import { generateFakeBolt11 } from "./utils/bolt11.js";
import { logger } from "./utils/logger.js";
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

const router = Router();

function withOperatorAuth(handler) {
  return async (request, env) => {
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

router.get("/api/fake-invoice", (request, env) => {
  const url = new URL(request.url);
  const amountMsat = parseInt(url.searchParams.get("amount"), 10);
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    return errorResponse("amount must be a positive integer (millisatoshis)", 400);
  }
  try {
    const invoice = generateFakeBolt11(amountMsat);
    return jsonResponse({ pr: invoice });
  } catch (err) {
    logger.error("Fake invoice generation failed", { error: err.message });
    return errorResponse("Internal error", 500);
  }
});
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
router.post("/operator/logout", (request, env) => handleOperatorLogout(request, env));
router.get("/operator", withOperatorAuth(() => redirect("/operator/pos")));
router.get("/operator/topup", withOperatorAuth((request, env) => handleTopupPage(request, env)));
router.post("/operator/topup/apply", withOperatorAuth((request, env, session) => handleTopupApply(request, env, session)));
router.get("/operator/refund", withOperatorAuth((request, env) => handleRefundPage(request, env)));
router.post("/operator/refund/apply", withOperatorAuth((request, env, session) => handleRefundApply(request, env, session)));
router.post("/api/balance-check", (request, env) => handleBalanceCheck(request, env));

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
router.get("/experimental/bulkwipe", withOperatorAuth((request, env) => handleBulkWipePage(request, env)));
router.get("/experimental/analytics", withOperatorAuth((request) => handleAnalyticsPage(request)));
router.get("/experimental/analytics/data", withOperatorAuth((request, env) => handleAnalyticsData(request, env)));
router.get("/api/keys", withOperatorAuth((request, env) => handleGetKeys(request, env)));
router.post("/api/keys", withOperatorAuth((request, env) => handleGetKeys(request, env)));
router.all("/api/v1/pull-payments/:pullPaymentId/boltcards", withOperatorAuth((request, env) => fetchBoltCardKeys(request, env)));
router.get("/api/bulk-wipe-keys", withOperatorAuth((request, env) => handleBulkWipeKeys(request, env)));
router.post("/api/bulk-wipe-keys", withOperatorAuth((request, env) => handleBulkWipeKeys(request, env)));
router.get("/identity", (request) => handleIdentityPage(request));

// 302 redirects from short paths to /experimental/
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
  if (searchParams.has("p") && searchParams.has("c")) {
    return handleLnurlw(request, env);
  }
  return handleLoginPage(request);
});
router.all("*", (request) => {
  const pathname = new URL(request.url).pathname;
  const noisePaths = ["/favicon.ico", "/robots.txt", "/.well-known/", "/apple-touch-icon"];
  const isNoise = noisePaths.some(p => pathname.startsWith(p));
  if (isNoise) {
    logger.debug("Request for well-known static path", { pathname, method: request.method });
  } else {
    logger.warn("Route not found", { pathname, method: request.method });
  }
    return errorResponse("Not found", 404);
});

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function withSecurityHeaders(response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// Export handleRequest for tests
export async function handleRequest(request, env) {
  return router.fetch(request, env);
}

export { CardReplayDO } from "./durableObjects/CardReplayDO.js";

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID().slice(0, REQUEST_ID_LENGTH);
    const startTime = Date.now();
    const url = new URL(request.url);

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

      const response = await router.fetch(request, env);
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-Request-Id", requestId);
      logger.info("Request completed", { requestId, status: response.status, duration: Date.now() - startTime, pathname: url.pathname });
      return withSecurityHeaders(response);
    } catch (error) {
      logger.error("Unhandled request error", { requestId, error: error.message, url: request.url, duration: Date.now() - startTime });
      return withSecurityHeaders(jsonResponse({ status: "ERROR", reason: "Internal server error" }, 500));
    }
  },
};
