import type { IRequest } from "itty-router";
import type { Env } from "../types/core.js";
import { generateFakeBolt11 } from "../utils/bolt11.js";
import { encodePaytoUri } from "../utils/fiat-rails/payto.js";
import { encodeUpiUri } from "../utils/fiat-rails/upi.js";
import { encodeSpayd } from "../utils/fiat-rails/spayd.js";
import { convertSatsToCurrency } from "../utils/fiat-rails/currency.js";
import { logger, getErrorMessage } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";

export async function handleFakeInvoice(request: IRequest, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const amountMsat = parseInt(url.searchParams.get("amount") ?? "", 10);
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    return errorResponse("amount must be a positive integer (millisatoshis)", 400);
  }
  try {
    const rail = url.searchParams.get("rail") || env.FAKEWALLET_DEFAULT_RAIL || "bolt11";
    let description: string | undefined;

    if (rail === "payto") {
      const currency = (url.searchParams.get("currency") || env.FAKEWALLET_CURRENCY || "EUR").toUpperCase();
      const iban = url.searchParams.get("iban") || env.FAKEWALLET_IBAN || "GB33BUKB20201555555555";
      const accountName = url.searchParams.get("accountName") || env.FAKEWALLET_ACCOUNT_NAME || "FakeWallet";

      let fiatAmount: number;
      try {
        fiatAmount = await convertSatsToCurrency(amountMsat / 1000, currency);
      } catch {
        fiatAmount = 0;
      }

      const message = `${Math.round(amountMsat / 1000)}sat@${new Date().toISOString().split("T")[0]}`;
      const execDate = new Date(Date.now() + 3600000).toISOString().split("T")[0];

      const paytoUri = encodePaytoUri({
        iban,
        amount: fiatAmount,
        currency,
        receiverName: accountName,
        message,
        execDate,
      });

      description = `PAYTO:${paytoUri}`;
    } else if (rail === "upi") {
      const pa = url.searchParams.get("pa") || env.FAKEWALLET_UPI_PA || "merchant@upi";
      const pn = url.searchParams.get("pn") || env.FAKEWALLET_UPI_PN || "FakeWallet";
      const currency = (url.searchParams.get("currency") || "INR").toUpperCase();

      let fiatAmount: number;
      try {
        fiatAmount = await convertSatsToCurrency(amountMsat / 1000, currency);
      } catch {
        fiatAmount = 0;
      }

      description = encodeUpiUri({
        pa,
        am: fiatAmount,
        cu: currency,
        pn,
        tn: `${Math.round(amountMsat / 1000)}sat@${new Date().toISOString().split("T")[0]}`,
      });
    } else if (rail === "spayd") {
      const acc = url.searchParams.get("acc") || env.FAKEWALLET_SPAYD_ACC || "CZ000000-0000000000";
      const currency = (url.searchParams.get("currency") || env.FAKEWALLET_CURRENCY || "CZK").toUpperCase();

      let fiatAmount: number;
      try {
        fiatAmount = await convertSatsToCurrency(amountMsat / 1000, currency);
      } catch {
        fiatAmount = 0;
      }

      description = encodeSpayd(
        {
          ACC: acc,
          AM: fiatAmount.toFixed(2),
          CC: currency,
          MSG: `${Math.round(amountMsat / 1000)}sat`,
          DT: new Date(Date.now() + 3600000).toISOString().split("T")[0]!.replace(/-/g, ""),
        },
        { includeCrc32: true, sortAttributes: true }
      );
    }

    const invoice = generateFakeBolt11(amountMsat, { description });
    return jsonResponse({ pr: invoice, ...(description ? { description } : {}) });
  } catch (err: unknown) {
    logger.error("Fake invoice generation failed", { error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}
