import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getAllIssuerKeyCandidates, getPerCardKeys, getUniquePerCardK1s, fingerprintHex } from "./keyLookup.js";
import { getCardState } from "../replayProtection.js";
import { cmacScanVersions } from "./cmacScan.js";
import { logger } from "./logger.js";
import { MAX_ISSUER_CANDIDATES, VERSION_SCAN_RANGE } from "./constants.js";

interface MatchResult {
  matched: boolean;
  uidHex?: string;
  ctr?: string;
  matchedVersion?: number | null;
  latestVersion?: number;
  issuerKey?: string;
  issuerLabel?: string;
  issuerFingerprint?: string;
  isPercard?: boolean;
  perCard?: any;
  cmacValid?: boolean;
  perCardOverride?: boolean;
  perCardSource?: string;
  versionAttempts?: any[];
}

export async function matchCardIssuer(pHex: string, cHex: string, env: any): Promise<MatchResult> {
  const candidates = getAllIssuerKeyCandidates(env);
  if (candidates.length > MAX_ISSUER_CANDIDATES) {
    candidates.length = MAX_ISSUER_CANDIDATES;
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

    const { matchedVersion, attempts } = await cmacScanVersions(
      uidBytes, ctrBytes, cHex, {
        k2ForVersion: async (v) => hexToBytes(deriveKeysFromHex(uidHex, candidate.hex, v).k2),
        highVersion: latestVersion,
        lowVersion: Math.max(1, latestVersion - VERSION_SCAN_RANGE),
      }
    );

    if (matchedVersion !== null) {
      const perCard = getPerCardKeys(uidHex);
      logger.info("Issuer key identified via card tap", {
        uidHex,
        version: matchedVersion,
        issuerLabel: candidate.label,
        isPercard: !!perCard,
      });
      return {
        matched: true,
        uidHex,
        ctr,
        matchedVersion,
        latestVersion,
        issuerKey: candidate.hex,
        issuerLabel: candidate.label,
        issuerFingerprint: fingerprintHex(candidate.hex),
        isPercard: !!perCard,
        perCard,
        cmacValid: true,
        versionAttempts: attempts,
      };
    }

    const perCard = getPerCardKeys(uidHex);
    if (perCard) {
      const { cmac_validated: pcCmac } = validateCmac(uidBytes, ctrBytes, cHex, hexToBytes(perCard.k2));
      if (pcCmac) {
        return {
          matched: true,
          uidHex,
          ctr,
          matchedVersion: latestVersion,
          latestVersion,
          issuerKey: candidate.hex,
          issuerLabel: candidate.label,
          issuerFingerprint: fingerprintHex(candidate.hex),
          isPercard: true,
          perCard,
          cmacValid: true,
          perCardOverride: true,
          perCardSource: perCard.card_name || "recovered",
          versionAttempts: attempts,
        };
      }
    }

    return {
      matched: false,
      uidHex,
      ctr,
      matchedVersion: null,
      latestVersion,
      issuerKey: candidate.hex,
      issuerLabel: candidate.label,
      issuerFingerprint: fingerprintHex(candidate.hex),
      isPercard: !!perCard,
      perCard,
      cmacValid: false,
      versionAttempts: attempts,
    };
  }

  for (const entry of getUniquePerCardK1s()) {
    const tryEnv = { ...env, ISSUER_KEY: entry.k1 };
    const decryption = extractUIDAndCounter(pHex, tryEnv);
    if (!decryption.success) continue;

    const { uidHex, ctr } = decryption;
    const perCard = getPerCardKeys(uidHex);
    if (!perCard) continue;

    const uidBytes = hexToBytes(uidHex);
    const ctrBytes = hexToBytes(ctr);
    const { cmac_validated } = validateCmac(uidBytes, ctrBytes, cHex, hexToBytes(perCard.k2));

    if (cmac_validated) {
      return {
        matched: true,
        uidHex,
        ctr,
        matchedVersion: 1,
        latestVersion: 1,
        issuerKey: entry.k1,
        issuerLabel: perCard.card_name || "recovered",
        issuerFingerprint: fingerprintHex(entry.k1),
        isPercard: true,
        perCard,
        cmacValid: true,
        perCardOverride: true,
        perCardSource: perCard.card_name || "recovered",
        versionAttempts: [],
      };
    }
  }

  logger.info("No issuer key matched from card tap", { pHexLength: pHex?.length });
  return { matched: false };
}
