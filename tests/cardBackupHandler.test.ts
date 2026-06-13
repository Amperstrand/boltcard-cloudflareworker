import { handleCardExport, handleCardRestore } from "../handlers/cardBackupHandler.js";
import { buildCardTestEnv } from "./testHelpers.js";

const UID = "ff000000000001";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeRestoreRequest(uid: string, body: unknown, authed: boolean = true): Request {
  const env = buildCardTestEnv({ uid, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet", balance: 5000, operatorAuth: authed });
  return new Request(`https://test.local/operator/cards/${uid}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getEnv(authed: boolean = true) {
  return buildCardTestEnv({
    uid: UID,
    issuerKey: ISSUER_KEY,
    paymentMethod: "fakewallet",
    balance: 5000,
    operatorAuth: authed,
  });
}

describe("handleCardExport", () => {
  it("returns card state as JSON download", async () => {
    const env = getEnv();
    const req = new Request(`https://test.local/operator/cards/${UID}/export`, { method: "GET" });
    const res = await handleCardExport(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Content-Disposition")).toContain(`card-${UID}-`);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    const data = await res.json() as Record<string, unknown>;
    expect(data.version).toBe(1);
    expect(data.exported_at).toBeDefined();
    expect(data.card_state).toBeDefined();
    expect(data.replay_state).toBeDefined();
  });

  it("includes taps and transactions in export", async () => {
    const env = getEnv();
    const state = (env.CARD_REPLAY as any).__cardStates.get(UID);
    state.state = "active";
    (env.CARD_REPLAY as any).__taps.set(`${UID}:1`, {
      counter: 1,
      bolt11: "lnbc10n1test",
      status: "completed",
      payment_hash: null,
      amount_msat: 10000,
      user_agent: null,
      request_url: "https://test.local/?p=xxx&c=yyy",
      created_at: 1700000000,
      updated_at: 1700000001,
    });
    (env.CARD_REPLAY as any).__transactions.set(UID, [
      { id: 1, counter: 1, amount: 5000, balance_after: 0, created_at: 1700000000, note: "POS charge" },
    ]);

    const req = new Request(`https://test.local/operator/cards/${UID}/export`, { method: "GET" });
    const res = await handleCardExport(req, env);
    const data = await res.json() as Record<string, unknown>;
    const taps = data.taps as Array<Record<string, unknown>>;
    const txns = data.transactions as Array<Record<string, unknown>>;
    expect(taps).toHaveLength(1);
    expect(taps[0]!.bolt11).toBe("lnbc10n1test");
    expect(txns).toHaveLength(1);
    expect(txns[0]!.amount).toBe(5000);
  });

  it("returns 400 when UID is missing from path", async () => {
    const env = getEnv();
    const req = new Request("https://test.local/operator/cards//export", { method: "GET" });
    const res = await handleCardExport(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated request", async () => {
    const env = getEnv(false);
    const req = new Request(`https://test.local/operator/cards/${UID}/export`, { method: "GET" });
    const res = await handleCardExport(req, env);
    expect(res.status).toBe(302);
  });
});

describe("handleCardRestore", () => {
  it("restores card state from exported JSON", async () => {
    const env = getEnv();

    const exportData = {
      version: 1,
      exported_at: Date.now(),
      replay_state: { singleton: 1, last_counter: 5 },
      card_state: {
        singleton: 1,
        state: "active",
        latest_issued_version: 2,
        active_version: 2,
        activated_at: 1700000000,
        terminated_at: null,
        keys_delivered_at: null,
        wipe_keys_fetched_at: null,
        balance: 12000,
        key_provenance: "public_issuer",
        key_fingerprint: "abc123",
        key_label: "dev-01",
        first_seen_at: 1699000000,
      },
      card_config: {
        singleton: 1,
        K2: "aabbccdd",
        payment_method: "fakewallet",
        config_json: null,
        pull_payment_id: null,
        updated_at: null,
      },
      taps: [
        { counter: 1, bolt11: "lnbc1test", status: "completed", payment_hash: null, amount_msat: 1000, user_agent: null, request_url: null, created_at: 1700000001, updated_at: 1700000002 },
      ],
      transactions: [
        { id: 1, counter: 1, amount: 1000, balance_after: 9000, created_at: 1700000001, note: "topup", voided_at: null },
      ],
    };

    const req = makeRestoreRequest(UID, exportData);
    const res = await handleCardRestore(req, env);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.restored).toBe(true);
    const tables = body.tables as Record<string, number>;
    expect(tables.card_state).toBe(1);
    expect(tables.card_config).toBe(1);
    expect(tables.taps).toBe(1);
    expect(tables.transactions).toBe(1);
    expect((env.CARD_REPLAY as any).__cardStates.get(UID).balance).toBe(12000);
    expect((env.CARD_REPLAY as any).__cardStates.get(UID).state).toBe("active");
    expect((env.CARD_REPLAY as any).__counters.get(UID)).toBe(5);
  });

  it("rejects unsupported export version", async () => {
    const env = getEnv();
    const req = makeRestoreRequest(UID, { version: 99 });
    const res = await handleCardRestore(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const env = getEnv();
    const req = new Request(`https://test.local/operator/cards/${UID}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    const res = await handleCardRestore(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when UID is missing from path", async () => {
    const env = getEnv();
    const req = new Request("https://test.local/operator/cards//restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    const res = await handleCardRestore(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated request", async () => {
    const env = getEnv(false);
    const req = makeRestoreRequest(UID, { version: 1 });
    const res = await handleCardRestore(req, env);
    expect(res.status).toBe(302);
  });
});

describe("export → restore round-trip", () => {
  it("export then restore preserves all state", async () => {
    const env = getEnv();

    (env.CARD_REPLAY as any).__cardStates.get(UID).state = "active";
    (env.CARD_REPLAY as any).__cardStates.get(UID).balance = 7500;
    (env.CARD_REPLAY as any).__counters.set(UID, 3);
    (env.CARD_REPLAY as any).__taps.set(`${UID}:1`, {
      counter: 1, bolt11: "lnbc1", status: "completed", payment_hash: null, amount_msat: 1000, user_agent: "test", request_url: null, created_at: 1, updated_at: 2,
    });
    (env.CARD_REPLAY as any).__taps.set(`${UID}:2`, {
      counter: 2, bolt11: "lnbc2", status: "completed", payment_hash: null, amount_msat: 2000, user_agent: null, request_url: null, created_at: 3, updated_at: 4,
    });
    (env.CARD_REPLAY as any).__transactions.set(UID, [
      { id: 1, counter: null, amount: 10000, balance_after: 10000, created_at: 1, note: "topup" },
      { id: 2, counter: 1, amount: 2500, balance_after: 7500, created_at: 2, note: "POS charge" },
    ]);

    const exportReq = new Request(`https://test.local/operator/cards/${UID}/export`, { method: "GET" });
    const exportRes = await handleCardExport(exportReq, env);
    const exportData = await exportRes.json();

    (env.CARD_REPLAY as any).__cardStates.get(UID).balance = 0;
    (env.CARD_REPLAY as any).__cardStates.get(UID).state = "terminated";
    (env.CARD_REPLAY as any).__counters.set(UID, 0);
    (env.CARD_REPLAY as any).__taps.clear();
    (env.CARD_REPLAY as any).__transactions.set(UID, []);

    const restoreReq = makeRestoreRequest(UID, exportData);
    const restoreRes = await handleCardRestore(restoreReq, env);
    expect(restoreRes.status).toBe(200);

    const state = (env.CARD_REPLAY as any).__cardStates.get(UID);
    expect(state.balance).toBe(7500);
    expect(state.state).toBe("active");
    expect((env.CARD_REPLAY as any).__counters.get(UID)).toBe(3);

    const tapKeys = Array.from((env.CARD_REPLAY as any).__taps.keys() as string[]).filter((k: string) => k.startsWith(`${UID}:`));
    expect(tapKeys).toHaveLength(2);

    const txns = (env.CARD_REPLAY as any).__transactions.get(UID);
    expect(txns).toHaveLength(2);
    expect(txns[0].amount).toBe(10000);
    expect(txns[1].amount).toBe(2500);
  });
});
