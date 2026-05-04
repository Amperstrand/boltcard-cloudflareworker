import { env } from "cloudflare:workers";

let testCounter = 0;

function makeStub(): DurableObjectStub {
  testCounter++;
  const ns = (env as Env & { CARD_REPLAY: DurableObjectNamespace }).CARD_REPLAY;
  const id = ns.idFromName(`test-do-real-${testCounter}`);
  return ns.get(id);
}

async function doPost(stub: DurableObjectStub, path: string, body?: Record<string, unknown>): Promise<Response> {
  return stub.fetch(new Request(`http://do${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function doGet(stub: DurableObjectStub, path: string, qs = ""): Promise<Response> {
  return stub.fetch(new Request(`http://do${path}${qs}`));
}

async function json(res: Response): Promise<Record<string, any>> {
  return res.json() as Promise<Record<string, any>>;
}

describe("CardReplayDO real SQLite", () => {
  let stub: DurableObjectStub;

  beforeEach(() => {
    stub = makeStub();
  });

  describe("counter check", () => {
    it("accepts first counter", async () => {
      const res = await doPost(stub, "/check", { counterValue: 5 });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.accepted).toBe(true);
      expect(data.lastCounter).toBe(5);
    });

    it("rejects replayed counter", async () => {
      await doPost(stub, "/check", { counterValue: 5 });
      const res = await doPost(stub, "/check", { counterValue: 5 });
      expect(res.status).toBe(409);
      const data = await json(res);
      expect(data.accepted).toBe(false);
      expect(data.lastCounter).toBe(5);
    });

    it("accepts higher counter after previous", async () => {
      await doPost(stub, "/check", { counterValue: 5 });
      const res = await doPost(stub, "/check", { counterValue: 6 });
      const data = await json(res);
      expect(data.accepted).toBe(true);
      expect(data.lastCounter).toBe(6);
    });

    it("rejects non-integer counter", async () => {
      const res = await doPost(stub, "/check", { counterValue: 3.5 });
      expect(res.status).toBe(400);
    });

    it("check-readonly does not advance counter", async () => {
      await doPost(stub, "/check", { counterValue: 5 });
      const ro = await doPost(stub, "/check-readonly", { counterValue: 10 });
      const roData = await json(ro);
      expect(roData.accepted).toBe(true);
      const res = await doPost(stub, "/check", { counterValue: 6 });
      const data = await json(res);
      expect(data.accepted).toBe(true);
      expect(data.lastCounter).toBe(6);
    });

    it("check-readonly detects replay without advancing", async () => {
      await doPost(stub, "/check", { counterValue: 5 });
      const res = await doPost(stub, "/check-readonly", { counterValue: 3 });
      expect(res.status).toBe(409);
      const data = await json(res);
      expect(data.accepted).toBe(false);
    });
  });

  describe("card state lifecycle", () => {
    it("starts as new with no DO row", async () => {
      const res = await doGet(stub, "/card-state");
      const data = await json(res);
      expect(data.state).toBe("new");
      expect(data.balance).toBe(0);
      expect(data.active_version).toBeNull();
    });

    it("mark-pending creates pending state", async () => {
      const res = await doPost(stub, "/mark-pending", {
        key_provenance: "public_issuer",
        key_fingerprint: "abc123",
        key_label: "test-key",
      });
      const data = await json(res);
      expect(data.state).toBe("pending");
      expect(data.key_provenance).toBe("public_issuer");
      expect(data.key_fingerprint).toBe("abc123");
      expect(data.key_label).toBe("test-key");
      expect(data.first_seen_at).toBeGreaterThan(0);
    });

    it("mark-pending returns already_exists on second call", async () => {
      await doPost(stub, "/mark-pending", { key_provenance: "public_issuer" });
      const res = await doPost(stub, "/mark-pending", { key_provenance: "env_issuer" });
      const data = await json(res);
      expect(data.already_exists).toBe(true);
      expect(data.state).toBe("pending");
    });

    it("discover upgrades pending to discovered", async () => {
      await doPost(stub, "/mark-pending", { key_provenance: "public_issuer" });
      const res = await doPost(stub, "/discover", {
        key_provenance: "public_issuer",
        key_fingerprint: "abc123",
        key_label: "dev-01",
        active_version: 1,
      });
      const data = await json(res);
      expect(data.state).toBe("discovered");
      expect(data.active_version).toBe(1);
      expect(data.already_exists).toBe(true);
    });

    it("discover creates discovered row from scratch (no prior state)", async () => {
      const res = await doPost(stub, "/discover", {
        key_provenance: "env_issuer",
        key_fingerprint: "def456",
        active_version: 2,
      });
      const data = await json(res);
      expect(data.state).toBe("discovered");
      expect(data.latest_issued_version).toBe(2);
      expect(data.active_version).toBe(2);
    });

    it("discover does NOT upgrade active state", async () => {
      await doPost(stub, "/deliver-keys");
      await doPost(stub, "/activate", { active_version: 1 });
      const res = await doPost(stub, "/discover", {
        key_provenance: "env_issuer",
        active_version: 1,
      });
      const data = await json(res);
      expect(data.state).toBe("active");
    });

    it("deliver-keys transitions to keys_delivered with version increment", async () => {
      const res = await doPost(stub, "/deliver-keys");
      const data = await json(res);
      expect(data.state).toBe("keys_delivered");
      expect(data.version).toBe(1);
      expect(data.latest_issued_version).toBe(1);
    });

    it("deliver-keys increments version on re-delivery", async () => {
      await doPost(stub, "/deliver-keys");
      const res = await doPost(stub, "/deliver-keys");
      const data = await json(res);
      expect(data.version).toBe(2);
    });

    it("activate transitions from keys_delivered to active", async () => {
      await doPost(stub, "/deliver-keys");
      const res = await doPost(stub, "/activate", { active_version: 1 });
      const data = await json(res);
      expect(data.state).toBe("active");
      expect(data.active_version).toBe(1);
      expect(data.activated_at).toBeGreaterThan(0);
    });

    it("activate rejects invalid active_version", async () => {
      const res = await doPost(stub, "/activate", { active_version: 0 });
      expect(res.status).toBe(400);
    });

    it("terminate clears taps and counters", async () => {
      await doPost(stub, "/deliver-keys");
      await doPost(stub, "/activate", { active_version: 1 });
      await doPost(stub, "/check", { counterValue: 5 });
      await doPost(stub, "/record-tap", { counterValue: 5, bolt11: "lnbc100" });

      const res = await doPost(stub, "/terminate");
      const data = await json(res);
      expect(data.state).toBe("terminated");
      expect(data.terminated_at).toBeGreaterThan(0);

      const counterTaps = json(await doGet(stub, "/list-taps")).then(d =>
        d.taps.filter((t: Record<string, any>) => t.counter !== null)
      );
      expect(await counterTaps).toHaveLength(0);

      const checkRes = await doPost(stub, "/check", { counterValue: 1 });
      expect((await json(checkRes)).accepted).toBe(true);
    });

    it("request-wipe transitions to wipe_requested", async () => {
      await doPost(stub, "/deliver-keys");
      await doPost(stub, "/activate", { active_version: 1 });
      const res = await doPost(stub, "/request-wipe");
      const data = await json(res);
      expect(data.state).toBe("wipe_requested");
      expect(data.wipe_keys_fetched_at).toBeGreaterThan(0);
    });

    it("request-wipe returns 404 on new card (no state row)", async () => {
      const res = await doPost(stub, "/request-wipe");
      expect(res.status).toBe(404);
    });
  });

  describe("balance and transactions", () => {
    it("starts with zero balance", async () => {
      const res = await doGet(stub, "/balance");
      const data = await json(res);
      expect(data.balance).toBe(0);
    });

    it("credit increases balance", async () => {
      const res = await doPost(stub, "/credit", { amount: 1000, note: "top-up" });
      const data = await json(res);
      expect(data.ok).toBe(true);
      expect(data.balance).toBe(1000);
      expect(data.transaction.amount).toBe(1000);
      expect(data.transaction.balance_after).toBe(1000);
    });

    it("debit decreases balance", async () => {
      await doPost(stub, "/credit", { amount: 1000 });
      const res = await doPost(stub, "/debit", { counter: 1, amount: 300, note: "payment" });
      const data = await json(res);
      expect(data.ok).toBe(true);
      expect(data.balance).toBe(700);
      expect(data.transaction.amount).toBe(-300);
    });

    it("debit rejects insufficient balance", async () => {
      await doPost(stub, "/credit", { amount: 100 });
      const res = await doPost(stub, "/debit", { counter: 1, amount: 200 });
      expect(res.status).toBe(400);
      const data = await json(res);
      expect(data.ok).toBe(false);
      expect(data.reason).toBe("Insufficient balance");
      expect(data.balance).toBe(100);
    });

    it("debit rejects zero amount", async () => {
      const res = await doPost(stub, "/debit", { counter: 1, amount: 0 });
      expect(res.status).toBe(400);
    });

    it("debit rejects negative amount", async () => {
      const res = await doPost(stub, "/debit", { counter: 1, amount: -50 });
      expect(res.status).toBe(400);
    });

    it("credit rejects zero amount", async () => {
      const res = await doPost(stub, "/credit", { amount: 0 });
      expect(res.status).toBe(400);
    });

    it("exact drain leaves zero balance", async () => {
      await doPost(stub, "/credit", { amount: 500 });
      const res = await doPost(stub, "/debit", { counter: 1, amount: 500 });
      const data = await json(res);
      expect(data.balance).toBe(0);
    });

    it("lists transactions in reverse order", async () => {
      await doPost(stub, "/credit", { amount: 1000, note: "first" });
      await doPost(stub, "/credit", { amount: 500, note: "second" });
      const res = await doGet(stub, "/transactions");
      const data = await json(res);
      expect(data.transactions.length).toBe(2);
      expect(data.transactions[0].amount).toBe(500);
      expect(data.transactions[1].amount).toBe(1000);
    });

    it("transactions respect limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await doPost(stub, "/credit", { amount: 100 });
      }
      const res = await doGet(stub, "/transactions", "?limit=2");
      const data = await json(res);
      expect(data.transactions.length).toBe(2);
    });
  });

  describe("tap recording and claim-tap", () => {
    it("record-tap advances counter and creates tap", async () => {
      const res = await doPost(stub, "/record-tap", {
        counterValue: 3,
        bolt11: "lnbc100",
        amountMsat: 100000,
      });
      const data = await json(res);
      expect(data.accepted).toBe(true);
      expect(data.tapRecorded).toBe(true);
    });

    it("record-tap rejects replayed counter", async () => {
      await doPost(stub, "/record-tap", { counterValue: 3 });
      const res = await doPost(stub, "/record-tap", { counterValue: 3 });
      expect(res.status).toBe(409);
    });

    it("record-read creates read tap without advancing counter", async () => {
      const res = await doPost(stub, "/record-read", {
        counterValue: 5,
        userAgent: "test",
        requestUrl: "http://test",
      });
      const data = await json(res);
      expect(data.recorded).toBe(true);
    });

    it("record-read uses timestamp when counter invalid", async () => {
      const res = await doPost(stub, "/record-read", {
        counterValue: -1,
      });
      const data = await json(res);
      expect(data.recorded).toBe(true);
    });

    it("claim-tap creates tap if not found", async () => {
      const res = await doPost(stub, "/claim-tap", {
        counter: 5,
        bolt11: "lnbc50",
        amountMsat: 50000,
      });
      const data = await json(res);
      expect(data.claimed).toBe(true);
    });

    it("claim-tap claims existing unclaimed tap", async () => {
      await doPost(stub, "/record-read", { counterValue: 5 });
      const res = await doPost(stub, "/claim-tap", {
        counter: 5,
        bolt11: "lnbc100",
        amountMsat: 100000,
      });
      const data = await json(res);
      expect(data.claimed).toBe(true);
    });

    it("claim-tap rejects already-claimed tap (double-spend)", async () => {
      await doPost(stub, "/claim-tap", { counter: 5, bolt11: "lnbc1" });
      const res = await doPost(stub, "/claim-tap", { counter: 5, bolt11: "lnbc2" });
      expect(res.status).toBe(409);
      const data = await json(res);
      expect(data.claimed).toBe(false);
      expect(data.reason).toBe("Tap already claimed");
      expect(data.bolt11).toBe("lnbc1");
    });

    it("claim-tap rejects invalid counter", async () => {
      const res = await doPost(stub, "/claim-tap", { counter: -1 });
      expect(res.status).toBe(400);
    });

    it("update-tap-status updates status", async () => {
      await doPost(stub, "/record-tap", { counterValue: 5, bolt11: "lnbc1" });
      const res = await doPost(stub, "/update-tap-status", {
        counter: 5,
        status: "completed",
      });
      const data = await json(res);
      expect(data.updated).toBe(true);
      const tapsData = await json(await doGet(stub, "/list-taps"));
      const t5 = tapsData.taps.find((t: Record<string, any>) => t.counter === 5);
      expect(t5.status).toBe("completed");
    });

    it("update-tap-status rejects invalid status", async () => {
      const res = await doPost(stub, "/update-tap-status", {
        counter: 5,
        status: "bogus",
      });
      expect(res.status).toBe(400);
    });

    it("update-tap-status returns updated:false for missing tap", async () => {
      const res = await doPost(stub, "/update-tap-status", {
        counter: 999,
        status: "completed",
      });
      const data = await json(res);
      expect(data.updated).toBe(false);
    });
  });

  describe("list-taps with lifecycle events", () => {
    it("merges tap data with lifecycle events", async () => {
      await doPost(stub, "/deliver-keys");
      await doPost(stub, "/activate", { active_version: 1 });
      await doPost(stub, "/record-tap", { counterValue: 5, bolt11: "lnbc100" });

      const res = await doGet(stub, "/list-taps");
      const data = await json(res);
      const statuses = data.taps.map((t: Record<string, any>) => t.status);
      expect(statuses).toContain("pending");
      expect(statuses).toContain("activated");
      expect(statuses).toContain("provisioned");
    });

    it("respects limit parameter", async () => {
      for (let i = 1; i <= 10; i++) {
        await doPost(stub, "/record-tap", { counterValue: i, bolt11: `lnbc${i}` });
      }
      const res = await doGet(stub, "/list-taps", "?limit=3");
      const data = await json(res);
      expect(data.taps.length).toBe(3);
    });
  });

  describe("analytics", () => {
    it("returns zero stats for empty DO", async () => {
      const res = await doGet(stub, "/analytics");
      const data = await json(res);
      expect(data.totalTaps).toBe(0);
      expect(data.totalMsat).toBe(0);
    });

    it("aggregates tap stats correctly", async () => {
      await doPost(stub, "/record-tap", { counterValue: 1, amountMsat: 1000 });
      await doPost(stub, "/update-tap-status", { counter: 1, status: "completed" });
      await doPost(stub, "/record-tap", { counterValue: 2, amountMsat: 2000 });
      await doPost(stub, "/update-tap-status", { counter: 2, status: "failed" });
      await doPost(stub, "/record-tap", { counterValue: 3, amountMsat: 3000 });

      const res = await doGet(stub, "/analytics");
      const data = await json(res);
      expect(data.totalTaps).toBe(3);
      expect(data.completedMsat).toBe(1000);
      expect(data.failedMsat).toBe(2000);
      expect(data.pendingMsat).toBe(3000);
    });
  });

  describe("config", () => {
    it("returns null when no config set", async () => {
      const res = await doGet(stub, "/get-config");
      const data = await json(res);
      expect(data).toBeNull();
    });

    it("set-config stores and get-config retrieves", async () => {
      await doPost(stub, "/set-config", {
        K2: "deadbeef",
        payment_method: "clnrest",
        ln_address: "test@example.com",
      });
      const res = await doGet(stub, "/get-config");
      const data = await json(res);
      expect(data.payment_method).toBe("clnrest");
      expect(data.K2).toBe("deadbeef");
      expect(data.ln_address).toBe("test@example.com");
    });

    it("set-k2 updates K2 without changing payment_method", async () => {
      await doPost(stub, "/set-config", { K2: "old", payment_method: "clnrest" });
      await doPost(stub, "/set-k2", { K2: "new" });
      const res = await doGet(stub, "/get-config");
      const data = await json(res);
      expect(data.K2).toBe("new");
      expect(data.payment_method).toBe("clnrest");
    });

    it("set-k2 creates config row if missing", async () => {
      await doPost(stub, "/set-k2", { K2: "abc" });
      const res = await doGet(stub, "/get-config");
      const data = await json(res);
      expect(data.K2).toBe("abc");
      expect(data.payment_method).toBe("fakewallet");
    });
  });

  describe("reset", () => {
    it("clears counters and taps", async () => {
      await doPost(stub, "/record-tap", { counterValue: 10, bolt11: "lnbc1" });

      await doPost(stub, "/reset", {});

      const checkRes = await doPost(stub, "/check", { counterValue: 1 });
      expect((await json(checkRes)).accepted).toBe(true);

      const counterTaps = await json(await doGet(stub, "/list-taps")).then(d =>
        d.taps.filter((t: Record<string, any>) => t.counter !== null)
      );
      expect(counterTaps).toHaveLength(0);
    });
  });

  describe("provenance tracking", () => {
    it("mark-pending stores provenance fields", async () => {
      await doPost(stub, "/mark-pending", {
        key_provenance: "env_issuer",
        key_fingerprint: "abcd1234efgh5678",
        key_label: "production",
      });
      const res = await doGet(stub, "/card-state");
      const data = await json(res);
      expect(data.key_provenance).toBe("env_issuer");
      expect(data.key_fingerprint).toBe("abcd1234efgh5678");
      expect(data.key_label).toBe("production");
    });

    it("discover preserves provenance via COALESCE", async () => {
      await doPost(stub, "/mark-pending", {
        key_provenance: "public_issuer",
        key_fingerprint: "aaa",
      });
      await doPost(stub, "/discover", {
        key_provenance: null,
        key_fingerprint: null,
        key_label: "override-label",
        active_version: 1,
      });
      const res = await doGet(stub, "/card-state");
      const data = await json(res);
      expect(data.key_provenance).toBe("public_issuer");
      expect(data.key_fingerprint).toBe("aaa");
      expect(data.key_label).toBe("override-label");
    });
  });

  describe("404", () => {
    it("returns 404 for unknown path", async () => {
      const res = await doGet(stub, "/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
