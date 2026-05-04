import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { renderIdentityPage } from "../templates/identityPage.js";
import { buildMaskedUid } from "../utils/validation.js";
import { getCardState } from "../replayProtection.js";
import { KEY_PROVENANCE } from "../utils/constants.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";

const IDENTITY_EMOJI_OPTIONS: string[] = ["👤", "😀", "😎", "🤖", "🧠", "🚀", "🦊", "🦄", "🐸", "🦉", "⚡", "🔥"];

const IDENTITY_DEPARTMENTS: string[] = ["Engineering", "Security", "Operations", "Command"];
const IDENTITY_ROLES: string[] = ["Administrator", "Specialist", "Technician", "Director"];

interface IdentityEnrollment {
  enrolled: boolean;
  record: Record<string, any> | null;
}

interface IdentityContext {
  uidHex: string;
  ctr: string;
  counterValue: number;
  record: Record<string, any>;
  response?: Response;
}

function parseIdentityRecord(kvRaw: string | null): IdentityEnrollment {
  if (!kvRaw) {
    return { enrolled: false, record: null };
  }

  try {
    const parsed = JSON.parse(kvRaw);
    if (parsed && typeof parsed === "object") {
      return { enrolled: true, record: parsed };
    }
  } catch {
  }

  return { enrolled: true, record: {} };
}

function buildIdentityProfile(uidHex: string, record: Record<string, any> = {}): Record<string, any> {
  const hex = (uidHex || "00000000").padEnd(8, "0");
  const p0 = parseInt(hex.substring(0, 2), 16) || 0;
  const p1 = parseInt(hex.substring(2, 4), 16) || 0;
  const p2 = parseInt(hex.substring(4, 6), 16) || 0;
  const p3 = parseInt(hex.substring(6, 8), 16) || 0;
  const selectedEmoji = record?.identity_profile?.emoji;

  return {
    emoji: IDENTITY_EMOJI_OPTIONS.includes(selectedEmoji)
      ? selectedEmoji
      : IDENTITY_EMOJI_OPTIONS[p0 % IDENTITY_EMOJI_OPTIONS.length],
    name: "Operator-" + hex.substring(0, 4).toUpperCase(),
    role: IDENTITY_ROLES[p3 % IDENTITY_ROLES.length],
    dept: IDENTITY_DEPARTMENTS[p1 % IDENTITY_DEPARTMENTS.length],
    level: "Level " + ((p2 % 5) + 1),
  };
}

async function resolveIdentityContext({ p, c }: { p: string | null; c: string | null }, env: any): Promise<Partial<IdentityContext> & { response?: Response }> {
  const auth: any = await resolveCardIdentity(p ?? undefined, c ?? undefined, env, { context: "identity" });
  if (!auth.ok) {
    const resp = (auth.status === 404 || auth.status === 403)
      ? jsonResponse({ verified: false, reason: auth.status === 404 ? "Card not recognized" : "Card authentication failed" })
      : errorResponse(auth.error, auth.status);
    return { response: resp };
  }

  const { uidHex, counterValue } = auth;

  let kvRaw: string | null;
  try {
    kvRaw = await env.UID_CONFIG.get(uidHex);
  } catch (error: any) {
    logger.error("KV lookup failed during identity verification", { uidHex, error: error.message });
    return { response: errorResponse("Identity lookup failed", 500) };
  }
  const enrollment = parseIdentityRecord(kvRaw);
  if (!enrollment.enrolled) {
    return { response: jsonResponse({ verified: false, reason: "Card not enrolled for identity" }) };
  }

  return {
    uidHex,
    ctr: auth.ctr,
    counterValue,
    record: enrollment.record || {},
  };
}

export function handleIdentityPage(request: Request): Response {
  const url = new URL(request.url);
  return htmlResponse(renderIdentityPage({ host: url.origin }));
}

export async function handleIdentityVerify(request: Request, env: any): Promise<Response> {
  const url = new URL(request.url);
  const context = await resolveIdentityContext({
    p: url.searchParams.get("p"),
    c: url.searchParams.get("c"),
  }, env);

  if (context.response) {
    return context.response;
  }

  const { uidHex, counterValue, record } = context as IdentityContext;
  const maskedUid = buildMaskedUid(uidHex);
  const profile = buildIdentityProfile(uidHex, record);

  let keyProvenance: string | null = null;
  let programmingRecommended = false;
  try {
    const cardState: any = await getCardState(env, uidHex);
    keyProvenance = cardState.key_provenance || null;
    programmingRecommended = keyProvenance === KEY_PROVENANCE.PUBLIC_ISSUER;
  } catch (e: any) {
    logger.warn("Card state lookup failed in identity verify", { uidHex, error: e.message });
  }

  logger.info("Identity verified", { uidHex, counterValue, keyProvenance });

  return jsonResponse({
    verified: true,
    uid: uidHex,
    maskedUid,
    profile,
    keyProvenance,
    programmingRecommended,
  });
}

export async function handleIdentityProfileUpdate(request: Request, env: any): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const body: any = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p, c, emoji }: { p?: string; c?: string; emoji?: string } = body || {};
  if (!IDENTITY_EMOJI_OPTIONS.includes(emoji!)) {
    return errorResponse("Unsupported emoji selection", 400, {
      allowedEmoji: IDENTITY_EMOJI_OPTIONS,
    });
  }

  const context = await resolveIdentityContext({ p: p || null, c: c || null }, env);
  if (context.response) {
    return context.response;
  }

  const { uidHex, record } = context as IdentityContext;
  const updatedRecord = {
    ...(record || {}),
    identity_profile: {
      ...(record?.identity_profile || {}),
      emoji,
    },
  };

  try {
    await env.UID_CONFIG.put(uidHex, JSON.stringify(updatedRecord));
  } catch (err: any) {
    logger.error("Identity profile update KV write failed", { uidHex, error: err.message });
    return errorResponse("Failed to save profile", 500);
  }

  logger.info("Identity profile updated", { uidHex, emoji });

  return jsonResponse({
    success: true,
    uid: uidHex,
    maskedUid: buildMaskedUid(uidHex),
    profile: buildIdentityProfile(uidHex, updatedRecord),
  });
}
