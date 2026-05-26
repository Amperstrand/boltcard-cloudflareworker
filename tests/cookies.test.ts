import { constantTimeEqual, getCookieValue } from "../utils/cookies.js";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("1234", "1235")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("long", "")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(constantTimeEqual(42 as any, "abc")).toBe(false);
    expect(constantTimeEqual("abc", null as any)).toBe(false);
  });

  it("does not short-circuit on first character mismatch", () => {
    expect(constantTimeEqual("x234", "1234")).toBe(false);
    expect(constantTimeEqual("123x", "1234")).toBe(false);
  });
});

describe("getCookieValue", () => {
  it("returns null for null header", () => {
    expect(getCookieValue(null, "foo")).toBeNull();
  });

  it("returns null for missing cookie", () => {
    expect(getCookieValue("bar=baz", "foo")).toBeNull();
  });

  it("returns value for present cookie", () => {
    expect(getCookieValue("foo=bar", "foo")).toBe("bar");
  });

  it("handles multiple cookies", () => {
    expect(getCookieValue("a=1; b=2; c=3", "b")).toBe("2");
  });

  it("handles cookie name with special regex chars", () => {
    expect(getCookieValue("a.b=1; c=d", "a.b")).toBe("1");
  });
});
