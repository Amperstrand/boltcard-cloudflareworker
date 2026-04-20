import { logger } from "../utils/logger.js";
import { jsonResponse } from "../utils/responses.js";

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

  const proxyHeaders = new Headers(request.headers);
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
      headers: proxiedResponse.headers,
    });

  } catch (error) {
    logger.error("Error fetching from proxy", { uidHex, error: error.message });
    return jsonResponse({ error: "Proxy error" }, 500);
  }
}
