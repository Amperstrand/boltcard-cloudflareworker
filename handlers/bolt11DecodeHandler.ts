import { decodeBolt11 } from "../utils/bolt11.js";
import { getErrorMessage } from "../utils/logger.js";
import { renderBolt11DecodePage } from "../templates/bolt11DecodePage.js";
import { jsonResponse, errorResponse, htmlResponse } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

export function handleDecodePage(request: Request): Response {
  return htmlResponse(renderBolt11DecodePage());
}

export function handleDecodeApi(request: Request): Response {
  const url = new URL(request.url);
  const invoice = url.searchParams.get("invoice") || url.searchParams.get("q") || "";

  if (!invoice) {
    return errorResponse("Missing 'invoice' query parameter", 400);
  }

  try {
    const result = decodeBolt11(invoice);
    return jsonResponse(result);
  } catch (err: unknown) {
    logger.error("BOLT11 decode API error", { error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}
