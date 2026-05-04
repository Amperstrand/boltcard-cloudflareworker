interface RateLimitOptions {
  maxRequests?: number;
  windowSeconds?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface EnvLike {
  RATE_LIMITS?: KVNamespace;
}

export async function checkRateLimit(request: Request, env: EnvLike, options: RateLimitOptions = {}): Promise<RateLimitResult> {
  const maxRequests = options.maxRequests ?? 100;
  const windowSeconds = options.windowSeconds ?? 60;

  if (!env.RATE_LIMITS) {
    return { allowed: true, remaining: maxRequests, resetAt: 0 };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const key = `${ip}:${windowStart}`;

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
