import { renderPosPage } from "../templates/posPage.js";
import { htmlResponse } from "../utils/responses.js";

export function handlePosPage(request) {
  const url = new URL(request.url);
  const host = `${url.protocol}//${url.host}`;
  return htmlResponse(renderPosPage({ host }));
}
