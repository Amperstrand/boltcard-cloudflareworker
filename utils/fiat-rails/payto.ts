import { logger } from "../logger.js";

export class PaytoPaymentDetails {
  iban: string;
  amount: number;
  currency: string;
  receiverName: string | undefined;
  message: string | undefined;
  execDate: string | undefined;

  constructor(iban: string, amount: number, currency: string, receiverName: string | undefined, message: string | undefined, execDate: string | undefined) {
    this.iban = iban;
    this.amount = amount;
    this.currency = currency;
    this.receiverName = receiverName;
    this.message = message;
    this.execDate = execDate;
  }
}

export function isPaytoUri(uri: unknown): boolean {
  return typeof uri === "string" && (uri.startsWith("payto://") || uri.startsWith("PAYTO:payto://"));
}

function isValidIbanFormat(iban: string): boolean {
  if (!iban || typeof iban !== "string") return false;
  const cleaned = iban.replace(/\s+/g, "");
  if (cleaned.length < 15 || cleaned.length > 34) return false;
  return /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned);
}

export function parsePaytoUri(paytoUri: string | null | undefined): PaytoPaymentDetails | null {
  if (!paytoUri || typeof paytoUri !== "string") return null;

  let uri = paytoUri.trim();

  if (uri.toUpperCase().startsWith("PAYTO:") && !uri.toLowerCase().startsWith("payto://")) {
    uri = uri.substring(6).trim();
  }

  if (!uri.toLowerCase().startsWith("payto://")) return null;

  try {
    const match = uri.match(/^payto:\/\/([^/]+)\/([^?]+)(\?.*)?$/i);
    if (!match) return null;

    const targetType = match[1].toLowerCase();
    let iban = match[2].trim();
    const queryString = match[3] || "";

    if (targetType !== "iban") return null;

    if (!isValidIbanFormat(iban)) {
      logger.warn("PayTo URI contains invalid IBAN format", { iban });
    }

    iban = iban.replace(/\s+/g, "");

    const params = new URLSearchParams(queryString.substring(1));

    const amountParam = params.get("amount");
    if (!amountParam) return null;

    const amountMatch = amountParam.match(/^([A-Z]{3}):([\d.]+(?:[eE][+-]?\d+)?)$/i);
    if (!amountMatch) return null;

    const currency = amountMatch[1].toUpperCase();
    const amount = parseFloat(amountMatch[2]);

    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) return null;

    const safeDecode = (value: string | null): string | undefined => {
      if (!value) return undefined;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    return new PaytoPaymentDetails(
      iban,
      amount,
      currency,
      safeDecode(params.get("receiver-name")),
      safeDecode(params.get("message")),
      params.get("x-execdate") || params.get("execdate") || undefined
    );
  } catch (error: any) {
    logger.error("Failed to parse PayTo URI", { error: error.message });
    return null;
  }
}

export function encodePaytoUri(details: Partial<PaytoPaymentDetails>): string {
  const iban = details.iban || "GB33BUKB20201555555555";
  const currency = (details.currency || "EUR").toUpperCase();
  const amount = (details.amount || 0).toFixed(2);
  const name = encodeURIComponent(details.receiverName || "FakeWallet");
  const message = details.message ? `&message=${encodeURIComponent(details.message)}` : "";
  const execDate = details.execDate ? `&x-execdate=${details.execDate}` : "";

  return `payto://iban/${iban}?amount=${currency}:${amount}&receiver-name=${name}${message}${execDate}`;
}
