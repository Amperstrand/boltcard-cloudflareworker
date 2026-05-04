import { errorResponse } from "../utils/responses.js";
import { listTransactions } from "../replayProtection.js";
import { formatAmount, getCurrencyLabel } from "../utils/currency.js";
import { logger } from "../utils/logger.js";
import { RECEIPT_TXN_LOOKUP_LIMIT } from "../utils/constants.js";

export async function handleReceipt(request: Request, env: any): Promise<Response> {
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
    const txData: any = await listTransactions(env, uid, RECEIPT_TXN_LOOKUP_LIMIT);
    const transactions: any[] = txData.transactions || [];
    const txn = transactions.find((t: any) => String(t.id) === txnId);

    if (!txn) {
      return errorResponse("Transaction not found", 404);
    }

    const displayAmount = formatAmount(txn.amount, env);
    const displayBalance = txn.balance_after !== null && txn.balance_after !== undefined
      ? formatAmount(txn.balance_after, env)
      : "N/A";

    const receipt = [
      "================================",
      `         RECEIPT`,
      "================================",
      "",
      `Transaction:  ${txn.id}`,
      `Date:         ${new Date(txn.created_at * 1000).toLocaleString()}`,
      "",
      `Amount:       ${displayAmount}`,
      `Balance:      ${displayBalance}`,
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
  } catch (error: any) {
    logger.error("Receipt generation failed", { txnId, uid, error: error.message });
    return errorResponse("Failed to generate receipt", 500);
  }
}
