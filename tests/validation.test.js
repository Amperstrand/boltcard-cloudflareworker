import { describe, it, expect } from "@jest/globals";
import { validateUid, getRequestOrigin } from "../utils/validation.js";

describe("validateUid", () => {
  it("normalizes uppercase to lowercase", () => {
    expect(validateUid("04A39493CC8680")).toBe("04a39493cc8680");
  });

  it("passes through already-lowercase UID", () => {
    expect(validateUid("04a39493cc8680")).toBe("04a39493cc8680");
  });

  it("rejects non-hex characters", () => {
    expect(validateUid("zzzzzzzzzzzzzz")).toBeNull();
  });

  it("rejects wrong length (too short)", () => {
    expect(validateUid("04a39493cc86")).toBeNull();
  });

  it("rejects wrong length (too long)", () => {
    expect(validateUid("04a39493cc868012")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(validateUid(12345)).toBeNull();
  });

  it("rejects null", () => {
    expect(validateUid(null)).toBeNull();
  });

  it("rejects undefined", () => {
    expect(validateUid(undefined)).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateUid("")).toBeNull();
  });
});

describe("getRequestOrigin", () => {
  it("extracts origin from URL with path", () => {
    expect(getRequestOrigin({ url: "https://example.com/path?q=1" })).toBe("https://example.com");
  });

  it("extracts origin from URL with port", () => {
    expect(getRequestOrigin({ url: "http://localhost:8787/api" })).toBe("http://localhost:8787");
  });

  it("extracts origin from root URL", () => {
    expect(getRequestOrigin({ url: "https://boltcardpoc.psbt.me/" })).toBe("https://boltcardpoc.psbt.me");
  });
});
