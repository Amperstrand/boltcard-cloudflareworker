import { deriveKeysFromHex } from "../keygenerator.js";
import { jsonResponse, buildBoltCardResponse, buildResetDeeplink, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getRequestOrigin, validateUid } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export async function handleBulkWipeKeys(request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const version = url.searchParams.has("version") ? parseInt(url.searchParams.get("version"), 10) : 1;
  if (isNaN(version) || version < 0) {
    return errorResponse("Invalid version: must be a non-negative integer", 400);
  }

  let key = url.searchParams.get("key");
  if (request.method === "POST") {
    const body = await parseJsonBody(request).catch(() => null);
    if (body?.key) key = body.key;
  }

  if (!uid || !validateUid(uid)) {
    return errorResponse("Invalid uid: must be exactly 14 hex characters.", 400);
  }
  if (!key || !/^[0-9a-fA-F]{32}$/.test(key)) {
    return errorResponse("Invalid key: must be exactly 32 hex characters.", 400);
  }

  try {
    const keys = deriveKeysFromHex(uid, key, version);

    const host = getRequestOrigin(request);
    const boltcard_response = buildBoltCardResponse(keys, uid, host, version);

    const wipe_json = {
      version: version,
      action: "wipe",
      k0: keys.k0,
      k1: keys.k1,
      k2: keys.k2,
      k3: keys.k3,
      k4: keys.k4,
    };

    const endpointUrl = `${host}/api/bulk-wipe-keys?uid=${uid}&key=${key}`;
    const reset_deeplink = buildResetDeeplink(endpointUrl);

    return jsonResponse({ uid, boltcard_response, wipe_json, reset_deeplink }, 200);
  } catch (err) {
    logger.error("Bulk wipe handler error", { error: err.message });
    return errorResponse("Internal error", 500);
  }
}
