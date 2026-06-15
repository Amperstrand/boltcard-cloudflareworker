import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { htmlResponse } from "../utils/responses.js";
import { BUILD_REVISION } from "../utils/buildInfo.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { listIndexedCards } from "../utils/cardIndex.js";
import { listShiftSummaries } from "../utils/shiftSummary.js";
import { _listAuditEvents } from "../utils/auditLog.js";
import { CARD_STATE } from "../utils/constants.js";
import { renderHealthPage } from "../templates/healthPage.js";

interface SystemStatus {
  kv: 'ok' | 'error';
  durableObject: 'ok' | 'error' | 'not_configured';
  overall: 'healthy' | 'degraded' | 'down';
}

async function checkKvHealth(env: Env): Promise<boolean> {
  try {
    const testKey = 'health-' + Date.now();
    await env.UID_CONFIG.put(testKey, 'ok');
    const val = await env.UID_CONFIG.get(testKey);
    await env.UID_CONFIG.delete(testKey);
    return val === 'ok';
  } catch (e: unknown) {
    logger.error("KV health check failed", { error: getErrorMessage(e) });
    return false;
  }
}

async function checkDoHealth(env: Env): Promise<'ok' | 'error' | 'not_configured'> {
  if (!env?.CARD_REPLAY) return 'not_configured';
  try {
    const doId = env.CARD_REPLAY.idFromName('__health_check__');
    const stub = env.CARD_REPLAY.get(doId);
    const resp = await stub.fetch(new Request('https://card-replay.internal/card-state'));
    return resp.ok ? 'ok' : 'error';
  } catch (e: unknown) {
    logger.error("DO health check failed", { error: getErrorMessage(e) });
    return 'error';
  }
}

export async function handleHealthPage(request: Request, env: Env): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;
  return htmlResponse(renderHealthPage());
}

export async function handleHealthData(request: Request, env: Env): Promise<Response> {
  const auth = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const startTime = Date.now();

  const [kvOk, doStatus] = await Promise.all([
    checkKvHealth(env),
    checkDoHealth(env),
  ]);

  const systemStatus: SystemStatus = {
    kv: kvOk ? 'ok' : 'error',
    durableObject: doStatus,
    overall: kvOk && doStatus === 'ok' ? 'healthy' : !kvOk && doStatus !== 'ok' ? 'down' : 'degraded',
  };

  const cardCounts: Record<string, number> = {
    [CARD_STATE.ACTIVE]: 0,
    [CARD_STATE.DISCOVERED]: 0,
    [CARD_STATE.PENDING]: 0,
    [CARD_STATE.KEYS_DELIVERED]: 0,
    [CARD_STATE.TERMINATED]: 0,
    [CARD_STATE.WIPE_REQUESTED]: 0,
    total: 0,
  };

  try {
    let cursor: string | null = null;
    do {
      const result = await listIndexedCards(env, { limit: 1000, cursor });
      for (const card of result.cards) {
        if (card.state in cardCounts) cardCounts[card.state]!++;
        cardCounts.total!++;
      }
      cursor = result.cursor;
    } while (cursor);
  } catch (e: unknown) {
    logger.warn("Failed to count cards", { error: getErrorMessage(e) });
  }

  let financialTotals = {
    topupCount: 0, topupTotal: 0,
    chargeCount: 0, chargeTotal: 0,
    refundCount: 0, refundTotal: 0,
    voidCount: 0, voidTotal: 0,
    outstandingBalance: 0, netCashIn: 0,
  };

  try {
    const summaries = await listShiftSummaries(env);
    for (const s of summaries) {
      financialTotals.topupCount += s.topupCount;
      financialTotals.topupTotal += s.topupTotal;
      financialTotals.chargeCount += s.chargeCount;
      financialTotals.chargeTotal += s.chargeTotal;
      financialTotals.refundCount += s.refundCount;
      financialTotals.refundTotal += s.refundTotal;
      financialTotals.voidCount += s.voidCount;
      financialTotals.voidTotal += s.voidTotal;
    }
    financialTotals.outstandingBalance = financialTotals.topupTotal - financialTotals.chargeTotal - financialTotals.refundTotal + financialTotals.voidTotal;
    financialTotals.netCashIn = financialTotals.topupTotal - financialTotals.refundTotal;
  } catch (e: unknown) {
    logger.warn("Failed to aggregate financial totals", { error: getErrorMessage(e) });
  }

  let recentEvents: Record<string, unknown>[] = [];
  try {
    const result = await _listAuditEvents(env, { limit: 10 });
    recentEvents = result.events;
  } catch (e: unknown) {
    logger.warn("Failed to list audit events", { error: getErrorMessage(e) });
  }

  return jsonResponse({
    system: systemStatus,
    version: BUILD_REVISION,
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - startTime,
    cards: cardCounts,
    financials: financialTotals,
    recentEvents,
  });
}
