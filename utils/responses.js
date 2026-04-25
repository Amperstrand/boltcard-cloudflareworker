export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function buildErrorPayload(reason, extra = {}) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    status: "ERROR",
    reason: message,
    error: message,
    success: false,
    ...extra,
  };
}

export function errorResponse(reason, status = 400, extra = {}) {
  return jsonResponse(buildErrorPayload(reason, extra), status);
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

export function buildBoltCardResponse(keys, uid, host, version = 1) {
  const hostPart = host.replace(/^https?:\/\//, "") + "/";
  return {
    CARD_NAME: `UID ${uid.toUpperCase()}`,
    ID: "1",
    Version: version,
    K0: keys.k0.toUpperCase(),
    K1: keys.k1.toUpperCase(),
    K2: keys.k2.toUpperCase(),
    K3: keys.k3.toUpperCase(),
    K4: keys.k4.toUpperCase(),
    LNURLW_BASE: `lnurlw://${hostPart}`,
    LNURLW: `lnurlw://${hostPart}`,
    k0: keys.k0.toLowerCase(),
    k1: keys.k1.toLowerCase(),
    k2: keys.k2.toLowerCase(),
    k3: keys.k3.toLowerCase(),
    k4: keys.k4.toLowerCase(),
    lnurlw_base: `lnurlw://${hostPart}`,
    PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
    PROTOCOL_VERSION: "1",
  };
}

export async function parseJsonBody(request) {
  return request.json();
}

export function buildResetDeeplink(endpointUrl) {
  return `boltcard://reset?url=${encodeURIComponent(endpointUrl)}`;
}
