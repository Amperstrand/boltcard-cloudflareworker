export async function handleStatus(request, env) {
  if (env?.UID_CONFIG) {
    try {
      await env.UID_CONFIG.put('test', 'test');
      const testValue = await env.UID_CONFIG.get('test');
      return new Response(JSON.stringify({
        status: 'OK',
        kv_status: testValue === 'test' ? 'working' : 'not working',
        message: 'Server is running'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('KV Test Error:', error);
      return new Response(JSON.stringify({
        status: 'ERROR',
        kv_status: 'error',
        error: error.message
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  const origin = new URL(request.url).origin;
  return Response.redirect(`${origin}/activate`, 302);
}
