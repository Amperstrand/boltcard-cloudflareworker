import { getAnalytics } from "../replayProtection.js";
import { renderAnalyticsPage } from "../templates/analyticsPage.js";
import { htmlResponse } from "../utils/responses.js";

export async function handleAnalyticsPage() {
  return htmlResponse(renderAnalyticsPage());
}

export async function handleAnalyticsData(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return new Response(JSON.stringify({ error: "Missing uid parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const analytics = await getAnalytics(env, uid);
  return new Response(JSON.stringify(analytics), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
