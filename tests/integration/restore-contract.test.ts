// ops#66: the /restore surface maps DO /import-state contract rejections
// through as 4xx carrying the DO's error payload, instead of the generic
// 500 "Failed to restore card state". The DO-side oracle (mock AND real)
// is pinned by the conformance suite; this is the worker-surface mapping.
//
// Run: npx vitest --config vitest.integration.config.js tests/integration/restore-contract.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { operatorLogin, provisionCard, apiFetch, makeUid, resetAll } from "./helpers.js";

describe("POST /operator/cards/:uid/restore — DO contract 400 surface (ops#66)", () => {
  beforeAll(async () => {
    resetAll();
    await operatorLogin();
  });

  it("reserved keys planted in card_config.config_json surface as 400 with the DO error + reserved_keys", async () => {
    const uid = makeUid();
    const provisioned = await provisionCard(uid);
    expect(provisioned.status).toBe(200);

    const exportResp = await apiFetch(`/operator/cards/${uid}/export`);
    expect(exportResp.status).toBe(200);
    const exportData = (await exportResp.json()) as Record<string, unknown>;

    const poisoned = {
      ...exportData,
      card_config: {
        ...((exportData.card_config as Record<string, unknown> | null) ?? {}),
        config_json: JSON.stringify({ K2: "deadbeefdeadbeefdeadbeefdeadbeef", custom: 1 }),
      },
    };

    const resp = await apiFetch(`/operator/cards/${uid}/restore`, {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(poisoned),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.error).toBe("Reserved keys in card_config.config_json are not importable");
    expect(body.reserved_keys).toEqual(["K2"]);
    expect(body.success).toBe(false);
  });
});
