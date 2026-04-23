import { renderPosPage } from "../templates/posPage.js";
import { htmlResponse } from "../utils/responses.js";
import { getCurrencyLabel } from "../utils/currency.js";

export function handlePosPage(request, env) {
  const host = new URL(request.url).origin;
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderPosPage({ host, currencyLabel }));
}
