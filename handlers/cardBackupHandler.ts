import { errorResponse, jsonResponse, parseJsonBody } from "../utils/responses.js";
import { getErrorMessage } from "../utils/logger.js";
import { logger } from "../utils/logger.js";
import type { Env, SessionPayload } from "../types/core.js";
import { requireOperator, type OperatorAuthResult } from "../middleware/operatorAuth.js";
import { exportCardState, importCardState, ImportContractError } from "../replayProtection.js";
import { recordAuditEvent } from "../utils/auditLog.js";
import type { CardExportData } from "../durableObjects/cardReplay/routes.js";

function extractUidFromPath(pathname: string): string | null {
  const pathParts = pathname.split("/");
  const uid = pathParts[3];
  if (!uid || uid === "export" || uid === "restore") return null;
  return uid;
}

export async function handleCardExport(request: Request, env: Env): Promise<Response> {
  const auth: OperatorAuthResult = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const uid = extractUidFromPath(url.pathname);
  if (!uid) {
    return errorResponse("UID required", 400);
  }

  try {
    const data: CardExportData = await exportCardState(env, uid);
    const json = JSON.stringify(data, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "");
    return new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="card-${uid}-${timestamp}.json"`,
      },
    });
  } catch (err: unknown) {
    logger.error("Card export failed", { uid, error: getErrorMessage(err) });
    return errorResponse("Failed to export card state", 500);
  }
}

export async function handleCardRestore(request: Request, env: Env, session?: SessionPayload): Promise<Response> {
  const auth: OperatorAuthResult = requireOperator(request, env);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const uid = extractUidFromPath(url.pathname);
  if (!uid) {
    return errorResponse("UID required", 400);
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  try {
    const exportData = body as CardExportData;
    if (exportData.version !== 1) {
      return errorResponse("Unsupported export version", 400);
    }
    const result = await importCardState(env, uid, exportData);
    await recordAuditEvent(env, {
      action: "restore",
      uidHex: uid,
      operatorShiftId: session?.shiftId || null,
      details: { tables: result.tables },
    });
    return jsonResponse(result);
  } catch (err: unknown) {
    if (err instanceof ImportContractError) {
      // ops#66: DO /import-state contract rejections (reserved-keys guard,
      // rowid-bind gate) map through as 4xx with the DO's payload — the
      // message becomes the API error string, extra payload keys
      // (reserved_keys) ride along, and the log keeps the full detail.
      const { error: _doError, ...extra } = err.payload;
      logger.warn("Card restore rejected by DO contract", { uid, status: err.status, payload: err.payload });
      return errorResponse(err.message, err.status, extra);
    }
    logger.error("Card restore failed", { uid, error: getErrorMessage(err) });
    return errorResponse("Failed to restore card state", 500);
  }
}
