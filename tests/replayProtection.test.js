import { recordTap, updateTapStatus, listTaps, resetReplayProtection, getCardState, deliverKeys, activateCard, terminateCard, requestWipe, getCardConfig, setCardConfig, debitCard, creditCard, getBalance, listTransactions, recordTapRead, getAnalytics, checkAndAdvanceCounter } from "../replayProtection.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const UID = "04a39493cc8680";

function makeEnv() {
  return { CARD_REPLAY: makeReplayNamespace({}, { [UID]: 1 }) };
}

function makeErrorEnv(statusCode, reason) {
  return {
    CARD_REPLAY: {
      idFromName: () => "stub",
      get: () => ({
        fetch: async (req) => {
          if (req.method === "GET") {
            return Response.json({ error: reason }, { status: statusCode });
          }
          return Response.json({ reason, error: reason }, { status: statusCode });
        },
      }),
    },
  };
}

describe("replayProtection", () => {
  describe("checkAndAdvanceCounter", () => {
    it("accepts first counter for new card", async () => {
      const env = makeEnv();
      const result = await checkAndAdvanceCounter(env, UID, 2);
      expect(result.accepted).toBe(true);
      expect(result.lastCounter).toBe(2);
    });

    it("accepts higher counter", async () => {
      const env = makeEnv();
      await checkAndAdvanceCounter(env, UID, 2);
      const result = await checkAndAdvanceCounter(env, UID, 5);
      expect(result.accepted).toBe(true);
    });

    it("rejects same counter", async () => {
      const env = makeEnv();
      await checkAndAdvanceCounter(env, UID, 3);
      const result = await checkAndAdvanceCounter(env, UID, 3);
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain("replay");
    });

    it("rejects lower counter", async () => {
      const env = makeEnv();
      await checkAndAdvanceCounter(env, UID, 10);
      const result = await checkAndAdvanceCounter(env, UID, 5);
      expect(result.accepted).toBe(false);
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(checkAndAdvanceCounter({}, UID, 1)).rejects.toThrow("not configured");
    });
  });

  describe("recordTap", () => {
    it("records tap with bolt11 and amount", async () => {
      const env = makeEnv();
      const result = await recordTap(env, UID, 2, {
        bolt11: "lnbc10n1test",
        amountMsat: 1000,
      });
      expect(result.accepted).toBe(true);
    });

    it("rejects replay counter", async () => {
      const env = makeEnv();
      await recordTap(env, UID, 3, { bolt11: "lnbc10n1test" });
      const result = await recordTap(env, UID, 3, { bolt11: "lnbc10n1test2" });
      expect(result.accepted).toBe(false);
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(recordTap({}, UID, 1, {})).rejects.toThrow("not configured");
    });
  });

  describe("recordTapRead", () => {
    it("records read without throwing", async () => {
      const env = makeEnv();
      await expect(recordTapRead(env, UID, 2, { userAgent: "test" })).resolves.toBeUndefined();
    });

    it("does nothing when CARD_REPLAY missing", async () => {
      await expect(recordTapRead({}, UID, 2)).resolves.toBeUndefined();
    });
  });

  describe("updateTapStatus", () => {
    it("updates tap status", async () => {
      const env = makeEnv();
      await recordTap(env, UID, 2, { bolt11: "lnbc10n1test" });
      await expect(updateTapStatus(env, UID, 2, "completed")).resolves.toBeUndefined();
    });

    it("does nothing when CARD_REPLAY missing", async () => {
      await expect(updateTapStatus({}, UID, 2, "completed")).resolves.toBeUndefined();
    });
  });

  describe("listTaps", () => {
    it("returns empty array when no taps", async () => {
      const env = makeEnv();
      const result = await listTaps(env, UID);
      expect(result.taps).toEqual([]);
    });

    it("returns recorded taps", async () => {
      const env = makeEnv();
      await recordTap(env, UID, 3, { bolt11: "lnbc10n1test" });
      const result = await listTaps(env, UID);
      expect(result.taps).toHaveLength(1);
      expect(result.taps[0].counter).toBe(3);
    });

    it("returns empty when CARD_REPLAY missing", async () => {
      const result = await listTaps({}, UID);
      expect(result.taps).toEqual([]);
    });
  });

  describe("resetReplayProtection", () => {
    it("resets counters and taps", async () => {
      const env = makeEnv();
      await checkAndAdvanceCounter(env, UID, 10);
      await resetReplayProtection(env, UID);
      const result = await checkAndAdvanceCounter(env, UID, 5);
      expect(result.accepted).toBe(true);
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(resetReplayProtection({}, UID)).rejects.toThrow("not configured");
    });
  });

  describe("getCardState", () => {
    it("returns card state for activated card", async () => {
      const env = makeEnv();
      const state = await getCardState(env, UID);
      expect(state.state).toBe("active");
      expect(state.active_version).toBe(1);
    });

    it("returns new state for unknown card", async () => {
      const env = makeEnv();
      const state = await getCardState(env, "04a39493cc8681");
      expect(state.state).toBe("new");
    });

    it("returns new state when CARD_REPLAY missing", async () => {
      const state = await getCardState({}, UID);
      expect(state.state).toBe("new");
    });
  });

  describe("deliverKeys", () => {
    it("delivers keys for new card", async () => {
      const env = makeEnv();
      env.CARD_REPLAY.__cardStates.get(UID).state = "new";
      const result = await deliverKeys(env, UID);
      expect(result.state).toBe("keys_delivered");
      expect(result.latest_issued_version).toBeGreaterThanOrEqual(1);
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(deliverKeys({}, UID)).rejects.toThrow("not configured");
    });
  });

  describe("activateCard", () => {
    it("activates a card", async () => {
      const env = makeEnv();
      env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
      const result = await activateCard(env, UID, 1);
      expect(result.state).toBe("active");
      expect(result.active_version).toBe(1);
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(activateCard({}, UID, 1)).rejects.toThrow("not configured");
    });
  });

  describe("terminateCard", () => {
    it("terminates an active card", async () => {
      const env = makeEnv();
      const result = await terminateCard(env, UID);
      expect(result.state).toBe("terminated");
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(terminateCard({}, UID)).rejects.toThrow("not configured");
    });
  });

  describe("requestWipe", () => {
    it("requests wipe for active card", async () => {
      const env = makeEnv();
      const result = await requestWipe(env, UID);
      expect(result).toBeDefined();
    });

    it("throws when CARD_REPLAY missing", async () => {
      await expect(requestWipe({}, UID)).rejects.toThrow("not configured");
    });
  });

  describe("getCardConfig / setCardConfig", () => {
    it("sets and gets config", async () => {
      const env = makeEnv();
      const config = { K2: "abcdef0123456789abcdef0123456789", payment_method: "fakewallet" };
      await setCardConfig(env, UID, config);
      const retrieved = await getCardConfig(env, UID);
      expect(retrieved.payment_method).toBe("fakewallet");
      expect(retrieved.K2).toBe(config.K2);
    });

    it("returns null when no config set", async () => {
      const env = makeEnv();
      const result = await getCardConfig(env, UID);
      expect(result).toBeNull();
    });

    it("returns null when CARD_REPLAY missing", async () => {
      const result = await getCardConfig({}, UID);
      expect(result).toBeNull();
    });

    it("setCardConfig does nothing when CARD_REPLAY missing", async () => {
      await expect(setCardConfig({}, UID, {})).resolves.toBeUndefined();
    });
  });

  describe("debitCard / creditCard / getBalance", () => {
    it("credits and debits balance", async () => {
      const env = makeEnv();
      const credit = await creditCard(env, UID, 1000, "topup");
      expect(credit.ok).toBe(true);
      expect(credit.balance).toBe(1000);

      const debit = await debitCard(env, UID, null, 300, "payment");
      expect(debit.ok).toBe(true);
      expect(debit.balance).toBe(700);
    });

    it("returns error when DO unavailable", async () => {
      const result = await debitCard({}, UID, null, 100, "test");
      expect(result.ok).toBe(false);
      const credit = await creditCard({}, UID, 100, "test");
      expect(credit.ok).toBe(false);
    });

    it("getBalance returns 0 when DO unavailable", async () => {
      const result = await getBalance({}, UID);
      expect(result.balance).toBe(0);
    });
  });

  describe("listTransactions", () => {
    it("returns empty when no transactions", async () => {
      const env = makeEnv();
      const result = await listTransactions(env, UID);
      expect(result.transactions).toEqual([]);
    });

    it("returns transactions after credit/debit", async () => {
      const env = makeEnv();
      await creditCard(env, UID, 500, "topup");
      await debitCard(env, UID, 1, 200, "payment");
      const result = await listTransactions(env, UID);
      expect(result.transactions).toHaveLength(2);
    });

    it("returns empty when DO unavailable", async () => {
      const result = await listTransactions({}, UID);
      expect(result.transactions).toEqual([]);
    });
  });

  describe("getAnalytics", () => {
    it("returns zeros for card with no taps", async () => {
      const env = makeEnv();
      const result = await getAnalytics(env, UID);
      expect(result.totalTaps).toBe(0);
      expect(result.totalMsat).toBe(0);
    });

    it("returns zeros when DO unavailable", async () => {
      const result = await getAnalytics({}, UID);
      expect(result.totalTaps).toBe(0);
    });
  });

  describe("error paths", () => {
    it("checkAndAdvanceCounter throws on server error", async () => {
      const env = makeErrorEnv(500, "internal");
      await expect(checkAndAdvanceCounter(env, UID, 2)).rejects.toThrow("internal");
    });

    it("recordTap throws on server error", async () => {
      const env = makeErrorEnv(500, "tap failed");
      await expect(recordTap(env, UID, 2, {})).rejects.toThrow("tap failed");
    });

    it("listTaps returns empty on server error", async () => {
      const env = makeErrorEnv(500, "list failed");
      const result = await listTaps(env, UID);
      expect(result.taps).toEqual([]);
    });

    it("resetReplayProtection throws on server error", async () => {
      const env = makeErrorEnv(500, "reset fail");
      await expect(resetReplayProtection(env, UID)).rejects.toThrow("reset fail");
    });

    it("getAnalytics returns zeros on server error", async () => {
      const env = makeErrorEnv(500, "analytics fail");
      const result = await getAnalytics(env, UID);
      expect(result.totalTaps).toBe(0);
    });

    it("getCardState throws on server error (not 404)", async () => {
      const env = makeErrorEnv(500, "state fail");
      await expect(getCardState(env, UID)).rejects.toThrow("state fail");
    });

    it("getCardState returns legacy on 404", async () => {
      const env = makeErrorEnv(404, "not found");
      const state = await getCardState(env, UID);
      expect(state.state).toBe("legacy");
    });

    it("deliverKeys returns legacy fallback on 404", async () => {
      const env = makeErrorEnv(404, "not found");
      const result = await deliverKeys(env, UID);
      expect(result.state).toBe("keys_delivered");
      expect(result.latest_issued_version).toBe(1);
    });

    it("deliverKeys throws on server error", async () => {
      const env = makeErrorEnv(500, "deliver fail");
      await expect(deliverKeys(env, UID)).rejects.toThrow("deliver fail");
    });

    it("activateCard returns legacy fallback on 404", async () => {
      const env = makeErrorEnv(404, "not found");
      const result = await activateCard(env, UID, 3);
      expect(result.state).toBe("active");
      expect(result.active_version).toBe(3);
    });

    it("activateCard throws on server error", async () => {
      const env = makeErrorEnv(500, "activate fail");
      await expect(activateCard(env, UID, 1)).rejects.toThrow("activate fail");
    });

    it("terminateCard returns legacy fallback on 404", async () => {
      const env = makeErrorEnv(404, "not found");
      const result = await terminateCard(env, UID);
      expect(result.state).toBe("terminated");
    });

    it("terminateCard throws on server error", async () => {
      const env = makeErrorEnv(500, "terminate fail");
      await expect(terminateCard(env, UID)).rejects.toThrow("terminate fail");
    });

    it("requestWipe returns fallback on 404", async () => {
      const env = makeErrorEnv(404, "not found");
      const result = await requestWipe(env, UID);
      expect(result.state).toBe("new");
    });

    it("requestWipe throws on server error", async () => {
      const env = makeErrorEnv(500, "wipe fail");
      await expect(requestWipe(env, UID)).rejects.toThrow("wipe fail");
    });

    it("getCardConfig returns null on server error", async () => {
      const env = makeErrorEnv(500, "config fail");
      const result = await getCardConfig(env, UID);
      expect(result).toBeNull();
    });

    it("setCardConfig does nothing when CARD_REPLAY missing", async () => {
      await expect(setCardConfig({}, UID, { foo: "bar" })).resolves.toBeUndefined();
    });
  });
});
