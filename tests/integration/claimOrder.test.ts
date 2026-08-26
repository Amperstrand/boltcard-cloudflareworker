// Claim-order regression test (issue #53).
//
// Witnessed on production 2026-08-26: the bolt11 claim (recordTap/claimTap)
// commits BEFORE balance validation in processWithdrawalPayment. A callback
// that fails on insufficient balance still consumes the tap — a retry with a
// valid invoice gets "Tap already claimed". First-callback-wins on both the
// success and failure paths is what makes replay double-spend impossible.
//
// This suite pins that ordering. If a refactor moves the claim after balance
// validation, scenario A fails (the retry would succeed).
//
// Run: npx vitest --config vitest.integration.config.js tests/integration/claimOrder.test.ts

import {
  operatorLogin,
  provisionCard,
  topUp,
  cardInfo,
  lnurlCallback,
  fakeInvoice,
  makeUid,
  virtualTap,
  resetAll,
} from "./helpers.js";
import { describe, it, expect, beforeEach } from "vitest";

describe("LNURL callback claim ordering (issue #53)", () => {
  beforeEach(() => {
    resetAll();
  });

  it("A: a callback rejected for insufficient balance still consumes the tap", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    // Fresh tap with zero balance
    const { pHex, cHex } = virtualTap(uid, 1, k1, k2);

    // Callback #1: invoice for 500 against balance 0 -> must fail on balance
    const inv1 = (await (await fakeInvoice(500)).json()) as { pr: string };
    const cb1 = await lnurlCallback(pHex, cHex, inv1.pr, 500);
    // 402 (payment required) in fakewallet mode; the contract is: refused on
    // balance, and — critically — the tap is still consumed (asserted below)
    expect([400, 402]).toContain(cb1.status);
    const cb1Json = (await cb1.json()) as { reason?: string; error?: string };
    expect(String(cb1Json.reason ?? cb1Json.error)).toContain("Insufficient balance");

    // Fund the card, then retry the SAME tap with a satisfiable invoice.
    // The regression this guards against: if the claim happened after the
    // balance check, this retry would succeed and pay out — a replay.
    await operatorLogin();
    const top = await topUp(uid, 10_000, k1, k2, 1);
    expect(top.status).toBe(200);

    const inv2 = (await (await fakeInvoice(1)).json()) as { pr: string };
    const cb2 = await lnurlCallback(pHex, cHex, inv2.pr, 1);
    expect(cb2.status).toBe(409);
    const cb2Json = (await cb2.json()) as { reason?: string; error?: string };
    expect(String(cb2Json.reason ?? cb2Json.error)).toContain("Tap already claimed");

    // And the balance must be untouched by the consumed tap
    const info = (await (await cardInfo(uid, k1, k2, 1)).json()) as { balance: number };
    expect(info.balance).toBe(10_000);
  });

  it("B: explicit success-path replay — exact duplicate callback is rejected", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();
    await operatorLogin();
    expect((await topUp(uid, 1_000, k1, k2, 1)).status).toBe(200);

    const { pHex, cHex } = virtualTap(uid, 2, k1, k2);
    const inv = (await (await fakeInvoice(10)).json()) as { pr: string };

    const ok = await lnurlCallback(pHex, cHex, inv.pr, 10);
    expect(ok.status).toBe(200);

    const replay = await lnurlCallback(pHex, cHex, inv.pr, 10);
    expect(replay.status).toBe(409);
    const replayJson = (await replay.json()) as { reason?: string; error?: string };
    expect(String(replayJson.reason ?? replayJson.error)).toContain("Tap already claimed");

    const info = (await (await cardInfo(uid, k1, k2, 2)).json()) as { balance: number };
    expect(info.balance).toBe(990);
  });
});
