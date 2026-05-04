interface BoltCardKeys {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
}

export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function _buildErrorPayload(reason: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    status: "ERROR",
    reason: message,
    error: message,
    success: false,
    ...extra,
  };
}

export function errorResponse(reason: unknown, status: number = 400, extra: Record<string, unknown> = {}): Response {
  return jsonResponse(_buildErrorPayload(reason, extra), status);
}

export function htmlResponse(html: string, status: number = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

export function buildBoltCardResponse(keys: BoltCardKeys, uid: string, host: string, version: number = 1): Record<string, unknown> {
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

export async function parseJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function buildResetDeeplink(endpointUrl: string): string {
  return `boltcard://reset?url=${encodeURIComponent(endpointUrl)}`;
}

export function redirect(url: string, status: number = 302): Response {
  return new Response(null, { status, headers: { Location: url } });
}
