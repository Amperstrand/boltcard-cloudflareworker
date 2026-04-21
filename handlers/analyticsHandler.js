import { getAnalytics } from "../replayProtection.js";
import { renderAnalyticsPage } from "../templates/analyticsPage.js";
import { htmlResponse, errorResponse, jsonResponse } from "../utils/responses.js";

export async function handleAnalyticsPage() {
  return htmlResponse(renderAnalyticsPage());
}

export async function handleAnalyticsData(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return errorResponse("Missing uid parameter", 400);
  }

  const analytics = await getAnalytics(env, uid);
  return jsonResponse(analytics);
}
