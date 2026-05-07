import { DurableObject } from "cloudflare:workers";
import { logger, getErrorMessage } from "../utils/logger.js";
import { initCardReplaySchema } from "./cardReplay/schema.js";
import { handleActivate, handleDeliverKeys, handleDiscover, handleGetCardState, handleMarkPending, handleRequestWipe, handleTerminate } from "./cardReplay/cardStateHandlers.js";
import { handleGetConfig, handleSetConfig, handleSetK2 } from "./cardReplay/configHandlers.js";
import { handleAnalytics, handleCheck, handleClaimTap, handleListTaps, handleRecordRead, handleRecordTap, handleUpdateTapStatus } from "./cardReplay/tapHandlers.js";
import { handleCredit, handleDebit, handleGetBalance, handleListTransactions, handleReset } from "./cardReplay/balanceHandlers.js";

export class CardReplayDO extends DurableObject<Env> {
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
        return handleCheck(this.sql, request, false);
      }

      if (request.method === "POST" && url.pathname === "/check-readonly") {
        return handleCheck(this.sql, request, true);
      }

      if (request.method === "POST" && url.pathname === "/record-tap") {
        return handleRecordTap(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/record-read") {
        return handleRecordRead(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/update-tap-status") {
        return handleUpdateTapStatus(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/claim-tap") {
        return handleClaimTap(this.sql, request);
      }

      if (request.method === "GET" && url.pathname === "/analytics") {
        return handleAnalytics(this.sql);
      }

      if (request.method === "GET" && url.pathname === "/list-taps") {
        return handleListTaps(this.sql, url);
      }

      if (request.method === "GET" && url.pathname === "/card-state") {
        return handleGetCardState(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/deliver-keys") {
        return handleDeliverKeys(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/activate") {
        return handleActivate(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/terminate") {
        return handleTerminate(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/request-wipe") {
        return handleRequestWipe(this.sql);
      }

      if (request.method === "GET" && url.pathname === "/get-config") {
        return handleGetConfig(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/set-config") {
        return handleSetConfig(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/debit") {
        return handleDebit(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/credit") {
        return handleCredit(this.sql, request);
      }

      if (request.method === "GET" && url.pathname === "/balance") {
        return handleGetBalance(this.sql);
      }

      if (request.method === "GET" && url.pathname === "/transactions") {
        return handleListTransactions(this.sql, url);
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        return handleReset(this.sql);
      }

      if (request.method === "POST" && url.pathname === "/mark-pending") {
        return handleMarkPending(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/discover") {
        return handleDiscover(this.sql, request);
      }

      if (request.method === "POST" && url.pathname === "/set-k2") {
        return handleSetK2(this.sql, request);
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
