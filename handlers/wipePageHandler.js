import { renderWipePage } from "../templates/wipePage.js";
import { htmlResponse } from "../utils/responses.js";

export function handleWipePage(request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return htmlResponse(renderWipePage({ baseUrl }));
}
