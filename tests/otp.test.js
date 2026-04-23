import { describe, it, expect } from "@jest/globals";
import { deriveOtpSecret } from "../utils/otp.js";

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
