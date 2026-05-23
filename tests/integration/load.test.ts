// Load test — concurrent card operations via miniflare (no network egress).
// Proves correctness under concurrent access: no double-debits, no balance corruption,
// sequential DO processing per card.
//
// Run: npx vitest --config vitest.integration.config.js tests/integration/load.test.ts

import {
  apiFetch,
  operatorLogin,
  provisionCard,
  topUp,
  posCharge,
  cardTap,
  cardInfo,
  lnurlCallback,
  fakeInvoice,
  nextCounter,
  makeUid,
  deriveKeys,
  virtualTap,
  resetAll,
} from "./helpers.js";

// ── Card tracking ─────────────────────────────────────────────────────────────

interface TestCard {
  uid: string;
  k1: string;
  k2: string;
  expectedBalance: number;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

describe("Load test: concurrent card operations", () => {
  const NUM_CARDS = 5;
  const INITIAL_TOPUP = 10000;
  const cards: TestCard[] = [];

  beforeAll(async () => {
    resetAll();
    await operatorLogin();
  });

  // ── Phase 1: Provision + Top-up ──────────────────────────────────────────────

  describe("Phase 1: Provision + Top-up (sequential)", () => {
    it(`provisions and tops up ${NUM_CARDS} cards`, async () => {
      for (let i = 0; i < NUM_CARDS; i++) {
        const uid = makeUid();
        const provResult = await provisionCard(uid);
        expect(provResult.status).toBe(200);
        expect(provResult.k1).toBeTruthy();
        expect(provResult.k2).toBeTruthy();

        const topUpCounter = nextCounter();
        const topUpResp = await topUp(uid, INITIAL_TOPUP, provResult.k1, provResult.k2, topUpCounter);
        expect(topUpResp.status).toBe(200);
        const topUpJson = (await topUpResp.json()) as { balance: number };
        expect(topUpJson.balance).toBe(INITIAL_TOPUP);

        // Verify balance via card/info
        const infoCounter = nextCounter();
        const infoResp = await cardInfo(uid, provResult.k1, provResult.k2, infoCounter);
        expect(infoResp.status).toBe(200);
        const infoJson = (await infoResp.json()) as { balance: number };
        expect(infoJson.balance).toBe(INITIAL_TOPUP);

        cards.push({ uid, k1: provResult.k1, k2: provResult.k2, expectedBalance: INITIAL_TOPUP });
      }

      expect(cards).toHaveLength(NUM_CARDS);
    });
  });

  // ── Phase 2: Concurrent POS charges ─────────────────────────────────────────

  describe("Phase 2: Concurrent POS charges (5 cards x 3 charges)", () => {
    const CHARGE_AMOUNT = 500;
    const CHARGES_PER_CARD = 3;

    it("fires 15 concurrent POS charges — all succeed", async () => {
      // Build 15 charge requests (3 per card, each with unique counter)
      const requests: { cardIdx: number; counter: number }[] = [];
      for (let i = 0; i < cards.length; i++) {
        for (let j = 0; j < CHARGES_PER_CARD; j++) {
          requests.push({ cardIdx: i, counter: nextCounter() });
        }
      }

      // Fire all 15 concurrently
      const results = await Promise.all(
        requests.map((req) =>
          posCharge(cards[req.cardIdx]!.uid, CHARGE_AMOUNT, cards[req.cardIdx]!.k1, cards[req.cardIdx]!.k2, req.counter),
        ),
      );

      // All should succeed — each has a unique counter
      for (let i = 0; i < results.length; i++) {
        expect(results[i]!.status).toBe(200);
      }
    });

    it("verifies correct balances after concurrent charges", async () => {
      const totalChargedPerCard = CHARGES_PER_CARD * CHARGE_AMOUNT; // 1500

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]!;
        card.expectedBalance -= totalChargedPerCard;

        const counter = nextCounter();
        const infoResp = await cardInfo(card.uid, card.k1, card.k2, counter);
        expect(infoResp.status).toBe(200);
        const infoJson = (await infoResp.json()) as { balance: number };
        expect(infoJson.balance).toBe(card.expectedBalance);
      }
    });
  });

  // ── Phase 3: Concurrent LNURL callbacks (double-spend test) ─────────────────

