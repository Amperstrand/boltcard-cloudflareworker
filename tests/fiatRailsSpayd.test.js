import {
  isSpaydUri,
  parseSpayd,
  encodeSpayd,
} from "../utils/fiat-rails/spayd.js";

describe("isSpaydUri", () => {
  test("returns true for SPD* prefix", () => {
    expect(isSpaydUri("SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK")).toBe(true);
  });

  test("returns true for spayd:// prefix", () => {
    expect(isSpaydUri("spayd://SPD*1.0*ACC:CZ5855000000001265098001")).toBe(true);
  });

  test("returns false for non-SPAYD input", () => {
    expect(isSpaydUri("payto://iban/test")).toBe(false);
    expect(isSpaydUri("upi://pay")).toBe(false);
    expect(isSpaydUri("")).toBe(false);
    expect(isSpaydUri(null)).toBe(false);
  });
});

describe("parseSpayd", () => {
  test("parses a complete SPAYD string", () => {
    const result = parseSpayd(
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK*MSG:Payment%20for%20goods"
    );
    expect(result).not.toBeNull();
    expect(result.acc).toBe("CZ5855000000001265098001");
    expect(result.am).toBeCloseTo(480.5, 1);
    expect(result.cc).toBe("CZK");
    expect(result.msg).toBe("Payment for goods");
  });

  test("parses spayd:// prefixed URI", () => {
    const result = parseSpayd("spayd://SPD*1.0*ACC:NO9386011117947*AM:100.00*CC:NOK");
    expect(result.acc).toBe("NO9386011117947");
    expect(result.am).toBe(100);
    expect(result.cc).toBe("NOK");
  });

  test("parses minimal SPAYD with only ACC", () => {
    const result = parseSpayd("SPD*1.0*ACC:DE89370400440532013000");
    expect(result.acc).toBe("DE89370400440532013000");
    expect(result.am).toBeUndefined();
  });

  test("returns null for empty input", () => {
    expect(parseSpayd("")).toBeNull();
    expect(parseSpayd(null)).toBeNull();
  });

  test("returns null for missing SPD header", () => {
    expect(parseSpayd("1.0*ACC:DE89370400440532013000")).toBeNull();
  });

  test("returns null for missing ACC attribute", () => {
    expect(parseSpayd("SPD*1.0*AM:100")).toBeNull();
  });

  test("handles RN (recipient name) attribute", () => {
    const result = parseSpayd("SPD*1.0*ACC:CZ5855000000001265098001*RN:Test%20Shop");
    expect(result.rn).toBe("Test Shop");
  });

  test("handles DT (date) attribute", () => {
    const result = parseSpayd("SPD*1.0*ACC:CZ5855000000001265098001*DT:20260427");
    expect(result.dt).toBe("20260427");
  });
});

describe("encodeSpayd", () => {
  test("encodes a SPAYD string", () => {
    const result = encodeSpayd({
      ACC: "CZ5855000000001265098001",
      AM: "480.50",
      CC: "CZK",
      MSG: "Payment for goods",
    });
    expect(result).toMatch(/^SPD\*1\.0\*/);
    expect(result).toContain("ACC:CZ5855000000001265098001");
    expect(result).toContain("CC:CZK");
  });

  test("throws if ACC is missing", () => {
    expect(() => encodeSpayd({ AM: "100" })).toThrow("missing required 'ACC'");
  });

  test("throws for non-object input", () => {
    expect(() => encodeSpayd(null)).toThrow("must be an object");
    expect(() => encodeSpayd("string")).toThrow("must be an object");
  });

  test("includes CRC32 when requested", () => {
    const result = encodeSpayd(
      { ACC: "CZ5855000000001265098001", AM: "100", CC: "CZK" },
      { includeCrc32: true, sortAttributes: true }
    );
    expect(result).toMatch(/CRC32:[0-9A-F]{8}$/);
  });

  test("CRC32 is valid and consistent", () => {
    const attrs = { ACC: "CZ5855000000001265098001", AM: "480.50", CC: "CZK" };
    const a = encodeSpayd(attrs, { includeCrc32: true, sortAttributes: true });
    const b = encodeSpayd(attrs, { includeCrc32: true, sortAttributes: true });
    expect(a).toBe(b);
  });

  test("round-trips encode/parse", () => {
    const original = { ACC: "NO9386011117947", AM: "100", CC: "NOK", MSG: "Test message" };
    const encoded = encodeSpayd(original);
    const parsed = parseSpayd(encoded);
    expect(parsed.acc).toBe(original.ACC);
    expect(parsed.am).toBe(100);
    expect(parsed.cc).toBe(original.CC);
    expect(parsed.msg).toBe(original.MSG);
  });

  test("sort attributes option produces stable output", () => {
    const attrs = { CC: "EUR", ACC: "DE89370400440532013000", AM: "50" };
    const sorted = encodeSpayd(attrs, { sortAttributes: true });
    const accIdx = sorted.indexOf("*ACC:");
    const amIdx = sorted.indexOf("*AM:");
    const ccIdx = sorted.indexOf("*CC:");
    expect(accIdx).toBeLessThan(amIdx);
    expect(amIdx).toBeLessThan(ccIdx);
  });

  test("handles array values", () => {
    const result = encodeSpayd({ ACC: "DE89370400440532013000", AM: ["100", "200"] });
    expect(result).toContain("AM:100");
    expect(result).toContain("AM:200");
  });

  test("skips null/undefined values", () => {
    const result = encodeSpayd({ ACC: "DE89370400440532013000", AM: null, CC: undefined });
    expect(result).not.toContain("*AM:");
    expect(result).not.toContain("*CC:");
  });
});
