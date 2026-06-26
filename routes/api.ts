import type { AppRouter } from "../middleware/withOperatorAuth.js";
import { withOperatorAuth } from "../middleware/withOperatorAuth.js";
import { handleIdentifyCard } from "../handlers/identifyCardHandler.js";
import { handleIdentifyIssuerKey } from "../handlers/identifyIssuerKeyHandler.js";
import { handleVirtualCardKeys } from "../handlers/virtualCardHandler.js";
import { handleGetKeys } from "../handlers/getKeysHandler.js";
import { handleBulkWipeKeys } from "../handlers/bulkWipeHandler.js";
import { fetchBoltCardKeys } from "../handlers/fetchBoltCardKeys.js";

export function registerApiRoutes(router: AppRouter): void {
  router.post("/api/identify-card", withOperatorAuth((request, env) => handleIdentifyCard(request, env)));
  router.post("/api/identify-issuer-key", withOperatorAuth((request, env) => handleIdentifyIssuerKey(request, env)));
  router.get("/api/debug/virtual-card-keys", withOperatorAuth((request, env) => handleVirtualCardKeys(request, env)));

  router.get("/api/keys", withOperatorAuth((request, env) => handleGetKeys(request, env)));
  router.post("/api/keys", withOperatorAuth((request, env) => handleGetKeys(request, env)));
  router.all("/api/v1/pull-payments/:pullPaymentId/boltcards", withOperatorAuth((request, env) => fetchBoltCardKeys(request, env)));
  router.get("/api/bulk-wipe-keys", withOperatorAuth((request) => handleBulkWipeKeys(request)));
  router.post("/api/bulk-wipe-keys", withOperatorAuth((request) => handleBulkWipeKeys(request)));
}
