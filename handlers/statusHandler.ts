import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, redirect } from "../utils/responses.js";

export async function handleStatus(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;

  if (!env?.UID_CONFIG) {
    return redirect(`${origin}/login`);
  }

  const result: Record<string, unknown> = {
    status: 'OK',
    message: 'Server is running',
  };

  try {
    const testKey = 'health-' + Date.now();
    await env.UID_CONFIG.put(testKey, 'ok');
    const testValue = await env.UID_CONFIG.get(testKey);
    await env.UID_CONFIG.delete(testKey);
    result.kv_status = testValue === 'ok' ? 'working' : 'not working';
  } catch (error: unknown) {
    logger.error('KV health check error', { error: getErrorMessage(error) });
    result.kv_status = 'error';
    result.status = 'DEGRADED';
  }

  if (env?.CARD_REPLAY) {
    try {
      const doId = env.CARD_REPLAY.idFromName('__health_check__');
      const stub = env.CARD_REPLAY.get(doId);
      const doResponse = await stub.fetch(new Request('https://card-replay.internal/card-state'));
      result.do_status = doResponse.ok ? 'working' : 'error';
      if (!doResponse.ok) result.status = 'DEGRADED';
    } catch (error: unknown) {
      logger.error('DO health check error', { error: getErrorMessage(error) });
      result.do_status = 'error';
      result.status = 'DEGRADED';
    }
  } else {
    result.do_status = 'not configured';
  }

  return jsonResponse(result);
}
