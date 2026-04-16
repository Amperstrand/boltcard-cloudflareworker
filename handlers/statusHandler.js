import { logger } from "../utils/logger.js";
import { jsonResponse } from "../utils/responses.js";

export async function handleStatus(request, env) {
  if (env?.UID_CONFIG) {
    try {
      await env.UID_CONFIG.put('test', 'test');
      const testValue = await env.UID_CONFIG.get('test');
      return jsonResponse({
        status: 'OK',
        kv_status: testValue === 'test' ? 'working' : 'not working',
        message: 'Server is running'
      });
    } catch (error) {
      logger.error('KV test error', { error: error.message });
      return jsonResponse({
        status: 'ERROR',
        kv_status: 'error',
        error: error.message
      });
    }
  }

  const origin = new URL(request.url).origin;
  return Response.redirect(`${origin}/activate`, 302);
}
