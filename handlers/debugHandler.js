import { htmlResponse } from "../utils/responses.js";
import { renderDebugConsolePage } from "../templates/debugConsolePage.js";

export function handleDebugPage(request) {
  const url = new URL(request.url);
  const host = `${url.protocol}//${url.host}`;
  const baseUrl = host;
  return htmlResponse(renderDebugConsolePage({ host, baseUrl }));
}
