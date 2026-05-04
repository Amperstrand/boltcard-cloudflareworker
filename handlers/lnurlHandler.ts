import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { CLN_REST_PAY_PATH, PAYMENT_METHOD, UID_VALIDATION_MSG } from "../utils/constants.js";
import { recordTap, updateTapStatus, debitCard, claimTap } from "../replayProtection.js";
import { decodeBolt11Amount } from "../utils/bolt11.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";

export async function handleLnurlpPayment(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lnurlpBase = "/boltcards/api/v1/lnurl/cb";
    
    let p: string | undefined;
    let c: string | undefined;

    if (request.method === "POST") {
      return errorResponse("Method Not Allowed", 405);
    } else if (request.method === "GET") {
      const extra: string[] = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
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
        p = k1Params.get("p") || undefined;
        c = k1Params.get("c") || undefined;
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

      const auth: any = await resolveCardIdentity(p, c, env, { context: "lnurl-callback" });
      if (!auth.ok) {
        return jsonResponse({ status: "ERROR", reason: auth.error }, auth.status);
      }

      const normalizedUidHex: string = auth.uidHex.toLowerCase();
      const counterValue: number = auth.counterValue;

      const amountMsat: number | null = explicitAmount !== null ? parseInt(explicitAmount, 10) : decodeBolt11Amount(invoice!);
      if (amountMsat !== null && amountMsat !== undefined && (isNaN(amountMsat) || amountMsat <= 0)) {
        return jsonResponse({ status: "ERROR", reason: "Invalid amount" }, 400);
      }

      try {
        const tapResult: any = await recordTap(env, normalizedUidHex, counterValue, {
          bolt11: invoice ?? undefined,
          amountMsat: amountMsat ?? undefined,
          userAgent: request.headers.get("user-agent") || undefined,
          requestUrl: request.url,
        });
        if (!tapResult.accepted) {
          const claim: any = await claimTap(env, normalizedUidHex, counterValue, {
            bolt11: invoice ?? undefined,
            amountMsat: amountMsat ?? undefined,
          });
          if (!claim.claimed) {
            logger.warn("Callback replay detected — tap already claimed", {
              uidHex: normalizedUidHex,
              counterValue,
              reason: claim.reason,
            });
            return jsonResponse({ status: "ERROR", reason: "Counter already used — possible replay" }, 409);
          }
        }
      } catch (error: unknown) {
        logger.error("Tap recording failed", { uidHex: normalizedUidHex, counterValue, error: getErrorMessage(error) });
        return errorResponse("Replay protection unavailable", 500);
      }

      const withdrawalResponse: Response = await processWithdrawalPayment(normalizedUidHex, invoice || null, env, counterValue, explicitAmount ? parseInt(explicitAmount, 10) : undefined, auth.config);

      if (withdrawalResponse.status === 200 || withdrawalResponse.status === 201) {
        await updateTapStatus(env, normalizedUidHex, counterValue, "completed").catch((e: any) => logger.warn("Failed to update tap status to completed", { uidHex: normalizedUidHex, error: getErrorMessage(e) }));
      } else {
        await updateTapStatus(env, normalizedUidHex, counterValue, "failed").catch((e: any) => logger.warn("Failed to update tap status to failed", { uidHex: normalizedUidHex, error: getErrorMessage(e) }));
      }
      
      if (withdrawalResponse instanceof Response) {
        return withdrawalResponse;
      }
      
      logger.error("processWithdrawalPayment returned unexpected value", { uidHex: normalizedUidHex });
      return errorResponse("Payment processing failed", 500);
    }
  } catch (err: unknown) {
    logger.error("Error processing LNURL withdraw request", { error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }

  return errorResponse("Internal error", 500);
}

async function processWithdrawalPayment(rawUid: string, pr: string | null, env: Env, counterValue: number, explicitAmount: number | undefined, config: any): Promise<Response> {
  if (!rawUid) {
    logger.error("Received undefined UID in processWithdrawalPayment");
    return jsonResponse({ status: "ERROR", reason: UID_VALIDATION_MSG }, 400);
  }

  const normalizedUid = rawUid.toLowerCase();

  if (!config) {
    logger.error("No configuration found for UID", { uid: normalizedUid });
    return jsonResponse({ status: "ERROR", reason: "UID configuration not found" }, 404);
  }

  if (config.payment_method === PAYMENT_METHOD.FAKEWALLET) {
    const amount: number = explicitAmount != null ? explicitAmount : (decodeBolt11Amount(pr ?? "") || 0);
    let result: any;
    try {
      result = await debitCard(env, normalizedUid, counterValue, amount, `Payment: ${amount} units`);
    } catch (error: unknown) {
      logger.error("Fakewallet debit threw", { uid: normalizedUid, amount, error: getErrorMessage(error) });
      return jsonResponse({ status: "ERROR", reason: "Debit failed" }, 500);
    }
    if (result.ok) {
      logger.info("Fakewallet payment processed", { uid: normalizedUid, amount, balance: result.balance });
      return jsonResponse({ status: "OK", message: "Payment processed", balance: result.balance }, 200);
    }
    logger.error("Fakewallet debit failed", { uid: normalizedUid, amount, reason: result.reason });
    return jsonResponse({ status: "ERROR", reason: result.reason || "Debit failed" }, 500);
  }

  if (config.payment_method === PAYMENT_METHOD.CLNREST) {
    if (!config.clnrest || !config.clnrest.rune) {
      logger.error("Missing CLN REST configuration or rune", { uid: normalizedUid });
      return jsonResponse({ status: "ERROR", reason: "Invalid CLN REST configuration" }, 400);
    }

    try {
      const clnrest: any = config.clnrest;
      const clnrest_endpoint = `${clnrest.host}`;

      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Rune", clnrest.rune);

      const requestBody = JSON.stringify({ bolt11: pr });
      logger.info("Calling CLN REST pay endpoint", {
        uid: normalizedUid,
        endpoint: `${clnrest_endpoint}/v1/pay`,
      });

      const response = await fetch(clnrest_endpoint + CLN_REST_PAY_PATH, {
        method: "POST",
        headers,
        body: requestBody,
      });

      const responseBody: any = await response.json();

      if (response.status === 201) {
        if (responseBody.status === "complete") {
          logger.info("CLN payment complete", { uid: normalizedUid, status: responseBody.status });
          return jsonResponse({ status: "OK", message: "Payment processed successfully" }, 200);
        }
        logger.warn("CLN payment not complete", { uid: normalizedUid, status: responseBody.status });
        return jsonResponse({ status: "ERROR", reason: "Payment not completed" }, 202);
      }

      logger.error("CLN REST error", { uid: normalizedUid, status: response.status, body: JSON.stringify(responseBody) });
      return jsonResponse({ status: "ERROR", reason: `Payment failed with status ${response.status}` }, response.status);
    } catch (error: unknown) {
      logger.error("CLN REST pay request failed", { uid: normalizedUid, error: getErrorMessage(error) });
      return jsonResponse({ status: "ERROR", reason: "Payment request failed" }, 500);
    }
  }

  logger.error("Unsupported payment method", { uid: normalizedUid, paymentMethod: config.payment_method });
  return jsonResponse({ status: "ERROR", reason: `Unsupported payment method: ${config.payment_method}` }, 400);
}
