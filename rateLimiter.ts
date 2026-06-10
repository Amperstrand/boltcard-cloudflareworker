import type { Env } from "./types/core.js";

interface RateLimitOptions {
  maxRequests?: number;
  windowSeconds?: number;
  customKey?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}


export async function checkRateLimit(request: Request, env: Env, options: RateLimitOptions = {}): Promise<RateLimitResult> {
  const maxRequests = options.maxRequests ?? 100;
  const windowSeconds = options.windowSeconds ?? 60;

  if (!env.RATE_LIMITS) {
    return { allowed: true, remaining: maxRequests, resetAt: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const rawKey = options.customKey || (request.headers.get("CF-Connecting-IP") || "unknown");
  const key = `${rawKey}:${windowStart}`;

  const current = parseInt(await env.RATE_LIMITS.get(key) ?? "0", 10) || 0;

  if (current >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: (windowStart + windowSeconds) * 1000,
    };
  }

  await env.RATE_LIMITS.put(key, String(current + 1), {
    expirationTtl: windowSeconds * 2,
  });

  return {
    allowed: true,
    remaining: maxRequests - current - 1,
    resetAt: (windowStart + windowSeconds) * 1000,
  };
}
