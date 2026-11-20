import { DurableObject } from "cloudflare:workers";
import { logger, getErrorMessage } from "../utils/logger.js";
import { initCardReplaySchema } from "./cardReplay/schema.js";
import { handleActivate, handleDeliverKeys, handleDiscover, handleGetCardState, handleMarkPending, handleRequestWipe, handleTerminate } from "./cardReplay/cardStateHandlers.js";
import { handleGetConfig, handleSetConfig, handleSetK2 } from "./cardReplay/configHandlers.js";
import { handleAnalytics, handleCheck, handleClaimTap, handleListTaps, handleRecordRead, handleRecordTap, handleUpdateTapStatus } from "./cardReplay/tapHandlers.js";
import { handleK1Issue, handleK1Verify } from "./cardReplay/k1ChallengeHandlers.js";
import { handleCredit, handleDebit, handleGetBalance, handleListTransactions, handleReset, handleVoid } from "./cardReplay/balanceHandlers.js";
import { handleExportState, handleImportState } from "./cardReplay/stateExportHandlers.js";

export class CardReplayStore extends DurableObject<Env> {
  declare state: DurableObjectState;
  declare env: Env;
  sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;

    state.blockConcurrencyWhile(async () => {
      initCardReplaySchema(this.sql);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/check") {
        return await handleCheck(this.sql, request, false);
      }

      if (request.method === "POST" && url.pathname === "/check-readonly") {
        return await handleCheck(this.sql, request, true);
      }

      if (request.method === "POST" && url.pathname === "/record-tap") {
        return await handleRecordTap(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/record-read") {
        return await handleRecordRead(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/update-tap-status") {
        return await handleUpdateTapStatus(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/claim-tap") {
        return await handleClaimTap(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/k1-issue") {
        return await handleK1Issue(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/k1-verify") {
        return await handleK1Verify(this.sql, request);
      }

      if (request.method === "GET" && url.pathname === "/analytics") {
        return await handleAnalytics(this.sql);
      }

      if (request.method === "GET" && url.pathname === "/list-taps") {
        return await handleListTaps(this.sql, url);
      }

      if (request.method === "GET" && url.pathname === "/card-state") {
        return await handleGetCardState(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/deliver-keys") {
        return await handleDeliverKeys(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/activate") {
        return await handleActivate(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/terminate") {
        return await handleTerminate(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/request-wipe") {
        return await handleRequestWipe(this.sql);
      }

      if (request.method === "GET" && url.pathname === "/get-config") {
        return await handleGetConfig(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/set-config") {
        return await handleSetConfig(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/debit") {
        return await handleDebit(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/credit") {
        return await handleCredit(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/void") {
        return await handleVoid(this.sql, request);
      }

      if (request.method === "GET" && url.pathname === "/balance") {
        return await handleGetBalance(this.sql);
      }

      if (request.method === "GET" && url.pathname === "/transactions") {
        return await handleListTransactions(this.sql, url);
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        return await handleReset(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/mark-pending") {
        return await handleMarkPending(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/discover") {
        return await handleDiscover(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/set-k2") {
        return await handleSetK2(this.sql, request);
      }

      if (request.method === "GET" && url.pathname === "/export-state") {
        return await handleExportState(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/import-state") {
        return await handleImportState(this.sql, request);
      }
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      logger.error("Unhandled DO error", { path: url.pathname, error: getErrorMessage(err) });
      return Response.json({ error: "Internal error" }, { status: 500 });
    }

    return new Response("Not found", { status: 404 });
  }
}
