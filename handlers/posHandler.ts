import { renderPosPage } from "../templates/posPage.js";
import { htmlResponse } from "../utils/responses.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { getRequestOrigin } from "../utils/validation.js";

export function handlePosPage(request: Request, env: any): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderPosPage({ host, currencyLabel }));
}
