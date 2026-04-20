import { renderWipePage } from "../templates/wipePage.js";
import { htmlResponse } from "../utils/responses.js";

export function handleWipePage(request, env = {}) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const pullPaymentId = env.DEFAULT_PULL_PAYMENT_ID || "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
  const resetApiUrl = `${baseUrl}/api/v1/pull-payments/${pullPaymentId}/boltcards?onExisting=KeepVersion`;
  return htmlResponse(renderWipePage({ baseUrl, resetApiUrl }));
}
