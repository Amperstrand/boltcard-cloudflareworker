import { handleCardBatchAction } from "../handlers/cardBatchHandler.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

function makeEnv() {
  const replay = makeReplayNamespace();
  return {
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async () => null,
      put: async () => {},
    },
    ...TEST_OPERATOR_AUTH,
  };
}

function setCardState(replay: ReturnType<typeof makeReplayNamespace>, uid: string, state: string) {
  (replay as any).__cardStates.set(uid.toLowerCase(), {
    state,
    latest_issued_version: 1,
    active_version: state === "active" || state === "discovered" ? 1 : null,
    activated_at: state === "active" ? Math.floor(Date.now() / 1000) : null,
    terminated_at: state === "terminated" ? Math.floor(Date.now() / 1000) : null,
    keys_delivered_at: state === "keys_delivered" ? Math.floor(Date.now() / 1000) : null,
    wipe_keys_fetched_at: null,
    balance: 0,
  });
}

async function batchReq(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>, method = "POST") {
  return handleCardBatchAction(
    new Request("https://test.local/operator/cards/batch", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    env as any,
    TEST_OPERATOR_AUTH.__TEST_OPERATOR_SESSION,
  );
}

describe("handleCardBatchAction", () => {
  it("rejects non-POST methods", async () => {
    const env = makeEnv();
    const resp = await batchReq(env, {}, "GET");
    expect(resp.status).toBe(405);
  });

  it("rejects missing uids", async () => {
    const env = makeEnv();
    const resp = await batchReq(env, { action: "terminate" });
    expect(resp.status).toBe(400);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/uids/);
  });

  it("rejects empty uids array", async () => {
    const env = makeEnv();
    const resp = await batchReq(env, { uids: [], action: "terminate" });
    expect(resp.status).toBe(400);
  });

  it("rejects batch size > 100", async () => {
    const env = makeEnv();
    const uids = Array.from({ length: 101 }, (_, i) => `ff${String(i).padStart(12, "0")}`);
    const resp = await batchReq(env, { uids, action: "terminate" });
    expect(resp.status).toBe(400);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/100/);
  });

  it("rejects invalid action", async () => {
    const env = makeEnv();
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "explode" });
    expect(resp.status).toBe(400);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/action/);
  });

  it("rejects invalid UID format", async () => {
    const env = makeEnv();
    const resp = await batchReq(env, { uids: ["not-a-uid"], action: "terminate" });
    expect(resp.status).toBe(400);
    expect(await resp.json()).toHaveProperty("reason");
  });

  it("terminates active cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "active");
    setCardState(env.CARD_REPLAY as any, "ff000000000002", "active");
    const resp = await batchReq(env, {
      uids: ["ff000000000001", "ff000000000002"],
      action: "terminate",
    });
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, any>;
    expect(json.action).toBe("terminate");
    expect(json.processed).toBe(2);
    expect(json.results).toHaveLength(2);
    expect(json.results.every((r: { status: string }) => r.status === "terminated")).toBe(true);

    const s1 = (env.CARD_REPLAY as any).__cardStates.get("ff000000000001");
    expect(s1.state).toBe("terminated");
    const s2 = (env.CARD_REPLAY as any).__cardStates.get("ff000000000002");
    expect(s2.state).toBe("terminated");
  });

  it("skips already terminated cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "terminated");
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "terminate" });
    const json = await resp.json() as Record<string, any>;
    expect(json.results[0].status).toBe("skipped");
    expect(json.results[0].reason).toMatch(/already terminated/);
  });

  it("wipes active cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "active");
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "wipe" });
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, any>;
    expect(json.results[0].status).toBe("wipe_requested");
  });

  it("skips wipe for non-wipeable states", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "terminated");
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "wipe" });
    const json = await resp.json() as Record<string, any>;
    expect(json.results[0].status).toBe("skipped");
  });

  it("activates keys_delivered cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "keys_delivered");
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "activate" });
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, any>;
    expect(json.results[0].status).toBe("activated");
    const s = (env.CARD_REPLAY as any).__cardStates.get("ff000000000001");
    expect(s.state).toBe("active");
  });

  it("activates discovered cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "discovered");
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "activate" });
    const json = await resp.json() as Record<string, any>;
    expect(json.results[0].status).toBe("activated");
  });

  it("skips already active cards on activate", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "active");
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "activate" });
    const json = await resp.json() as Record<string, any>;
    expect(json.results[0].status).toBe("skipped");
    expect(json.results[0].reason).toMatch(/already active/);
  });

  it("handles mixed results across multiple cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "active");
    setCardState(env.CARD_REPLAY as any, "ff000000000002", "terminated");
    setCardState(env.CARD_REPLAY as any, "ff000000000003", "active");
    const resp = await batchReq(env, {
      uids: ["ff000000000001", "ff000000000002", "ff000000000003"],
      action: "terminate",
    });
    const json = await resp.json() as Record<string, any>;
    expect(json.processed).toBe(3);
    expect(json.results).toHaveLength(3);
    const statuses = json.results.map((r: { status: string }) => r.status);
    expect(statuses).toContain("terminated");
    expect(statuses).toContain("skipped");
  });

  it("returns errors array on DO failure", async () => {
    const env = makeEnv();
    (env.CARD_REPLAY as any).__cardStates.set("ff000000000001".toLowerCase(), {
      state: "new",
      latest_issued_version: 0,
      active_version: null,
      activated_at: null,
      terminated_at: null,
      keys_delivered_at: null,
      wipe_keys_fetched_at: null,
      balance: 0,
    });
    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "terminate" });
    expect(resp.status).toBe(200);
  });

  it("rejects invalid JSON body", async () => {
    const env = makeEnv();
    const resp = handleCardBatchAction(
      new Request("https://test.local/operator/cards/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json{",
      }),
      env as any,
      TEST_OPERATOR_AUTH.__TEST_OPERATOR_SESSION,
    );
    const r = await resp;
    expect(r.status).toBe(400);
  });
});

