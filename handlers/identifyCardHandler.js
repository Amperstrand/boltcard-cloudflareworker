import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { hexToBytes } from "../cryptoutils.js";
import { getCardState } from "../replayProtection.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";

export async function handleIdentifyCard(request, env) {
  const body = await request.json().catch(() => null);
  const pHex = body?.p || new URL(request.url).searchParams.get("p");
  const cHex = body?.c || new URL(request.url).searchParams.get("c");

  if (!pHex || !cHex) {
    return errorResponse("Missing required parameters: p and c are required");
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return errorResponse(decryption.error);
  }

  const { uidHex, ctr } = decryption;
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const counterValue = parseInt(ctr, 16);

  let cardState = null;
  try {
    cardState = await getCardState(env, uidHex);
  } catch {}

  const results = [];

  if (cardState && cardState.state !== "terminated") {
    const activeVersion = cardState.active_version || 1;
    const config = await getUidConfig(uidHex, env, activeVersion);

    if (config && config.K2) {
      const cmac = validate_cmac(uidBytes, ctrBytes, cHex, hexToBytes(config.K2));
      results.push({
        source: "config",
        version: activeVersion,
        cmac_validated: cmac.cmac_validated,
        payment_method: config.payment_method,
        card_state: cardState.state,
        active_version: activeVersion,
      });
    }
  }

  for (let v = 0; v <= 10; v++) {
    try {
      const keys = await getDeterministicKeys(uidHex, env, v);
      const cmac = validate_cmac(uidBytes, ctrBytes, cHex, hexToBytes(keys.k2));
      if (cmac.cmac_validated) {
        results.push({
          source: "deterministic",
          version: v,
          cmac_validated: true,
          id: keys.id,
        });
      }
    } catch {}
  }

  const match = results.find(r => r.cmac_validated);

  return jsonResponse({
    uid: uidHex,
    counter: counterValue,
    card_state: cardState?.state || "unknown",
    active_version: cardState?.active_version || null,
    latest_issued_version: cardState?.latest_issued_version || null,
    matched: match || null,
    all_attempts: results,
  });
}
