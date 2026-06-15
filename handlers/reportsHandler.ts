import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { _listAuditEvents } from "../utils/auditLog.js";
import { listShiftSummaries, getShiftSummary, type ShiftSummary } from "../utils/shiftSummary.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { BUILD_REVISION } from "../utils/buildInfo.js";

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatEpochMs(ms: number): string {
  return new Date(ms).toISOString();
}

export async function handleAuditExport(request: Request, env: Env): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "csv";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "5000", 10) || 5000, 10000);

  try {
    const result = await _listAuditEvents(env, { limit });
    const events = result.events;

    if (format === "json") {
      return new Response(JSON.stringify(events, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="audit-export-${Date.now()}.json"`,
        },
      });
    }

    const headers = ["timestamp", "iso_time", "action", "uid", "operator_shift", "amount", "details"];
    const rows: string[] = [headers.join(",")];

    for (const ev of events) {
      const ts = ev.timestamp as number;
      const details = ev.details as Record<string, unknown> | undefined;
      const amount = details?.amount ?? "";
      const detailStr = details ? JSON.stringify(details) : "";
      rows.push([
        csvEscape(ts),
        csvEscape(formatEpochMs(ts)),
        csvEscape(ev.action),
        csvEscape(ev.uid),
        csvEscape(ev.operator),
        csvEscape(amount),
        csvEscape(detailStr),
      ].join(","));
    }

    const csv = rows.join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-export-${Date.now()}.csv"`,
      },
    });
  } catch (e: unknown) {
    logger.error("Audit export failed", { error: getErrorMessage(e) });
    return errorResponse("Failed to export audit data", 500);
  }
}

interface ShiftReportTotals {
  topupCount: number; topupTotal: number;
  chargeCount: number; chargeTotal: number;
  refundCount: number; refundTotal: number;
  voidCount: number; voidTotal: number;
  outstandingBalance: number; netCashIn: number;
}

function aggregateTotals(summaries: ShiftSummary[]): ShiftReportTotals {
  const t: ShiftReportTotals = {
    topupCount: 0, topupTotal: 0,
    chargeCount: 0, chargeTotal: 0,
    refundCount: 0, refundTotal: 0,
    voidCount: 0, voidTotal: 0,
    outstandingBalance: 0, netCashIn: 0,
  };
  for (const s of summaries) {
    t.topupCount += s.topupCount;
    t.topupTotal += s.topupTotal;
    t.chargeCount += s.chargeCount;
    t.chargeTotal += s.chargeTotal;
    t.refundCount += s.refundCount;
    t.refundTotal += s.refundTotal;
    t.voidCount += s.voidCount;
    t.voidTotal += s.voidTotal;
  }
  t.outstandingBalance = t.topupTotal - t.chargeTotal - t.refundTotal + t.voidTotal;
  t.netCashIn = t.topupTotal - t.refundTotal;
  return t;
}

export async function handleShiftReportPage(request: Request, env: Env): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const shiftId = url.searchParams.get("shift") || auth.session.shiftId;

  let summary: ShiftSummary | null = null;
  if (shiftId) {
    summary = await getShiftSummary(env, shiftId);
  }

  const allSummaries = await listShiftSummaries(env);
  const totals = aggregateTotals(allSummaries);
  const currency = getCurrencyLabel(env);
  const now = new Date().toISOString();

  const summaryRows = allSummaries.map((s) => {
    const balance = s.topupTotal - s.chargeTotal - s.refundTotal + s.voidTotal;
    return `<tr class="border-b border-gray-700">
      <td class="px-3 py-2 font-mono text-gray-500 text-xs">${escapeHtml(s.shiftId.slice(0, 8))}</td>
      <td class="px-3 py-2 text-gray-400 text-xs">${new Date(s.startedAt).toLocaleString()}</td>
      <td class="px-3 py-2 text-right text-emerald-400">${s.topupTotal.toLocaleString()}</td>
      <td class="px-3 py-2 text-right text-blue-400">${s.chargeTotal.toLocaleString()}</td>
      <td class="px-3 py-2 text-right text-amber-400">${s.refundTotal.toLocaleString()}</td>
      <td class="px-3 py-2 text-right text-red-400">${s.voidTotal.toLocaleString()}</td>
      <td class="px-3 py-2 text-right text-white font-bold">${balance.toLocaleString()}</td>
    </tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shift Report — ${now}</title>
  <style>
    body { background: #111827; color: #f3f4f6; font-family: system-ui, sans-serif; padding: 2rem; }
    h1 { color: #10b981; font-size: 1.5rem; margin-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th { text-align: left; padding: 0.5rem; color: #6b7280; font-size: 0.75rem; text-transform: uppercase; }
    td { padding: 0.5rem; font-size: 0.875rem; }
    .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1.5rem 0; }
    .total-card { background: #1f2937; border: 1px solid #374151; border-radius: 0.75rem; padding: 1rem; }
    .total-label { color: #6b7280; font-size: 0.75rem; text-transform: uppercase; }
    .total-value { font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem; }
    .meta { color: #6b7280; font-size: 0.75rem; margin-bottom: 1rem; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>Shift Report</h1>
  <p class="meta">Generated ${now} · Version ${BUILD_REVISION} · Currency: ${escapeHtml(currency)}</p>
  <button class="no-print" onclick="window.print()" style="background:#10b981;color:white;border:none;padding:0.5rem 1rem;border-radius:0.5rem;cursor:pointer;margin-bottom:1rem">Print / Save PDF</button>

  <div class="totals">
    <div class="total-card">
      <div class="total-label">Top-ups</div>
      <div class="total-value text-emerald-400" style="color:#34d399">${totals.topupTotal.toLocaleString()}</div>
      <div style="color:#6b7280;font-size:0.75rem">${totals.topupCount} transactions</div>
    </div>
    <div class="total-card">
      <div class="total-label">Charges</div>
      <div class="total-value" style="color:#60a5fa">${totals.chargeTotal.toLocaleString()}</div>
      <div style="color:#6b7280;font-size:0.75rem">${totals.chargeCount} transactions</div>
    </div>
    <div class="total-card">
      <div class="total-label">Refunds</div>
      <div class="total-value" style="color:#fbbf24">${totals.refundTotal.toLocaleString()}</div>
      <div style="color:#6b7280;font-size:0.75rem">${totals.refundCount} transactions</div>
    </div>
    <div class="total-card">
      <div class="total-label">Voids</div>
      <div class="total-value" style="color:#f87171">${totals.voidTotal.toLocaleString()}</div>
      <div style="color:#6b7280;font-size:0.75rem">${totals.voidCount} transactions</div>
    </div>
    <div class="total-card">
      <div class="total-label">Outstanding Balance</div>
      <div class="total-value" style="color:#f3f4f6">${totals.outstandingBalance.toLocaleString()}</div>
    </div>
    <div class="total-card">
      <div class="total-label">Net Cash In</div>
      <div class="total-value" style="color:#34d399">${totals.netCashIn.toLocaleString()}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Shift</th>
        <th>Started</th>
        <th class="text-right">Top-ups</th>
        <th class="text-right">Charges</th>
        <th class="text-right">Refunds</th>
        <th class="text-right">Voids</th>
        <th class="text-right">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${summaryRows}
    </tbody>
  </table>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
