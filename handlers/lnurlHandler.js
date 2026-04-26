import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";
import { logger } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { recordTap, updateTapStatus, debitCard, listTaps } from "../replayProtection.js";
import { decodeBolt11Amount } from "../utils/bolt11.js";
import { PAYMENT_METHOD } from "../utils/constants.js";

export async function handleLnurlpPayment(request, env) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lnurlpBase = "/boltcards/api/v1/lnurl/cb";
    
    let p, c;

    if (request.method === "POST") {
      return errorResponse("Method Not Allowed", 405);
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
      const explicitAmount = params.get("amount");
      if (!invoice && !explicitAmount) {
        return jsonResponse({ status: "ERROR", reason: "Missing pr or amount parameter" }, 400);
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
          bolt11: invoice || null,
          amountMsat: explicitAmount !== null ? parseInt(explicitAmount, 10) : decodeBolt11Amount(invoice),
          userAgent: request.headers.get("User-Agent") || null,
          requestUrl: request.url,
        });
        if (!tapResult.accepted) {
          const existing = await listTaps(env, normalizedUidHex, 1);
          const matchingTap = existing.taps?.find(t => t.counter === counterValue);
          if (matchingTap?.bolt11) {
            logger.warn("Callback replay detected — tap already has bolt11", {
              uidHex: normalizedUidHex,
              counterValue,
            });
            return jsonResponse({ status: "ERROR", reason: "Counter already used — possible replay" }, 409);
          }
          logger.info("Tap counter already recorded in LNURLW Step 1, updating metadata in callback", {
            uidHex: normalizedUidHex,
            counterValue,
            lastCounter: tapResult.lastCounter,
          });
          await updateTapStatus(env, normalizedUidHex, counterValue, "pending", {
            bolt11: invoice || null,
            amountMsat: explicitAmount !== null ? parseInt(explicitAmount, 10) : decodeBolt11Amount(invoice),
          });
        }
      } catch (error) {
        logger.error("Tap recording failed", { uidHex: normalizedUidHex, counterValue, error: error.message });
      }

      const withdrawalResponse = await processWithdrawalPayment(normalizedUidHex, invoice || null, env, counterValue, explicitAmount ? parseInt(explicitAmount, 10) : undefined);

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
    return errorResponse("Internal error", 500);
  }
}

async function processWithdrawalPayment(uid, pr, env, counterValue, explicitAmount) {
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

  if (config.payment_method === PAYMENT_METHOD.FAKEWALLET) {
    const amount = explicitAmount != null ? explicitAmount : (decodeBolt11Amount(pr) || 0);
    const result = await debitCard(env, uid, counterValue, amount, `Payment: ${amount} units`);
    if (result.ok) {
      logger.info("Fakewallet payment processed", { uid, amount, balance: result.balance });
      return jsonResponse({ status: "OK", message: "Payment processed", balance: result.balance }, 200);
    }
    logger.error("Fakewallet debit failed", { uid, amount, reason: result.reason });
    return jsonResponse({ status: "ERROR", reason: result.reason || "Debit failed" }, 500);
  }

  // Handle CLN REST payment method
  // CLN REST API: POST /v1/pay with {bolt11: invoice}, Rune auth header
  // Success: HTTP 201 with JSON body containing status "complete" or "pending"
  // See: https://docs.corelightning.org/reference/pay
  // See: https://docs.corelightning.org/reference/post_rpc_method_resource
  if (config.payment_method === PAYMENT_METHOD.CLNREST) {
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
