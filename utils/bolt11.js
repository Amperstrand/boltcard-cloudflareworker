const DIVISORS = { m: 1e3, u: 1e6, n: 1e9, p: 1e12 };
const MILLISATS_PER_BTC = 1e11;

export function decodeBolt11Amount(invoice) {
  if (!invoice || typeof invoice !== "string") return null;

  const lower = invoice.toLowerCase();

  if (!lower.startsWith("lnbc")) return null;

  const hrpEnd = lower.lastIndexOf("1");
  if (hrpEnd <= 4) return null;

  const amountPart = lower.substring(4, hrpEnd);

  if (amountPart.length === 0) return null;

  const lastChar = amountPart[amountPart.length - 1];
  let divisor = null;
  let numStr = amountPart;

  if (DIVISORS[lastChar] !== undefined) {
    divisor = lastChar;
    numStr = amountPart.slice(0, -1);
  }

  if (!numStr.match(/^\d+$/)) return null;

  const value = parseInt(numStr, 10);
  if (!Number.isSafeInteger(value)) return null;

  if (divisor) {
    return Math.round((value * MILLISATS_PER_BTC) / DIVISORS[divisor]);
  }

  return value * MILLISATS_PER_BTC;
}
