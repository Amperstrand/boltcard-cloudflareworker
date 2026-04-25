import { handleBulkWipePage } from "../handlers/bulkWipePageHandler.js";

describe("handleBulkWipePage", () => {
  it("returns HTML response with key options", async () => {
    const req = new Request("https://test.local/experimental/bulkwipe");
    const res = await handleBulkWipePage(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<optgroup");
    expect(html).toContain("<option");
    expect(html).toContain("data-fingerprint");
  });

  it("caches fingerprints on second call", async () => {
    const req = new Request("https://test.local/experimental/bulkwipe");
    const res1 = await handleBulkWipePage(req);
    const res2 = await handleBulkWipePage(req);
    const html1 = await res1.text();
    const html2 = await res2.text();
    expect(html1).toBe(html2);
  });

  it("includes default domain group", async () => {
    const req = new Request("https://test.local/experimental/bulkwipe");
    const res = await handleBulkWipePage(req);
    const html = await res.text();
    expect(html).toContain("Default / Shared");
  });

  it("includes key hex values in options", async () => {
    const req = new Request("https://test.local/experimental/bulkwipe");
    const res = await handleBulkWipePage(req);
    const html = await res.text();
    expect(html).toContain("00000000000000000000000000000000");
    expect(html).toContain("00000000000000000000000000000001");
  });
});
