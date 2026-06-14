// User story integration tests — cardholder self-service, identity, balance, 2FA.
// Runs via miniflare with real SQLite DO + KV. Zero network egress.

import { env } from "cloudflare:workers";
import {
  apiFetch,
  operatorLogin,
  provisionCard,
  topUp,
  cardTap,
  cardInfo,
  nextCounter,
  makeUid,
  virtualTap,
  resetAll,
} from "./helpers.js";

// ── Response type interfaces ──────────────────────────────────────────────────

interface LockResponse {
  success: boolean;
  state: string;
}

interface ReactivateResponse {
  success: boolean;
  state: string;
  version?: number;
}

interface CardInfoResponse {
  state: string;
  balance: number;
  reactivationAvailable?: boolean;
}

interface BalanceCheckResponse {
  success: boolean;
  balance: number;
  uidHex: string;
}

interface TwoFactorJsonResponse {
  uidHex: string;
  maskedUid: string;
  totpCode: string;
  totpSecondsRemaining: number;
  hotpCode: string;
  counterValue: number;
}

interface IdentityVerifyResponse {
  verified: boolean;
  uid?: string;
  maskedUid?: string;
  profile?: Record<string, unknown>;
  keyProvenance?: string | null;
  programmingRecommended?: boolean;
  demoMode?: boolean;
  fallbackReason?: string;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("User story integration tests", () => {
  beforeAll(async () => {
    resetAll();
    await operatorLogin();
  });

  // ── Cardholder self-service ──────────────────────────────────────────────────

  describe("cardholder self-service", () => {
    it("locks a card via POST /api/card/lock", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      const activateResp = await cardTap(uid, k1, k2, nextCounter());
      expect(activateResp.status).toBe(200);

      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch("/api/card/lock", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: pHex, c: cHex }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as LockResponse;
      expect(body.success).toBe(true);
      expect(body.state).toBe("terminated");

      const infoResp = await cardInfo(uid, k1, k2, nextCounter());
      expect(infoResp.status).toBe(200);
      const info = (await infoResp.json()) as CardInfoResponse;
      expect(info.state).toBe("terminated");
    });

    it("reactivates a locked card via POST /api/card/reactivate", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      const activateResp = await cardTap(uid, k1, k2, nextCounter());
      expect(activateResp.status).toBe(200);

      const lockCtr = nextCounter();
      const lockTap = virtualTap(uid, lockCtr, k1, k2);
      const lockResp = await apiFetch("/api/card/lock", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: lockTap.pHex, c: lockTap.cHex }),
      });
      expect(lockResp.status).toBe(200);

      const reactivateCtr = nextCounter();
      const reactivateTap = virtualTap(uid, reactivateCtr, k1, k2);
      const resp = await apiFetch("/api/card/reactivate", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: reactivateTap.pHex, c: reactivateTap.cHex }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as ReactivateResponse;
      expect(body.success).toBe(true);
      expect(body.state).toBe("keys_delivered");
      expect(typeof body.version).toBe("number");
    });

    it("rejects lock with wrong CMAC (403)", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      const activateResp = await cardTap(uid, k1, k2, nextCounter());
      expect(activateResp.status).toBe(200);

      const ctr = nextCounter();
      const { pHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch("/api/card/lock", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: pHex, c: "aabbccddeeff0011aabbccddeeff0011" }),
      });
      expect(resp.status).toBe(403);
    });

    it("rejects lock with missing params (400)", async () => {
      const resp = await apiFetch("/api/card/lock", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── Identity verification ────────────────────────────────────────────────────

  describe("identity verification", () => {
    it("verifies enrolled card with verified:true", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await cardInfo(uid, k1, k2, nextCounter());

      await env.UID_CONFIG.put(
        uid,
        JSON.stringify({ identity_profile: { emoji: "🚀" } }),
      );

      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch(`/api/verify-identity?p=${pHex}&c=${cHex}`);
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as IdentityVerifyResponse;
      expect(body.verified).toBe(true);
      expect(body.demoMode).toBeUndefined();
      expect(typeof body.uid).toBe("string");
      expect(body.profile).toBeDefined();
    });

    it("returns demo fallback for unenrolled card", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await cardInfo(uid, k1, k2, nextCounter());

      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch(`/api/verify-identity?p=${pHex}&c=${cHex}`);
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as IdentityVerifyResponse;
      expect(body.verified).toBe(true);
      expect(body.demoMode).toBe(true);
      expect(typeof body.fallbackReason).toBe("string");
    });
  });

  // ── Balance check ────────────────────────────────────────────────────────────

  describe("balance check", () => {
    it("returns correct balance after top-up", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await topUp(uid, 5000, k1, k2, nextCounter());

      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch("/api/balance-check", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: pHex, c: cHex }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as BalanceCheckResponse;
      expect(body.success).toBe(true);
      expect(body.balance).toBe(5000);
      expect(body.uidHex).toBe(uid);
    });

    it("returns balance 0 on fresh activated card", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await cardInfo(uid, k1, k2, nextCounter());

      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch("/api/balance-check", {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ p: pHex, c: cHex }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as BalanceCheckResponse;
      expect(body.success).toBe(true);
      expect(body.balance).toBe(0);
    });
  });

  // ── 2FA endpoint ─────────────────────────────────────────────────────────────

  describe("2FA endpoint", () => {
    it("returns TOTP and HOTP codes for valid card", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await cardInfo(uid, k1, k2, nextCounter());

      const ctr = nextCounter();
      const { pHex, cHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch(`/2fa?p=${pHex}&c=${cHex}`, {
        headers: { Accept: "application/json" },
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as TwoFactorJsonResponse;
      expect(typeof body.totpCode).toBe("string");
      expect(body.totpCode.length).toBe(6);
      expect(typeof body.hotpCode).toBe("string");
      expect(body.hotpCode.length).toBe(6);
      expect(typeof body.totpSecondsRemaining).toBe("number");
      expect(body.totpSecondsRemaining).toBeGreaterThan(0);
      expect(body.totpSecondsRemaining).toBeLessThanOrEqual(30);
      expect(body.uidHex).toBe(uid);
    });

    it("rejects wrong CMAC with 403", async () => {
      const uid = makeUid();
      const { k1, k2 } = await provisionCard(uid);
      expect(k1).toBeTruthy();

      await cardInfo(uid, k1, k2, nextCounter());

      const ctr = nextCounter();
      const { pHex } = virtualTap(uid, ctr, k1, k2);
      const resp = await apiFetch(
        `/2fa?p=${pHex}&c=deadbeefdeadbeefdeadbeefdeadbeef`,
        { headers: { Accept: "application/json" } },
      );
      expect(resp.status).toBe(403);
    });
  });
});
