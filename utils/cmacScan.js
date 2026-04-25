import { validate_cmac } from "../boltCardHelper.js";

/**
 * Scan card key versions to find which version validates a CMAC tag.
 *
 * Iterates from highVersion down to lowVersion (inclusive), calling
 * k2ForVersion(v) to get the K2 key bytes for each version, then
 * validates the CMAC. Returns the first matching version (unless
 * stopOnFirst is false, in which case all versions are scanned).
 *
 * @param {Uint8Array} uidBytes
 * @param {Uint8Array} ctrBytes
 * @param {string} cHex
 * @param {object} opts
 * @param {function(number): Uint8Array} opts.k2ForVersion - Returns K2 key bytes for a given version
 * @param {number} opts.highVersion - Start scanning from this version (inclusive)
 * @param {number} opts.lowVersion - Stop scanning at this version (inclusive)
 * @param {boolean} [opts.stopOnFirst=true] - If true, return on first match
 * @returns {{ matchedVersion: number|null, attempts: Array<{version: number, cmac_validated: boolean}> }}
 */
export async function cmacScanVersions(uidBytes, ctrBytes, cHex, opts) {
  const { k2ForVersion, highVersion, lowVersion, stopOnFirst = true } = opts;
  const attempts = [];
  let matchedVersion = null;

  const step = highVersion >= lowVersion ? -1 : 1;
  for (let v = highVersion; step > 0 ? v <= lowVersion : v >= lowVersion; v += step) {
    const k2Bytes = await k2ForVersion(v);
    const { cmac_validated } = validate_cmac(uidBytes, ctrBytes, cHex, k2Bytes);
    attempts.push({ version: v, cmac_validated });
    if (cmac_validated && stopOnFirst) {
      matchedVersion = v;
      break;
    }
    if (cmac_validated && !stopOnFirst && matchedVersion === null) {
      matchedVersion = v;
    }
  }

  return { matchedVersion, attempts };
}
