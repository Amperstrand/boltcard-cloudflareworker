import { logger } from "../utils/logger.js";
import { jsonResponse } from "../utils/responses.js";
export async function handleStatus(request, env) {
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
    } catch (error) {
      logger.error('KV health check error', { error: error.message });
      return jsonResponse({
        status: 'ERROR',
        kv_status: 'error',
        error: error.message
      });
    }
  }

  const origin = new URL(request.url).origin;
  return new Response(null, { status: 302, headers: { Location: `${origin}/login` } });
}
