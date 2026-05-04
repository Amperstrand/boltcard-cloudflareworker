import { handleActivatePage } from "../handlers/activatePageHandler.js";

const minimalEnv = { UID_CONFIG: {} as KVNamespace, CARD_REPLAY: {} as DurableObjectNamespace };

describe("handleActivatePage", () => {
  it("returns HTML response with activate page", async () => {
    const req = new Request("https://test.local/experimental/activate");
    const res = handleActivatePage(req, minimalEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Activate");
    expect(html).toContain("boltcard://program");
    expect(html).toContain("boltcard://reset");
  });

  it("uses custom pullPaymentId from query string", async () => {
    const req = new Request("https://test.local/experimental/activate?pullPaymentId=custom123");
    const res = handleActivatePage(req, minimalEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("custom123");
  });

  it("uses env DEFAULT_PULL_PAYMENT_ID when no query param", async () => {
    const req = new Request("https://test.local/experimental/activate");
    const res = handleActivatePage(req, { ...minimalEnv, DEFAULT_PULL_PAYMENT_ID: "envPpid" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("envPpid");
  });

  it("includes correct API URL structure", async () => {
    const req = new Request("https://test.local/experimental/activate?pullPaymentId=testPpid");
    const res = handleActivatePage(req, minimalEnv);
    const html = await res.text();
    expect(html).toContain("/api/v1/pull-payments/testPpid/boltcards");
    expect(html).toContain("onExisting=UpdateVersion");
    expect(html).toContain("onExisting=KeepVersion");
  });
});
