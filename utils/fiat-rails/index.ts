import { isPaytoUri, parsePaytoUri, type PaytoPaymentDetails } from "./payto.js";
import { isUpiUri, parseUpiUri, type UpiPaymentDetails } from "./upi.js";
import { isSpaydUri, parseSpayd, type SpaydPaymentDetails } from "./spayd.js";

export { parsePaytoUri, encodePaytoUri, isPaytoUri, PaytoPaymentDetails } from "./payto.js";
export { parseUpiUri, encodeUpiUri, isUpiUri, UpiPaymentDetails } from "./upi.js";
export { parseSpayd, encodeSpayd, isSpaydUri, SpaydPaymentDetails } from "./spayd.js";
export { convertCurrencyToSats, convertSatsToCurrency, getBtcPrice, fetchBtcRates } from "./currency.js";

interface FiatRailResult {
  type: string;
  uri: string | null;
}

export function detectFiatRail(description: string | null | undefined): FiatRailResult {
  if (!description || typeof description !== "string") {
    return { type: "bolt11", uri: null };
  }

  if (description.toUpperCase().startsWith("PAYTO:")) {
    const paytoUri = description.substring(6).trim();
    if (isPaytoUri(paytoUri)) {
      return { type: "payto", uri: paytoUri };
    }
  }

  if (description.includes("payto://")) {
    const match = description.match(/payto:\/\/[^\s]+/);
    if (match && match[0]) {
      return { type: "payto", uri: match[0] };
    }
  }

  if (description.includes("upi://")) {
    const match = description.match(/upi:\/\/[^\s]+/);
    if (match && match[0]) {
      return { type: "upi", uri: match[0] };
    }
  }

  if (isSpaydUri(description)) {
    let spaydString = description.trim();
    if (spaydString.startsWith("spayd://")) {
      spaydString = spaydString.substring(8);
    }
    const match = description.match(/SPD\*[^*]+(?:\*[^*:]+:[^*]+)*/);
    if (match && match[0]) {
      return { type: "spayd", uri: match[0] };
    }
    if (spaydString.startsWith("SPD*")) {
      return { type: "spayd", uri: spaydString };
    }
  }

  return { type: "bolt11", uri: null };
}

export function parseFiatRailDetails(type: string, uri: string): PaytoPaymentDetails | UpiPaymentDetails | SpaydPaymentDetails | null {
  switch (type) {
    case "payto":
      return parsePaytoUri(uri);
    case "upi":
      return parseUpiUri(uri);
    case "spayd":
      return parseSpayd(uri);
    default:
      return null;
  }
}
