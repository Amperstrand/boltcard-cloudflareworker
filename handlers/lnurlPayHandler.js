import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";
import { logger } from "../utils/logger.js";
import { jsonResponse } from "../utils/responses.js";
import { recordTap, updateTapStatus } from "../replayProtection.js";
import { resolveLightningAddress } from "../utils/lightningAddress.js";

const POS_ADDRESS_POOL = [
  "test@walletofsatoshi.com",
  "test@zbd.gg",
  "test@bitrefill.me",
];

function pickRandomAddress(config) {
  const configured = config?.lnurlpay?.lightning_address;
  if (configured && !configured.includes("coinos")) {
    return configured;
  }
  return POS_ADDRESS_POOL[Math.floor(Math.random() * POS_ADDRESS_POOL.length)];
}

const errorResponse = (reason, status = 400) =>
  jsonResponse({ status: "ERROR", reason }, status);

export function constructPayRequest(uidHex, pHex, cHex, counterValue, baseUrl, config) {
  const host = baseUrl || "https://boltcardpoc.psbt.me";
  const callbackUrl = new URL("/lnurlp/cb", host);
  callbackUrl.searchParams.set("p", pHex);
  callbackUrl.searchParams.set("c", cHex);

  const minSendable = config?.lnurlpay?.min_sendable ?? 1000;
  const maxSendable = config?.lnurlpay?.max_sendable ?? 1000;
  const destination = pickRandomAddress(config);

  return {
    tag: "payRequest",
    callback: callbackUrl.toString(),
    minSendable,
    maxSendable,
    metadata: JSON.stringify([["text/plain", `${destination} - Order #${counterValue}`]]),
  };
}

export async function handleLnurlPayCallback(request, env) {
  try {
    const url = new URL(request.url);
    const pHex = url.searchParams.get("p");
    const cHex = url.searchParams.get("c");
    const amountParam = url.searchParams.get("amount");

    if (!pHex || !cHex) {
      logger.error("Missing LNURL-pay callback parameters", { hasP: Boolean(pHex), hasC: Boolean(cHex) });
      return errorResponse("Missing required parameters: p and c are required");
    }

    if (!amountParam) {
      return errorResponse("Missing required parameter: amount");
    }

    const amountMsat = Number(amountParam);
    if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
      return errorResponse("Invalid amount parameter");
    }

    const decryption = extractUIDAndCounter(pHex, env);
    if (!decryption.success) {
      logger.error("Failed to decrypt LNURL-pay callback payload", { error: decryption.error });
      return errorResponse(decryption.error);
    }

    const { uidHex, ctr } = decryption;
    if (!uidHex) {
      return errorResponse("Failed to extract UID from payload");
    }

    const config = await getUidConfig(uidHex, env);
    if (!config) {
      logger.error("UID not found for LNURL-pay callback", { uidHex });
      return errorResponse("UID not found in config");
    }

    if (config.payment_method !== "lnurlpay") {
      return errorResponse(`Unsupported payment method: ${config.payment_method}`);
    }

    if (!config.K2) {
      return errorResponse("K2 key not available for local CMAC validation");
    }

  const lightningAddress = pickRandomAddress(config);
  if (typeof lightningAddress !== "string" || !lightningAddress) {
    return errorResponse("No Lightning Address available");
  }

    const minSendable = config.lnurlpay?.min_sendable ?? 1000;
    const maxSendable = config.lnurlpay?.max_sendable ?? 1000;
    if (amountMsat < minSendable || amountMsat > maxSendable) {
      return errorResponse(`Amount ${amountMsat} is outside allowed range ${minSendable}-${maxSendable}`);
    }

    const { cmac_validated, cmac_error } = validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(config.K2)
    );

    if (!cmac_validated) {
      logger.warn("LNURL-pay callback CMAC validation failed", { uidHex });
      return errorResponse(cmac_error || "CMAC validation failed");
    }

    const counterValue = parseInt(ctr, 16);
    try {
      const tapResult = await recordTap(env, uidHex, counterValue, {
        amountMsat: amountMsat,
        userAgent: request.headers.get("User-Agent") || null,
        requestUrl: request.url,
      });
      if (!tapResult.accepted) {
        logger.warn("LNURL-pay callback replay detected", {
          uidHex,
          counterValue,
          lastCounter: tapResult.lastCounter,
        });
        return errorResponse(tapResult.reason || "Counter replay detected — tap rejected");
      }
    } catch (error) {
      logger.error("LNURL-pay callback tap recording failed", {
        uidHex,
        counterValue,
        error: error.message,
      });
      return errorResponse("Replay protection unavailable", 500);
    }

    const invoice = await resolveLightningAddress(lightningAddress, amountMsat);

    await updateTapStatus(env, uidHex, counterValue, invoice.pr ? "completed" : "failed").catch(e => logger.warn("Failed to update tap status", { uidHex, error: e.message }));

    return jsonResponse(invoice);
  } catch (error) {
    logger.error("Error handling LNURL-pay callback", { error: error.message });
    return errorResponse(error.message, 500);
  }
}
