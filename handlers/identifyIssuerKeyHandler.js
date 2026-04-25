import { extractUIDAndCounter } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getAllIssuerKeyCandidates, getPerCardKeys, getUniquePerCardK1s, fingerprintHex } from "../utils/keyLookup.js";
import { getCardState } from "../replayProtection.js";
import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { logger } from "../utils/logger.js";
import { cmacScanVersions } from "../utils/cmacScan.js";

const MAX_CANDIDATES = 50;

export async function handleIdentifyIssuerKey(request, env) {
  const body = await parseJsonBody(request).catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const pHex = body?.p;
  const cHex = body?.c;

  if (!pHex || !cHex) {
    return errorResponse("Missing required parameters: p and c are required");
  }

  const candidates = getAllIssuerKeyCandidates(env);
  if (candidates.length > MAX_CANDIDATES) {
    candidates.length = MAX_CANDIDATES;
  }

  for (const candidate of candidates) {
    const tryEnv = { ...env, ISSUER_KEY: candidate.hex };
    const decryption = extractUIDAndCounter(pHex, tryEnv);
    if (!decryption.success) continue;

    const { uidHex, ctr } = decryption;
    const uidBytes = hexToBytes(uidHex);
    const ctrBytes = hexToBytes(ctr);

    const cardState = await getCardState(env, uidHex);
    const latestVersion = cardState?.latest_issued_version || cardState?.active_version || 1;

    const { matchedVersion } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
      k2ForVersion: (v) => hexToBytes(deriveKeysFromHex(uidHex, candidate.hex, v).k2),
      highVersion: latestVersion,
      lowVersion: Math.max(1, latestVersion - 10),
    });

    if (matchedVersion !== null) {
      const fp = fingerprintHex(candidate.hex);
      const perCard = getPerCardKeys(uidHex);
      logger.info("Issuer key identified via card tap", {
        uidHex,
        version: matchedVersion,
        issuerLabel: candidate.label,
        fingerprint: fp,
        isPercard: !!perCard,
      });
      return jsonResponse({
        matched: true,
        uid: uidHex,
        version: matchedVersion,
        issuerKeyFingerprint: fp,
        issuerKeyLabel: candidate.label,
        isPercard: !!perCard,
      });
    }
  }

  const percardK1s = getUniquePerCardK1s();
  for (const entry of percardK1s) {
    const tryEnv = { ...env, ISSUER_KEY: entry.k1 };
    const decryption = extractUIDAndCounter(pHex, tryEnv);
    if (!decryption.success) continue;

    const { uidHex, ctr } = decryption;
    const uidBytes = hexToBytes(uidHex);
    const ctrBytes = hexToBytes(ctr);

    const { matchedVersion } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
      k2ForVersion: (v) => hexToBytes(deriveKeysFromHex(uidHex, entry.k1, v).k2),
      highVersion: 10,
      lowVersion: 1,
    });

    if (matchedVersion !== null) {
      const fp = fingerprintHex(entry.k1);
      return jsonResponse({
        matched: true,
        uid: uidHex,
        version: matchedVersion,
        issuerKeyFingerprint: fp,
        issuerKeyLabel: entry.card_name || "percard",
        isPercard: true,
      });
    }
  }

  logger.info("No issuer key matched from card tap", { pHexLength: pHex?.length });
  return jsonResponse({ matched: false, uid: null });
}
