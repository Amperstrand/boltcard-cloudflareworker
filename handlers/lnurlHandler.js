import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";
import { logger } from "../utils/logger.js";
import { jsonResponse } from "../utils/responses.js";
import { recordTap, updateTapStatus } from "../replayProtection.js";
import { decodeBolt11Amount } from "../utils/bolt11.js";

// Per-isolate counter for fakewallet test mode (alternates success/failure).
// Resets on isolate eviction — not suitable for production payment logic.
let fakewalletCounter = 0;

export async function handleLnurlpPayment(request, env) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lnurlpBase = "/boltcards/api/v1/lnurl/cb";
    
    let p, c, json;

    if (request.method === "POST") {
      json = await request.json();
      logger.debug("Received LNURL callback POST", {
        pathname,
        hasK1: Boolean(json?.k1),
        hasInvoice: Boolean(json?.invoice),
        hasAmount: Boolean(json?.amount),
      });

      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
        if (extra.length >= 1) {
          p = extra[0];
          if (!json.k1) {
            return jsonResponse({ status: "ERROR", reason: "Missing k1 parameter for c value" }, 400);
          }
          c = json.k1;
        } else {
          if (!json.k1) {
            return jsonResponse({ status: "ERROR", reason: "Missing k1 parameter" }, 400);
          }
          const k1Params = new URLSearchParams(json.k1);
          p = k1Params.get("p");
          c = k1Params.get("c");
          if (!p || !c) {
            return jsonResponse({ status: "ERROR", reason: "Invalid k1 format, missing p or c" }, 400);
          }
        }

      logger.trace("Parsed LNURL callback POST params", {
        hasP: Boolean(p),
        hasC: Boolean(c),
      });
      // Optionally, if you want to support POST-based withdrawal processing,
      // you can call processWithdrawalPayment here.
      // For now, the POST branch only logs the request.
      return jsonResponse({ status: "200", message: "POST received" }, 200);
    } else if (request.method === "GET") {
      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
      if (extra.length >= 1) {
        p = extra[0];
      }

      const params = url.searchParams;
      const k1 = params.get("k1");
      if (!k1) {
        return jsonResponse({ status: "ERROR", reason: "Missing k1 parameter in query string" }, 400);
      }

      if (!p) {
        const k1Params = new URLSearchParams(k1);
        p = k1Params.get("p");
        c = k1Params.get("c");
        if (!p || !c) {
          return jsonResponse({ status: "ERROR", reason: "Invalid k1 format, missing p or c" }, 400);
        }
      } else {
        c = k1;
      }

      logger.trace("Parsed LNURL callback GET params", {
        hasP: Boolean(p),
        hasC: Boolean(c),
      });

      const invoice = params.get("pr");
      if (!invoice) {
        return jsonResponse({ status: "ERROR", reason: "Missing invoice parameter in query string" }, 400);
      }

      // Step 1: Decrypt PICCENCData to recover UID and SDMReadCtr
      const decryption = extractUIDAndCounter(p, env);
      if (!decryption.success) {
        return jsonResponse({ status: "ERROR", reason: decryption.error }, 400);
      }

      if (!decryption.uidHex) {
        return jsonResponse({ status: "ERROR", reason: "Failed to decode UID" }, 400);
      }

      const normalizedUidHex = decryption.uidHex.toLowerCase();

      const config = await getUidConfig(normalizedUidHex, env);
      if (!config || !config.K2) {
        return jsonResponse({ status: "ERROR", reason: "Card configuration not found or missing K2 for local verification" }, 400);
      }

      // Step 3: Validate CMAC with the card's K2 key
      const uidBytes = hexToBytes(decryption.uidHex);
      const ctrBytes = hexToBytes(decryption.ctr);
      const k2Bytes = hexToBytes(config.K2);
      const { cmac_validated, cmac_error } = validate_cmac(uidBytes, ctrBytes, c, k2Bytes);
      if (!cmac_validated) {
        return jsonResponse({ status: "ERROR", reason: cmac_error || "CMAC validation failed" }, 400);
      }

      const counterValue = parseInt(decryption.ctr, 16);

      try {
        const tapResult = await recordTap(env, normalizedUidHex, counterValue, {
          bolt11: invoice,
          amountMsat: decodeBolt11Amount(invoice),
          userAgent: request.headers.get("User-Agent") || null,
          requestUrl: request.url,
        });
        if (!tapResult.accepted) {
          logger.warn("Tap replay detected in callback", { uidHex: normalizedUidHex, counterValue, lastCounter: tapResult.lastCounter });
          return jsonResponse({ status: "ERROR", reason: tapResult.reason || "Counter replay detected — tap rejected" }, 409);
        }
      } catch (error) {
        logger.error("Tap recording failed", { uidHex: normalizedUidHex, counterValue, error: error.message });
        return jsonResponse({ status: "ERROR", reason: "Tap recording unavailable" }, 500);
      }

      const withdrawalResponse = await processWithdrawalPayment(normalizedUidHex, invoice, env);

      if (withdrawalResponse.status === 200 || withdrawalResponse.status === 201) {
        await updateTapStatus(env, normalizedUidHex, counterValue, "completed").catch(e => logger.warn("Failed to update tap status to completed", { uidHex: normalizedUidHex, error: e.message }));
      } else {
        await updateTapStatus(env, normalizedUidHex, counterValue, "failed").catch(e => logger.warn("Failed to update tap status to failed", { uidHex: normalizedUidHex, error: e.message }));
      }
      
      // If processWithdrawalPayment returns a Response, forward it.
      if (withdrawalResponse instanceof Response) {
        return withdrawalResponse;
      }
      
      // Fallback if no response was provided from processWithdrawalPayment.
      return jsonResponse({ status: "-1" }, 200);
    }
  } catch (err) {
    logger.error("Error processing LNURL withdraw request", { error: err.message });
    return jsonResponse({ status: "ERROR", reason: err.message }, 500);
  }
}

