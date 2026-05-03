import { decodeBolt11 } from "../utils/bolt11.js";
import { renderBolt11DecodePage } from "../templates/bolt11DecodePage.js";
import { jsonResponse, errorResponse, htmlResponse } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

export function handleDecodePage(request) {
  return htmlResponse(renderBolt11DecodePage());
}

export function handleDecodeApi(request) {
  const url = new URL(request.url);
  const invoice = url.searchParams.get("invoice") || url.searchParams.get("q") || "";

  if (!invoice) {
    return errorResponse("Missing 'invoice' query parameter", 400);
  }

  try {
    const result = decodeBolt11(invoice);
    return jsonResponse(result);
  } catch (err) {
    logger.error("BOLT11 decode API error", { error: err.message });
    return errorResponse("Internal error", 500);
  }
}
