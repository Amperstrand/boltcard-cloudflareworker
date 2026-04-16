// index.js
import { Router } from "itty-router";
import { extractUIDAndCounter, validate_cmac } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { fetchBoltCardKeys } from "./handlers/fetchBoltCardKeys.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { constructWithdrawResponse } from "./handlers/withdrawHandler.js";
import handleNfc from "./handlers/handleNfc.js";
import { getUidConfig } from "./getUidConfig.js";
import { handleActivateCardPage as handleActivateForm, handleActivateCardSubmit } from "./handlers/activateCardHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleActivatePage } from "./handlers/activatePageHandler.js";
import { handleWipePage } from "./handlers/wipePageHandler.js";
import { hexToBytes } from "./cryptoutils.js";
import { logger } from "./utils/logger.js";
import { checkRateLimit } from "./rateLimiter.js";
import { enforceReplayProtection } from "./replayProtection.js";

// Helper functions for responses
const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const errorResponse = (reason, status = 400) =>
  jsonResponse({ status: "ERROR", reason }, status);

const router = Router();

router.get("/nfc", () => handleNfc());
router.get("/status", (request, env) => handleStatus(request, env));
router.all("/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards", (request, env) =>
  fetchBoltCardKeys(request, env)
);
router.all("/boltcards/api/v1/lnurl/cb*", (request, env) => handleLnurlpPayment(request, env));
router.get("/activate", (request) => handleActivatePage(request));
router.get("/activate/form", () => handleActivateForm());
router.post("/activate/form", (request, env) => handleActivateCardSubmit(request, env));
router.get("/wipe", (request, env) => {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const baseUrl = `${url.protocol}//${url.host}`;
  if (uid) return handleReset(uid, env, baseUrl);
  return handleWipePage(request);
});
router.get("/", handleLnurlw);
router.all("*", (request) => {
  logger.error("Route not found", { pathname: new URL(request.url).pathname, method: request.method });
  return new Response("Not found", { status: 404 });
});

async function handleLnurlw(request, env) {
  const { searchParams } = new URL(request.url);
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    logger.error("Missing required parameters", { pHex: !!pHex, cHex: !!cHex });
    return jsonResponse({ error: "Missing required parameters: p and c are required" }, 400);
  }

  logger.debug("LNURLW Verification", { pHex, cHex });

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.error("Failed to extract UID and counter", { error: decryption.error, pHex, cHex });
    return jsonResponse({ error: decryption.error }, 400);
  }

  logger.debug("Decryption result", decryption);

  const { uidHex, ctr } = decryption;

  if (!uidHex) {
    logger.error("UID is undefined after decryption", { pHex, cHex });
    return jsonResponse({ error: "Failed to extract UID from payload" }, 400);
  }

  logger.debug("Extracted UID and counter", { uidHex, ctr });

  const config = await getUidConfig(uidHex, env);
  logger.debug("Configuration loaded", { uidHex, config });

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

  const counterValue = parseInt(ctr, 16);
  try {
    const replayResult = await enforceReplayProtection(env, uidHex, counterValue);
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

  logger.debug("Decoded UID and counter", { uidHex, ctr: parseInt(ctr, 16) });

  if (proxyRelayMode) {
    return handleProxy(request, uidHex, pHex, cHex, config.proxy.baseurl, {
      cmacValidated: cmac_validated,
      validationDeferred: !hasK2,
    });
  }

  if (config.payment_method === "clnrest" || config.payment_method === "fakewallet") {
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
      return new Response(JSON.stringify({ status: "ERROR", reason: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      });
    }

    const response = await router.fetch(request, env);
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    return response;
  },
};
