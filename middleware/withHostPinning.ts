import type { IRequest } from "itty-router";
import type { Env } from "../types/core.js";
import { errorResponse } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

// Audit 2026-11-13 finding #18 (docs/security-audit-2026-11-13.md): the
// worker reflects the request origin into LNURL callbacks (Go reference
// rejects `req.Host != HOST_DOMAIN` on both the withdraw request and the
// callback). Today that is bounded by the Cloudflare account host binding;
// this middleware makes host pinning a config flip instead:
//
//   ALLOWED_HOSTS unset/empty      → current (open) behavior
//   ALLOWED_HOSTS=a.example,b.org  → requests whose Host (url.host, port
//                                    included when non-default) is not in
//                                    the comma list → 400 (Go behavior)
//
// Default remains open so nothing changes until the owner flips the
// binding in wrangler.toml/secrets. Applied to the card/LNURL surface
// only (routes/public.ts) — the same endpoints Go pins.

export function parseAllowedHosts(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0)
  );
}

export function withHostPinning(
  handler: (request: IRequest, env: Env) => Promise<Response> | Response,
): (request: IRequest, env: Env) => Promise<Response> {
  return async (request: IRequest, env: Env) => {
    const allowed = parseAllowedHosts(env.ALLOWED_HOSTS);
    if (allowed.size === 0) return handler(request, env);

    const requestHost = new URL(request.url).host.toLowerCase();
    if (!allowed.has(requestHost)) {
      logger.warn("Host pinning: request Host not in ALLOWED_HOSTS — refusing", {
        action: "host_pinning",
        requestHost,
      });
      return errorResponse("Host not allowed", 400);
    }
    return handler(request, env);
  };
}
