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
