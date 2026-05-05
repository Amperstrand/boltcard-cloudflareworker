import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { errorResponse, jsonResponse, redirect } from "../utils/responses.js";

export async function handleStatus(request: Request, env: Env): Promise<Response> {
  if (env?.UID_CONFIG) {
    try {
      const testKey = 'health-' + Date.now();
      await env.UID_CONFIG.put(testKey, 'ok');
      const testValue = await env.UID_CONFIG.get(testKey);
      await env.UID_CONFIG.delete(testKey);
      return jsonResponse({
        status: 'OK',
        kv_status: testValue === 'ok' ? 'working' : 'not working',
        message: 'Server is running'
      });
    } catch (error: unknown) {
      logger.error('KV health check error', { error: getErrorMessage(error) });
      return errorResponse('KV health check failed', 200, { kv_status: 'error' });
    }
  }

  const origin = new URL(request.url).origin;
  return redirect(`${origin}/login`);
}
