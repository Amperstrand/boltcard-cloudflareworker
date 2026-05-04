import { renderWipePage } from "../templates/wipePage.js";
import type { Env } from "../types/core.js";
import { htmlResponse } from "../utils/responses.js";
import { getRequestOrigin } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID } from "../utils/constants.js";

export function handleWipePage(request: Request, env: Env): Response {
  const baseUrl = getRequestOrigin(request);
  const pullPaymentId = env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;
  const resetApiUrl = `${baseUrl}/api/v1/pull-payments/${pullPaymentId}/boltcards?onExisting=KeepVersion`;
  return htmlResponse(renderWipePage({ baseUrl, resetApiUrl }));
}
