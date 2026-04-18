import { logger } from "./logger.js";

function parseLightningAddress(lightningAddress) {
  if (typeof lightningAddress !== "string") {
    throw new Error("Lightning Address must be a string");
  }

  const trimmedAddress = lightningAddress.trim();
  const parts = trimmedAddress.split("@");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid Lightning Address format: ${lightningAddress}`);
  }

  return {
    user: parts[0],
    domain: parts[1],
  };
}

function validateAmountMsat(amountMsat) {
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    throw new Error(`Invalid amountMsat: ${amountMsat}`);
  }
}

async function parseJsonResponse(response, url, errorPrefix) {
  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`${errorPrefix}: invalid JSON response from ${url}: ${error.message}`);
  }

  if (!response.ok) {
    const reason = typeof data?.reason === "string" ? ` - ${data.reason}` : "";
    throw new Error(`${errorPrefix}: ${url} returned HTTP ${response.status}${reason}`);
  }

  if (data?.status === "ERROR") {
    throw new Error(`${errorPrefix}: ${url} returned LNURL error${data.reason ? ` - ${data.reason}` : ""}`);
  }

  return data;
}

async function fetchJson(url, errorPrefix) {
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${errorPrefix}: failed to fetch ${url}: ${error.message}`);
  }

  return parseJsonResponse(response, url, errorPrefix);
}

export async function resolveLightningAddress(lightningAddress, amountMsat) {
  validateAmountMsat(amountMsat);

  const { user, domain } = parseLightningAddress(lightningAddress);
  const metadataUrl = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;

  logger.info("Resolving Lightning Address", {
    lightningAddress,
    metadataUrl,
    amountMsat,
  });

  const payRequest = await fetchJson(
    metadataUrl,
    "Lightning Address resolution failed"
  );

  if (payRequest.tag !== "payRequest") {
    throw new Error(`Lightning Address resolution failed: ${metadataUrl} returned invalid tag: ${payRequest.tag}`);
  }

  if (typeof payRequest.callback !== "string" || !payRequest.callback) {
    throw new Error(`Lightning Address resolution failed: ${metadataUrl} missing callback URL`);
  }

  if (!Number.isInteger(payRequest.minSendable) || !Number.isInteger(payRequest.maxSendable)) {
    throw new Error(`Lightning Address resolution failed: ${metadataUrl} missing minSendable or maxSendable`);
  }

  if (amountMsat < payRequest.minSendable || amountMsat > payRequest.maxSendable) {
    throw new Error(
      `Amount ${amountMsat}msat is outside allowed range ${payRequest.minSendable}-${payRequest.maxSendable}msat for ${lightningAddress}`
    );
  }

  let callbackUrl;

  try {
    callbackUrl = new URL(payRequest.callback);
  } catch (error) {
    throw new Error(`Lightning Address resolution failed: invalid callback URL ${payRequest.callback}: ${error.message}`);
  }

  callbackUrl.searchParams.set("amount", String(amountMsat));

  logger.info("Requesting Lightning invoice", {
    lightningAddress,
    callbackUrl: callbackUrl.toString(),
    amountMsat,
  });

  const invoiceData = await fetchJson(
    callbackUrl.toString(),
    "Lightning Address callback failed"
  );

  if (typeof invoiceData.pr !== "string" || !invoiceData.pr) {
    throw new Error(`Lightning Address callback failed: ${callbackUrl.toString()} missing pr`);
  }

  return {
    pr: invoiceData.pr,
    routes: [],
  };
}
