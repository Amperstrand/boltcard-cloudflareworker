// @ts-nocheck
import { detectFiatRail, parseFiatRailDetails } from "../utils/fiat-rails/index.js";

describe("detectFiatRail", () => {
  test("detects payto:// URIs", () => {
    const result = detectFiatRail("payto://iban/DE89370400440532013000?amount=EUR:10.00");
    expect(result.type).toBe("payto");
    expect(result.uri).toContain("payto://iban/");
  });

  test("detects PAYTO: prefix (cashu-cf convention)", () => {
    const result = detectFiatRail("PAYTO:payto://iban/DE89370400440532013000?amount=EUR:10.00");
    expect(result.type).toBe("payto");
    expect(result.uri).toContain("payto://iban/");
  });

  test("detects upi:// URIs", () => {
    const result = detectFiatRail("upi://pay?pa=merchant@bank&am=100.00&cu=INR");
    expect(result.type).toBe("upi");
    expect(result.uri).toContain("upi://");
  });

  test("detects SPD* SPAYD strings", () => {
    const result = detectFiatRail("SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK");
    expect(result.type).toBe("spayd");
    expect(result.uri).toContain("SPD*");
  });

  test("detects spayd:// prefix", () => {
    const result = detectFiatRail("spayd://SPD*1.0*ACC:CZ5855000000001265098001");
    expect(result.type).toBe("spayd");
  });

  test("returns bolt11 for plain descriptions", () => {
    const result = detectFiatRail("fakewallet payment");
    expect(result.type).toBe("bolt11");
    expect(result.uri).toBeNull();
  });

  test("returns bolt11 for null/empty input", () => {
    expect(detectFiatRail(null).type).toBe("bolt11");
    expect(detectFiatRail("").type).toBe("bolt11");
    expect(detectFiatRail(undefined).type).toBe("bolt11");
  });

  test("payto takes priority over other rails", () => {
    const desc = "PAYTO:payto://iban/DE89370400440532013000?amount=EUR:10.00 upi://ignored";
    const result = detectFiatRail(desc);
    expect(result.type).toBe("payto");
  });
});

describe("parseFiatRailDetails", () => {
  test("parses payto details", () => {
    const details = parseFiatRailDetails(
      "payto",
      "payto://iban/DE89370400440532013000?amount=EUR:10.00"
    );
    expect(details).not.toBeNull();
    expect(details.iban).toBe("DE89370400440532013000");
    expect(details.currency).toBe("EUR");
  });

  test("parses upi details", () => {
    const details = parseFiatRailDetails(
      "upi",
      "upi://pay?pa=merchant@bank&am=100.00&cu=INR"
    );
    expect(details).not.toBeNull();
    expect(details.pa).toBe("merchant@bank");
    expect(details.am).toBe(100);
  });

  test("parses spayd details", () => {
    const details = parseFiatRailDetails(
      "spayd",
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480.50*CC:CZK"
    );
    expect(details).not.toBeNull();
    expect(details.acc).toBe("CZ5855000000001265098001");
  });

  test("returns null for bolt11 type", () => {
    expect(parseFiatRailDetails("bolt11", null)).toBeNull();
  });

  test("returns null for unknown type", () => {
    expect(parseFiatRailDetails("custom", "something")).toBeNull();
  });
});