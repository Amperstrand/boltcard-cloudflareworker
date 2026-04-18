/**
 * getKeysHandler.js — Public key lookup API for Bolt Card tools
 *
 * GET /api/keys?uid=04C15FFA967380
 *
 * Returns K0-K4 for a card UID. Lookup priority:
 *   1. Per-card keys from CSV data (non-deterministic, manually imported)
 *   2. Deterministic keys from all known issuer keys (tried until K1 decrypt matches)
 *   3. env.ISSUER_KEY deterministic keys
 *
 * Response:
 *   { uid, source, keysets: [{ k0, k1, k2, k3, k4, version, label }] }
 *
 * This is a PUBLIC endpoint — keys are only useful with physical card access.
 */
import { getDeterministicKeys } from "../keygenerator.js";
import { getPerCardKeys, getAllIssuerKeyCandidates } from "../utils/keyLookup.js";
import { jsonResponse } from "../utils/responses.js";

export async function handleGetKeys(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return jsonResponse({ error: "Missing required parameter: uid" }, 400);
  }

  const normalizedUid = uid.toLowerCase();

  // Validate UID: 7 bytes = 14 hex chars (NTAG424 DNA)
  if (!/^[0-9a-f]{14}$/i.test(normalizedUid)) {
    return jsonResponse({ error: "Invalid UID: must be exactly 14 hex characters (7 bytes)" }, 400);
  }

  const keysets = [];

  // 1. Check per-card CSV keys (manually imported, non-deterministic)
  const perCard = getPerCardKeys(normalizedUid);
  if (perCard) {
    keysets.push({
      k0: perCard.k0,
      k1: perCard.k1,
      k2: perCard.k2,
      k3: perCard.k3 || null,
      k4: perCard.k4 || null,
      version: null,
      source: "percard",
      label: perCard.card_name || "per-card import",
    });
  }

  // 2. Deterministic keys from all known issuer keys
  const issuerCandidates = getAllIssuerKeyCandidates(env);

  for (const candidate of issuerCandidates) {
    // Try version 1 (standard) and version 0
    for (const version of [1, 0]) {
      try {
        // Temporarily override ISSUER_KEY for deterministic derivation
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const keys = await getDeterministicKeys(normalizedUid, tempEnv, version);

        keysets.push({
          k0: keys.k0,
          k1: keys.k1,
          k2: keys.k2,
          k3: keys.k3,
          k4: keys.k4,
          version,
          source: "deterministic",
          label: candidate.label,
          card_key: keys.cardKey,
        });
      } catch (e) {
        // Skip invalid derivations silently
      }
    }
  }

  if (keysets.length === 0) {
    return jsonResponse({ error: "No keys found for this UID", uid: normalizedUid }, 404);
  }

  return jsonResponse({
    uid: normalizedUid,
    keysets,
  });
}
