import { getDeterministicKeys } from "../keygenerator.js";
import type { CardStateRow, Env } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import { getPerCardKeys, getAllIssuerKeyCandidates } from "../utils/keyLookup.js";
import { jsonResponse, buildBoltCardResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getCardState } from "../replayProtection.js";
import { validateUid, getRequestOrigin } from "../utils/validation.js";
import { UID_VALIDATION_MSG } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

type DerivedKeys = ReturnType<typeof getDeterministicKeys>;

interface KeysetResult {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  source: string;
  label: string;
  version?: number;
}

async function findFirstKeyset(normalizedUid: string, env: Env): Promise<KeysetResult | null> {
  const perCard = getPerCardKeys(normalizedUid);
  if (perCard && perCard.k0 && perCard.k1 && perCard.k2) {
    return {
      k0: perCard.k0, k1: perCard.k1, k2: perCard.k2,
      k3: perCard.k3 || perCard.k1,
      k4: perCard.k4 || perCard.k2,
      source: "percard", label: perCard.card_name || "per-card import",
    };
  }

  let cardState: CardStateRow | undefined;
  try {
    cardState = await getCardState(env, normalizedUid);
  } catch (e: unknown) {
    logger.warn("getCardState failed in findFirstKeyset", { uid: normalizedUid, error: getErrorMessage(e) });
  }
  const activeVersion = cardState?.active_version || cardState?.latest_issued_version;
  const versions = activeVersion && activeVersion > 1
    ? [activeVersion, activeVersion - 1, 1, 0]
    : [1, 0];
  const seenVersions = new Set<number>();
  const uniqueVersions = versions.filter((v: number) => { if (seenVersions.has(v)) return false; seenVersions.add(v); return true; });

  const issuerCandidates = getAllIssuerKeyCandidates(env);
  for (const candidate of issuerCandidates) {
    for (const version of uniqueVersions) {
      try {
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const keys: DerivedKeys = getDeterministicKeys(normalizedUid, tempEnv, version);
        if (keys.k0 && keys.k1 && keys.k2 && keys.k3 && keys.k4) {
          return {
            k0: keys.k0, k1: keys.k1, k2: keys.k2,
            k3: keys.k3, k4: keys.k4,
            source: "deterministic", label: candidate.label, version,
          };
        }
      } catch (e: unknown) {
        logger.warn("Key derivation failed for candidate", { error: getErrorMessage(e) });
        continue;
      }
    }
  }
  return null;
}

export async function handleGetKeys(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const uidParam = url.searchParams.get("uid");
  const baseUrl = getRequestOrigin(request);

  if (request.method === "POST") {
    const body: Record<string, unknown> | null = await parseJsonBody(request);
    if (!body) return errorResponse("Invalid JSON body", 400);

    let uid: string | null = uidParam;
    if (!uid && body.UID) uid = String(body.UID);
    if (!uid && body.uid) uid = String(body.uid);
    const validatedUid = validateUid(uid);

    if (!validatedUid) {
      return errorResponse(UID_VALIDATION_MSG, 400);
    }

    let keys: KeysetResult | null;
    try {
      keys = await findFirstKeyset(validatedUid, env);
    } catch (err: unknown) {
      logger.error("Key lookup failed", { uid: validatedUid, error: getErrorMessage(err) });
      return errorResponse("Key lookup failed", 500);
    }
    if (!keys) {
      return errorResponse("No keys found for UID", 404, { uid: validatedUid });
    }

    return jsonResponse(buildBoltCardResponse(keys, validatedUid, baseUrl));
  }

  if (!uidParam) {
    return errorResponse("Missing required parameter: uid", 400);
  }

  const validatedUid = validateUid(uidParam);
  if (!validatedUid) {
    return errorResponse(UID_VALIDATION_MSG, 400);
  }

  if (url.searchParams.get("format") === "boltcard") {
    let keys: KeysetResult | null;
    try {
      keys = await findFirstKeyset(validatedUid, env);
    } catch (err: unknown) {
      logger.error("Key lookup failed", { uid: validatedUid, error: getErrorMessage(err) });
      return errorResponse("Key lookup failed", 500);
    }
    if (!keys) {
      return errorResponse("No keys found for UID", 404, { uid: validatedUid });
    }
    return jsonResponse(buildBoltCardResponse(keys, validatedUid, baseUrl));
  }

  const keysets: Record<string, unknown>[] = [];

  const perCard = getPerCardKeys(validatedUid);
  if (perCard) {
    keysets.push({
      k0: perCard.k0, k1: perCard.k1, k2: perCard.k2,
      k3: perCard.k3 || null, k4: perCard.k4 || null,
      version: null, source: "percard", label: perCard.card_name || "per-card import",
    });
  }

  const issuerCandidates = getAllIssuerKeyCandidates(env);
  let cardStateDetail: CardStateRow | undefined;
  try {
    cardStateDetail = await getCardState(env, validatedUid);
  } catch (e: unknown) {
    logger.warn("getCardState failed in keyset builder", { uid: validatedUid, error: getErrorMessage(e) });
  }
  const activeVersionDetail = cardStateDetail?.active_version || cardStateDetail?.latest_issued_version;
  const detailVersions = activeVersionDetail && activeVersionDetail > 1
    ? [activeVersionDetail, activeVersionDetail - 1, 1, 0]
    : [1, 0];
  const seenDetail = new Set<number>();
  const uniqueDetailVersions = detailVersions.filter((v: number) => { if (seenDetail.has(v)) return false; seenDetail.add(v); return true; });

  for (const candidate of issuerCandidates) {
    for (const version of uniqueDetailVersions) {
      try {
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const k: DerivedKeys = getDeterministicKeys(validatedUid, tempEnv, version);
        keysets.push({
          k0: k.k0, k1: k.k1, k2: k.k2, k3: k.k3, k4: k.k4,
          version, source: "deterministic", label: candidate.label, card_key: k.cardKey,
        });
      } catch (e: unknown) {
        logger.warn("Key derivation failed for bulk key candidate", { error: getErrorMessage(e) });
        continue;
      }
    }
  }

  if (keysets.length === 0) {
    return errorResponse("No keys found for this UID", 404, { uid: validatedUid });
  }

  return jsonResponse({ uid: validatedUid, keysets });
}
