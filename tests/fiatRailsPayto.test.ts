// @ts-nocheck
import {
  isPaytoUri,
  parsePaytoUri,
  encodePaytoUri,
  PaytoPaymentDetails,
} from "../utils/fiat-rails/payto.js";

describe("isPaytoUri", () => {
  test("returns true for payto:// URIs", () => {
    expect(isPaytoUri("payto://iban/DE89370400440532013000?amount=EUR:10.00")).toBe(true);
  });

  test("returns true for PAYTO:payto:// URIs", () => {
    expect(isPaytoUri("PAYTO:payto://iban/DE89370400440532013000?amount=EUR:10.00")).toBe(true);
  });

  test("returns false for non-payto URIs", () => {
    expect(isPaytoUri("upi://pay?pa=test")).toBe(false);
    expect(isPaytoUri("https://example.com")).toBe(false);
    expect(isPaytoUri("")).toBe(false);
    expect(isPaytoUri(null)).toBe(false);
    expect(isPaytoUri(undefined)).toBe(false);
  });
});

describe("parsePaytoUri", () => {
  test("parses a complete PayTo URI", () => {
    const result = parsePaytoUri(
      "payto://iban/DE89370400440532013000?amount=EUR:10.50&receiver-name=Test%20Shop&message=order-123&x-execdate=2026-04-27"
    );
    expect(result).toBeInstanceOf(PaytoPaymentDetails);
    expect(result.iban).toBe("DE89370400440532013000");
    expect(result.amount).toBe(10.5);
    expect(result.currency).toBe("EUR");
    expect(result.receiverName).toBe("Test Shop");
    expect(result.message).toBe("order-123");
    expect(result.execDate).toBe("2026-04-27");
  });

  test("parses URI with PAYTO: prefix", () => {
    const result = parsePaytoUri(
      "PAYTO:payto://iban/GB33BUKB20201555555555?amount=GBP:100.00&receiver-name=FakeWallet"
    );
    expect(result.iban).toBe("GB33BUKB20201555555555");
    expect(result.amount).toBe(100);
    expect(result.currency).toBe("GBP");
  });

  test("returns null for missing amount parameter", () => {
    expect(parsePaytoUri("payto://iban/DE89370400440532013000?receiver-name=Test")).toBeNull();
  });

  test("returns null for invalid amount format", () => {
    expect(parsePaytoUri("payto://iban/DE89370400440532013000?amount=NOTACURRENCY")).toBeNull();
  });

  test("returns null for non-iban target type", () => {
    expect(parsePaytoUri("payto://bic/DEUTDEFF?amount=EUR:10.00")).toBeNull();
  });

  test("returns null for null/undefined input", () => {
    expect(parsePaytoUri(null)).toBeNull();
    expect(parsePaytoUri(undefined)).toBeNull();
    expect(parsePaytoUri("")).toBeNull();
  });

  test("returns null for non-payto input", () => {
    expect(parsePaytoUri("upi://pay?pa=test")).toBeNull();
  });

  test("handles zero amount", () => {
    expect(parsePaytoUri("payto://iban/DE89370400440532013000?amount=EUR:0")).toBeNull();
  });

  test("handles negative amount", () => {
    expect(parsePaytoUri("payto://iban/DE89370400440532013000?amount=EUR:-5")).toBeNull();
  });

  test("handles case-insensitive currency", () => {
    const result = parsePaytoUri("payto://iban/DE89370400440532013000?amount=eur:10.00");
    expect(result.currency).toBe("EUR");
  });
});

describe("encodePaytoUri", () => {
  test("encodes a complete PayTo URI", () => {
    const uri = encodePaytoUri({
      iban: "DE89370400440532013000",
      amount: 10.5,
      currency: "EUR",
      receiverName: "Test Shop",
      message: "order-123",
      execDate: "2026-04-27",
    });
    expect(uri).toMatch(/^payto:\/\/iban\//);
    expect(uri).toContain("amount=EUR:10.50");
    expect(uri).toContain("receiver-name=Test%20Shop");
    expect(uri).toContain("message=order-123");
    expect(uri).toContain("x-execdate=2026-04-27");
  });

  test("uses defaults for missing fields", () => {
    const uri = encodePaytoUri({});
    expect(uri).toContain("payto://iban/GB33BUKB20201555555555");
    expect(uri).toContain("amount=EUR:0.00");
    expect(uri).toContain("receiver-name=FakeWallet");
  });

  test("round-trips parse/encode", () => {
    const original = {
      iban: "NO9386011117947",
      amount: 0.08,
      currency: "EUR",
      receiverName: "Test",
      message: "quote-abc",
    };
    const encoded = encodePaytoUri(original);
    const parsed = parsePaytoUri(encoded);
    expect(parsed.iban).toBe(original.iban);
    expect(parsed.amount).toBeCloseTo(original.amount, 2);
    expect(parsed.currency).toBe(original.currency);
    expect(parsed.receiverName).toBe(original.receiverName);
    expect(parsed.message).toBe(original.message);
  });
});