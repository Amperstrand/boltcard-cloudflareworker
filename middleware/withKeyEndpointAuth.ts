import type { IRequest } from "itty-router";
import type { Env } from "../types/core.js";
import { withOperatorAuth, type AuthedHandler, type AppRouter } from "./withOperatorAuth.js";

// Audit 2026-11-13 finding #20 (docs/security-audit-2026-11-13.md): the
// key-material endpoints (/api/vc/keys, the pull-payments boltcard issuer)
// are deliberately OPEN in the demo/HIL posture — deterministic keys +
// anonymous taps — but UIDs are plaintext in anti-collision, so anyone who
// ever read a UID can forge taps. This middleware makes the owner's
// accept-or-gate decision a config flip instead of a code change:
//
//   KEY_ENDPOINTS_AUTH unset/"open"   → current (open) behavior
//   KEY_ENDPOINTS_AUTH = "operator"   → endpoint requires an operator session
//
// Default remains open so the bench lanes (boltcard-hce, matrix) are
// unaffected until the owner flips the binding in wrangler.toml/secrets.

export function withKeyEndpointAuth(
  handler: (request: IRequest, env: Env) => Promise<Response> | Response,
): (request: IRequest, env: Env) => Promise<Response> {
  return async (request: IRequest, env: Env) => {
    if ((env.KEY_ENDPOINTS_AUTH || "open").toLowerCase() === "operator") {
      const authed = handler as unknown as AuthedHandler;
      return withOperatorAuth(authed)(request, env);
    }
    return handler(request, env);
  };
}

export type { AppRouter };
