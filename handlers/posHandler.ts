import { renderPosPage } from "../templates/posPage.js";
import type { Env } from "../types/core.js";
import { htmlResponse } from "../utils/responses.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { getRequestOrigin } from "../utils/validation.js";

export function handlePosPage(request: Request, env: Env): Response {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderPosPage({ host, currencyLabel }));
}
