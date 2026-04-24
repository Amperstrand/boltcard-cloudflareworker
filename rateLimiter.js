// IP-based rate limiting for Cloudflare Workers using KV.
// Fixed-window counter per IP with configurable limits.

export async function checkRateLimit(request, env, options = {}) {
  const maxRequests = options.maxRequests ?? 100;
  const windowSeconds = options.windowSeconds ?? 60;

  // If no KV binding, skip rate limiting (dev/local mode)
  if (!env.RATE_LIMITS) {
    return { allowed: true, remaining: maxRequests, resetAt: 0 };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const key = `${ip}:${windowStart}`;

  const current = parseInt(await env.RATE_LIMITS.get(key), 10) || 0;

  if (current >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: (windowStart + windowSeconds) * 1000,
    };
  }

  // TTL = 2 windows so stale entries auto-expire
  await env.RATE_LIMITS.put(key, String(current + 1), {
    expirationTtl: windowSeconds * 2,
  });

  return {
    allowed: true,
    remaining: maxRequests - current - 1,
    resetAt: (windowStart + windowSeconds) * 1000,
  };
}
