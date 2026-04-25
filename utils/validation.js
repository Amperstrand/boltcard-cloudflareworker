const UID_REGEX = /^[0-9a-f]{14}$/;

export function validateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  const normalized = uid.toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

export function getRequestOrigin(request) {
  const url = new URL(request.url);
  return url.origin;
}

export function buildMaskedUid(uidHex) {
  const upper = uidHex.toUpperCase();
  return upper.length >= 8
    ? upper.substring(0, 4) + "\u00b7\u00b7\u00b7" + upper.substring(upper.length - 4)
    : upper;
}
