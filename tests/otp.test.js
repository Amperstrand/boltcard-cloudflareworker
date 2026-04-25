import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { deriveOtpSecret, generateHOTP, generateTOTP } from "../utils/otp.js";

describe("deriveOtpSecret", () => {
  const uidHex = "04a39493cc8680";

  it("derives a 16-byte secret", () => {
    const env = { ISSUER_KEY: "00000000000000000000000000000001" };
    const secret = deriveOtpSecret(env, uidHex, "2d003f75");
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(16);
  });

  it("throws in production when ISSUER_KEY is missing", () => {
    const prodEnv = { WORKER_ENV: "production" };
    expect(() => deriveOtpSecret(prodEnv, uidHex, "2d003f75")).toThrow("ISSUER_KEY must be set in production");
  });

  it("uses fallback in dev when ISSUER_KEY is missing", () => {
    const devEnv = {};
    const secret = deriveOtpSecret(devEnv, uidHex, "2d003f75");
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(16);
  });

  it("produces different secrets for different domain tags", () => {
    const env = { ISSUER_KEY: "00000000000000000000000000000001" };
    const s1 = deriveOtpSecret(env, uidHex, "2d003f75");
    const s2 = deriveOtpSecret(env, uidHex, "2d003f76");
    expect(s1).not.toEqual(s2);
  });

  it("produces different secrets for different UIDs", () => {
    const env = { ISSUER_KEY: "00000000000000000000000000000001" };
    const s1 = deriveOtpSecret(env, "04a39493cc8680", "2d003f75");
    const s2 = deriveOtpSecret(env, "04996c6a926980", "2d003f75");
    expect(s1).not.toEqual(s2);
  });
});

describe("generateHOTP", () => {
  const secret = new TextEncoder().encode("12345678901234567890");

  it("generates RFC 4226 test vectors", () => {
    expect(generateHOTP(secret, 0)).toBe("755224");
    expect(generateHOTP(secret, 1)).toBe("287082");
    expect(generateHOTP(secret, 2)).toBe("359152");
    expect(generateHOTP(secret, 3)).toBe("969429");
    expect(generateHOTP(secret, 4)).toBe("338314");
    expect(generateHOTP(secret, 5)).toBe("254676");
    expect(generateHOTP(secret, 6)).toBe("287922");
    expect(generateHOTP(secret, 7)).toBe("162583");
    expect(generateHOTP(secret, 8)).toBe("399871");
    expect(generateHOTP(secret, 9)).toBe("520489");
  });

  it("pads with leading zeros", () => {
    const smallSecret = new Uint8Array(20);
    const code = generateHOTP(smallSecret, 0);
    expect(code).toHaveLength(6);
  });

  it("supports custom digit count", () => {
    const code = generateHOTP(secret, 0, 8);
    expect(code).toHaveLength(8);
  });
});

describe("generateTOTP", () => {
  const secret = new TextEncoder().encode("12345678901234567890");

  it("returns code, secondsRemaining, and counter", () => {
    const result = generateTOTP(secret, 30, 6);
    expect(result.code).toHaveLength(6);
    expect(typeof result.counter).toBe("number");
    expect(typeof result.secondsRemaining).toBe("number");
    expect(result.secondsRemaining).toBeGreaterThanOrEqual(0);
    expect(result.secondsRemaining).toBeLessThanOrEqual(30);
  });

  it("returns same code on consecutive calls within same time step", () => {
    const r1 = generateTOTP(secret, 30, 6);
    const r2 = generateTOTP(secret, 30, 6);
    expect(r1.code).toBe(r2.code);
    expect(r1.counter).toBe(r2.counter);
  });

  it("supports custom time step", () => {
    const result = generateTOTP(secret, 60, 6);
    expect(result.code).toHaveLength(6);
    expect(result.secondsRemaining).toBeGreaterThanOrEqual(0);
    expect(result.secondsRemaining).toBeLessThanOrEqual(60);
  });

  it("supports custom digit count", () => {
    const result = generateTOTP(secret, 30, 8);
    expect(result.code).toHaveLength(8);
  });
});
