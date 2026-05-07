import { recordAuditEvent, _listAuditEvents } from "../utils/auditLog.js";
import type { Env } from "../types/core.js";

type KvStore = Record<string, { value: string; opts?: { expirationTtl?: number } }>;

function makeKvEnv(store: KvStore = {} as KvStore): Env & { __store: KvStore } {
  return {
    UID_CONFIG: {
      get: async (key: string) => (store as Record<string, unknown>)[key] != null ? ((store as Record<string, unknown>)[key] as { value: string }).value : null,
      put: async (key: string, val: string, opts?: { expirationTtl?: number }) => { store[key] = { value: val, opts }; },
      list: async ({ prefix, limit } = {} as { prefix?: string; limit?: number }) => {
        const keys = Object.keys(store)
          .filter(k => k.startsWith(prefix || ""))
          .sort()
          .slice(0, limit || 100)
          .map(k => ({ name: k }));
        return { keys, list_complete: true, cursor: null };
      },
    } as unknown as KVNamespace,
    __store: store,
  } as Env & { __store: KvStore };
}

describe("auditLog", () => {
  describe("recordAuditEvent", () => {
    it("stores audit event in KV", async () => {
      const env = makeKvEnv();
      await recordAuditEvent(env, {
        action: "topup",
        uidHex: "ff000000000001",
        operatorShiftId: "shift-123",
        details: { amount: 100, balance: 200 },
      });

      const keys = Object.keys(env.__store).filter(k => k.startsWith("audit_log:"));
      expect(keys).toHaveLength(1);
      const entry = JSON.parse(env.__store[keys[0]!]!.value);
      expect(entry.action).toBe("topup");
      expect(entry.uid).toBe("ff000000000001");
      expect(entry.operator).toBe("shift-123");
      expect(entry.details.amount).toBe(100);
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it("sets TTL on audit entries", async () => {
      const env = makeKvEnv();
      await recordAuditEvent(env, { action: "refund", uidHex: "ff000000000002" });
      const key = Object.keys(env.__store).find(k => k.startsWith("audit_log:"));
      expect(env.__store[key!]!.opts!.expirationTtl).toBe(90 * 24 * 60 * 60);
    });

    it("silently fails when UID_CONFIG is missing", async () => {
      await expect(recordAuditEvent({} as Env, { action: "test" })).resolves.toBeUndefined();
    });

    it("silently fails on KV write error", async () => {
      const env = { UID_CONFIG: { put: async () => { throw new Error("KV down"); } } } as unknown as Env;
      await expect(recordAuditEvent(env, { action: "test" })).resolves.toBeUndefined();
    });

    it("generates unique IDs for concurrent events", async () => {
      const env = makeKvEnv();
      await Promise.all([
        recordAuditEvent(env, { action: "topup", uidHex: "ff000000000001" }),
        recordAuditEvent(env, { action: "refund", uidHex: "ff000000000002" }),
      ]);
      const keys = Object.keys(env.__store).filter(k => k.startsWith("audit_log:"));
      expect(keys).toHaveLength(2);
    });
  });

  describe("_listAuditEvents", () => {
    it("returns sorted audit events (newest first)", async () => {
      const store: Record<string, string> = {
        "audit_log:1000-aaaa": JSON.stringify({ id: "1000-aaaa", timestamp: 1000, action: "topup" }),
        "audit_log:2000-bbbb": JSON.stringify({ id: "2000-bbbb", timestamp: 2000, action: "refund" }),
        "audit_log:1500-cccc": JSON.stringify({ id: "1500-cccc", timestamp: 1500, action: "pos_charge" }),
      };
      const env = {
        UID_CONFIG: {
          get: async (key: string) => store[key] ?? null,
          list: async () => ({
            keys: Object.keys(store).map(k => ({ name: k })),
            list_complete: true,
            cursor: null,
          }),
        },
      } as unknown as Env;

      const result = await _listAuditEvents(env);
      expect(result.events).toHaveLength(3);
      expect(result.events[0]!.timestamp).toBe(2000);
      expect(result.events[1]!.timestamp).toBe(1500);
      expect(result.events[2]!.timestamp).toBe(1000);
    });

    it("returns empty when no events", async () => {
      const env = makeKvEnv();
      const result = await _listAuditEvents(env);
      expect(result.events).toEqual([]);
    });

    it("skips corrupted entries", async () => {
      const store: Record<string, string> = {
        "audit_log:1000-aaaa": "not-json",
        "audit_log:2000-bbbb": JSON.stringify({ id: "2000-bbbb", timestamp: 2000, action: "topup" }),
      };
      const env = {
        UID_CONFIG: {
          get: async (key: string) => store[key] ?? null,
          list: async () => ({
            keys: Object.keys(store).map(k => ({ name: k })),
            list_complete: true,
            cursor: null,
          }),
        },
      } as unknown as Env;

      const result = await _listAuditEvents(env);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.action).toBe("topup");
    });

    it("returns empty when UID_CONFIG is missing", async () => {
      const result = await _listAuditEvents({} as Env);
      expect(result.events).toEqual([]);
    });

    it("handles KV list error gracefully", async () => {
      const env = { UID_CONFIG: { list: async () => { throw new Error("KV down"); } } } as unknown as Env;
      const result = await _listAuditEvents(env);
      expect(result.events).toEqual([]);
    });
  });
});
