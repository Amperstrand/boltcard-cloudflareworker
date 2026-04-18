export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

export function buildBoltCardResponse(keys, uid, host) {
  const hostPart = host.replace(/^https?:\/\//, "") + "/";
  return {
    CARD_NAME: `UID ${uid.toUpperCase()}`,
    ID: "1",
    K0: keys.k0.toUpperCase(),
    K1: keys.k1.toUpperCase(),
    K2: keys.k2.toUpperCase(),
    K3: keys.k3.toUpperCase(),
    K4: keys.k4.toUpperCase(),
    LNURLW_BASE: `lnurlw://${hostPart}`,
    LNURLW: `lnurlw://${hostPart}`,
    PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
    PROTOCOL_VERSION: "1",
  };
}

export function buildResetDeeplink(endpointUrl) {
  return `boltcard://reset?url=${encodeURIComponent(endpointUrl)}`;
}
