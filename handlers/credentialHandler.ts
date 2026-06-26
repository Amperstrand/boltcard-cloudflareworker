import { logger } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse, htmlResponse } from "../utils/responses.js";
import { parseValidatedBody } from "../utils/schemas.js";
import type { VerifyCredentialBody } from "../utils/schemas.js";
import { verifyCredentialBodySchema } from "../utils/schemas.js";
import { renderCredentialPage } from "../templates/credentialPage.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";
import { issueVcJwt, verifyVcJwt, decodeVcJwt, getIssuerDid, buildCredentialProfile } from "../utils/vc.js";
import type { VcAlgorithm } from "../utils/vc.js";

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

  const auth = await resolveCardIdentity(p ?? undefined, c ?? undefined, env, { context: "vc-issue" });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex } = auth;
  const profile = buildCredentialProfile(uidHex);
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
