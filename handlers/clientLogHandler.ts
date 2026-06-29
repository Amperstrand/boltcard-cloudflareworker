import type { IRequest } from "itty-router";
import type { Env } from "../types/core.js";
import { jsonResponse } from "../utils/responses.js";
import { logger } from "../utils/logger.js";

// ── Body + rate-limit constants ──────────────────────────────
const CLIENT_LOG_MAX_BODY_BYTES = 64 * 1024;
const CLIENT_LOG_RATE_LIMIT = 50;
const CLIENT_LOG_WINDOW_MS = 60_000;

/** Isolate-scoped rate limiter (in-memory, per-pattern). */
const clientLogBuckets = new Map<string, { count: number; windowStart: number }>();

interface ClientErrorReport {
  type: string;
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  timestamp: number;
  userAgent?: string;
  correlationId?: string;
}

// ── CORS ──────────────────────────────────────────────────────

export const CLIENT_LOG_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function corsResponse(data: unknown, status: number): Response {
  const response = jsonResponse(data, status);
  for (const [key, value] of Object.entries(CLIENT_LOG_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ── Rate limiter ──────────────────────────────────────────────

function checkClientLogRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = clientLogBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > CLIENT_LOG_WINDOW_MS) {
    clientLogBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count++;
  return bucket.count <= CLIENT_LOG_RATE_LIMIT;
}

// ── OPTIONS preflight ─────────────────────────────────────────

export function handleClientLogOptions(): Response {
  return new Response(null, { status: 204, headers: CLIENT_LOG_CORS_HEADERS });
}

// ── POST handler ──────────────────────────────────────────────

export async function handleClientLog(request: IRequest, _env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (!checkClientLogRateLimit(ip)) {
    return corsResponse({ error: "Rate limit exceeded" }, 429);
  }

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > CLIENT_LOG_MAX_BODY_BYTES) {
    return corsResponse({ error: "Body too large" }, 413);
  }

  let body: { errors?: ClientErrorReport[] };
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: "Invalid JSON body" }, 400);
  }

  const errors = Array.isArray(body.errors) ? body.errors : [];

  for (const err of errors) {
    logger.info("client_error", {
      event: "client_error",
      correlationId: (err.correlationId ?? "none").substring(0, 100),
      type: (err.type ?? "").substring(0, 100),
      message: (err.message ?? "").substring(0, 500),
      stack: (err.stack ?? "").substring(0, 500),
      url: (err.url ?? "").substring(0, 200),
      userAgent: (err.userAgent ?? "").substring(0, 100),
      clientIp: ip,
    });
  }

  return corsResponse({ ok: true, received: errors.length }, 200);
}
