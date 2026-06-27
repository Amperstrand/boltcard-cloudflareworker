import { test, expect } from "@playwright/test";
import { VirtualProvider } from "./providers/virtual-provider.js";
import { operatorLogin, makeApiHelpers } from "./helpers.js";

const provider = new VirtualProvider();

test.describe(`User Stories — Virtual Card Simulation (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
    const api = makeApiHelpers(provider, page);
    const disc = await api.discoverCard();
    expect(disc.ok).toBeTruthy();
    expect(disc.data.tag).toBe("withdrawRequest");
  });

  // ─── US1: Card Discovery ───────────────────────────────────────────
  test("US1: New user taps virtual card and sees it discovered", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const bal = await api.balanceCheck();
    expect(bal.ok).toBeTruthy();
    expect(bal.data.balance).toBe(0);

    const t = await provider.tap(page);
    const cardInfo = await page.evaluate(async (tap: { p: string; c: string }): Promise<{ state: string; uid: string }> => {
      const r = await fetch("/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));
      return r.json();
    }, t);
    expect(["discovered", "active"]).toContain(cardInfo.state);
    expect(cardInfo.uid).toBeTruthy();
  });

  // ─── US2: Top-Up Flow ──────────────────────────────────────────────
  test("US2: Operator tops up card with 10000 msat", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const topup = await api.topUp(10000);
    expect(topup.ok).toBeTruthy();
    expect(topup.data.success || topup.data.status === "OK").toBeTruthy();
    expect(topup.data.balance).toBe(10000);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(10000);
  });

  // ─── US3: POS Payment ──────────────────────────────────────────────
  test("US3: Customer pays 3000 msat at POS terminal", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    expect(charge.ok).toBeTruthy();
    expect(charge.data.success).toBeTruthy();
    expect(charge.data.balance).toBe(7000);
    expect(charge.data.txnId).toBeDefined();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(7000);
  });

  // ─── US4: Refund Flow ──────────────────────────────────────────────
  test("US4: Operator refunds 3000 msat to customer", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);
    await api.charge(3000);

    const refund = await api.refund(3000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(10000);
  });

  // ─── US5: Full Event Day ───────────────────────────────────────────
  test("US5: Full event day — top up, 3 purchases, 1 refund, verify balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);

    await api.topUp(20000);

    const c1 = await api.charge(3000);
    expect(c1.data.balance).toBe(17000);

    const c2 = await api.charge(2500);
    expect(c2.data.balance).toBe(14500);

    const c3 = await api.charge(1500);
    expect(c3.data.balance).toBe(13000);

    const refund = await api.refund(2500);
    expect(refund.data.balance).toBe(15500);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(15500);
  });

  // ─── US6: Card Lock (Self-Service) ─────────────────────────────────
  test("US6: Customer locks lost card via self-service", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(5000);

    const t = await provider.tap(page);
    const lockResp = await page.evaluate(async (tap: { p: string; c: string }): Promise<{ ok: boolean; data: { success: boolean } }> => {
      const r = await fetch("/api/card/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      });
      return { ok: r.ok, data: await r.json() };
    }, t);
    expect(lockResp.ok).toBeTruthy();
    expect(lockResp.data.success).toBeTruthy();

    const t2 = await provider.tap(page);
    const infoResp = await page.evaluate(async (tap: { p: string; c: string }): Promise<{ state: string }> => {
      const r = await fetch("/card/info?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));
      return r.json();
    }, t2);
    expect(infoResp.state).toBe("terminated");
  });

  // ─── US7: Overdraft Prevention ─────────────────────────────────────
  test("US7: POS rejects charge exceeding balance", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(1000);

    const charge = await api.charge(5000);
    expect(charge.status).toBe(402);
    expect(charge.data.success).toBeFalsy();

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(1000);
  });

  // ─── US8: Void Transaction ────────────────────────────────────────
  test("US8: Operator voids mistaken charge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    const txnId = charge.data.txnId;
    expect(txnId).toBeDefined();

    const voidResult = await api.void(txnId);
    expect(voidResult.ok).toBeTruthy();
    expect(voidResult.data.balance).toBe(10000);

    const txns = await api.voidTransactions();
    const voidedTxn = txns.data.transactions.find((t: { id: number }) => t.id === txnId);
    expect(voidedTxn).toBeUndefined();
  });

  // ─── US9: Multiple Top-Ups ─────────────────────────────────────────
  test("US9: Customer tops up multiple times throughout the day", async ({ page }) => {
    const api = makeApiHelpers(provider, page);

    await api.topUp(3000);
    await api.topUp(5000);
    await api.topUp(2000);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(10000);
  });

  // ─── US10: Receipt Generation ──────────────────────────────────────
  test("US10: Receipt generated after POS charge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    const txnId = charge.data.txnId;
    const keys = await provider.getCardInfo(page);

    const receipt = await api.receipt(txnId, keys.uid);
    expect(receipt.ok).toBeTruthy();
    expect(receipt.text).toContain("RECEIPT");
    expect(receipt.text).toContain(String(txnId));
  });

  // ─── US11: Double Void Prevention ──────────────────────────────────
  test("US11: System prevents double-void of same transaction", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const charge = await api.charge(3000);
    const txnId = charge.data.txnId;

    const v1 = await api.void(txnId);
    expect(v1.ok).toBeTruthy();

    const v2 = await api.void(txnId);
    expect(v2.ok).toBeFalsy();
  });

  // ─── US12: Balance Integrity After Void + Recharge ─────────────────
  test("US12: Balance integrity maintained after void then recharge", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);

    const c1 = await api.charge(3000);
    expect(c1.data.balance).toBe(7000);

    await api.void(c1.data.txnId);
    const bal1 = await api.balanceCheck();
    expect(bal1.data.balance).toBe(10000);

    const c2 = await api.charge(1500);
    expect(c2.data.balance).toBe(8500);

    const bal2 = await api.balanceCheck();
    expect(bal2.data.balance).toBe(8500);
  });

  // ─── US13: Exact Balance Charge ────────────────────────────────────
  test("US13: Customer spends entire balance (charge equals balance)", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(5000);

    const charge = await api.charge(5000);
    expect(charge.ok).toBeTruthy();
    expect(charge.data.balance).toBe(0);

    const bal = await api.balanceCheck();
    expect(bal.data.balance).toBe(0);
  });

  // ─── US14: Partial Refund ──────────────────────────────────────────
  test("US14: Operator issues partial refund after purchase", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);
    await api.charge(3000);

    const refund = await api.refund(1000);
    expect(refund.ok).toBeTruthy();
    expect(refund.data.balance).toBe(8000);
  });

  // ─── US15: Virtual Card Persistence ────────────────────────────────
  test("US15: Virtual card persists across page navigation", async ({ page }) => {
    const keysBefore = await provider.getCardInfo(page);
    expect(keysBefore.uid).toBeTruthy();

    const counterBefore = await page.evaluate(() => {
      const card = JSON.parse(localStorage.getItem("virtual_boltcard") || "{}");
      return card.counter || 0;
    });

    await page.goto("/card", { waitUntil: "domcontentloaded" });

    const simActive = await page.evaluate(() => !!(window as any)._virtualSim?.isActive?.());
    expect(simActive).toBeTruthy();

    const keysAfter = await provider.getCardInfo(page);
    expect(keysAfter.uid).toBe(keysBefore.uid);

    const counterAfter = await page.evaluate(() => {
      const card = JSON.parse(localStorage.getItem("virtual_boltcard") || "{}");
      return card.counter || 0;
    });
    expect(counterAfter).toBeGreaterThanOrEqual(counterBefore);
  });

  // ─── US16: Reconciliation Data ─────────────────────────────────────
  test("US16: Reconciliation dashboard shows transaction totals", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    await api.topUp(10000);
    await api.charge(3000);
    await api.refund(1000);

    const recon = await page.evaluate(async (): Promise<{
      venueTotals: { topupTotal: number; chargeTotal: number; refundTotal: number; outstandingBalance: number };
      summaries: unknown[];
    }> => {
      const r = await fetch("/operator/reconciliation/data");
      return r.json();
    });

    expect(recon.venueTotals).toBeDefined();
    expect(recon.venueTotals.topupTotal).toBeGreaterThanOrEqual(10000);
    expect(recon.venueTotals.chargeTotal).toBeGreaterThanOrEqual(3000);
    expect(recon.venueTotals.refundTotal).toBeGreaterThanOrEqual(1000);
  });

  // ─── US17: VC Issuance ─────────────────────────────────────────────
  test("US17: Card holder taps card and receives a verifiable credential", async ({ page }) => {
    const t = await provider.tap(page);
    const result = await page.evaluate(async (tap: { p: string; c: string }): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
      const r = await fetch(`/api/credential?p=${tap.p}&c=${tap.c}`);
      return { ok: r.ok, data: await r.json() };
    }, t);
    expect(result.ok).toBeTruthy();
    expect(result.data.credential).toBeTruthy();
    expect(result.data.issuer).toMatch(/^did:key:z/);
    expect((result.data.credential as string).split(".")).toHaveLength(3);
  });

  // ─── US18: VC Verification ─────────────────────────────────────────
  test("US18: Third party verifies the credential signature", async ({ page }) => {
    const t = await provider.tap(page);
    const issue = await page.evaluate(async (tap: { p: string; c: string }): Promise<Record<string, unknown>> => {
      const r = await fetch(`/api/credential?p=${tap.p}&c=${tap.c}`);
      return r.json();
    }, t);

    const verify = await page.evaluate(async (credential: string): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      return r.json();
    }, issue.credential as string);

    expect(verify.valid).toBe(true);
    expect(verify.payload).toBeDefined();
  });

  // ─── US19: Algorithm Toggle ────────────────────────────────────────
  test("US19: Credential issued with EdDSA algorithm verifies correctly", async ({ page }) => {
    const t = await provider.tap(page);
    const issue = await page.evaluate(async (tap: { p: string; c: string }): Promise<Record<string, unknown>> => {
      const r = await fetch(`/api/credential?p=${tap.p}&c=${tap.c}&alg=EdDSA`);
      return r.json();
    }, t);
    expect(issue.alg).toBe("EdDSA");

    const verify = await page.evaluate(async (credential: string): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      return r.json();
    }, issue.credential as string);
    expect(verify.valid).toBe(true);
  });

  // ─── US20: Data Integrity Proof ────────────────────────────────────
  test("US20: Credential issued as Data Integrity proof with JCS+Ed25519", async ({ page }) => {
    const t = await provider.tap(page);
    const issue = await page.evaluate(async (tap: { p: string; c: string }): Promise<Record<string, unknown>> => {
      const r = await fetch(`/api/credential?p=${tap.p}&c=${tap.c}&format=di`);
      return r.json();
    }, t);
    expect(issue.format).toBe("di");
    const credential = issue.credential as Record<string, unknown>;
    const proof = credential.proof as Record<string, unknown>;
    expect(proof).toBeDefined();
    expect(proof.type).toBe("DataIntegrityProof");
    expect(proof.cryptosuite).toBe("jcs-eddsa-2025");

    const verify = await page.evaluate(async (cred: string): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: cred }),
      });
      return r.json();
    }, JSON.stringify(credential));
    expect(verify.valid).toBe(true);
  });

  // ─── US21: SD-JWT Selective Disclosure ─────────────────────────────
  test("US21: Credential issued as SD-JWT with selective disclosures", async ({ page }) => {
    const t = await provider.tap(page);
    const issue = await page.evaluate(async (tap: { p: string; c: string }): Promise<Record<string, unknown>> => {
      const r = await fetch(`/api/credential?p=${tap.p}&c=${tap.c}&format=sdjwt`);
      return r.json();
    }, t);
    expect(issue.format).toBe("sdjwt");
    const sdJwt = issue.credential as string;
    expect(sdJwt).toContain("~");

    const verify = await page.evaluate(async (credential: string): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      return r.json();
    }, sdJwt);
    expect(verify.valid).toBe(true);
    expect(verify.disclosures).toBeDefined();
    expect((verify.disclosures as unknown[]).length).toBeGreaterThan(0);
  });

  // ─── US22: VC in LNURL Response ────────────────────────────────────
  test("US22: Card tap returns verifiable credential in LNURL payment response", async ({ page }) => {
    const api = makeApiHelpers(provider, page);
    const disc = await api.discoverCard();
    expect(disc.data.verifiableCredential).toBeTruthy();
    expect(typeof disc.data.verifiableCredential).toBe("string");

    const verify = await page.evaluate(async (credential: string): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      return r.json();
    }, disc.data.verifiableCredential as string);
    expect(verify.valid).toBe(true);
  });
});
