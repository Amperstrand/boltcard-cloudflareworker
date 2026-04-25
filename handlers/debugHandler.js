import { htmlResponse } from "../utils/responses.js";
import { renderDebugConsolePage } from "../templates/debugConsolePage.js";
import { getRequestOrigin } from "../utils/validation.js";

export function handleDebugPage(request) {
  const host = getRequestOrigin(request);
  return htmlResponse(renderDebugConsolePage({ host, baseUrl: host }));
}
