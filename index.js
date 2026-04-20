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
import { handleWipePage } from "./handlers/wipePageHandler.js";
import { handleGetKeys } from "./handlers/getKeysHandler.js";
import { handleBulkWipeKeys } from "./handlers/bulkWipeHandler.js";
import { handleBulkWipePage } from "./handlers/bulkWipePageHandler.js";
import { handleAnalyticsPage, handleAnalyticsData } from "./handlers/analyticsHandler.js";
import { hexToBytes } from "./cryptoutils.js";
import { getDeterministicKeys } from "./keygenerator.js";
import { logger } from "./utils/logger.js";
import { jsonResponse } from "./utils/responses.js";
import { checkRateLimit } from "./rateLimiter.js";
import { checkReplayOnly, recordTapRead, getCardState, activateCard } from "./replayProtection.js";

const errorResponse = (reason, status = 400) =>
  jsonResponse({ status: "ERROR", reason }, status);

const router = Router();

router.get("/api/keys", (request, env) => handleGetKeys(request, env));
router.post("/api/keys", (request, env) => handleGetKeys(request, env));
router.get("/status", (request, env) => handleStatus(request, env));
router.all("/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards", (request, env) =>
  fetchBoltCardKeys(request, env)
);
router.all("/boltcards/api/v1/lnurl/cb*", (request, env) => handleLnurlpPayment(request, env));
router.get("/2fa", (request, env) => handleTwoFactor(request, env));
router.get("/login", (request) => handleLoginPage(request));
router.post("/login", (request, env) => handleLoginVerify(request, env));
router.post("/activate/form", (request, env) => handleActivateCardSubmit(request, env));
router.get("/lnurlp/cb", (request, env) => handleLnurlPayCallback(request, env));
router.get("/api/bulk-wipe-keys", (request, env) => handleBulkWipeKeys(request, env));

// /experimental/ aliases for operator tools
router.get("/experimental/nfc", () => handleNfc());
router.get("/experimental/activate", (request) => handleActivatePage(request));
router.get("/experimental/activate/form", () => handleActivateForm());
router.post("/experimental/activate/form", (request, env) => handleActivateCardSubmit(request, env));
router.get("/experimental/wipe", (request, env) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const baseUrl = `${url.protocol}//${url.host}`;
  if (uid) return handleReset(uid, env, baseUrl);
  return handleWipePage(request);
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
router.get("/", (request, env) => {
  const { searchParams } = new URL(request.url);
  if (searchParams.has("p") && searchParams.has("c")) {
    return handleLnurlw(request, env);
  }
  return handleLoginPage(request);
});
router.all("*", (request) => {
  logger.error("Route not found", { pathname: new URL(request.url).pathname, method: request.method });
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

async function handleLnurlw(request, env) {
  const { searchParams } = new URL(request.url);
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

  logger.trace("Decryption succeeded", { success: decryption.success });

  const { uidHex, ctr } = decryption;

  if (!uidHex) {
    logger.error("UID is undefined after decryption", { pHex, cHex });
    return errorResponse("Failed to extract UID from payload");
  }

  const counterValue = parseInt(ctr, 16);

  logger.trace("Extracted UID and counter", { uidHex, counterValue });

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
  logger.trace("Configuration loaded", {
    uidHex,
    hasConfig: Boolean(config),
    paymentMethod: config?.payment_method,
    hasK2: typeof config?.K2 === "string" && config.K2.length > 0,
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
    logger.info("Proxy relay mode: skipping CMAC validation locally", { uidHex });
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
      const replayResult = await checkReplayOnly(env, uidHex, counterValue);
      if (!replayResult.accepted) {
        logger.warn("Counter replay detected", {
          uidHex,
          counterValue,
          lastCounter: replayResult.lastCounter,
        });
        return errorResponse(replayResult.reason || "Counter replay detected — tap rejected");
      }
    } catch (error) {
      logger.error("Replay protection check failed", {
        uidHex,
        counterValue,
        error: error.message,
      });
      return errorResponse("Replay protection unavailable", 500);
    }

    logger.trace("LNURLW request accepted", { uidHex, counterValue });
    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    });
    return handleProxy(request, uidHex, pHex, cHex, config.proxy.baseurl, {
      cmacValidated: cmac_validated,
      validationDeferred: !hasK2,
    });
  }

  if (config.payment_method === "lnurlpay") {
    const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    });
    return jsonResponse(constructPayRequest(uidHex, pHex, cHex, counterValue, baseUrl, config));
  }

  if (config.payment_method === "clnrest" || config.payment_method === "fakewallet") {
    try {
      const replayResult = await checkReplayOnly(env, uidHex, counterValue);
      if (!replayResult.accepted) {
        logger.warn("Counter replay detected", {
          uidHex,
          counterValue,
          lastCounter: replayResult.lastCounter,
        });
        return errorResponse(replayResult.reason || "Counter replay detected — tap rejected");
      }
    } catch (error) {
      logger.error("Replay protection check failed", {
        uidHex,
        counterValue,
        error: error.message,
      });
      return errorResponse("Replay protection unavailable", 500);
    }

    logger.trace("LNURLW request accepted", { uidHex, counterValue });
    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    });
    const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
    const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated, baseUrl);
    if (responsePayload.status === "ERROR") return errorResponse(responsePayload.reason);
    return jsonResponse(responsePayload);
  }

  logger.error("Unsupported payment method", { uidHex, paymentMethod: config.payment_method });
  return errorResponse(`Unsupported payment method: ${config.payment_method}`);
}

// Export handleRequest for tests
export async function handleRequest(request, env) {
  logger.logRequest(request);
  return router.fetch(request, env);
}

export { CardReplayDO } from "./durableObjects/CardReplayDO.js";

export default {
  async fetch(request, env, ctx) {
    logger.logRequest(request);

    const { allowed, remaining, resetAt } = await checkRateLimit(request, env);
    if (!allowed) {
      const response = jsonResponse({ status: "ERROR", reason: "Rate limit exceeded" }, 429);
      response.headers.set("Retry-After", String(Math.ceil((resetAt - Date.now()) / 1000)));
      response.headers.set("X-RateLimit-Remaining", "0");
      return response;
    }

    const response = await router.fetch(request, env);
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    return response;
  },
};
