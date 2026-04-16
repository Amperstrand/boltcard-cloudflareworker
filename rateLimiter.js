// IP-based rate limiting for Cloudflare Workers using KV.
// Fixed-window counter per IP with configurable limits.

const WINDOW_SECONDS = 60;

/**
 * Check if a request should be rate-limited.
 * Uses CF-Connecting-IP header and a RATE_LIMITS KV namespace.
 *
 * @param {Request} request
 * @param {object} env - Worker environment (must have RATE_LIMITS KV binding)
 * @param {object} [options]
 * @param {number} [options.maxRequests=100] - Max requests per window
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
export async function checkRateLimit(request, env, options = {}) {
  const maxRequests = options.maxRequests ?? 100;

  // If no KV binding, skip rate limiting (dev/local mode)
  if (!env.RATE_LIMITS) {
    return { allowed: true, remaining: maxRequests, resetAt: 0 };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % WINDOW_SECONDS);
  const key = `${ip}:${windowStart}`;

  const current = parseInt(await env.RATE_LIMITS.get(key), 10) || 0;

  if (current >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: (windowStart + WINDOW_SECONDS) * 1000,
    };
  }

  // TTL = 2 windows so stale entries auto-expire
  await env.RATE_LIMITS.put(key, String(current + 1), {
    expirationTtl: WINDOW_SECONDS * 2,
  });

  return {
    allowed: true,
    remaining: maxRequests - current - 1,
    resetAt: (windowStart + WINDOW_SECONDS) * 1000,
  };
}
