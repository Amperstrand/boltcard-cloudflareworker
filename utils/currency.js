const DEFAULT_LABEL = "credits";
const DEFAULT_DECIMALS = 0;

export function getCurrencyLabel(env) {
  return env.CURRENCY_LABEL || DEFAULT_LABEL;
}

export function getCurrencyDecimals(env) {
  const raw = env.CURRENCY_DECIMALS;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_DECIMALS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DECIMALS;
  return Math.min(n, 6);
}

export function formatAmount(raw, env) {
  const decimals = getCurrencyDecimals(env);
  const label = getCurrencyLabel(env);
  const value = typeof raw === "number" ? raw : parseInt(raw, 10);
  if (!Number.isFinite(value)) return `0 ${label}`;

  const divisor = Math.pow(10, decimals);
  const display = (value / divisor).toFixed(decimals);
  const parts = display.split(".");
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = decimals > 0 ? `${whole}.${parts[1]}` : whole;
  return `${formatted} ${label}`;
}

export function _parseAmount(input, env) {
  if (input === undefined || input === null) return null;
  const decimals = getCurrencyDecimals(env);
  const str = String(input).trim();
  if (str === "") return null;

  const cleaned = str.replace(/,/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;

  const multiplier = Math.pow(10, decimals);
  const raw = Math.round(num * multiplier);

  if (!Number.isFinite(raw) || raw < 0) return null;
  return raw;
}
