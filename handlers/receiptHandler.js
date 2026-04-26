import { errorResponse } from "../utils/responses.js";
import { listTransactions } from "../replayProtection.js";
import { getCurrencyLabel, getCurrencyDecimals } from "../utils/currency.js";
import { logger } from "../utils/logger.js";
import { RECEIPT_TXN_LOOKUP_LIMIT } from "../utils/constants.js";

export async function handleReceipt(request, env) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const txnId = pathParts[pathParts.length - 1];

  if (!txnId || txnId === "receipt") {
    return errorResponse("Transaction ID required", 400);
  }

  const uid = url.searchParams.get("uid");
  if (!uid) {
    return errorResponse("UID required", 400);
  }

  try {
    const txData = await listTransactions(env, uid, RECEIPT_TXN_LOOKUP_LIMIT);
    const transactions = txData.transactions || [];
    const txn = transactions.find(t => String(t.id) === txnId);

    if (!txn) {
      return errorResponse("Transaction not found", 404);
    }

    const currencyLabel = getCurrencyLabel(env);
    const decimals = getCurrencyDecimals(env);
    const divisor = Math.pow(10, decimals);
    const displayAmount = (txn.amount / divisor).toFixed(decimals);
    const displayBalance = txn.balance_after !== null && txn.balance_after !== undefined
      ? (txn.balance_after / divisor).toFixed(decimals)
      : "N/A";

    const receipt = [
      "================================",
      `         RECEIPT`,
      "================================",
      "",
      `Transaction:  ${txn.id}`,
      `Date:         ${new Date(txn.created_at * 1000).toLocaleString()}`,
      "",
      `Amount:       ${displayAmount} ${currencyLabel}`,
      `Balance:      ${displayBalance} ${currencyLabel}`,
      "",
    ];

    if (txn.note) {
      receipt.push(`Reference:    ${txn.note}`);
      receipt.push("");
    }

    receipt.push("================================");
    receipt.push("     Thank you!");
    receipt.push("================================");

    return new Response(receipt.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    logger.error("Receipt generation failed", { txnId, uid, error: error.message });
    return errorResponse("Failed to generate receipt", 500);
  }
}
