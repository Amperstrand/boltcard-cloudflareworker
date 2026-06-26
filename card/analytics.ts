import type { Env, AnalyticsResult } from "../types/core.js";
import { doSafeGet } from "./doFacade.js";

const EMPTY_ANALYTICS: AnalyticsResult = Object.freeze({
  totalMsat: 0, completedMsat: 0, failedMsat: 0, pendingMsat: 0,
  totalTaps: 0, completedTaps: 0, failedTaps: 0, pendingTaps: 0,
});

export async function getAnalytics(env: Env, uidHex: string): Promise<AnalyticsResult> {
  return doSafeGet(env, uidHex, "/analytics", { ...EMPTY_ANALYTICS });
}
