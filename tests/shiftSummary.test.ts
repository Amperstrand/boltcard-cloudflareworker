import { describe, it, expect, beforeEach } from "vitest";
import { updateShiftSummary, getShiftSummary, listShiftSummaries, type ShiftSummary } from "../utils/shiftSummary.js";
import { createMockKV } from "./testHelpers.js";
import type { Env } from "../types/core.js";

function makeEnv(kv?: KVNamespace): Env {
  return {
    UID_CONFIG: kv ?? createMockKV(),
    CARD_REPLAY: {} as DurableObjectNamespace,
  } satisfies Env;
}

describe("updateShiftSummary", () => {
  let kv: KVNamespace;
  let env: Env;

  beforeEach(() => {
    kv = createMockKV();
    env = makeEnv(kv);
  });

  it("creates new shift on first call", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 1000);
    const raw = await kv.get("shift:shift-1");
    expect(raw).not.toBeNull();
    const summary: ShiftSummary = JSON.parse(raw!);
    expect(summary.shiftId).toBe("shift-1");
    expect(summary.topupCount).toBe(1);
    expect(summary.topupTotal).toBe(1000);
    expect(summary.startedAt).toBeGreaterThan(0);
  });

  it("increments topup counters", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 500);
    await updateShiftSummary(env, "shift-1", "topup", 300);
    const raw = await kv.get("shift:shift-1");
    const summary: ShiftSummary = JSON.parse(raw!);
    expect(summary.topupCount).toBe(2);
    expect(summary.topupTotal).toBe(800);
  });

  it("increments pos_charge counters", async () => {
    await updateShiftSummary(env, "shift-1", "pos_charge", 200);
    const raw = await kv.get("shift:shift-1");
    const summary: ShiftSummary = JSON.parse(raw!);
    expect(summary.chargeCount).toBe(1);
    expect(summary.chargeTotal).toBe(200);
  });

  it("increments refund counters", async () => {
    await updateShiftSummary(env, "shift-1", "refund", 100);
    const raw = await kv.get("shift:shift-1");
    const summary: ShiftSummary = JSON.parse(raw!);
    expect(summary.refundCount).toBe(1);
    expect(summary.refundTotal).toBe(100);
  });

  it("increments void counters", async () => {
    await updateShiftSummary(env, "shift-1", "void", 50);
    const raw = await kv.get("shift:shift-1");
    const summary: ShiftSummary = JSON.parse(raw!);
    expect(summary.voidCount).toBe(1);
    expect(summary.voidTotal).toBe(50);
  });

  it("increments all action types on same shift", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 1000);
    await updateShiftSummary(env, "shift-1", "pos_charge", 300);
    await updateShiftSummary(env, "shift-1", "refund", 100);
    await updateShiftSummary(env, "shift-1", "void", 50);
    const raw = await kv.get("shift:shift-1");
    const summary: ShiftSummary = JSON.parse(raw!);
    expect(summary.topupCount).toBe(1);
    expect(summary.topupTotal).toBe(1000);
    expect(summary.chargeCount).toBe(1);
    expect(summary.chargeTotal).toBe(300);
    expect(summary.refundCount).toBe(1);
    expect(summary.refundTotal).toBe(100);
    expect(summary.voidCount).toBe(1);
    expect(summary.voidTotal).toBe(50);
  });

  it("ignores invalid actions", async () => {
    await updateShiftSummary(env, "shift-1", "invalid_action", 500);
    const raw = await kv.get("shift:shift-1");
    expect(raw).toBeNull();
  });

  it("ignores zero amounts", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 0);
    const raw = await kv.get("shift:shift-1");
    expect(raw).toBeNull();
  });

  it("ignores negative amounts", async () => {
    await updateShiftSummary(env, "shift-1", "topup", -100);
    const raw = await kv.get("shift:shift-1");
    expect(raw).toBeNull();
  });

  it("ignores empty shiftId", async () => {
    await updateShiftSummary(env, "", "topup", 1000);
    const raw = await kv.get("shift:");
    expect(raw).toBeNull();
  });

  it("handles missing env gracefully (undefined)", async () => {
    await expect(updateShiftSummary(undefined, "shift-1", "topup", 1000)).resolves.toBeUndefined();
  });

  it("handles missing env.UID_CONFIG gracefully", async () => {
    const envNoKv = { CARD_REPLAY: {} as DurableObjectNamespace } as unknown as Env;
    await expect(updateShiftSummary(envNoKv, "shift-1", "topup", 1000)).resolves.toBeUndefined();
  });

  it("adds to shift index on first call", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 1000);
    const indexRaw = await kv.get("shifts:index");
    expect(indexRaw).not.toBeNull();
    const index = JSON.parse(indexRaw!);
    expect(index).toHaveLength(1);
    expect(index[0].shiftId).toBe("shift-1");
  });

  it("does not duplicate index entry on subsequent calls", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 1000);
    await updateShiftSummary(env, "shift-1", "pos_charge", 200);
    const indexRaw = await kv.get("shifts:index");
    const index = JSON.parse(indexRaw!);
    expect(index).toHaveLength(1);
  });

  it("updates lastActivity on subsequent calls", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 1000);
    const raw1 = await kv.get("shift:shift-1");
    const s1: ShiftSummary = JSON.parse(raw1!);
    // Small delay to ensure different timestamp (unlikely but safe)
    await updateShiftSummary(env, "shift-1", "pos_charge", 200);
    const raw2 = await kv.get("shift:shift-1");
    const s2: ShiftSummary = JSON.parse(raw2!);
    expect(s2.lastActivity).toBeGreaterThanOrEqual(s1.lastActivity);
  });
});

