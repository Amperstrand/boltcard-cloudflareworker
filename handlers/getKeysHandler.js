import { getDeterministicKeys } from "../keygenerator.js";
import { getPerCardKeys, getAllIssuerKeyCandidates } from "../utils/keyLookup.js";
import { jsonResponse, buildBoltCardResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getCardState } from "../replayProtection.js";
import { validateUid, getRequestOrigin } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

async function findFirstKeyset(normalizedUid, env) {
  const perCard = getPerCardKeys(normalizedUid);
  if (perCard && perCard.k0 && perCard.k1 && perCard.k2) {
    return {
      k0: perCard.k0, k1: perCard.k1, k2: perCard.k2,
      k3: perCard.k3 || perCard.k1,
      k4: perCard.k4 || perCard.k2,
      source: "percard", label: perCard.card_name || "per-card import",
    };
  }

  const cardState = await getCardState(env, normalizedUid);
  const activeVersion = cardState?.active_version || cardState?.latest_issued_version;
  const versions = activeVersion && activeVersion > 1
    ? [activeVersion, activeVersion - 1, 1, 0]
    : [1, 0];
  const seenVersions = new Set();
  const uniqueVersions = versions.filter(v => { if (seenVersions.has(v)) return false; seenVersions.add(v); return true; });

  const issuerCandidates = getAllIssuerKeyCandidates(env);
  for (const candidate of issuerCandidates) {
    for (const version of uniqueVersions) {
      try {
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const keys = getDeterministicKeys(normalizedUid, tempEnv, version);
        if (keys.k0 && keys.k1 && keys.k2 && keys.k3 && keys.k4) {
          return {
            k0: keys.k0, k1: keys.k1, k2: keys.k2,
            k3: keys.k3, k4: keys.k4,
            source: "deterministic", label: candidate.label, version,
          };
        }
      } catch (e) {
        logger.warn("Key derivation failed for candidate", { error: e.message });
        continue;
      }
    }
  }
  return null;
}

export async function handleGetKeys(request, env) {
  const url = new URL(request.url);
  const uidParam = url.searchParams.get("uid");
  const baseUrl = getRequestOrigin(request);

  if (request.method === "POST") {
    const body = await parseJsonBody(request).catch(() => null);
    if (!body) return errorResponse("Invalid JSON body", 400);

    let uid = uidParam;
    if (!uid && body.UID) uid = body.UID;
    if (!uid && body.uid) uid = body.uid;
    const validatedUid = validateUid(uid);

    if (!validatedUid) {
      return errorResponse("Invalid or missing UID (must be 14 hex chars)", 400);
    }

    const keys = await findFirstKeyset(validatedUid, env);
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
    return errorResponse("Invalid UID: must be exactly 14 hex characters (7 bytes)", 400);
  }

  if (url.searchParams.get("format") === "boltcard") {
    const keys = await findFirstKeyset(validatedUid, env);
    if (!keys) {
      return errorResponse("No keys found for UID", 404, { uid: validatedUid });
    }
    return jsonResponse(buildBoltCardResponse(keys, validatedUid, baseUrl));
  }

  const keysets = [];

  const perCard = getPerCardKeys(validatedUid);
  if (perCard) {
    keysets.push({
      k0: perCard.k0, k1: perCard.k1, k2: perCard.k2,
      k3: perCard.k3 || null, k4: perCard.k4 || null,
      version: null, source: "percard", label: perCard.card_name || "per-card import",
    });
  }

  const issuerCandidates = getAllIssuerKeyCandidates(env);
  const cardStateDetail = await getCardState(env, validatedUid);
  const activeVersionDetail = cardStateDetail?.active_version || cardStateDetail?.latest_issued_version;
  const detailVersions = activeVersionDetail && activeVersionDetail > 1
    ? [activeVersionDetail, activeVersionDetail - 1, 1, 0]
    : [1, 0];
  const seenDetail = new Set();
  const uniqueDetailVersions = detailVersions.filter(v => { if (seenDetail.has(v)) return false; seenDetail.add(v); return true; });

  for (const candidate of issuerCandidates) {
    for (const version of uniqueDetailVersions) {
      try {
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const k = getDeterministicKeys(validatedUid, tempEnv, version);
        keysets.push({
          k0: k.k0, k1: k.k1, k2: k.k2, k3: k.k3, k4: k.k4,
          version, source: "deterministic", label: candidate.label, card_key: k.cardKey,
        });
      } catch (e) {
        logger.warn("Key derivation failed for bulk key candidate", { error: e.message });
        continue;
      }
    }
  }

  if (keysets.length === 0) {
    return errorResponse("No keys found for this UID", 404, { uid: validatedUid });
  }

  return jsonResponse({ uid: validatedUid, keysets });
}
