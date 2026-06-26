import type { AppRouter } from "../middleware/withOperatorAuth.js";
import { withOperatorAuth } from "../middleware/withOperatorAuth.js";
import { redirect } from "../utils/responses.js";
import { getRequestOrigin } from "../utils/validation.js";
import { handleDebugPage } from "../handlers/debugHandler.js";
import { handleActivateCardPage as handleActivateForm, handleActivateCardSubmit } from "../handlers/activateCardHandler.js";
import { handleActivatePage } from "../handlers/activatePageHandler.js";
import { handleReset } from "../handlers/resetHandler.js";
import { handleWipePage } from "../handlers/wipePageHandler.js";
import { handleBulkWipePage } from "../handlers/bulkWipePageHandler.js";
import { handleAnalyticsPage, handleAnalyticsData } from "../handlers/analyticsHandler.js";
import { handleTestErrorPage } from "../handlers/testErrorHandler.js";

export function registerAdminRoutes(router: AppRouter): void {
  router.get("/debug", withOperatorAuth((request) => handleDebugPage(request)));
  router.get("/test-error", withOperatorAuth((request, env) => handleTestErrorPage(request, env)));

  router.get("/experimental/nfc", (request) => {
    return redirect(new URL(request.url).origin + "/debug#console", 302);
  });
  router.get("/experimental/activate", withOperatorAuth((request, env) => handleActivatePage(request, env)));
  router.get("/experimental/activate/form", withOperatorAuth(() => handleActivateForm()));
  router.post("/experimental/activate/form", withOperatorAuth((request, env) => handleActivateCardSubmit(request, env)));
  router.get("/experimental/wipe", withOperatorAuth((request, env) => {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid");
    if (uid) return handleReset(uid, env, getRequestOrigin(request));
    return handleWipePage(request, env);
  }));
  router.get("/experimental/bulkwipe", withOperatorAuth((request) => handleBulkWipePage(request)));
  router.get("/experimental/analytics", withOperatorAuth(() => handleAnalyticsPage()));
  router.get("/experimental/analytics/data", withOperatorAuth((request, env) => handleAnalyticsData(request, env)));

  router.post("/activate/form", withOperatorAuth((request, env) => handleActivateCardSubmit(request, env)));

  router.get("/nfc", (request) => {
    return redirect(new URL(request.url).origin + "/debug#console", 302);
  });
  router.get("/activate", (request) => {
    return redirect(new URL(request.url).origin + "/experimental/activate", 302);
  });
  router.get("/activate/form", (request) => {
    return redirect(new URL(request.url).origin + "/experimental/activate/form", 302);
  });
  router.get("/wipe", withOperatorAuth((request, env) => {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid");
    if (uid) return handleReset(uid, env, getRequestOrigin(request));
    return redirect(url.origin + "/experimental/wipe", 302);
  }));
  router.get("/bulkwipe", (request) => {
    return redirect(new URL(request.url).origin + "/experimental/bulkwipe", 302);
  });
  router.get("/analytics", (request) => {
    return redirect(new URL(request.url).origin + "/experimental/analytics", 302);
  });
  router.get("/analytics/data", withOperatorAuth((request, env) => handleAnalyticsData(request, env)));
}
