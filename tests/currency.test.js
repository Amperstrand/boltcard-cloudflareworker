import { describe, it, expect } from "@jest/globals";
import { getCurrencyLabel, getCurrencyDecimals, formatAmount, _parseAmount } from "../utils/currency.js";

function makeEnv(overrides = {}) {
  return { CURRENCY_LABEL: "credits", CURRENCY_DECIMALS: "0", ...overrides };
}

describe("getCurrencyLabel", () => {
  it("returns CURRENCY_LABEL from env", () => {
    expect(getCurrencyLabel({ CURRENCY_LABEL: "GBP" })).toBe("GBP");
  });

  it("defaults to 'credits'", () => {
    expect(getCurrencyLabel({})).toBe("credits");
    expect(getCurrencyLabel({ CURRENCY_LABEL: "" })).toBe("credits");
  });
});

describe("getCurrencyDecimals", () => {
  it("returns parsed CURRENCY_DECIMALS from env", () => {
    expect(getCurrencyDecimals({ CURRENCY_DECIMALS: "2" })).toBe(2);
  });

  it("defaults to 0", () => {
    expect(getCurrencyDecimals({})).toBe(0);
    expect(getCurrencyDecimals({ CURRENCY_DECIMALS: "" })).toBe(0);
    expect(getCurrencyDecimals({ CURRENCY_DECIMALS: "invalid" })).toBe(0);
  });

  it("clamps negative to 0", () => {
    expect(getCurrencyDecimals({ CURRENCY_DECIMALS: "-1" })).toBe(0);
  });

  it("clamps above 6 to 6", () => {
    expect(getCurrencyDecimals({ CURRENCY_DECIMALS: "10" })).toBe(6);
  });
});

describe("formatAmount", () => {
  it("formats zero-decimal credits", () => {
    expect(formatAmount(0, makeEnv())).toBe("0 credits");
    expect(formatAmount(150, makeEnv())).toBe("150 credits");
    expect(formatAmount(1000, makeEnv())).toBe("1,000 credits");
  });

  it("formats two-decimal GBP", () => {
    const env = makeEnv({ CURRENCY_LABEL: "GBP", CURRENCY_DECIMALS: "2" });
    expect(formatAmount(0, env)).toBe("0.00 GBP");
    expect(formatAmount(100, env)).toBe("1.00 GBP");
    expect(formatAmount(1550, env)).toBe("15.50 GBP");
    expect(formatAmount(100000, env)).toBe("1,000.00 GBP");
  });

  it("formats three-decimal tokens", () => {
    const env = makeEnv({ CURRENCY_LABEL: "tokens", CURRENCY_DECIMALS: "3" });
    expect(formatAmount(1234, env)).toBe("1.234 tokens");
  });

  it("handles non-number input", () => {
    expect(formatAmount("abc", makeEnv())).toBe("0 credits");
    expect(formatAmount(null, makeEnv())).toBe("0 credits");
    expect(formatAmount(undefined, makeEnv())).toBe("0 credits");
  });

  it("uses default env when env is empty", () => {
    expect(formatAmount(500, {})).toBe("500 credits");
  });
});

describe("_parseAmount", () => {
  it("parses zero-decimal input", () => {
    expect(_parseAmount("10", makeEnv())).toBe(10);
    expect(_parseAmount("0", makeEnv())).toBe(0);
    expect(_parseAmount(10, makeEnv())).toBe(10);
  });

  it("parses two-decimal input", () => {
    const env = makeEnv({ CURRENCY_DECIMALS: "2" });
    expect(_parseAmount("1.00", env)).toBe(100);
    expect(_parseAmount("15.50", env)).toBe(1550);
    expect(_parseAmount("0.01", env)).toBe(1);
    expect(_parseAmount("1,000.00", env)).toBe(100000);
  });

  it("rounds correctly", () => {
    const env = makeEnv({ CURRENCY_DECIMALS: "2" });
    expect(_parseAmount("1.005", env)).toBe(100);
    expect(_parseAmount("1.004", env)).toBe(100);
    expect(_parseAmount("1.006", env)).toBe(101);
  });

  it("returns null for invalid input", () => {
    expect(_parseAmount("", makeEnv())).toBe(null);
    expect(_parseAmount("abc", makeEnv())).toBe(null);
    expect(_parseAmount("-5", makeEnv())).toBe(null);
    expect(_parseAmount(null, makeEnv())).toBe(null);
    expect(_parseAmount(undefined, makeEnv())).toBe(null);
  });

  it("handles comma-formatted input", () => {
    expect(_parseAmount("1,000", makeEnv())).toBe(1000);
    expect(_parseAmount("10,000", makeEnv())).toBe(10000);
  });

  it("round-trips with formatAmount", () => {
    const env = makeEnv({ CURRENCY_LABEL: "GBP", CURRENCY_DECIMALS: "2" });
    const original = 1550;
    const formatted = formatAmount(original, env);
    const numericPart = formatted.split(" ")[0];
    expect(_parseAmount(numericPart, env)).toBe(original);
  });
});
