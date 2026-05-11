import type { IRequest } from "itty-router";
import type { Env } from "../types/core.js";
import { parseJsonBody } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

export async function handleClientError(request: IRequest, _env: Env): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body || typeof body !== "object") {
    return new Response(null, { status: 204 });
  }

  const message = typeof (body as Record<string, unknown>).message === "string"
    ? (body as Record<string, unknown>).message as string
    : "unknown";
  const stack = typeof (body as Record<string, unknown>).stack === "string"
    ? (body as Record<string, unknown>).stack as string
    : undefined;
  const source = typeof (body as Record<string, unknown>).source === "string"
    ? (body as Record<string, unknown>).source as string
    : undefined;
  const url = typeof (body as Record<string, unknown>).url === "string"
    ? (body as Record<string, unknown>).url as string
    : undefined;
  const deploy = typeof (body as Record<string, unknown>).deploy === "string"
    ? (body as Record<string, unknown>).deploy as string
    : undefined;
  const js = typeof (body as Record<string, unknown>).js === "string"
    ? (body as Record<string, unknown>).js as string
    : undefined;

  logger.warn("client-error", {
    clientMessage: message.substring(0, 500),
    clientStack: stack ? stack.substring(0, 500) : undefined,
    clientSource: source,
    clientUrl: url,
    clientDeploy: deploy,
    clientJs: js,
    clientIp: request.headers.get("CF-Connecting-IP") || undefined,
  });

  return new Response(null, { status: 204 });
}
