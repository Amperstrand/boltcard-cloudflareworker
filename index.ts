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
import { handleCardPage, handleCardInfo, handleCardLock, handleCardReactivate } from "./handlers/cardDashboardHandler.js";
import { handlePosPage } from "./handlers/posHandler.js";
import { handleWipePage } from "./handlers/wipePageHandler.js";
import { handleGetKeys } from "./handlers/getKeysHandler.js";
import { handleBulkWipeKeys } from "./handlers/bulkWipeHandler.js";
import { handleBulkWipePage } from "./handlers/bulkWipePageHandler.js";
import { handleAnalyticsPage, handleAnalyticsData } from "./handlers/analyticsHandler.js";
import { generateFakeBolt11 } from "./utils/bolt11.js";
import { encodePaytoUri } from "./utils/fiat-rails/payto.js";
import { encodeUpiUri } from "./utils/fiat-rails/upi.js";
import { encodeSpayd } from "./utils/fiat-rails/spayd.js";
import { convertSatsToCurrency } from "./utils/fiat-rails/currency.js";
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
import { handleCardAuditPage, handleCardAuditData, handleIndexRepair } from "./handlers/cardAuditHandler.js";
import { handleCardBatchAction } from "./handlers/cardBatchHandler.js";
import { handleDecodePage, handleDecodeApi } from "./handlers/bolt11DecodeHandler.js";

const router = Router();

