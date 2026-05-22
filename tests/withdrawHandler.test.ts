import { constructWithdrawResponse } from "../handlers/withdrawHandler.js";

describe("constructWithdrawResponse", () => {
  it("returns ERROR when CMAC validation failed", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000002", false, "https://test.local", "fakewallet");
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("CMAC");
  });

  it("returns withdrawRequest with fakewallet amounts", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000002", true, "https://test.local", "fakewallet");
    expect(result.tag).toBe("withdrawRequest");
    expect(result.minWithdrawable).toBe(1);
    expect(result.maxWithdrawable).toBe(1000000);
    expect(result.callback).toContain("/boltcards/api/v1/lnurl/cb/");
  });

  it("returns withdrawRequest with clnrest fixed amounts", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000002", true, "https://test.local", "clnrest");
    expect(result.tag).toBe("withdrawRequest");
    expect(result.minWithdrawable).toBe(1000);
    expect(result.maxWithdrawable).toBe(1000);
  });

  it("uses default host when baseUrl is empty", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000002", true, "", "fakewallet");
    expect(result.callback).toContain("https://");
  });

  it("defaults to fakewallet when paymentMethod is omitted", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000002", true, "https://test.local");
    expect(result.tag).toBe("withdrawRequest");
    expect(result.maxWithdrawable).toBe(1000000);
  });

  it("uses proxy fixed amounts", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000002", true, "https://test.local", "proxy");
    expect(result.minWithdrawable).toBe(1000);
    expect(result.maxWithdrawable).toBe(1000);
  });

  it("includes k1 field equal to c parameter", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "phex", "chex", "000002", true, "https://test.local", "fakewallet");
    expect(result.k1).toBe("chex");
  });

  it("includes callback with p parameter in path", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "testp", "testc", "000002", true, "https://test.local", "fakewallet");
    expect(result.callback).toBe("https://test.local/boltcards/api/v1/lnurl/cb/testp");
  });

  it("includes defaultDescription with counter (no raw UID)", () => {
    const result = constructWithdrawResponse("04a39493cc8680", "p", "c", "000005", true, "https://test.local", "fakewallet");
    expect(result.defaultDescription).toContain("#5");
    expect(result.defaultDescription).not.toContain("04a39493cc8680");
  });
});
