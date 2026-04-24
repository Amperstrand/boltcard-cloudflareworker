import { renderOperatorLoginPage } from "../templates/operatorLoginPage.js";
import { htmlResponse, errorResponse } from "../utils/responses.js";
import {
  requireOperator,
  validatePinConfig,
  checkPin,
  createSession,
  buildExpiredCookie,
} from "../middleware/operatorAuth.js";
import { checkRateLimit } from "../rateLimiter.js";
import { logger } from "../utils/logger.js";

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

  const rateLimit = await checkRateLimit(request, env, { maxRequests: 5, windowSeconds: 900 });
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
    const { cookie, shiftId } = await createSession(env);
    logger.info("Operator logged in", { shiftId });

    return new Response(null, {
      status: 302,
      headers: {
        "Location": returnUrl,
        "Set-Cookie": cookie,
      },
    });
  } catch (error) {
    logger.error("Session creation failed", { error: error.message });
    return errorResponse("Session error", 500);
  }
}

export async function handleOperatorLogout(request, env) {
  const auth = await requireOperator(request, env);
  void auth;
  logger.info("Operator logged out");
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/operator/login",
      "Set-Cookie": buildExpiredCookie(),
    },
  });
}
