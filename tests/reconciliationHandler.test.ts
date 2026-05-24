import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleReconciliationPage, handleReconciliationData } from "../handlers/reconciliationHandler.js";
import type { Env, SessionPayload } from "../types/core.js";
import type { ShiftSummary } from "../utils/shiftSummary.js";
import { createMockKV } from "./testHelpers.js";

const BASE_URL = "https://boltcardpoc.psbt.me";
const RECONCILIATION_URL = `${BASE_URL}/operator/reconciliation`;
const RECONCILIATION_DATA_URL = `${BASE_URL}/operator/reconciliation/data`;

const session: SessionPayload = {
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 43200,
  shiftId: "test-shift-recon",
};

function makeAuthedEnv(): Env {
  return {
    UID_CONFIG: createMockKV(),
    CARD_REPLAY: {} as DurableObjectNamespace,
    __TEST_OPERATOR_SESSION: session,
    WORKER_ENV: "test",
  } satisfies Env;
}

function makeUnauthedEnv(): Env {
  return {
    UID_CONFIG: createMockKV(),
    CARD_REPLAY: {} as DurableObjectNamespace,
    WORKER_ENV: "test",
  } satisfies Env;
}

vi.mock("../utils/shiftSummary.js", () => ({
  listShiftSummaries: vi.fn(),
}));

import { listShiftSummaries } from "../utils/shiftSummary.js";

const mockListShiftSummaries = vi.mocked(listShiftSummaries);

// ─── handleReconciliationPage ─────────────────────────────────────

describe("handleReconciliationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when not authenticated", () => {
    const env = makeUnauthedEnv();
    const req = new Request(RECONCILIATION_URL);
    const resp = handleReconciliationPage(req, env);
    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location");
    expect(location).toContain("/operator/login");
  });

  it("renders page when authenticated", () => {
    const env = makeAuthedEnv();
    const req = new Request(RECONCILIATION_URL);
    const resp = handleReconciliationPage(req, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/html");
  });
});

// ─── handleReconciliationData ─────────────────────────────────────

describe("handleReconciliationData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when not authenticated", async () => {
    const env = makeUnauthedEnv();
    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location");
    expect(location).toContain("/operator/login");
  });

  it("returns JSON with summaries and venueTotals", async () => {
    const env = makeAuthedEnv();
    const summaries: ShiftSummary[] = [
      {
        shiftId: "shift-1",
        startedAt: 1000,
        lastActivity: 2000,
        topupCount: 2,
        topupTotal: 5000,
        chargeCount: 3,
        chargeTotal: 3000,
        refundCount: 1,
        refundTotal: 500,
        voidCount: 1,
        voidTotal: 200,
      },
    ];
    mockListShiftSummaries.mockResolvedValue(summaries);

    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      summaries: ShiftSummary[];
      venueTotals: Record<string, number>;
    };
    expect(json.summaries).toHaveLength(1);
    expect(json.venueTotals.topupTotal).toBe(5000);
    expect(json.venueTotals.chargeTotal).toBe(3000);
    expect(json.venueTotals.refundTotal).toBe(500);
    expect(json.venueTotals.voidTotal).toBe(200);
  });

  it("aggregates correctly across multiple shifts", async () => {
    const env = makeAuthedEnv();
    const summaries: ShiftSummary[] = [
      {
        shiftId: "shift-1",
        startedAt: 1000,
        lastActivity: 2000,
        topupCount: 2,
        topupTotal: 5000,
        chargeCount: 3,
        chargeTotal: 3000,
        refundCount: 1,
        refundTotal: 500,
        voidCount: 0,
        voidTotal: 0,
      },
      {
        shiftId: "shift-2",
        startedAt: 3000,
        lastActivity: 4000,
        topupCount: 1,
        topupTotal: 3000,
        chargeCount: 2,
        chargeTotal: 1500,
        refundCount: 0,
        refundTotal: 0,
        voidCount: 1,
        voidTotal: 100,
      },
    ];
    mockListShiftSummaries.mockResolvedValue(summaries);

    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    const json = (await resp.json()) as {
      summaries: ShiftSummary[];
      venueTotals: Record<string, number>;
    };
    expect(json.venueTotals.topupCount).toBe(3);
    expect(json.venueTotals.topupTotal).toBe(8000);
    expect(json.venueTotals.chargeCount).toBe(5);
    expect(json.venueTotals.chargeTotal).toBe(4500);
    expect(json.venueTotals.refundCount).toBe(1);
    expect(json.venueTotals.refundTotal).toBe(500);
    expect(json.venueTotals.voidCount).toBe(1);
    expect(json.venueTotals.voidTotal).toBe(100);
  });

  it("calculates outstandingBalance = topupTotal - chargeTotal - refundTotal + voidTotal", async () => {
    const env = makeAuthedEnv();
    const summaries: ShiftSummary[] = [
      {
        shiftId: "shift-1",
        startedAt: 1000,
        lastActivity: 2000,
        topupCount: 1,
        topupTotal: 10000,
        chargeCount: 2,
        chargeTotal: 4000,
        refundCount: 1,
        refundTotal: 2000,
        voidCount: 1,
        voidTotal: 500,
      },
    ];
    mockListShiftSummaries.mockResolvedValue(summaries);

    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    const json = (await resp.json()) as { venueTotals: Record<string, number> };
    // outstandingBalance = 10000 - 4000 - 2000 + 500 = 4500
    expect(json.venueTotals.outstandingBalance).toBe(4500);
  });

  it("calculates netCashIn = topupTotal - refundTotal", async () => {
    const env = makeAuthedEnv();
    const summaries: ShiftSummary[] = [
      {
        shiftId: "shift-1",
        startedAt: 1000,
        lastActivity: 2000,
        topupCount: 1,
        topupTotal: 10000,
        chargeCount: 2,
        chargeTotal: 4000,
        refundCount: 1,
        refundTotal: 2000,
        voidCount: 0,
        voidTotal: 0,
      },
    ];
    mockListShiftSummaries.mockResolvedValue(summaries);

    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    const json = (await resp.json()) as { venueTotals: Record<string, number> };
    // netCashIn = 10000 - 2000 = 8000
    expect(json.venueTotals.netCashIn).toBe(8000);
  });

  it("returns empty summaries when no shifts", async () => {
    const env = makeAuthedEnv();
    mockListShiftSummaries.mockResolvedValue([]);

    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    const json = (await resp.json()) as { summaries: unknown[]; venueTotals: Record<string, number> };
    expect(json.summaries).toEqual([]);
    expect(json.venueTotals.topupTotal).toBe(0);
    expect(json.venueTotals.outstandingBalance).toBe(0);
    expect(json.venueTotals.netCashIn).toBe(0);
  });

  it("returns error on failure from listShiftSummaries", async () => {
    const env = makeAuthedEnv();
    mockListShiftSummaries.mockRejectedValue(new Error("KV error"));

    const req = new Request(RECONCILIATION_DATA_URL);
    const resp = await handleReconciliationData(req, env);
    expect(resp.status).toBe(500);
  });
});
