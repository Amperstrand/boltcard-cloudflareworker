import { renderActivatePage } from "../templates/activatePage.js";
import { htmlResponse } from "../utils/responses.js";

export function handleActivatePage(request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const pullPaymentId = url.searchParams.get("pullPaymentId") || "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
  const apiUrl = `${baseUrl}/api/v1/pull-payments/${pullPaymentId}/boltcards`;
  
  const programUrl = `${apiUrl}?onExisting=UpdateVersion`;
  const resetUrl = `${apiUrl}?onExisting=KeepVersion`;

  const programDeepLink = `boltcard://program?url=${encodeURIComponent(programUrl)}`;
  const resetDeepLink = `boltcard://reset?url=${encodeURIComponent(resetUrl)}`;

  return htmlResponse(renderActivatePage({ apiUrl, programDeepLink, resetDeepLink, programUrl, resetUrl }));
}
