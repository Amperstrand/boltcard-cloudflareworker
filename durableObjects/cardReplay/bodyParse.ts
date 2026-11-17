/**
 * Safe JSON body parse for DO route handlers (ops#35, owner decision:
 * safe-parse).
 *
 * workerd's `request.json()` throws a jsg.SyntaxError that escapes every
 * try/catch inside the DO and rejects the stub RPC, so the dispatcher's
 * documented 400 branch never executes in the real-DO test pool (ops#27
 * parked divergence). Reading the body as text (never throws for content
 * reasons) and parsing with JSON.parse keeps the failure inside the DO
 * as a plain catchable JS SyntaxError.
 */
export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return JSON.parse(await request.text()) as T;
  } catch {
    return null;
  }
}

export function invalidJsonBodyResponse(): Response {
  return Response.json({ error: "Invalid JSON body" }, { status: 400 });
}
