import { logger } from "./logger.js";

const AUDIT_PREFIX = "audit_log:";
const AUDIT_TTL = 90 * 24 * 60 * 60;

export async function recordAuditEvent(env, { action, uidHex, operatorShiftId, details = {} }) {
  if (!env?.UID_CONFIG) return;

  try {
    const timestamp = Date.now();
    const id = `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
    const entry = {
      id,
      timestamp,
      action,
      uid: uidHex || null,
      operator: operatorShiftId || null,
      details,
    };

    await env.UID_CONFIG.put(
      AUDIT_PREFIX + id,
      JSON.stringify(entry),
      { expirationTtl: AUDIT_TTL }
    );
  } catch (e) {
    logger.warn("Failed to record audit event", { action, uidHex, error: e.message });
  }
}

export async function listAuditEvents(env, { limit = 50, cursor } = {}) {
  if (!env?.UID_CONFIG) return { events: [], cursor: null };

  try {
    const listResult = await env.UID_CONFIG.list({
      prefix: AUDIT_PREFIX,
      limit,
      cursor: cursor || undefined,
    });

    const events = [];
    const values = await Promise.all(
      listResult.keys.map((key) =>
        env.UID_CONFIG.get(key.name).then((raw) => {
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        }).catch(() => null)
      )
    );

    for (const entry of values) {
      if (entry) events.push(entry);
    }

    events.sort((a, b) => b.timestamp - a.timestamp);

    return {
      events,
      cursor: listResult.list_complete ? null : listResult.cursor,
    };
  } catch (e) {
    logger.warn("Failed to list audit events", { error: e.message });
    return { events: [], cursor: null };
  }
}
