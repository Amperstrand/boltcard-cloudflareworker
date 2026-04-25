import { handleActivateCardSubmit, handleActivateCardPage } from "../handlers/activateCardHandler.js";
import { handleActivatePage } from "../handlers/activatePageHandler.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv() {
  return {
    ISSUER_KEY,
    CARD_REPLAY: makeReplayNamespace(),
  };
}

function postRequest(body) {
  return new Request("https://test.local/activate/form", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleActivateCardPage", () => {
  it("returns HTML response", () => {
    const res = handleActivateCardPage();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("handleActivateCardSubmit", () => {
  it("activates a card successfully", async () => {
    const env = buildEnv();
    const req = postRequest({ uid: UID });
    const res = await handleActivateCardSubmit(req, env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("SUCCESS");
    expect(body.uid).toBe(UID);
    expect(body.config.K2).toBeDefined();
    expect(body.config.payment_method).toBe("fakewallet");
    expect(body.config.K2).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns 400 for invalid JSON body", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/activate/form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleActivateCardSubmit(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("Invalid JSON");
  });

  it("returns 400 for missing uid", async () => {
    const env = buildEnv();
    const req = postRequest({});
    const res = await handleActivateCardSubmit(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("UID");
  });

  it("returns 400 for invalid uid format", async () => {
    const env = buildEnv();
    const req = postRequest({ uid: "ZZZZZZZZZZZZZZ" });
    const res = await handleActivateCardSubmit(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("UID");
  });

  it("returns 400 for uid too short", async () => {
    const env = buildEnv();
    const req = postRequest({ uid: "04a394" });
    const res = await handleActivateCardSubmit(req, env);
    expect(res.status).toBe(400);
  });

  it("writes config to DO after activation", async () => {
    const env = buildEnv();
    const req = postRequest({ uid: UID });
    await handleActivateCardSubmit(req, env);
    const storedConfig = env.CARD_REPLAY.__cardConfigs.get(UID);
    expect(storedConfig).toBeDefined();
    expect(storedConfig.payment_method).toBe("fakewallet");
    expect(storedConfig.K2).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns consistent keys for same UID", async () => {
    const env1 = buildEnv();
    const env2 = buildEnv();
    const req1 = postRequest({ uid: UID });
    const req2 = postRequest({ uid: UID });
    const res1 = await handleActivateCardSubmit(req1, env1);
    const res2 = await handleActivateCardSubmit(req2, env2);
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.config.K2).toBe(body2.config.K2);
  });

  it("returns different keys for different UIDs", async () => {
    const env1 = buildEnv();
    const env2 = buildEnv();
    const req1 = postRequest({ uid: "04a39493cc8680" });
    const req2 = postRequest({ uid: "04a39493cc8681" });
    const res1 = await handleActivateCardSubmit(req1, env1);
    const res2 = await handleActivateCardSubmit(req2, env2);
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.config.K2).not.toBe(body2.config.K2);
  });

  it("normalizes uid to lowercase", async () => {
    const env = buildEnv();
    const req = postRequest({ uid: "04A39493CC8680" });
    const res = await handleActivateCardSubmit(req, env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.uid).toBe("04a39493cc8680");
  });
});

describe("handleActivatePage", () => {
  it("returns HTML with default pullPaymentId", () => {
    const req = new Request("https://test.local/experimental/activate");
    const res = handleActivatePage(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("uses pullPaymentId from URL query param", async () => {
    const req = new Request("https://test.local/experimental/activate?pullPaymentId=custom-pp-999");
    const res = handleActivatePage(req);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("custom-pp-999");
  });

  it("uses DEFAULT_PULL_PAYMENT_ID from env when no URL param", async () => {
    const req = new Request("https://test.local/experimental/activate");
    const res = handleActivatePage(req, { DEFAULT_PULL_PAYMENT_ID: "env-pp-42" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("env-pp-42");
  });

  it("works without env (default parameter)", () => {
    const req = new Request("https://test.local/experimental/activate");
    const res = handleActivatePage(req);
    expect(res.status).toBe(200);
  });
});
