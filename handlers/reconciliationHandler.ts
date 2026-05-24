import type { Env, SessionPayload } from "../types/core.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { getRequestOrigin } from "../utils/validation.js";
import { renderReconciliationPage } from "../templates/reconciliationPage.js";
import { listShiftSummaries, type ShiftSummary } from "../utils/shiftSummary.js";

interface VenueTotals {
  topupCount: number;
  topupTotal: number;
  chargeCount: number;
  chargeTotal: number;
  refundCount: number;
  refundTotal: number;
  voidCount: number;
  voidTotal: number;
  outstandingBalance: number;
  netCashIn: number;
}

export function handleReconciliationPage(request: Request, env: Env): Response {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderReconciliationPage({ host, currencyLabel }));
}

export async function handleReconciliationData(request: Request, env: Env): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  try {
    const summaries = await listShiftSummaries(env);

    const totals: VenueTotals = {
      topupCount: 0,
      topupTotal: 0,
      chargeCount: 0,
      chargeTotal: 0,
      refundCount: 0,
      refundTotal: 0,
      voidCount: 0,
      voidTotal: 0,
      outstandingBalance: 0,
      netCashIn: 0,
    };

    for (const s of summaries) {
      totals.topupCount += s.topupCount;
      totals.topupTotal += s.topupTotal;
      totals.chargeCount += s.chargeCount;
      totals.chargeTotal += s.chargeTotal;
      totals.refundCount += s.refundCount;
      totals.refundTotal += s.refundTotal;
      totals.voidCount += s.voidCount;
      totals.voidTotal += s.voidTotal;
    }

    totals.outstandingBalance = totals.topupTotal - totals.chargeTotal - totals.refundTotal + totals.voidTotal;
    totals.netCashIn = totals.topupTotal - totals.refundTotal;

    return jsonResponse({
      summaries,
      venueTotals: totals,
    });
  } catch (e: unknown) {
    return errorResponse("Failed to load reconciliation data", 500);
  }
}
