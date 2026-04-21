import { htmlResponse } from "../utils/responses.js";
import { renderDebugPage } from "../templates/debugPage.js";

export function handleDebugPage(request) {
  const url = new URL(request.url);
  const host = `${url.protocol}//${url.host}`;
  return htmlResponse(renderDebugPage({ host }));
}