describe("getShiftSummary", () => {
  let kv: KVNamespace;
  let env: Env;

  beforeEach(() => {
    kv = createMockKV();
    env = makeEnv(kv);
  });

  it("returns null for non-existent shift", async () => {
    const result = await getShiftSummary(env, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns correct summary after update", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 500);
    const result = await getShiftSummary(env, "shift-1");
    expect(result).not.toBeNull();
    expect(result!.shiftId).toBe("shift-1");
    expect(result!.topupCount).toBe(1);
    expect(result!.topupTotal).toBe(500);
  });

  it("returns null for missing env", async () => {
    const result = await getShiftSummary(undefined, "shift-1");
    expect(result).toBeNull();
  });

  it("returns null for missing UID_CONFIG", async () => {
    const envNoKv = { CARD_REPLAY: {} as DurableObjectNamespace } as unknown as Env;
    const result = await getShiftSummary(envNoKv, "shift-1");
    expect(result).toBeNull();
  });
});

describe("listShiftSummaries", () => {
  let kv: KVNamespace;
  let env: Env;

  beforeEach(() => {
    kv = createMockKV();
    env = makeEnv(kv);
  });

  it("returns empty array when no shifts", async () => {
    const result = await listShiftSummaries(env);
    expect(result).toEqual([]);
  });

  it("returns single shift", async () => {
    await updateShiftSummary(env, "shift-1", "topup", 1000);
    const result = await listShiftSummaries(env);
    expect(result).toHaveLength(1);
    expect(result[0]!.shiftId).toBe("shift-1");
  });

  it("returns shifts sorted by startedAt descending", async () => {
    await updateShiftSummary(env, "shift-early", "topup", 500);
    // Create a second shift after a tiny delay — the timestamps use Date.now()
    // so both will likely have the same timestamp. To force ordering we
    // directly manipulate KV to set different startedAt values.
    const rawEarly = await kv.get("shift:shift-early");
    const earlySummary: ShiftSummary = JSON.parse(rawEarly!);
    earlySummary.startedAt = 1000;
    await kv.put("shift:shift-early", JSON.stringify(earlySummary));

    await updateShiftSummary(env, "shift-late", "topup", 1000);
    const rawLate = await kv.get("shift:shift-late");
    const lateSummary: ShiftSummary = JSON.parse(rawLate!);
    lateSummary.startedAt = 2000;
    await kv.put("shift:shift-late", JSON.stringify(lateSummary));

    const result = await listShiftSummaries(env);
    expect(result).toHaveLength(2);
    expect(result[0]!.shiftId).toBe("shift-late");
    expect(result[1]!.shiftId).toBe("shift-early");
  });

  it("handles missing env gracefully", async () => {
    const result = await listShiftSummaries(undefined);
    expect(result).toEqual([]);
  });

  it("handles missing UID_CONFIG gracefully", async () => {
    const envNoKv = { CARD_REPLAY: {} as DurableObjectNamespace } as unknown as Env;
    const result = await listShiftSummaries(envNoKv);
    expect(result).toEqual([]);
  });

  it("skips malformed entries in index", async () => {
    await updateShiftSummary(env, "shift-good", "topup", 1000);
    // Manually corrupt the index to add a bad shift ID
    const indexRaw = await kv.get("shifts:index");
    const index = JSON.parse(indexRaw!);
    index.push({ shiftId: "shift-bad", startedAt: Date.now() });
    await kv.put("shifts:index", JSON.stringify(index));
    // Don't put any data for shift-bad — it will be skipped

    const result = await listShiftSummaries(env);
    expect(result).toHaveLength(1);
    expect(result[0]!.shiftId).toBe("shift-good");
  });
});
