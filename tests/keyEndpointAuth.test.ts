// Audit #20 gate: withKeyEndpointAuth (middleware/withKeyEndpointAuth.ts).
// Default OPEN preserves the demo/HIL posture (bench lanes unaffected);
// KEY_ENDPOINTS_AUTH=operator requires an operator session on the
// key-material endpoints. This is the owner's accept-or-gate flip.

import { describe, it, expect } from "vitest";
import { withKeyEndpointAuth } from "../middleware/withKeyEndpointAuth.js";
import { buildCardTestEnv } from "./testHelpers.js";
import type { Env } from "../types/core.js";

function handler(_request: Request, _env: Env): Response {
  return new Response("KEYS", { status: 200 });
}

function gateRequest(): Request {
  return new Request("https://worker.test/api/vc/keys?uid=04a39493cc8680", { method: "GET" });
}

describe("withKeyEndpointAuth (audit #20 gate)", () => {
  it("default (unset): open — handler runs without auth", async () => {
    const env = buildCardTestEnv({}) as unknown as Env;
    const resp = await withKeyEndpointAuth(handler)(gateRequest() as never, env);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("KEYS");
  });

  it('KEY_ENDPOINTS_AUTH="open" (explicit): still open', async () => {
    const env = buildCardTestEnv({}) as unknown as Env;
    (env as unknown as Record<string, unknown>).KEY_ENDPOINTS_AUTH = "open";
    const resp = await withKeyEndpointAuth(handler)(gateRequest() as never, env);
    expect(resp.status).toBe(200);
  });

  it('KEY_ENDPOINTS_AUTH="operator": refuses without a session', async () => {
    // No operatorAuth fixture (that injects a TEST session — auto-authorized);
    // configure the pin explicitly so the gate is armed and the bare request
    // has no session cookie → authRedirect (302 to /operator/login).
    const env = buildCardTestEnv({
      extraEnv: { OPERATOR_PIN: "1234", OPERATOR_SESSION_SECRET: "kga-secret" },
    }) as unknown as Env;
    (env as unknown as Record<string, unknown>).KEY_ENDPOINTS_AUTH = "operator";
    const resp = await withKeyEndpointAuth(handler)(gateRequest() as never, env);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location") || "").toContain("/operator/login");
  });

  it('KEY_ENDPOINTS_AUTH="OPERATOR" (case-insensitive): refuses too', async () => {
    const env = buildCardTestEnv({
      extraEnv: { OPERATOR_PIN: "1234", OPERATOR_SESSION_SECRET: "kga-secret" },
    }) as unknown as Env;
    (env as unknown as Record<string, unknown>).KEY_ENDPOINTS_AUTH = "OPERATOR";
    const resp = await withKeyEndpointAuth(handler)(gateRequest() as never, env);
    expect(resp.status).toBe(302);
  });

  it('KEY_ENDPOINTS_AUTH="operator" WITH a valid session: handler runs', async () => {
    const env = buildCardTestEnv({ operatorAuth: true }) as unknown as Env;
    (env as unknown as Record<string, unknown>).KEY_ENDPOINTS_AUTH = "operator";
    const resp = await withKeyEndpointAuth(handler)(gateRequest() as never, env);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("KEYS");
  });
});
