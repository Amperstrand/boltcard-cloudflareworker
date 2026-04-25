import { renderActivatePage } from "../templates/activatePage.js";
import { htmlResponse } from "../utils/responses.js";
import { getRequestOrigin } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID } from "../utils/constants.js";

export function handleActivatePage(request, env = {}) {
  const baseUrl = getRequestOrigin(request);
  const pullPaymentId = new URL(request.url).searchParams.get("pullPaymentId") || env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;
  const apiUrl = `${baseUrl}/api/v1/pull-payments/${pullPaymentId}/boltcards`;
  
  const programUrl = `${apiUrl}?onExisting=UpdateVersion`;
  const resetUrl = `${apiUrl}?onExisting=KeepVersion`;

  const programDeepLink = `boltcard://program?url=${encodeURIComponent(programUrl)}`;
  const resetDeepLink = `boltcard://reset?url=${encodeURIComponent(resetUrl)}`;

  return htmlResponse(renderActivatePage({ apiUrl, programDeepLink, resetDeepLink, programUrl, resetUrl }));
}
