// index.js
import { Router } from "itty-router";
import { extractUIDAndCounter, validate_cmac } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { fetchBoltCardKeys } from "./handlers/fetchBoltCardKeys.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { constructWithdrawResponse } from "./handlers/withdrawHandler.js";
import { constructPayRequest, handleLnurlPayCallback } from "./handlers/lnurlPayHandler.js";
import handleNfc from "./handlers/handleNfc.js";
import { getUidConfig } from "./getUidConfig.js";
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
import { hexToBytes } from "./cryptoutils.js";
import { getDeterministicKeys } from "./keygenerator.js";
import { generateFakeBolt11 } from "./utils/bolt11.js";
import { logger } from "./utils/logger.js";
import { jsonResponse, errorResponse } from "./utils/responses.js";
import { checkRateLimit } from "./rateLimiter.js";
import { checkReplayOnly, recordTapRead, getCardState, activateCard } from "./replayProtection.js";

const router = Router();

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
    return errorResponse(err.message, 500);
  }
});
router.get("/api/keys", (request, env) => handleGetKeys(request, env));
router.post("/api/keys", (request, env) => handleGetKeys(request, env));
router.get("/status", (request, env) => handleStatus(request, env));
router.all("/api/v1/pull-payments/:pullPaymentId/boltcards", (request, env) =>
  fetchBoltCardKeys(request, env)
);
router.all("/boltcards/api/v1/lnurl/cb*", (request, env) => handleLnurlpPayment(request, env));
router.get("/2fa", (request, env) => handleTwoFactor(request, env));
router.get("/login", (request) => handleLoginPage(request));
router.post("/login", (request, env) => handleLoginVerify(request, env));
router.get("/pos", (request) => handlePosPage(request));
router.post("/activate/form", (request, env) => handleActivateCardSubmit(request, env));
router.get("/lnurlp/cb", (request, env) => handleLnurlPayCallback(request, env));
router.get("/api/bulk-wipe-keys", (request, env) => handleBulkWipeKeys(request, env));

// /experimental/ aliases for operator tools
router.get("/experimental/nfc", () => handleNfc());
router.get("/experimental/activate", (request, env) => handleActivatePage(request, env));
router.get("/experimental/activate/form", () => handleActivateForm());
router.post("/experimental/activate/form", (request, env) => handleActivateCardSubmit(request, env));
router.get("/experimental/wipe", (request, env) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const baseUrl = `${url.protocol}//${url.host}`;
  if (uid) return handleReset(uid, env, baseUrl);
  return handleWipePage(request, env);
});
router.get("/experimental/bulkwipe", (request) => handleBulkWipePage(request));
router.get("/experimental/analytics", (request) => handleAnalyticsPage(request));
router.get("/experimental/analytics/data", (request, env) => handleAnalyticsData(request, env));

// 301 redirects from old paths to /experimental/
router.get("/nfc", () => Response.redirect("/experimental/nfc", 301));
router.get("/activate", () => Response.redirect("/experimental/activate", 301));
router.get("/activate/form", () => Response.redirect("/experimental/activate/form", 301));
router.post("/activate/form", (request, env) => handleActivateCardSubmit(request, env));
router.get("/wipe", (request, env) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  if (uid) return handleReset(uid, env, `${url.protocol}//${url.host}`);
  return Response.redirect("/experimental/wipe", 301);
});
router.get("/bulkwipe", () => Response.redirect("/experimental/bulkwipe", 301));
router.get("/analytics", () => Response.redirect("/experimental/analytics", 301));
router.get("/analytics/data", (request, env) => handleAnalyticsData(request, env));
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
  return new Response("Not found", { status: 404 });
});

async function detectCardVersion(uidHex, ctr, cHex, env, latestVersion) {
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const minVersion = Math.max(1, latestVersion - 10);

  for (let v = latestVersion; v >= minVersion; v--) {
    const keys = await getDeterministicKeys(uidHex, env, v);
    const k2Bytes = hexToBytes(keys.k2);
    const result = validate_cmac(uidBytes, ctrBytes, cHex, k2Bytes);
    if (result.cmac_validated) {
      return v;
    }
  }
  return null;
}

async function checkAndRejectReplay(env, uidHex, counterValue) {
  const replayResult = await checkReplayOnly(env, uidHex, counterValue);
  if (!replayResult.accepted) {
    logger.warn("Counter replay detected", {
      uidHex,
      counterValue,
      lastCounter: replayResult.lastCounter,
    });
    return errorResponse(replayResult.reason || "Counter replay detected — tap rejected");
  }
  return null;
}

