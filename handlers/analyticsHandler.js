import { getAnalytics } from "../replayProtection.js";
import { renderAnalyticsPage } from "../templates/analyticsPage.js";
import { htmlResponse, errorResponse, jsonResponse } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

export function handleAnalyticsPage() {
  return htmlResponse(renderAnalyticsPage());
}

export async function handleAnalyticsData(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return errorResponse("Missing uid parameter", 400);
  }

  try {
    const analytics = await getAnalytics(env, uid);
    return jsonResponse(analytics);
  } catch (error) {
    logger.error("Analytics data fetch failed", { uid, error: error.message });
    return errorResponse("Failed to retrieve analytics data", 500);
  }
}