export async function processWithdrawalPayment(uid, pr, env) {
  if (!uid) {
    logger.error("Received undefined UID in processWithdrawalPayment");
    return jsonResponse({ status: "ERROR", reason: "Invalid UID" }, 400);
  }

  logger.debug("Processing LNURL payment", { uid });

  uid = uid.toLowerCase(); // Ensure UID is in lowercase for lookup
  const config = await getUidConfig(uid, env);
  logger.trace("Loaded payment config", {
    uid,
    paymentMethod: config?.payment_method,
    hasConfig: Boolean(config),
  });

  if (!config) {
    logger.error("No configuration found for UID", { uid });
    return jsonResponse({ status: "ERROR", reason: "UID configuration not found" }, 400);
  }

  // Handle fakewallet payment method with alternating failure/success
  if (config.payment_method === "fakewallet") {
    fakewalletCounter++;
    if (fakewalletCounter % 2 === 0) {
      logger.info("Fakewallet simulated failure", { uid });
      return jsonResponse({ status: "ERROR", reason: "Simulated fakewallet failure" }, 400);
    } else {
      logger.info("Fakewallet simulated success", { uid });
      return jsonResponse({ status: "OK", message: "Payment processed successfully by fakewallet" }, 200);
    }
  }

  // Handle CLN REST payment method
  // CLN REST API: POST /v1/pay with {bolt11: invoice}, Rune auth header
  // Success: HTTP 201 with JSON body containing status "complete" or "pending"
  // See: https://docs.corelightning.org/reference/pay
  // See: https://docs.corelightning.org/reference/post_rpc_method_resource
  if (config.payment_method === "clnrest") {
    if (!config.clnrest || !config.clnrest.rune) {
      logger.error("Missing CLN REST configuration or rune", { uid });
      return jsonResponse({ status: "ERROR", reason: "Invalid CLN REST configuration" }, 400);
    }

    try {
      const clnrest = config.clnrest;
      const clnrest_endpoint = `${clnrest.host}`;

      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Rune", clnrest.rune);

      const requestBody = JSON.stringify({ bolt11: pr });
      logger.info("Calling CLN REST pay endpoint", {
        uid,
        endpoint: `${clnrest_endpoint}/v1/pay`,
      });

      const response = await fetch(clnrest_endpoint + "/v1/pay", {
        method: "POST",
        headers,
        body: requestBody,
      });

      const responseBody = await response.json();

      if (response.status === 201) {
        if (responseBody.status === "complete") {
          logger.info("CLN payment complete", { uid, status: responseBody.status });
          return jsonResponse({ status: "OK", message: "Payment processed successfully" }, 200);
        }
        logger.warn("CLN payment not complete", { uid, status: responseBody.status });
        return jsonResponse({ status: "ERROR", reason: `Payment status: ${responseBody.status}` }, 202);
      }

      const errorReason = `${response.status}: ${JSON.stringify(responseBody)}`;
      logger.error("CLN REST error", { uid, status: response.status });
      return jsonResponse({ status: "ERROR", reason: errorReason }, response.status);
    } catch (error) {
      logger.error("CLN REST pay request failed", { uid, error: error.message });
      return jsonResponse({ status: "ERROR", reason: `CLN REST Pay Request Failed: ${error.message}` }, 500);
    }
  }

  // If the payment_method is neither fakewallet nor clnrest, return an error.
  logger.error("Unsupported payment method", { uid, paymentMethod: config.payment_method });
  return jsonResponse({ status: "ERROR", reason: `Unsupported payment method: ${config.payment_method}` }, 400);
}
