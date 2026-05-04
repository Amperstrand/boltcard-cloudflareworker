import { DEFAULT_FALLBACK_HOST, MISSING_PARAMS_MSG, PAYMENT_METHOD } from "../utils/constants.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { logger } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { recordTap, updateTapStatus } from "../replayProtection.js";
import { resolveLightningAddress } from "../utils/lightningAddress.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";

function getPosAddressPool(env: Env): string[] {
  if (env?.POS_ADDRESS_POOL) {
    return env.POS_ADDRESS_POOL.split(",").map((addr: string) => addr.trim()).filter((addr: string) => addr.length > 0);
  }
  return [];
}

function pickRandomAddress(config: any, env: Env): string | null {
  const configured = config?.lnurlpay?.lightning_address;
  if (configured && !configured.includes("coinos")) {
    return configured;
  }
  const pool = getPosAddressPool(env);
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export function constructPayRequest(uidHex: string, pHex: string, cHex: string, counterValue: number, baseUrl: string, config: any, env: Env): Record<string, any> {
  const host = baseUrl || DEFAULT_FALLBACK_HOST;
  const callbackUrl = new URL("/lnurlp/cb", host);
  callbackUrl.searchParams.set("p", pHex);
  callbackUrl.searchParams.set("c", cHex);

  const minSendable = config?.lnurlpay?.min_sendable ?? 1000;
  const maxSendable = config?.lnurlpay?.max_sendable ?? 1000;
  const destination = pickRandomAddress(config, env);

  return {
    tag: "payRequest",
    callback: callbackUrl.toString(),
    minSendable,
    maxSendable,
    metadata: JSON.stringify([["text/plain", `${destination} - Order #${counterValue}`]]),
  };
}

export async function handleLnurlPayCallback(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pHex = url.searchParams.get("p");
    const cHex = url.searchParams.get("c");
    const amountParam = url.searchParams.get("amount");

    if (!pHex || !cHex) {
      logger.error("Missing LNURL-pay callback parameters", { hasP: Boolean(pHex), hasC: Boolean(cHex) });
      return errorResponse(MISSING_PARAMS_MSG);
    }

    if (!amountParam) {
      return errorResponse("Missing required parameter: amount", 400);
    }

    const amountMsat = Number(amountParam);
    if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
      return errorResponse("Invalid amount parameter", 400);
    }

    const auth: any = await resolveCardIdentity(pHex, cHex, env, { context: "lnurl-pay" });
    if (!auth.ok) {
      return errorResponse(auth.error, auth.status);
    }

    const { uidHex, counterValue, config } = auth;

    if (config.payment_method !== PAYMENT_METHOD.LNURLPAY) {
      return errorResponse(`Unsupported payment method: ${config.payment_method}`, 400);
    }

    const lightningAddress = pickRandomAddress(config, env);
    if (typeof lightningAddress !== "string" || !lightningAddress) {
      return errorResponse("No Lightning Address available", 503);
    }

    const minSendable = config.lnurlpay?.min_sendable ?? 1000;
    const maxSendable = config.lnurlpay?.max_sendable ?? 1000;
    if (amountMsat < minSendable || amountMsat > maxSendable) {
      return errorResponse(`Amount ${amountMsat} is outside allowed range ${minSendable}-${maxSendable}`, 400);
    }

    try {
      const tapResult: any = await recordTap(env, uidHex, counterValue, {
        amountMsat: amountMsat,
        userAgent: request.headers.get("user-agent") || null,
        requestUrl: request.url,
      });
      if (!tapResult.accepted) {
        logger.warn("LNURL-pay callback replay detected", {
          uidHex,
          counterValue,
          lastCounter: tapResult.lastCounter,
        });
        return jsonResponse({ status: "ERROR", reason: tapResult.reason || "Counter replay detected — tap rejected" }, 409);
      }
    } catch (error: unknown) {
      logger.error("LNURL-pay callback tap recording failed", {
        uidHex,
        counterValue,
        error: getErrorMessage(error),
      });
      return errorResponse("Replay protection unavailable", 500);
    }

    const invoice: any = await resolveLightningAddress(lightningAddress, amountMsat);

    await updateTapStatus(env, uidHex, counterValue, invoice.pr ? "completed" : "failed").catch((e: any) => logger.warn("Failed to update tap status", { uidHex, error: getErrorMessage(e) }));

    return jsonResponse(invoice);
  } catch (error: unknown) {
    logger.error("Error handling LNURL-pay callback", { error: getErrorMessage(error) });
    return errorResponse("Internal error", 500);
  }
}
