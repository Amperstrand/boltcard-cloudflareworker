import { handleWipePage } from "../handlers/wipePageHandler.js";
import { handleReset } from "../handlers/resetHandler.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

describe("handleWipePage", () => {
  it("returns HTML response", () => {
    const req = new Request("https://test.local/experimental/wipe");
    const res = handleWipePage(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("includes reset API URL in response", async () => {
    const req = new Request("https://test.local/experimental/wipe");
    const res = handleWipePage(req, {});
    const html = await res.text();
    expect(html).toContain("KeepVersion");
  });
});

describe("handleReset", () => {
  function makeEnv() {
    return {
      ISSUER_KEY,
      CARD_REPLAY: makeReplayNamespace({}, { [UID]: 1 }),
    };
  }

  it("returns 400 for missing UID", async () => {
    const res = await handleReset(null, makeEnv(), "https://test.local");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("UID");
  });

  it("returns 400 for invalid UID", async () => {
    const res = await handleReset("ZZZZ", makeEnv(), "https://test.local");
    expect(res.status).toBe(400);
  });

  it("terminates active card and returns keys", async () => {
    const env = makeEnv();
    const res = await handleReset(UID, env, "https://test.local");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(body.K0).toBeDefined();
    expect(env.CARD_REPLAY.__cardStates.get(UID).state).toBe("terminated");
  });

  it("returns keys for already terminated card", async () => {
    const env = makeEnv();
    env.CARD_REPLAY.__cardStates.get(UID).state = "terminated";
    const res = await handleReset(UID, env, "https://test.local");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
  });

  it("returns keys for new card", async () => {
    const env = makeEnv();
    env.CARD_REPLAY.__cardStates.get(UID).state = "new";
    const res = await handleReset(UID, env, "https://test.local");
    expect(res.status).toBe(200);
  });

  it("returns 400 for keys_delivered card", async () => {
    const env = makeEnv();
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    const res = await handleReset(UID, env, "https://test.local");
    expect(res.status).toBe(400);
  });

  it("returns 500 when CARD_REPLAY missing", async () => {
    const res = await handleReset(UID, {}, "https://test.local");
    expect(res.status).toBe(500);
  });

  it("normalizes UID to lowercase", async () => {
    const env = makeEnv();
    const res = await handleReset("04A39493CC8680", env, "https://test.local");
    expect(res.status).toBe(200);
  });
});
