import { computeAesCmac, hexToBytes, bytesToHex } from "./cryptoutils.js";

interface DerivedKeys {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  cardKey: string;
  id: string;
}

interface EnvLike {
  ISSUER_KEY?: string;
  WORKER_ENV?: string;
}

export function getDeterministicKeys(uidHex: string, env: EnvLike | null | undefined, version: number = 1): DerivedKeys {
  if (!uidHex || uidHex.length !== 14) {
    throw new Error(`Invalid UID: "${uidHex}" is not exactly 7 bytes (14 hex characters). Received ${uidHex ? uidHex.length : 'no'} characters.`);
  }
  const issuerKeyHex = (env && env.ISSUER_KEY) ? env.ISSUER_KEY : (() => {
    if (env && env.WORKER_ENV === "production") {
      throw new Error("ISSUER_KEY must be set in production");
    }
    return "00000000000000000000000000000001";
  })();
  const result = deriveKeysFromHex(uidHex, issuerKeyHex, version);
  const uid = hexToBytes(uidHex);
  const issuerKey = hexToBytes(issuerKeyHex);
  const id = computeAesCmac(new Uint8Array([...hexToBytes("2d003f7b"), ...uid]), issuerKey);
  return { ...result, id: bytesToHex(id) };
}

export function deriveKeysFromHex(uidHex: string, issuerKeyHex: string, version: number = 1): Omit<DerivedKeys, 'id'> {
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, version, true);

  const cardKey = computeAesCmac(
    new Uint8Array([...hexToBytes("2d003f75"), ...uid, ...versionBytes]),
    issuerKey
  );

  return {
    k0: bytesToHex(computeAesCmac(hexToBytes("2d003f76"), cardKey)),
    k1: bytesToHex(computeAesCmac(hexToBytes("2d003f77"), issuerKey)),
    k2: bytesToHex(computeAesCmac(hexToBytes("2d003f78"), cardKey)),
    k3: bytesToHex(computeAesCmac(hexToBytes("2d003f79"), cardKey)),
    k4: bytesToHex(computeAesCmac(hexToBytes("2d003f7a"), cardKey)),
    cardKey: bytesToHex(cardKey),
  };
}
