import { renderOperatorLoginPage } from "../templates/operatorLoginPage.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { htmlResponse, errorResponse, redirect } from "../utils/responses.js";
import {
  requireOperator,
  validatePinConfig,
  checkPin,
  createSession,
  buildExpiredCookie,
} from "../middleware/operatorAuth.js";
import { checkRateLimit } from "../rateLimiter.js";
import { logger } from "../utils/logger.js";
import { LOGIN_RATE_LIMIT_REQUESTS, LOGIN_RATE_LIMIT_WINDOW } from "../utils/constants.js";

export function handleOperatorLoginPage(request: Request): Response {
  const url = new URL(request.url);
  const returnTo: string = url.searchParams.get("return") || "";
  return htmlResponse(renderOperatorLoginPage({ error: undefined, returnTo }));
}

export async function handleOperatorLogin(request: Request, env: Env): Promise<Response> {
  if (!validatePinConfig(env)) {
    logger.error("Operator login attempted but OPERATOR_PIN not configured");
    return errorResponse("Operator PIN not configured", 500);
  }

  const rateLimit: Awaited<ReturnType<typeof checkRateLimit>> = await checkRateLimit(request, env, { maxRequests: LOGIN_RATE_LIMIT_REQUESTS, windowSeconds: LOGIN_RATE_LIMIT_WINDOW });
  if (!rateLimit.allowed) {
    return errorResponse("Too many login attempts. Try again later.", 429);
  }

  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return errorResponse("Invalid form data", 400);
  }

  const pin: string | null = body.get("pin") as string | null;
  if (!pin) {
    return htmlResponse(renderOperatorLoginPage({ error: "PIN is required" }));
  }

  if (!checkPin(pin, env)) {
    logger.warn("Operator login failed — wrong PIN");
    return htmlResponse(renderOperatorLoginPage({ error: "Incorrect PIN" }));
  }

  const rawReturn: string = (body.get("return") as string) || "/operator/pos";
  const returnUrl: string = (rawReturn.startsWith("/") && !rawReturn.startsWith("//")) ? rawReturn : "/operator/pos";

  try {
    const { cookie, shiftId }: { cookie: string; shiftId: string } = createSession(env);
    logger.info("Operator logged in", { shiftId });

    const resp: Response = redirect(returnUrl);
    resp.headers.append("Set-Cookie", cookie);
    return resp;
  } catch (error: unknown) {
    logger.error("Session creation failed", { error: getErrorMessage(error) });
    return errorResponse("Session error", 500);
  }
}

export function handleOperatorLogout(request: Request, env: Env): Response {
  requireOperator(request, env);
  logger.info("Operator logged out");
  const resp: Response = redirect("/operator/login");
  resp.headers.append("Set-Cookie", buildExpiredCookie());
  return resp;
}
