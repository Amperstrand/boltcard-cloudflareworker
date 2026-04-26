import { logger } from "../utils/logger.js";
import { errorResponse } from "../utils/responses.js";

const ALLOWED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "user-agent",
  "accept-language",
];

const ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "x-boltcard-",
];

function filterHeaders(headers, allowList) {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (allowList.some(allowed => lower.startsWith(allowed))) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

export async function handleProxy(request, uidHex, pHex, cHex, baseurl, verification = {}) {
  const targetUrl = new URL(baseurl);
  targetUrl.searchParams.append('p', pHex);
  targetUrl.searchParams.append('c', cHex);

  logger.info("Proxying boltcard request", {
    uidHex,
    method: request.method,
    targetOrigin: targetUrl.origin,
    targetPathname: targetUrl.pathname,
  });

  let requestBody = null;

  try {
    if (request.method !== "GET") {
      const requestClone = request.clone();
      requestBody = await requestClone.text();
      logger.debug("Proxy request body captured", {
        uidHex,
        requestBodyLength: requestBody.length,
      });
    }
  } catch (error) {
    logger.error("Error reading proxy request body", { uidHex, error: error.message });
  }

  const proxyHeaders = filterHeaders(request.headers, ALLOWED_REQUEST_HEADERS);
  proxyHeaders.set("X-BoltCard-UID", uidHex);
  proxyHeaders.set("X-BoltCard-CMAC-Validated", String(!!verification.cmacValidated));
  proxyHeaders.set("X-BoltCard-CMAC-Deferred", String(!!verification.validationDeferred));

  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: proxyHeaders,
    body: requestBody ? requestBody : null,
    redirect: "manual"
  });

  try {
    const proxiedResponse = await fetch(proxyRequest);

    const responseBody = await proxiedResponse.text();
    logger.info("Proxy response received", {
      uidHex,
      status: proxiedResponse.status,
      responseBodyLength: responseBody.length,
    });

    return new Response(responseBody, {
      status: proxiedResponse.status,
      headers: filterHeaders(proxiedResponse.headers, ALLOWED_RESPONSE_HEADERS),
    });

  } catch (error) {
    logger.error("Error fetching from proxy", { uidHex, error: error.message });
    return errorResponse("Proxy error", 500);
  }
}
