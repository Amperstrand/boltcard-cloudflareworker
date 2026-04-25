import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { hexToBytes } from "../cryptoutils.js";
import { getCardState } from "../replayProtection.js";
import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { cmacScanVersions } from "../utils/cmacScan.js";

export async function handleIdentifyCard(request, env) {
  const body = await parseJsonBody(request).catch(() => null);
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

  const keyCache = new Map();
  const { attempts: detAttempts } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
    k2ForVersion: async (v) => {
      try {
        const keys = getDeterministicKeys(uidHex, env, v);
        keyCache.set(v, keys);
        return hexToBytes(keys.k2);
      } catch {
        return new Uint8Array(16);
      }
    },
    highVersion: 10,
    lowVersion: 0,
    stopOnFirst: false,
  });

  for (const attempt of detAttempts) {
    if (attempt.cmac_validated && keyCache.has(attempt.version)) {
      results.push({
        source: "deterministic",
        version: attempt.version,
        cmac_validated: true,
        id: keyCache.get(attempt.version).id,
      });
    }
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
