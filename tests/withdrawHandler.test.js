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
});
