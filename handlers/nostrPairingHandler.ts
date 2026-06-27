import { logger } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { jsonResponse, errorResponse, htmlResponse } from "../utils/responses.js";
import { parseValidatedBody } from "../utils/schemas.js";
import type { PairNostrBody, UnpairNostrBody } from "../utils/schemas.js";
import { pairNostrBodySchema, unpairNostrBodySchema } from "../utils/schemas.js";
import { renderNostrPairingPage } from "../templates/nostrPairingPage.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";

const KV_PREFIX = "card_nostr:";

export function handlePairingPage(request: Request): Response {
  const url = new URL(request.url);
  return htmlResponse(renderNostrPairingPage({ host: url.origin }));
}

export async function handlePairNostr(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  const result = await parseValidatedBody<PairNostrBody>(request, pairNostrBodySchema);
  if (!result.ok) return errorResponse(result.error, 400);

  const { p, c, npub } = result.data;

  if (!npub.startsWith("npub1") || npub.length < 50) {
    return errorResponse("Invalid npub format", 400);
  }

  const auth = await resolveCardIdentity(p ?? undefined, c ?? undefined, env, { context: "nostr-pair" });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex } = auth;

  try {
    await env.UID_CONFIG.put(KV_PREFIX + uidHex, JSON.stringify({
      npub,
      paired_at: Date.now(),
    }));
  } catch (err: unknown) {
    logger.error("Failed to store Nostr pairing in KV", { uidHex, error: String(err) });
    return errorResponse("Failed to store pairing", 500);
  }

  logger.info("Nostr identity paired", { uidHex, npub: npub.substring(0, 20) + "...", action: "nostr_pair" });

  return jsonResponse({
    success: true,
    uidHex,
    npub,
    message: "Card paired to Nostr identity",
  });
}

export async function handleUnpairNostr(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  const result = await parseValidatedBody<UnpairNostrBody>(request, unpairNostrBodySchema);
  if (!result.ok) return errorResponse(result.error, 400);

  const { p, c } = result.data;

  const auth = await resolveCardIdentity(p ?? undefined, c ?? undefined, env, { context: "nostr-unpair" });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex } = auth;

  try {
    await env.UID_CONFIG.delete(KV_PREFIX + uidHex);
  } catch (err: unknown) {
    logger.error("Failed to delete Nostr pairing from KV", { uidHex, error: String(err) });
    return errorResponse("Failed to remove pairing", 500);
  }

  logger.info("Nostr identity unpaired", { uidHex, action: "nostr_unpair" });

  return jsonResponse({
    success: true,
    uidHex,
    message: "Card unpaired from Nostr identity",
  });
}

export async function getNostrNpub(env: Env, uidHex: string): Promise<string | null> {
  try {
    const raw = await env.UID_CONFIG.get(KV_PREFIX + uidHex);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { npub: string };
    return parsed.npub;
  } catch {
    return null;
  }
}
