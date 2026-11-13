// Security-audit regression tests (2026-11-13 findings #9 and #12).
//
// #12: amount-only callbacks (no pr) re-claimed the tap row on every replay
//      (bolt11 stays NULL), debiting the balance once per replay from a
//      single sniffed tap. The atomic pending->paying claim makes the
//      amount-only path exactly-once per counter, like the bolt11 path.
// #9:  a well-formed-length but non-hex c= surfaced as an "Internal error"
//      500 (uncaught hexToBytes inside verifyCmac) instead of the 400 the
//      malformed-p= input class already gets.
//
// Run: npx vitest --config vitest.integration.config.js tests/integration/auditRegression.test.ts

import {
  operatorLogin,
  provisionCard,
  topUp,
  virtualTap,
  resetAll,
  apiFetch,
  makeUid,
} from "./helpers.js";
import { describe, it, expect, beforeEach } from "vitest";

describe("security audit 2026-11-13 regressions", () => {
  beforeEach(() => {
    resetAll();
  });

  it("#12: an amount-only callback can be claimed exactly once per counter", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    expect(k1).toBeTruthy();

    await operatorLogin();
    const top = await topUp(uid, 100_000, k1, k2, 1);
    expect(top.status).toBe(200);

    const { pHex, cHex } = virtualTap(uid, 5, k1, k2);

    // First amount-only callback on counter 5: debits and succeeds.
    const cb1 = await apiFetch(`/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&amount=1000`);
    expect(cb1.status).toBe(200);

    // Replays of the SAME sniffed tap must not debit again. The pre-fix bug:
    // claimTap re-claimed NULL-bolt11 rows unconditionally.
    for (let i = 0; i < 3; i++) {
      const replay = await apiFetch(`/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&amount=1000`);
      expect(replay.status).toBe(409);
      const j = (await replay.json()) as { reason?: string };
      expect(String(j.reason ?? "")).toContain("already claimed");
    }
  });

  it("#9: a non-hex c= answers 400, not an internal-error 500", async () => {
    const uid = makeUid();
    const { k1, k2 } = await provisionCard(uid);
    const { pHex } = virtualTap(uid, 1, k1, k2);
    const badC = "zzzzzzzzzzzzzzzz"; // 16 chars, not hex

    const resp = await apiFetch(`/card/info?p=${pHex}&c=${badC}`);
    expect(resp.status).toBe(400);
    const j = (await resp.json()) as { reason?: string; error?: string };
    expect(String(j.reason ?? j.error ?? "")).toContain("Invalid card data");
  });

  it("#9 (control): a hex c= on the same shape reaches normal auth failure, not 400-invalid", async () => {
    const uid = makeUid();
    const { k1 } = await provisionCard(uid);
    const { pHex } = virtualTap(uid, 1, k1, "00".repeat(16)); // wrong K2 -> CMAC fail
    const resp = await apiFetch(`/card/info?p=${pHex}&c=${"ab".repeat(8)}`);
    // Unregistered-card flows may 404 before CMAC; the point is it is NOT
    // the 400 invalid-data bucket and definitely not a 500.
    expect(resp.status).not.toBe(500);
    expect(resp.status).not.toBe(400);
  });
});
