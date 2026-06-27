import { logger } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse, htmlResponse } from "../utils/responses.js";
import { parseValidatedBody } from "../utils/schemas.js";
import type { VerifyCredentialBody } from "../utils/schemas.js";
import { verifyCredentialBodySchema } from "../utils/schemas.js";
import { renderCredentialPage } from "../templates/credentialPage.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";
import { issueVcJwt, verifyVcJwt, decodeVcJwt, getIssuerDid, buildCredentialProfile, issueDataIntegrityProof, verifyDataIntegrityProof, issueSdJwt, verifySdJwt } from "../utils/vc.js";
import type { VcAlgorithm, VerifiableCredentialWithProof } from "../utils/vc.js";
import { getNostrNpub } from "./nostrPairingHandler.js";
import { getCardState } from "../replayProtection.js";
import { getNostrProfile } from "../utils/nostrRelay.js";

export function handleCredentialPage(request: Request): Response {
  const url = new URL(request.url);
  return htmlResponse(renderCredentialPage({ host: url.origin }));
}

export async function handleCredentialIssue(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams.get("p");
  const c = url.searchParams.get("c");
  const algParam = url.searchParams.get("alg");
  const alg: VcAlgorithm = algParam === "EdDSA" ? "EdDSA" : "ES256";
  const format = url.searchParams.get("format");

  const auth = await resolveCardIdentity(p ?? undefined, c ?? undefined, env, { context: "vc-issue" });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex } = auth;
  const profile = buildCredentialProfile(uidHex);
  const nostrNpub = await getNostrNpub(env, uidHex);
  if (nostrNpub) {
    profile.nostrNpub = nostrNpub;
    try {
      const nostrProfile = await getNostrProfile(env, nostrNpub);
      if (nostrProfile?.name) profile.nostrName = nostrProfile.name;
      if (nostrProfile?.nip05) profile.nostrNip05 = nostrProfile.nip05;
    } catch { }
  }
  try {
    const cardState = await getCardState(env, uidHex);
    profile.cardBalance = cardState.balance;
    profile.cardState = cardState.state;
  } catch { }

  if (format === "di") {
    const vc = await issueDataIntegrityProof(env, uidHex, profile);
    logger.info("VC Data Integrity proof issued", { uidHex, action: "vc_issue", format: "di" });
    return jsonResponse({ credential: vc, issuer: vc.issuer, format: "di" });
  }

  if (format === "sdjwt") {
    const sdJwt = await issueSdJwt(env, uidHex, profile, alg);
    const jwtPart = sdJwt.split("~")[0]!;
    const sdDecoded = decodeVcJwt(jwtPart);
    logger.info("VC SD-JWT issued", { uidHex, action: "vc_issue", format: "sdjwt", alg });
    return jsonResponse({ credential: sdJwt, issuer: sdDecoded?.payload?.iss ?? "", format: "sdjwt", alg });
  }

  const jwt = await issueVcJwt(env, uidHex, profile, alg);
  const decoded = decodeVcJwt(jwt);

  logger.info("VC-JWT issued", { uidHex, action: "vc_issue", alg });

  return jsonResponse({
    credential: jwt,
    decoded: decoded?.payload,
    issuer: decoded?.payload?.iss,
    alg,
  });
}

export async function handleCredentialVerify(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  const result = await parseValidatedBody<VerifyCredentialBody>(request, verifyCredentialBodySchema);
  if (!result.ok) return errorResponse(result.error, 400);

  const { credential } = result.data;

  if (credential.trim().startsWith("{")) {
    try {
      const vc = JSON.parse(credential) as VerifiableCredentialWithProof;
      const verification = await verifyDataIntegrityProof(env, vc);
      return jsonResponse({ valid: verification.valid, error: verification.error, format: "di" });
    } catch {
      return jsonResponse({ valid: false, error: "Failed to parse Data Integrity credential" });
    }
  }

  if (credential.includes("~")) {
    const sdResult = await verifySdJwt(env, credential);
    return jsonResponse({
      valid: sdResult.valid,
      payload: sdResult.payload,
      disclosures: sdResult.disclosures,
      error: sdResult.error,
      format: "sdjwt",
    });
  }

  const verification = await verifyVcJwt(env, credential);

  return jsonResponse({
    valid: verification.valid,
    payload: verification.payload,
    error: verification.error,
  });
}

export async function handleCredentialIssuer(request: Request, env: Env): Promise<Response> {
  const didKey = await getIssuerDid(env);
  return jsonResponse({ issuer: didKey });
}