function withOperatorAuth(handler: (request: any, env: any, session?: any) => any) {
  return async (request: any, env: any) => {
    const auth = requireOperator(request, env);
    if (!auth.authorized) return (auth as any).response;

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

router.get("/api/fake-invoice", async (request: any, env: any) => {
  const url = new URL(request.url);
  const amountMsat = parseInt(url.searchParams.get("amount") ?? "", 10);
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    return errorResponse("amount must be a positive integer (millisatoshis)", 400);
  }
  try {
    const rail = url.searchParams.get("rail") || env.FAKEWALLET_DEFAULT_RAIL || "bolt11";
    let description: string | undefined;

    if (rail === "payto") {
      const currency = (url.searchParams.get("currency") || env.FAKEWALLET_CURRENCY || "EUR").toUpperCase();
      const iban = url.searchParams.get("iban") || env.FAKEWALLET_IBAN || "GB33BUKB20201555555555";
      const accountName = url.searchParams.get("accountName") || env.FAKEWALLET_ACCOUNT_NAME || "FakeWallet";

      let fiatAmount: number;
      try {
        fiatAmount = await convertSatsToCurrency(amountMsat / 1000, currency);
      } catch {
        fiatAmount = 0;
      }

      const message = `${Math.round(amountMsat / 1000)}sat@${new Date().toISOString().split("T")[0]}`;
      const execDate = new Date(Date.now() + 3600000).toISOString().split("T")[0];

      const paytoUri = encodePaytoUri({
        iban,
        amount: fiatAmount,
        currency,
        receiverName: accountName,
        message,
        execDate,
      });

      description = `PAYTO:${paytoUri}`;
    } else if (rail === "upi") {
      const pa = url.searchParams.get("pa") || env.FAKEWALLET_UPI_PA || "merchant@upi";
      const pn = url.searchParams.get("pn") || env.FAKEWALLET_UPI_PN || "FakeWallet";
      const currency = (url.searchParams.get("currency") || "INR").toUpperCase();

      let fiatAmount: number;
      try {
        fiatAmount = await convertSatsToCurrency(amountMsat / 1000, currency);
      } catch {
        fiatAmount = 0;
      }

      description = encodeUpiUri({
        pa,
        am: fiatAmount,
        cu: currency,
        pn,
        tn: `${Math.round(amountMsat / 1000)}sat@${new Date().toISOString().split("T")[0]}`,
      });
    } else if (rail === "spayd") {
      const acc = url.searchParams.get("acc") || env.FAKEWALLET_SPAYD_ACC || "CZ000000-0000000000";
      const currency = (url.searchParams.get("currency") || env.FAKEWALLET_CURRENCY || "CZK").toUpperCase();

      let fiatAmount: number;
      try {
        fiatAmount = await convertSatsToCurrency(amountMsat / 1000, currency);
      } catch {
        fiatAmount = 0;
      }

      description = encodeSpayd(
        {
          ACC: acc,
          AM: fiatAmount.toFixed(2),
          CC: currency,
          MSG: `${Math.round(amountMsat / 1000)}sat`,
          DT: new Date(Date.now() + 3600000).toISOString().split("T")[0].replace(/-/g, ""),
        },
        { includeCrc32: true, sortAttributes: true }
      );
    }

    const invoice = generateFakeBolt11(amountMsat, { description });
    return jsonResponse({ pr: invoice, ...(description ? { description } : {}) });
  } catch (err: any) {
    logger.error("Fake invoice generation failed", { error: err.message });
    return errorResponse("Internal error", 500);
  }
});
router.get("/status", (request: any, env: any) => handleStatus(request, env));
router.all("/boltcards/api/v1/lnurl/cb*", (request: any, env: any) => handleLnurlpPayment(request, env));
router.get("/2fa", (request: any, env: any) => handleTwoFactor(request, env));
router.get("/login", (request: any) => handleLoginPage(request));
router.post("/login", (request: any, env: any) => handleLoginVerify(request, env));
router.get("/pos", () => redirect("/operator/pos"));
router.get("/operator/pos", withOperatorAuth((request: any, env: any) => handlePosPage(request, env)));
router.post("/operator/pos/charge", withOperatorAuth((request: any, env: any, session: any) => handlePosCharge(request, env, session)));
router.get("/operator/pos/menu", withOperatorAuth((request: any, env: any) => handleMenuEditorPage(request, env)));
router.put("/operator/pos/menu", withOperatorAuth((request: any, env: any) => handleMenuPut(request, env)));
router.get("/api/pos/menu", withOperatorAuth((request: any, env: any) => handleMenuGet(request, env)));
router.get("/api/receipt/:txnId", withOperatorAuth((request: any, env: any) => handleReceipt(request, env)));
router.post("/activate/form", withOperatorAuth((request: any, env: any) => handleActivateCardSubmit(request, env)));
router.get("/lnurlp/cb", (request: any, env: any) => handleLnurlPayCallback(request, env));
router.get("/api/verify-identity", (request: any, env: any) => handleIdentityVerify(request, env));
router.post("/api/identity/profile", (request: any, env: any) => handleIdentityProfileUpdate(request, env));
router.get("/operator/login", (request: any) => handleOperatorLoginPage(request));
router.post("/operator/login", (request: any, env: any) => handleOperatorLogin(request, env));
router.post("/api/identify-card", withOperatorAuth((request: any, env: any) => handleIdentifyCard(request, env)));
router.post("/api/identify-issuer-key", withOperatorAuth((request: any, env: any) => handleIdentifyIssuerKey(request, env)));
router.post("/operator/logout", (request: any, env: any) => handleOperatorLogout(request, env));
router.get("/operator", withOperatorAuth(() => redirect("/operator/pos")));
router.get("/operator/cards", withOperatorAuth((request: any, env: any) => handleCardAuditPage(request, env)));
router.get("/operator/cards/data", withOperatorAuth((request: any, env: any) => handleCardAuditData(request, env)));
router.post("/operator/cards/batch", withOperatorAuth((request: any, env: any, session: any) => handleCardBatchAction(request, env, session)));
router.post("/operator/cards/repair", withOperatorAuth((request: any, env: any) => handleIndexRepair(request, env)));
router.get("/operator/topup", withOperatorAuth((request: any, env: any) => handleTopupPage(request, env)));
router.post("/operator/topup/apply", withOperatorAuth((request: any, env: any, session: any) => handleTopupApply(request, env, session)));
router.get("/operator/refund", withOperatorAuth((request: any, env: any) => handleRefundPage(request, env)));
router.post("/operator/refund/apply", withOperatorAuth((request: any, env: any, session: any) => handleRefundApply(request, env, session)));
router.post("/api/balance-check", (request: any, env: any) => handleBalanceCheck(request, env));

router.get("/decode", (request: any) => handleDecodePage(request));
router.get("/api/decode", (request: any) => handleDecodeApi(request));

router.get("/debug", withOperatorAuth((request: any) => handleDebugPage(request)));
router.get("/experimental/nfc", (request: any) => {
  return redirect(new URL(request.url).origin + "/debug#console", 302);
});
router.get("/experimental/activate", withOperatorAuth((request: any, env: any) => handleActivatePage(request, env)));
router.get("/experimental/activate/form", withOperatorAuth(() => handleActivateForm()));
router.post("/experimental/activate/form", withOperatorAuth((request: any, env: any) => handleActivateCardSubmit(request, env)));
router.get("/experimental/wipe", withOperatorAuth((request: any, env: any) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  if (uid) return handleReset(uid, env, getRequestOrigin(request));
  return handleWipePage(request, env);
}));
  router.get("/experimental/bulkwipe", withOperatorAuth((request: any) => handleBulkWipePage(request)));
  router.get("/experimental/analytics", withOperatorAuth(() => handleAnalyticsPage()));
