import { logger } from "./logger.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { SHIFT_SUMMARY_TTL } from "./constants.js";

const SHIFT_PREFIX = "shift:";
const SHIFTS_INDEX_KEY = "shifts:index";

export interface ShiftSummary {
  shiftId: string;
  startedAt: number;
  lastActivity: number;
  topupCount: number;
  topupTotal: number;
  chargeCount: number;
  chargeTotal: number;
  refundCount: number;
  refundTotal: number;
  voidCount: number;
  voidTotal: number;
}

type ShiftAction = "topup" | "pos_charge" | "refund" | "void";

interface ShiftIndexEntry {
  shiftId: string;
  startedAt: number;
}

function emptySummary(shiftId: string, now: number): ShiftSummary {
  return {
    shiftId,
    startedAt: now,
    lastActivity: now,
    topupCount: 0,
    topupTotal: 0,
    chargeCount: 0,
    chargeTotal: 0,
    refundCount: 0,
    refundTotal: 0,
    voidCount: 0,
    voidTotal: 0,
  };
}

export async function updateShiftSummary(env: Env | undefined, shiftId: string, action: string, amount: number): Promise<void> {
  if (!env?.UID_CONFIG) return;
  if (!shiftId || amount <= 0) return;

  const validActions: Set<string> = new Set<ShiftAction>(["topup", "pos_charge", "refund", "void"]);
  if (!validActions.has(action)) return;

  try {
    const key = SHIFT_PREFIX + shiftId;
    const raw = await env.UID_CONFIG.get(key);
    const now = Date.now();
    const summary: ShiftSummary = raw ? JSON.parse(raw) : emptySummary(shiftId, now);

    summary.lastActivity = now;

    if (action === "topup") {
      summary.topupCount++;
      summary.topupTotal += amount;
    } else if (action === "pos_charge") {
      summary.chargeCount++;
      summary.chargeTotal += amount;
    } else if (action === "refund") {
      summary.refundCount++;
      summary.refundTotal += amount;
    } else if (action === "void") {
      summary.voidCount++;
      summary.voidTotal += amount;
    }

    await env.UID_CONFIG.put(key, JSON.stringify(summary), {
      expirationTtl: SHIFT_SUMMARY_TTL,
    });

    // If this is a new shift, add to index
    if (!raw) {
      const indexRaw = await env.UID_CONFIG.get(SHIFTS_INDEX_KEY);
      const index: ShiftIndexEntry[] = indexRaw ? JSON.parse(indexRaw) : [];
      index.push({ shiftId, startedAt: now });
      await env.UID_CONFIG.put(SHIFTS_INDEX_KEY, JSON.stringify(index), {
        expirationTtl: SHIFT_SUMMARY_TTL,
      });
    }
  } catch (e: unknown) {
    logger.warn("Failed to update shift summary", { shiftId, action, amount, error: getErrorMessage(e) });
  }
}

export async function getShiftSummary(env: Env | undefined, shiftId: string): Promise<ShiftSummary | null> {
  if (!env?.UID_CONFIG) return null;
  try {
    const raw = await env.UID_CONFIG.get(SHIFT_PREFIX + shiftId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e: unknown) {
    logger.warn("Failed to get shift summary", { shiftId, error: getErrorMessage(e) });
    return null;
  }
}

export async function listShiftSummaries(env: Env | undefined): Promise<ShiftSummary[]> {
  if (!env?.UID_CONFIG) return [];
  try {
    const indexRaw = await env.UID_CONFIG.get(SHIFTS_INDEX_KEY);
    if (!indexRaw) return [];
    const index: ShiftIndexEntry[] = JSON.parse(indexRaw);
    if (!Array.isArray(index) || index.length === 0) return [];

    const summaries: ShiftSummary[] = [];
    for (const entry of index) {
      const raw = await env.UID_CONFIG.get(SHIFT_PREFIX + entry.shiftId);
      if (raw) {
        try {
          summaries.push(JSON.parse(raw));
        } catch {
          // skip malformed entries
        }
      }
    }

    summaries.sort((a, b) => b.startedAt - a.startedAt);
    return summaries;
  } catch (e: unknown) {
    logger.warn("Failed to list shift summaries", { error: getErrorMessage(e) });
    return [];
  }
}
