import type { IRequest, IttyRouterType } from "itty-router";
import type { Env, SessionPayload } from "../types/core.js";
import { requireOperator, buildCsrfCookie, CSRF_COOKIE_NAME } from "./operatorAuth.js";
import { errorResponse } from "../utils/responses.js";
import { getCookieValue, constantTimeEqual } from "../utils/cookies.js";

export type AppRouter = IttyRouterType<IRequest, [env: Env]>;

export type AuthedHandler = (request: IRequest, env: Env, session: SessionPayload) => Promise<Response> | Response;

export function withOperatorAuth(handler: AuthedHandler): (request: IRequest, env: Env) => Promise<Response> {
  return async (request: IRequest, env: Env) => {
    const auth = requireOperator(request, env);
    if (!auth.authorized) return auth.response;

    const method = request.method.toUpperCase();
    const isMutating = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";

    if (isMutating) {
      const cookieHeader = request.headers.get("Cookie") || "";
      const csrfCookie = getCookieValue(cookieHeader, CSRF_COOKIE_NAME);
      const csrfHeader = request.headers.get("X-CSRF-Token");

      const skipCsrf = env && env.__TEST_OPERATOR_SESSION && env.WORKER_ENV !== "production";
      if (!skipCsrf && (!csrfCookie || !csrfHeader || !constantTimeEqual(csrfCookie, csrfHeader))) {
        return errorResponse("CSRF validation failed", 403);
      }
    }

    const response = await handler(request, env, auth.session);

    if (response && !isMutating) {
      const existingCsrf = request.headers.get("Cookie") || "";
      const hasCsrf = !!getCookieValue(existingCsrf, CSRF_COOKIE_NAME);
      if (!hasCsrf) {
        const token = crypto.randomUUID();
        const newResponse = new Response(response.body, response);
        newResponse.headers.append("Set-Cookie", buildCsrfCookie(token));
        return newResponse;
      }
    }

    return response;
  };
}