async function handleLnurlw(request, env) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    logger.error("Missing required parameters", { pHex: !!pHex, cHex: !!cHex });
    return errorResponse("Missing required parameters: p and c are required");
  }

  logger.trace("LNURLW verification request", {
    hasP: Boolean(pHex),
    hasC: Boolean(cHex),
  });

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.error("Failed to extract UID and counter", { error: decryption.error });
    return errorResponse(decryption.error);
  }

  const { uidHex, ctr } = decryption;

  if (!uidHex) {
    logger.error("UID is undefined after decryption", { pHex, cHex });
    return errorResponse("Failed to extract UID from payload");
  }

  const counterValue = parseInt(ctr, 16);

  logger.info("LNURLW decrypted", { uidHex, counterValue });

  // Card lifecycle state check
  const cardState = await getCardState(env, uidHex);

  if (cardState.state === "terminated") {
    return errorResponse("Card has been terminated. Re-activate to use.", 403);
  }

  let activeVersion;

  if (cardState.state === "keys_delivered") {
    activeVersion = await detectCardVersion(uidHex, ctr, cHex, env, cardState.latest_issued_version);
    if (activeVersion === null) {
      return errorResponse("Unable to verify card. Version mismatch.", 403);
    }
    await activateCard(env, uidHex, activeVersion);
  } else if (cardState.state === "active") {
    activeVersion = cardState.active_version || 1;
  } else {
    // state === "new" — legacy card created before lifecycle feature
    activeVersion = 1;
  }

  const config = await getUidConfig(uidHex, env, activeVersion);
  logger.info("Card config loaded", {
    uidHex,
    paymentMethod: config?.payment_method,
    cardState: cardState.state,
    activeVersion,
  });

  if (!config) {
    logger.error("UID not found in configuration", { uidHex });
    return errorResponse("UID not found in config");
  }

  const proxyRelayMode = config.payment_method === "proxy" && !!config.proxy?.baseurl;
  const hasK2 = typeof config.K2 === "string" && config.K2.length > 0;

  let cmac_validated = false;
  let cmac_error = null;

  if (hasK2) {
    ({ cmac_validated, cmac_error } = validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(config.K2)
    ));
  } else if (proxyRelayMode) {
    cmac_error = "CMAC validation deferred to downstream backend";
    logger.info("Proxy relay mode: CMAC deferred", { uidHex });
  } else {
    logger.error("K2 missing for payment method requiring local verification", {
      uidHex,
      paymentMethod: config.payment_method,
    });
    return errorResponse("K2 key not available for local CMAC validation");
  }

  if (hasK2 && !cmac_validated) {
    logger.warn(`CMAC validation failed: ${cmac_error || "CMAC validation failed."}`);
    return errorResponse(cmac_error || "CMAC validation failed");
  }

  if (proxyRelayMode) {
    try {
      const replayError = await checkAndRejectReplay(env, uidHex, counterValue);
      if (replayError) return replayError;
    } catch (error) {
      logger.error("Replay protection check failed", {
        uidHex,
        counterValue,
        error: error.message,
      });
      return errorResponse("Replay protection unavailable", 500);
    }

    logger.info("LNURLW request accepted", { uidHex, counterValue });
    await recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    });
    return handleProxy(request, uidHex, pHex, cHex, config.proxy.baseurl, {
      cmacValidated: cmac_validated,
      validationDeferred: !hasK2,
    });
  }

  if (config.payment_method === "lnurlpay") {
    const baseUrl = `${url.protocol}//${url.host}`;
    await recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    });
    return jsonResponse(constructPayRequest(uidHex, pHex, cHex, counterValue, baseUrl, config));
  }

  if (config.payment_method === "clnrest" || config.payment_method === "fakewallet") {
    try {
      const replayError = await checkAndRejectReplay(env, uidHex, counterValue);
      if (replayError) return replayError;
    } catch (error) {
      logger.error("Replay protection check failed", {
        uidHex,
        counterValue,
        error: error.message,
      });
      return errorResponse("Replay protection unavailable", 500);
    }

    logger.info("LNURLW request accepted", { uidHex, counterValue });
    await recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    });
    const baseUrl = `${url.protocol}//${url.host}`;
    const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated, baseUrl, config.payment_method);
    if (responsePayload.status === "ERROR") return errorResponse(responsePayload.reason);
    return jsonResponse(responsePayload);
  }

  logger.error("Unsupported payment method", { uidHex, paymentMethod: config.payment_method });
  return errorResponse(`Unsupported payment method: ${config.payment_method}`);
}

// Export handleRequest for tests
export async function handleRequest(request, env) {
  return router.fetch(request, env);
}

export { CardReplayDO } from "./durableObjects/CardReplayDO.js";

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID().slice(0, 8);
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
        return response;
      }

      const response = await router.fetch(request, env);
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-Request-Id", requestId);
      logger.info("Request completed", { requestId, status: response.status, duration: Date.now() - startTime, pathname: url.pathname });
      return response;
    } catch (error) {
      logger.error("Unhandled request error", { requestId, error: error.message, url: request.url, duration: Date.now() - startTime });
      return jsonResponse({ status: "ERROR", reason: "Internal server error" }, 500);
    }
  },
};