router.get("/experimental/analytics/data", withOperatorAuth((request: any, env: any) => handleAnalyticsData(request, env)));
router.get("/api/keys", withOperatorAuth((request: any, env: any) => handleGetKeys(request, env)));
router.post("/api/keys", withOperatorAuth((request: any, env: any) => handleGetKeys(request, env)));
router.all("/api/v1/pull-payments/:pullPaymentId/boltcards", withOperatorAuth((request: any, env: any) => fetchBoltCardKeys(request, env)));
  router.get("/api/bulk-wipe-keys", withOperatorAuth((request: any) => handleBulkWipeKeys(request)));
  router.post("/api/bulk-wipe-keys", withOperatorAuth((request: any) => handleBulkWipeKeys(request)));
router.get("/identity", (request: any) => handleIdentityPage(request));

router.get("/card", (request: any, env: any) => handleCardPage(request, env));
router.get("/card/info", (request: any, env: any) => handleCardInfo(request, env));
router.post("/api/card/lock", (request: any, env: any) => handleCardLock(request, env));
router.post("/api/card/reactivate", (request: any, env: any) => handleCardReactivate(request, env));

router.get("/nfc", (request: any) => {
  return redirect(new URL(request.url).origin + "/debug#console", 302);
});
router.get("/activate", (request: any) => {
  return redirect(new URL(request.url).origin + "/experimental/activate", 302);
});
router.get("/activate/form", (request: any) => {
  return redirect(new URL(request.url).origin + "/experimental/activate/form", 302);
});
router.get("/wipe", withOperatorAuth((request: any, env: any) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  if (uid) return handleReset(uid, env, getRequestOrigin(request));
  return redirect(url.origin + "/experimental/wipe", 302);
}));
router.get("/bulkwipe", (request: any) => {
  return redirect(new URL(request.url).origin + "/experimental/bulkwipe", 302);
});
router.get("/analytics", (request: any) => {
  return redirect(new URL(request.url).origin + "/experimental/analytics", 302);
});
router.get("/analytics/data", withOperatorAuth((request: any, env: any) => handleAnalyticsData(request, env)));
router.get("/favicon.ico", () => new Response(null, { status: 204 }));
router.get("/", (request: any, env: any) => {
  const { searchParams } = new URL(request.url);
  if (searchParams.has("p") && searchParams.has("c")) {
    return handleLnurlw(request, env);
  }
  return handleLoginPage(request);
});
router.all("*", (request: any) => {
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

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
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

export async function handleRequest(request: any, env: any): Promise<any> {
  return router.fetch(request, env);
}

export { CardReplayDO } from "./durableObjects/CardReplayDO.js";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
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

      env.ctx = ctx;
      const response = await router.fetch(request, env, ctx);
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-Request-Id", requestId);
      logger.info("Request completed", { requestId, status: response.status, duration: Date.now() - startTime, pathname: url.pathname });
      return withSecurityHeaders(response);
    } catch (error: any) {
      logger.error("Unhandled request error", { requestId, error: error.message, url: request.url, duration: Date.now() - startTime });
      return withSecurityHeaders(jsonResponse({ status: "ERROR", reason: "Internal server error" }, 500));
    }
  },
};
