import type { AppRouter, AuthedHandler } from "../middleware/withOperatorAuth.js";
import { withOperatorAuth } from "../middleware/withOperatorAuth.js";
import { redirect } from "../utils/responses.js";
import { getRequestOrigin } from "../utils/validation.js";
import { handleOperatorLoginPage, handleOperatorLogin, handleOperatorLogout } from "../handlers/operatorLoginHandler.js";
import { handlePosPage } from "../handlers/posHandler.js";
import { handlePosCharge } from "../handlers/posChargeHandler.js";
import { handleMenuEditorPage, handleMenuGet, handleMenuPut } from "../handlers/menuEditorHandler.js";
import { handleTopupPage, handleTopupApply } from "../handlers/topupHandler.js";
import { handleRefundPage, handleRefundApply } from "../handlers/refundHandler.js";
import { handleVoidPage, handleVoidApply, handleVoidTransactions } from "../handlers/voidHandler.js";
import { handleReconciliationPage, handleReconciliationData } from "../handlers/reconciliationHandler.js";
import { handleCardAuditPage, handleCardAuditData, handleIndexRepair } from "../handlers/cardAuditHandler.js";
import { handleCardExport, handleCardRestore } from "../handlers/cardBackupHandler.js";
import { handleCardBatchAction } from "../handlers/cardBatchHandler.js";
import { handleHealthPage, handleHealthData } from "../handlers/healthHandler.js";
import { handleAuditExport, handleShiftReportPage } from "../handlers/reportsHandler.js";
import { handleReceipt } from "../handlers/receiptHandler.js";

export function registerOperatorRoutes(router: AppRouter): void {
  router.get("/operator/login", (request) => handleOperatorLoginPage(request));
  router.post("/operator/login", (request, env) => handleOperatorLogin(request, env));
  router.post("/operator/logout", (request, env) => handleOperatorLogout(request, env));

  router.get("/operator", withOperatorAuth(() => redirect("/operator/pos")));

  router.get("/operator/pos", withOperatorAuth((request, env) => handlePosPage(request, env)));
  router.post("/operator/pos/charge", withOperatorAuth((request, env, session) => handlePosCharge(request, env, session)));
  router.get("/operator/pos/menu", withOperatorAuth((request, env) => handleMenuEditorPage(request, env)));
  router.put("/operator/pos/menu", withOperatorAuth((request, env) => handleMenuPut(request, env)));
  router.get("/api/pos/menu", withOperatorAuth((request, env) => handleMenuGet(request, env)));
  router.get("/api/receipt/:txnId", withOperatorAuth((request, env) => handleReceipt(request, env)));

  router.get("/operator/topup", withOperatorAuth((request, env) => handleTopupPage(request, env)));
  router.post("/operator/topup/apply", withOperatorAuth((request, env, session) => handleTopupApply(request, env, session)));

  router.get("/operator/refund", withOperatorAuth((request, env) => handleRefundPage(request, env)));
  router.post("/operator/refund/apply", withOperatorAuth((request, env, session) => handleRefundApply(request, env, session)));

  router.get("/operator/void", withOperatorAuth((request, env) => handleVoidPage(request, env)));
  router.post("/operator/void/apply", withOperatorAuth((request, env, session) => handleVoidApply(request, env, session)));
  router.get("/operator/void/transactions", withOperatorAuth((request, env) => handleVoidTransactions(request, env)));

  router.get("/operator/reconciliation", withOperatorAuth((request, env) => handleReconciliationPage(request, env)));
  router.get("/operator/reconciliation/data", withOperatorAuth((request, env) => handleReconciliationData(request, env)));

  router.get("/operator/cards", withOperatorAuth((request, env) => handleCardAuditPage(request, env)));
  router.get("/operator/cards/data", withOperatorAuth((request, env) => handleCardAuditData(request, env)));
  router.post("/operator/cards/batch", withOperatorAuth((request, env, session) => handleCardBatchAction(request, env, session)));
  router.post("/operator/cards/repair", withOperatorAuth((request, env) => handleIndexRepair(request, env)));
  router.get("/operator/cards/:uid/export", withOperatorAuth((request, env) => handleCardExport(request, env)));
  router.post("/operator/cards/:uid/restore", withOperatorAuth((request, env, session) => handleCardRestore(request, env, session)));

  router.get("/operator/health", withOperatorAuth((request, env) => handleHealthPage(request, env)));
  router.get("/operator/health/data", withOperatorAuth((request, env) => handleHealthData(request, env)));
  router.get("/operator/audit/export", withOperatorAuth((request, env) => handleAuditExport(request, env)));
  router.get("/operator/shift/report", withOperatorAuth((request, env) => handleShiftReportPage(request, env)));
}
