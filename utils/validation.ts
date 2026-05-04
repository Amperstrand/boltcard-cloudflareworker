const UID_REGEX = /^[0-9a-f]{14}$/;

export function validateUid(uid: unknown): string | null {
  if (!uid || typeof uid !== 'string') return null;
  const normalized = uid.toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  return url.origin;
}

export function buildMaskedUid(uidHex: string): string {
  const upper = uidHex.toUpperCase();
  return upper.length >= 8
    ? upper.substring(0, 4) + "\u00b7\u00b7\u00b7" + upper.substring(upper.length - 4)
    : upper;
}

export function parsePositiveInt(raw: unknown, max: number = Infinity): number | null {
  const n = parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n <= 0 || n > max) return null;
  return n;
}