describe("batch reprovision", () => {
  it("re-provisions terminated cards with version advance", async () => {
    const env = makeEnv();
    const uid = "ff000000000001";
    setCardState(env.CARD_REPLAY as any, uid, "terminated");
    (env.CARD_REPLAY as any).__cardStates.get(uid).latest_issued_version = 3;

    const resp = await batchReq(env, { uids: [uid], action: "reprovision" });
    expect(resp.status).toBe(200);

    const body = await resp.json() as Record<string, any>;
    expect(body.results[0].status).toBe("reprovisioned");
    expect(body.results[0].version).toBe(4);

    const state = (env.CARD_REPLAY as any).__cardStates.get(uid);
    expect(state.state).toBe("keys_delivered");
    expect(state.latest_issued_version).toBe(4);
  });

  it("skips non-terminated cards", async () => {
    const env = makeEnv();
    setCardState(env.CARD_REPLAY as any, "ff000000000001", "active");

    const resp = await batchReq(env, { uids: ["ff000000000001"], action: "reprovision" });
    expect(resp.status).toBe(200);

    const body = await resp.json() as Record<string, any>;
    expect(body.results[0].status).toBe("skipped");
    expect(body.results[0].reason).toContain("terminated");
  });

  it("handles mixed terminated and active cards", async () => {
    const env = makeEnv();
    const uid1 = "ff000000000001";
    const uid2 = "ff000000000002";
    setCardState(env.CARD_REPLAY as any, uid1, "terminated");
    setCardState(env.CARD_REPLAY as any, uid2, "active");
    (env.CARD_REPLAY as any).__cardStates.get(uid1).latest_issued_version = 2;

    const resp = await batchReq(env, { uids: [uid1, uid2], action: "reprovision" });
    expect(resp.status).toBe(200);

    const body = await resp.json() as Record<string, any>;
    expect(body.results).toHaveLength(2);
    expect(body.results.find((r: { uid: string; status: string }) => r.uid === uid1).status).toBe("reprovisioned");
    expect(body.results.find((r: { uid: string; status: string }) => r.uid === uid2).status).toBe("skipped");
  });

  it("records audit event for re-provisioned cards", async () => {
    const env = makeEnv();
    const uid = "ff000000000001";
    setCardState(env.CARD_REPLAY as any, uid, "terminated");

    const resp = await batchReq(env, { uids: [uid], action: "reprovision" });
    expect(resp.status).toBe(200);

    const body = await resp.json() as Record<string, any>;
    expect(body.results[0].status).toBe("reprovisioned");
  });
});
