import { deriveKeysFromHex as _deriveKeysFromHex, computeAesCmac, hexToBytes, bytesToHex } from "@ntag424/crypto";
import type { DerivedKeys as LibDerivedKeys } from "@ntag424/crypto";
import type { Env } from "./types/core.js";

// App-specific extension: adds `id` field (CMAC of UID with constant 2d003f7b)
interface DerivedKeys extends LibDerivedKeys {
  id: string;
}

export function getDeterministicKeys(uidHex: string, env: Env | null | undefined, version: number = 1): DerivedKeys {
  if (!uidHex || uidHex.length !== 14) {
    throw new Error(`Invalid UID: "${uidHex}" is not exactly 7 bytes (14 hex characters). Received ${uidHex ? uidHex.length : 'no'} characters.`);
  }
  const issuerKeyHex = (env && env.ISSUER_KEY) ? env.ISSUER_KEY : (() => {
    if (env && env.WORKER_ENV === "production") {
      throw new Error("ISSUER_KEY must be set in production");
    }
    return "00000000000000000000000000000001";
  })();
  const result = _deriveKeysFromHex(uidHex, issuerKeyHex, version);
  const uid = hexToBytes(uidHex);
  const issuerKey = hexToBytes(issuerKeyHex);
  const id = computeAesCmac(new Uint8Array([...hexToBytes("2d003f7b"), ...uid]), issuerKey);
  return { ...result, id: bytesToHex(id) };
}

export function deriveKeysFromHex(uidHex: string, issuerKeyHex: string, version: number = 1): Omit<DerivedKeys, 'id'> {
  return _deriveKeysFromHex(uidHex, issuerKeyHex, version);
}