  describe("Phase 3: Concurrent LNURL callbacks", () => {
    const CALLBACK_AMOUNT = 300;
    const NUM_LNURL_CARDS = 3;

    it("fires 2 concurrent callbacks per card — exactly 1 succeeds (no double-debit)", async () => {
      const testCards = cards.slice(0, NUM_LNURL_CARDS);
      expect(testCards).toHaveLength(NUM_LNURL_CARDS);

      // Step 1: Tap each card to get withdrawResponse
      const tapData: { card: TestCard; pHex: string; cHex: string; k1param: string }[] = [];
      for (const card of testCards) {
        const counter = nextCounter();
        const tapResp = await cardTap(card.uid, card.k1, card.k2, counter);
        expect(tapResp.status).toBe(200);

        const tapJson = (await tapResp.json()) as {
          tag: string;
          callback: string;
          k1: string;
        };
        expect(tapJson.tag).toBe("withdrawRequest");
        expect(tapJson.callback).toBeTruthy();
        expect(tapJson.k1).toBeTruthy();

        // Re-derive p/c from the same tap to use in callback
        const { pHex, cHex } = virtualTap(card.uid, counter, card.k1, card.k2);
        tapData.push({ card, pHex, cHex, k1param: tapJson.k1 });
      }

      // Step 2: Generate one fake invoice per card
      const invoices: string[] = [];
      for (let i = 0; i < tapData.length; i++) {
        const invResp = await fakeInvoice(CALLBACK_AMOUNT);
        expect(invResp.status).toBe(200);
        const invJson = (await invResp.json()) as { pr: string };
        expect(invJson.pr).toBeTruthy();
        invoices.push(invJson.pr);
      }

      // Step 3: Fire 2 concurrent callbacks per card (same invoice = double-spend)
      const callbackRequests: { cardIdx: number }[] = [];
      for (let i = 0; i < tapData.length; i++) {
        const { pHex, cHex, k1param } = tapData[i]!;
        // Two identical callbacks per card
        for (let j = 0; j < 2; j++) {
          callbackRequests.push({ cardIdx: i });
        }
      }

      // Fire all 6 callbacks concurrently
      const cbResults = await Promise.all(
        callbackRequests.map((req, idx) => {
          const i = req.cardIdx;
          const { pHex, cHex, k1param } = tapData[i]!;
          return lnurlCallback(pHex, k1param, invoices[i]!, CALLBACK_AMOUNT);
        }),
      );

      // Step 4: Verify exactly 1 callback per card succeeded
      for (let i = 0; i < tapData.length; i++) {
        const card = testCards[i]!;
        const cardResults = cbResults.filter(
          (_, idx) => callbackRequests[idx]!.cardIdx === i,
        );
        expect(cardResults).toHaveLength(2);

        const successes = cardResults.filter((r) => r.status === 200);
        const failures = cardResults.filter((r) => r.status !== 200);

        // Exactly one success, one failure (replay/double-spend)
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);

        // Card was debited exactly once
        card.expectedBalance -= CALLBACK_AMOUNT;
      }
    });

    it("verifies correct balances after LNURL double-spend test", async () => {
      const testCards = cards.slice(0, NUM_LNURL_CARDS);
      for (let i = 0; i < testCards.length; i++) {
        const card = testCards[i]!;
        const counter = nextCounter();
        const infoResp = await cardInfo(card.uid, card.k1, card.k2, counter);
        expect(infoResp.status).toBe(200);
        const infoJson = (await infoResp.json()) as { balance: number };
        expect(infoJson.balance).toBe(card.expectedBalance);
      }
    });
  });

  // ── Phase 4: Mixed concurrent top-ups + charges ──────────────────────────────

  describe("Phase 4: Mixed concurrent top-ups + charges", () => {
    it("tops up all cards then fires concurrent top-up + charge per card", async () => {
      // Step 1: Sequential top-up of 5000 per card
      for (const card of cards) {
        const counter = nextCounter();
        const resp = await topUp(card.uid, 5000, card.k1, card.k2, counter);
        expect(resp.status).toBe(200);
        card.expectedBalance += 5000;
      }

      // Step 2: Fire top-up(1000) + pos-charge(500) simultaneously per card
      const mixedRequests: { cardIdx: number; type: "topup" | "charge"; counter: number }[] = [];
      for (let i = 0; i < cards.length; i++) {
        mixedRequests.push({ cardIdx: i, type: "topup", counter: nextCounter() });
        mixedRequests.push({ cardIdx: i, type: "charge", counter: nextCounter() });
      }

      const mixedResults = await Promise.all(
        mixedRequests.map((req) => {
          const card = cards[req.cardIdx]!;
          if (req.type === "topup") {
            return topUp(card.uid, 1000, card.k1, card.k2, req.counter);
          }
          return posCharge(card.uid, 500, card.k1, card.k2, req.counter);
        }),
      );

      // Both top-up and charge should succeed per card (different counters)
      for (let i = 0; i < cards.length; i++) {
        const topupResult = mixedResults.find(
          (_, idx) => mixedRequests[idx]!.cardIdx === i && mixedRequests[idx]!.type === "topup",
        );
        const chargeResult = mixedResults.find(
          (_, idx) => mixedRequests[idx]!.cardIdx === i && mixedRequests[idx]!.type === "charge",
        );
        expect(topupResult!.status).toBe(200);
        expect(chargeResult!.status).toBe(200);

        // Net: +1000 - 500 = +500
        cards[i]!.expectedBalance += 500;
      }
    });

    it("verifies correct balances after mixed load", async () => {
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]!;
        const counter = nextCounter();
        const infoResp = await cardInfo(card.uid, card.k1, card.k2, counter);
        expect(infoResp.status).toBe(200);
        const infoJson = (await infoResp.json()) as { balance: number };
        expect(infoJson.balance).toBe(card.expectedBalance);
      }
    });
  });

  // ── Phase 5: Double-spend stress — single card, same tap ─────────────────────

  describe("Phase 5: Double-spend stress (same card, same tap params)", () => {
    it("two concurrent LNURL callbacks with identical params — exactly 1 succeeds", async () => {
      const card = cards[0]!;

      // Tap the card
      const counter = nextCounter();
      const tapResp = await cardTap(card.uid, card.k1, card.k2, counter);
      expect(tapResp.status).toBe(200);

      const tapJson = (await tapResp.json()) as {
        tag: string;
        callback: string;
        k1: string;
      };

      // Get fake invoice
      const invResp = await fakeInvoice(200);
      expect(invResp.status).toBe(200);
      const invJson = (await invResp.json()) as { pr: string };

      // Re-derive p/c for callback
      const { pHex, cHex } = virtualTap(card.uid, counter, card.k1, card.k2);

      // Fire 2 identical callbacks simultaneously
      const [resp1, resp2] = await Promise.all([
        lnurlCallback(pHex, tapJson.k1, invJson.pr, 200),
        lnurlCallback(pHex, tapJson.k1, invJson.pr, 200),
      ]);

      const statuses = [resp1.status, resp2.status].sort();
      // One should be 200 (success), the other 409 (conflict/replay)
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // Card was debited exactly once
      card.expectedBalance -= 200;
    });

    it("verifies balance after double-spend stress", async () => {
      const card = cards[0]!;
      const counter = nextCounter();
      const infoResp = await cardInfo(card.uid, card.k1, card.k2, counter);
      expect(infoResp.status).toBe(200);
      const infoJson = (await infoResp.json()) as { balance: number };
      expect(infoJson.balance).toBe(card.expectedBalance);
    });

    it("POS charge with duplicate counter still processes (replay enforcement disabled)", async () => {
      const card = cards[1]!;
      const counter = nextCounter();

      // First charge should succeed
      const resp1 = await posCharge(card.uid, 100, card.k1, card.k2, counter);
      expect(resp1.status).toBe(200);
      const json1 = (await resp1.json()) as { balance: number };
      expect(json1.balance).toBe(card.expectedBalance - 100);
      card.expectedBalance -= 100;

      // Second charge with same counter — replay enforcement is disabled for POS,
      // so it processes again (warns but proceeds)
      const resp2 = await posCharge(card.uid, 100, card.k1, card.k2, counter);
      expect(resp2.status).toBe(200);
      const json2 = (await resp2.json()) as { balance: number };
      expect(json2.balance).toBe(card.expectedBalance - 100);
      card.expectedBalance -= 100;

      // Verify balance reflects both charges
      const infoCounter = nextCounter();
      const infoResp = await cardInfo(card.uid, card.k1, card.k2, infoCounter);
      expect(infoResp.status).toBe(200);
      const infoJson = (await infoResp.json()) as { balance: number };
      expect(infoJson.balance).toBe(card.expectedBalance);
    });
  });
});
