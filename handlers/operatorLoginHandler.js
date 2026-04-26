import { renderOperatorLoginPage } from "../templates/operatorLoginPage.js";
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

export function handleOperatorLoginPage(request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") || "";
  return htmlResponse(renderOperatorLoginPage({ returnTo }));
}

export async function handleOperatorLogin(request, env) {
  if (!validatePinConfig(env)) {
    logger.error("Operator login attempted but OPERATOR_PIN not configured");
    return errorResponse("Operator PIN not configured", 500);
  }

  const rateLimit = await checkRateLimit(request, env, { maxRequests: LOGIN_RATE_LIMIT_REQUESTS, windowSeconds: LOGIN_RATE_LIMIT_WINDOW });
  if (!rateLimit.allowed) {
    return errorResponse("Too many login attempts. Try again later.", 429);
  }

  let body;
  try {
    body = await request.formData();
  } catch {
    return errorResponse("Invalid form data", 400);
  }

  const pin = body.get("pin");
  if (!pin) {
    return htmlResponse(renderOperatorLoginPage({ error: "PIN is required" }));
  }

  if (!checkPin(pin, env)) {
    logger.warn("Operator login failed — wrong PIN");
    return htmlResponse(renderOperatorLoginPage({ error: "Incorrect PIN" }));
  }

  const returnUrl = body.get("return") || "/operator/pos";

  try {
    const { cookie, shiftId } = createSession(env);
    logger.info("Operator logged in", { shiftId });

    const resp = redirect(returnUrl);
    resp.headers.append("Set-Cookie", cookie);
    return resp;
  } catch (error) {
    logger.error("Session creation failed", { error: error.message });
    return errorResponse("Session error", 500);
  }
}

export function handleOperatorLogout(request, env) {
  requireOperator(request, env);
  logger.info("Operator logged out");
  const resp = redirect("/operator/login");
  resp.headers.append("Set-Cookie", buildExpiredCookie());
  return resp;
}
