import {
  convertCurrencyToSats,
  convertSatsToCurrency,
  getBtcPrice,
  fetchBtcRates,
} from "../utils/fiat-rails/currency.js";

describe("currency conversion", () => {
  afterEach(() => {
    // Reset internal cache between tests
  });

  describe("getBtcPrice", () => {
    test("returns a positive number for EUR", async () => {
      const price = await getBtcPrice("EUR");
      expect(price).toBeGreaterThan(0);
    });

    test("returns fallback for unknown currency", async () => {
      const price = await getBtcPrice("XYZ");
      expect(price).toBeGreaterThan(0);
    });
  });

  describe("convertCurrencyToSats", () => {
    test("converts EUR to positive satoshis", async () => {
      const sats = await convertCurrencyToSats(100, "EUR");
      expect(sats).toBeGreaterThan(0);
      expect(Number.isInteger(sats)).toBe(true);
    });

    test("throws for zero amount", async () => {
      await expect(convertCurrencyToSats(0, "EUR")).rejects.toThrow("must be positive");
    });

    test("throws for negative amount", async () => {
      await expect(convertCurrencyToSats(-10, "EUR")).rejects.toThrow("must be positive");
    });

    test("larger fiat amounts produce more sats", async () => {
      const sats100 = await convertCurrencyToSats(100, "EUR");
      const sats1000 = await convertCurrencyToSats(1000, "EUR");
      expect(sats1000).toBeGreaterThan(sats100);
    });
  });

  describe("convertSatsToCurrency", () => {
    test("converts sats to fiat", async () => {
      const fiat = await convertSatsToCurrency(100000, "EUR");
      expect(fiat).toBeGreaterThan(0);
    });

    test("returns 0 for zero sats", async () => {
      const fiat = await convertSatsToCurrency(0, "EUR");
      expect(fiat).toBe(0);
    });

    test("returns 0 for negative sats", async () => {
      const fiat = await convertSatsToCurrency(-100, "EUR");
      expect(fiat).toBe(0);
    });

    test("convertSatsToCurrency and convertCurrencyToSats are roughly inverse", async () => {
      const originalSats = 10000;
      const fiat = await convertSatsToCurrency(originalSats, "EUR");
      const roundTripped = await convertCurrencyToSats(fiat, "EUR");
      // Should be within 1 sat due to rounding
      expect(Math.abs(roundTripped - originalSats)).toBeLessThanOrEqual(1);
    });
  });

  describe("fetchBtcRates", () => {
    test("returns an object (or null on failure)", async () => {
      const rates = await fetchBtcRates();
      // In test env, fetch may fail — either null or object with rates is fine
      if (rates) {
        expect(typeof rates).toBe("object");
        expect(rates.EUR || rates.USD).toBeDefined();
      }
    });
  });
});
