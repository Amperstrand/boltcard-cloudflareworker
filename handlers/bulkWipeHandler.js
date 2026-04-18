import { computeAesCmac, hexToBytes, bytesToHex } from "../cryptoutils.js";
import { jsonResponse } from "../utils/responses.js";

function deriveKeysFromMasterKey(uidHex, issuerKeyHex) {
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, 1, true); // version = 1, little-endian

  const cardKeyMessage = new Uint8Array([
    ...hexToBytes("2d003f75"),
    ...uid,
    ...versionBytes,
  ]);
  const cardKey = computeAesCmac(cardKeyMessage, issuerKey);

  const k0 = bytesToHex(computeAesCmac(hexToBytes("2d003f76"), cardKey));
  const k1 = bytesToHex(computeAesCmac(hexToBytes("2d003f77"), issuerKey));
  const k2 = bytesToHex(computeAesCmac(hexToBytes("2d003f78"), cardKey));
  const k3 = bytesToHex(computeAesCmac(hexToBytes("2d003f79"), cardKey));
  const k4 = bytesToHex(computeAesCmac(hexToBytes("2d003f7a"), cardKey));

  return { k0, k1, k2, k3, k4 };
}

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
    const { k0, k1, k2, k3, k4 } = deriveKeysFromMasterKey(uid, key);

    const host = `${url.protocol}//${url.host}`;
    const lnurlwPath = host.replace(/^https?:\/\//, "") + "/";
    const uidUpper = uid.toUpperCase();

    const boltcard_response = {
      CARD_NAME: `UID ${uidUpper}`,
      ID: "1",
      K0: k0.toUpperCase(),
      K1: k1.toUpperCase(),
      K2: k2.toUpperCase(),
      K3: k3.toUpperCase(),
      K4: k4.toUpperCase(),
      LNURLW_BASE: `lnurlw://${lnurlwPath}`,
      LNURLW: `lnurlw://${lnurlwPath}`,
      PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
      PROTOCOL_VERSION: "1",
    };

    const wipe_json = {
      version: 1,
      action: "wipe",
      k0,
      k1,
      k2,
      k3,
      k4,
    };

    const endpointUrl = `${host}/api/bulk-wipe-keys?uid=${uid}&key=${key}`;
    const reset_deeplink = `boltcard://reset?url=${encodeURIComponent(endpointUrl)}`;

    return jsonResponse({ uid, boltcard_response, wipe_json, reset_deeplink }, 200);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
