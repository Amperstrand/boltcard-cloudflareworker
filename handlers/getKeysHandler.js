import { getDeterministicKeys } from "../keygenerator.js";
import { getPerCardKeys, getAllIssuerKeyCandidates } from "../utils/keyLookup.js";
import { jsonResponse } from "../utils/responses.js";

async function findFirstKeyset(normalizedUid, env) {
  const perCard = getPerCardKeys(normalizedUid);
  if (perCard && perCard.k0 && perCard.k1 && perCard.k2 && perCard.k3 && perCard.k4) {
    return {
      k0: perCard.k0, k1: perCard.k1, k2: perCard.k2,
      k3: perCard.k3, k4: perCard.k4,
      source: "percard", label: perCard.card_name || "per-card import",
    };
  }

  const issuerCandidates = getAllIssuerKeyCandidates(env);
  for (const candidate of issuerCandidates) {
    for (const version of [1, 0]) {
      try {
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const keys = await getDeterministicKeys(normalizedUid, tempEnv, version);
        if (keys.k0 && keys.k1 && keys.k2 && keys.k3 && keys.k4) {
          return {
            k0: keys.k0, k1: keys.k1, k2: keys.k2,
            k3: keys.k3, k4: keys.k4,
            source: "deterministic", label: candidate.label,
          };
        }
      } catch (e) {
        continue;
      }
    }
  }
  return null;
}

function toAppResponse(keys, uid, baseUrl) {
  const host = baseUrl ? baseUrl.replace(/^https?:\/\//, "") : "boltcardpoc.psbt.me";
  const lnurlw = `lnurlw://${host}/`;
  return {
    CARD_NAME: `UID ${uid.toUpperCase()}`,
    ID: "1",
    K0: keys.k0, k0: keys.k0,
    K1: keys.k1, k1: keys.k1,
    K2: keys.k2, k2: keys.k2,
    K3: keys.k3, k3: keys.k3,
    K4: keys.k4, k4: keys.k4,
    LNURLW_BASE: lnurlw,
    LNURLW: lnurlw,
    lnurlw_base: lnurlw,
    PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
    PROTOCOL_VERSION: "1",
  };
}

export async function handleGetKeys(request, env) {
  const url = new URL(request.url);
  const uidParam = url.searchParams.get("uid");
  const baseUrl = `${url.protocol}//${url.host}`;

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    let uid = uidParam;
    if (!uid && body.UID) uid = body.UID;
    if (!uid && body.uid) uid = body.uid;

    if (!uid || !/^[0-9a-fA-F]{14}$/.test(uid)) {
      return jsonResponse({ error: "Invalid or missing UID (must be 14 hex chars)" }, 400);
    }

    const normalizedUid = uid.toLowerCase();
    const keys = await findFirstKeyset(normalizedUid, env);
    if (!keys) {
      return jsonResponse({ error: "No keys found for UID", uid: normalizedUid }, 404);
    }

    return jsonResponse(toAppResponse(keys, normalizedUid, baseUrl));
  }

  if (!uidParam) {
    return jsonResponse({ error: "Missing required parameter: uid" }, 400);
  }

  const normalizedUid = uidParam.toLowerCase();
  if (!/^[0-9a-f]{14}$/i.test(normalizedUid)) {
    return jsonResponse({ error: "Invalid UID: must be exactly 14 hex characters (7 bytes)" }, 400);
  }

  const keysets = [];

  const perCard = getPerCardKeys(normalizedUid);
  if (perCard) {
    keysets.push({
      k0: perCard.k0, k1: perCard.k1, k2: perCard.k2,
      k3: perCard.k3 || null, k4: perCard.k4 || null,
      version: null, source: "percard", label: perCard.card_name || "per-card import",
    });
  }

  const issuerCandidates = getAllIssuerKeyCandidates(env);
  for (const candidate of issuerCandidates) {
    for (const version of [1, 0]) {
      try {
        const tempEnv = { ...env, ISSUER_KEY: candidate.hex };
        const k = await getDeterministicKeys(normalizedUid, tempEnv, version);
        keysets.push({
          k0: k.k0, k1: k.k1, k2: k.k2, k3: k.k3, k4: k.k4,
          version, source: "deterministic", label: candidate.label, card_key: k.cardKey,
        });
      } catch (e) {
        continue;
      }
    }
  }

  if (keysets.length === 0) {
    return jsonResponse({ error: "No keys found for this UID", uid: normalizedUid }, 404);
  }

  return jsonResponse({ uid: normalizedUid, keysets });
}
