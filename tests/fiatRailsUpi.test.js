import {
  isUpiUri,
  parseUpiUri,
  encodeUpiUri,
  UpiPaymentDetails,
} from "../utils/fiat-rails/upi.js";

describe("isUpiUri", () => {
  test("returns true for upi:// URIs", () => {
    expect(isUpiUri("upi://pay?pa=merchant@bank&am=100.00&cu=INR")).toBe(true);
  });

  test("returns false for non-upi URIs", () => {
    expect(isUpiUri("payto://iban/test")).toBe(false);
    expect(isUpiUri("")).toBe(false);
    expect(isUpiUri(null)).toBe(false);
  });
});

describe("parseUpiUri", () => {
  test("parses a complete UPI URI", () => {
    const result = parseUpiUri(
      "upi://pay?pa=merchant@acqbank&pn=My%20Store&mc=1234&tr=INV-100029&tn=Invoice&am=499.00&cu=INR"
    );
    expect(result).toBeInstanceOf(UpiPaymentDetails);
    expect(result.pa).toBe("merchant@acqbank");
    expect(result.am).toBe(499);
    expect(result.cu).toBe("INR");
    expect(result.pn).toBe("My Store");
    expect(result.mc).toBe("1234");
    expect(result.tr).toBe("INV-100029");
    expect(result.tn).toBe("Invoice");
  });

  test("parses minimal UPI URI", () => {
    const result = parseUpiUri("upi://pay?pa=test@bank&am=100.00");
    expect(result.pa).toBe("test@bank");
    expect(result.am).toBe(100);
    expect(result.cu).toBe("INR");
  });

  test("returns null for missing pa parameter", () => {
    expect(parseUpiUri("upi://pay?am=100.00&cu=INR")).toBeNull();
  });

  test("returns null for missing am parameter", () => {
    expect(parseUpiUri("upi://pay?pa=test@bank")).toBeNull();
  });

  test("returns null for zero amount", () => {
    expect(parseUpiUri("upi://pay?pa=test@bank&am=0")).toBeNull();
  });

  test("returns null for negative amount", () => {
    expect(parseUpiUri("upi://pay?pa=test@bank&am=-5")).toBeNull();
  });

  test("returns null for null/undefined input", () => {
    expect(parseUpiUri(null)).toBeNull();
    expect(parseUpiUri(undefined)).toBeNull();
    expect(parseUpiUri("")).toBeNull();
  });

  test("returns null for non-upi input", () => {
    expect(parseUpiUri("payto://iban/test")).toBeNull();
  });
});

describe("encodeUpiUri", () => {
  test("encodes a complete UPI URI", () => {
    const uri = encodeUpiUri({
      pa: "merchant@bank",
      am: 499,
      cu: "INR",
      pn: "My Store",
      tr: "INV-001",
    });
    expect(uri).toMatch(/^upi:\/\/pay\?/);
    expect(uri).toContain("pa=merchant%40bank");
    expect(uri).toContain("am=499.00");
    expect(uri).toContain("cu=INR");
    expect(uri).toContain("pn=My%20Store");
    expect(uri).toContain("tr=INV-001");
  });

  test("uses defaults for missing fields", () => {
    const uri = encodeUpiUri({});
    expect(uri).toContain("pa=merchant%40acqbank");
    expect(uri).toContain("am=0.00");
    expect(uri).toContain("cu=INR");
  });

  test("round-trips parse/encode", () => {
    const original = { pa: "shop@upi", am: 250, cu: "INR", pn: "Test Shop" };
    const encoded = encodeUpiUri(original);
    const parsed = parseUpiUri(encoded);
    expect(parsed.pa).toBe(original.pa);
    expect(parsed.am).toBe(original.am);
    expect(parsed.cu).toBe(original.cu);
    expect(parsed.pn).toBe(original.pn);
  });
});
