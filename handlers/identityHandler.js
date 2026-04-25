import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { renderIdentityPage } from "../templates/identityPage.js";
import { buildMaskedUid } from "../utils/validation.js";

const IDENTITY_EMOJI_OPTIONS = ["👤", "😀", "😎", "🤖", "🧠", "🚀", "🦊", "🦄", "🐸", "🦉", "⚡", "🔥"];

const IDENTITY_DEPARTMENTS = ["Engineering", "Security", "Operations", "Command"];
const IDENTITY_ROLES = ["Administrator", "Specialist", "Technician", "Director"];

function parseIdentityRecord(kvRaw) {
  if (!kvRaw) {
    return { enrolled: false, record: null };
  }

  try {
    const parsed = JSON.parse(kvRaw);
    if (parsed && typeof parsed === "object") {
      return { enrolled: true, record: parsed };
    }
  } catch {
    // Older enrollment entries may not be JSON. Treat them as enrolled.
  }

  return { enrolled: true, record: {} };
}

function buildIdentityProfile(uidHex, record = {}) {
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

async function resolveIdentityContext({ p, c }, env) {
  if (!p || !c) {
    return { response: errorResponse("Missing p or c parameters", 400) };
  }

  const decryption = extractUIDAndCounter(p, env);
  if (!decryption.success) {
    return { response: errorResponse("Decryption failed: " + decryption.error, 400) };
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  const config = await getUidConfig(uidHex, env);
  if (!config || !config.K2) {
    return { response: jsonResponse({ verified: false, reason: "Card not recognized" }) };
  }

  let kvRaw;
  try {
    kvRaw = await env.UID_CONFIG.get(uidHex);
  } catch (error) {
    logger.error("KV lookup failed during identity verification", { uidHex, error: error.message });
    return { response: errorResponse("Identity lookup failed", 500) };
  }
  const enrollment = parseIdentityRecord(kvRaw);
  if (!enrollment.enrolled) {
    return { response: jsonResponse({ verified: false, reason: "Card not enrolled for identity" }) };
  }

  const { cmac_validated } = validate_cmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    c,
    hexToBytes(config.K2),
  );

  if (!cmac_validated) {
    return { response: jsonResponse({ verified: false, reason: "Card authentication failed" }) };
  }

  return {
    uidHex,
    ctr,
    counterValue,
    record: enrollment.record,
  };
}

export function handleIdentityPage(request) {
  const url = new URL(request.url);
  return htmlResponse(renderIdentityPage({ host: url.origin }));
}

export async function handleIdentityVerify(request, env) {
  const url = new URL(request.url);
  const context = await resolveIdentityContext({
    p: url.searchParams.get("p"),
    c: url.searchParams.get("c"),
  }, env);

  if (context.response) {
    return context.response;
  }

  const { uidHex, counterValue, record } = context;
  const maskedUid = buildMaskedUid(uidHex);
  const profile = buildIdentityProfile(uidHex, record);

  logger.info("Identity verified", { uidHex, counterValue });

  return jsonResponse({ verified: true, uid: uidHex, maskedUid, profile });
}

export async function handleIdentityProfileUpdate(request, env) {
  const body = await parseJsonBody(request).catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const { p, c, emoji } = body || {};
  if (!IDENTITY_EMOJI_OPTIONS.includes(emoji)) {
    return errorResponse("Unsupported emoji selection", 400, {
      allowedEmoji: IDENTITY_EMOJI_OPTIONS,
    });
  }

  const context = await resolveIdentityContext({ p, c }, env);
  if (context.response) {
    return context.response;
  }

  const { uidHex, record } = context;
  const updatedRecord = {
    ...(record || {}),
    identity_profile: {
      ...(record?.identity_profile || {}),
      emoji,
    },
  };

  await env.UID_CONFIG.put(uidHex, JSON.stringify(updatedRecord));

  logger.info("Identity profile updated", { uidHex, emoji });

  return jsonResponse({
    success: true,
    uid: uidHex,
    maskedUid: buildMaskedUid(uidHex),
    profile: buildIdentityProfile(uidHex, updatedRecord),
  });
}
