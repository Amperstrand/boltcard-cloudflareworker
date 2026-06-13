import type { Env } from "../types/core.js";
import { hexToBytes } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { cmacScanVersions } from "./cmacScan.js";
import { VERSION_SCAN_RANGE } from "./constants.js";

/**
 * Detect which key version a physical card is using by scanning CMAC
 * across a range of versions. Tries [latest-RANGE, latest] first,
 * then falls back to v1 for cards re-burned at factory version.
 *
 * Used by both the LNURL-withdraw handler and validateCardTap (operator
 * endpoints) to ensure consistent version detection across all tap paths.
 */
export async function detectCardVersion(
  uidHex: string,
  ctr: string,
  cHex: string,
  env: Env,
  latestVersion: number,
): Promise<number | null> {
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const lowVersion = Math.max(1, latestVersion - VERSION_SCAN_RANGE);
  const { matchedVersion } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
    k2ForVersion: async (v: number) => hexToBytes(getDeterministicKeys(uidHex, env, v).k2),
    highVersion: latestVersion,
    lowVersion,
  });
  if (matchedVersion !== null) return matchedVersion;

  // Fallback: always try version 1.
  // Handles cards that have been through many wipe/reactivate cycles where
  // latest_issued_version exceeds VERSION_SCAN_RANGE but the physical card
  // was re-programmed at v1 (e.g., test environments, factory reset).
  if (lowVersion > 1) {
    const v1K2 = getDeterministicKeys(uidHex, env, 1).k2;
    const { matchedVersion: v1Match } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
      k2ForVersion: async () => hexToBytes(v1K2),
      highVersion: 1,
      lowVersion: 1,
    });
    return v1Match;
  }

  return null;
}
