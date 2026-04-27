import { logger } from "../logger.js";

export class UpiPaymentDetails {
  constructor(pa, am, cu, pn, mc, tr, tn) {
    this.pa = pa;
    this.am = am;
    this.cu = cu;
    this.pn = pn;
    this.mc = mc;
    this.tr = tr;
    this.tn = tn;
  }
}

export function isUpiUri(uri) {
  return typeof uri === "string" && uri.startsWith("upi://");
}

export function parseUpiUri(upiUri) {
  if (!upiUri || typeof upiUri !== "string") return null;
  if (!upiUri.startsWith("upi://")) return null;

  try {
    const url = new URL(upiUri);
    const params = new URLSearchParams(url.search);

    const pa = params.get("pa");
    const am = params.get("am");
    const cu = params.get("cu") || "INR";

    if (!pa || !am) return null;

    const amount = parseFloat(am);
    if (isNaN(amount) || amount <= 0) return null;

    return new UpiPaymentDetails(
      pa,
      amount,
      cu,
      params.get("pn") || undefined,
      params.get("mc") || undefined,
      params.get("tr") || undefined,
      params.get("tn") || undefined
    );
  } catch (error) {
    logger.error("Failed to parse UPI URI", { error: error.message });
    return null;
  }
}

export function encodeUpiUri(details) {
  const pa = details.pa || "merchant@acqbank";
  const am = (details.am || 0).toFixed(2);
  const cu = details.cu || "INR";
  const pn = details.pn ? `&pn=${encodeURIComponent(details.pn)}` : "";
  const mc = details.mc ? `&mc=${encodeURIComponent(details.mc)}` : "";
  const tr = details.tr ? `&tr=${encodeURIComponent(details.tr)}` : "";
  const tn = details.tn ? `&tn=${encodeURIComponent(details.tn)}` : "";

  return `upi://pay?pa=${encodeURIComponent(pa)}&am=${am}&cu=${cu}${pn}${mc}${tr}${tn}`;
}
