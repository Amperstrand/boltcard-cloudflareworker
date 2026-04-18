import { deriveKeysFromHex } from "../keygenerator.js";
import { jsonResponse, buildBoltCardResponse, buildResetDeeplink } from "../utils/responses.js";

export async function handleBulkWipeKeys(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const key = url.searchParams.get("key");

  if (!uid || !/^[0-9a-fA-F]{14}$/.test(uid)) {
    return jsonResponse({ error: "Invalid uid: must be exactly 14 hex characters." }, 400);
  }
  if (!key || !/^[0-9a-fA-F]{32}$/.test(key)) {
    return jsonResponse({ error: "Invalid key: must be exactly 32 hex characters." }, 400);
  }

  try {
    const keys = deriveKeysFromHex(uid, key);

    const host = `${url.protocol}//${url.host}`;
    const boltcard_response = buildBoltCardResponse(keys, uid, host);

    const wipe_json = {
      version: 1,
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
    return jsonResponse({ error: err.message }, 500);
  }
}
