import { logger } from "../logger.js";

const FALLBACK_RATES: Record<string, number> = {
  EUR: 60000,
  USD: 65000,
  INR: 7000000,
  CZK: 1500000,
  GBP: 50000,
  CHF: 60000,
  NOK: 700000,
  SEK: 650000,
};

let cachedRates: Record<string, string> | null = null;
let cachedRatesExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchBtcRates(): Promise<Record<string, string> | null> {
  if (cachedRates && Date.now() < cachedRatesExpiry) return cachedRates;

  try {
    const response = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=BTC", {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as any;
      const rates = data?.data?.rates;
      if (rates && typeof rates === "object") {
        cachedRates = rates;
        cachedRatesExpiry = Date.now() + CACHE_TTL_MS;
        return rates;
      }
    }
  } catch (error: any) {
    logger.warn("Failed to fetch BTC exchange rates from Coinbase", { error: error.message });
  }

  return null;
}

export async function getBtcPrice(currency: string): Promise<number> {
  const rates = await fetchBtcRates();
  if (rates && rates[currency]) {
    const price = parseFloat(rates[currency]);
    if (price > 0) return price;
  }

  const fallback = FALLBACK_RATES[currency] || FALLBACK_RATES.EUR;
  logger.warn("Using fallback exchange rate", { currency, rate: fallback });
  return fallback;
}

export async function convertCurrencyToSats(amount: number, currency: string): Promise<number> {
  if (amount <= 0) {
    throw new Error(`${currency} amount must be positive`);
  }

  const btcPrice = await getBtcPrice(currency.toUpperCase());
  const btcAmount = amount / btcPrice;
  return Math.ceil(btcAmount * 100000000);
}

export async function convertSatsToCurrency(amountSats: number, currency: string): Promise<number> {
  if (amountSats <= 0) return 0;

  const btcPrice = await getBtcPrice(currency.toUpperCase());
  const satPrice = btcPrice / 100000000;
  return amountSats * satPrice;
}
