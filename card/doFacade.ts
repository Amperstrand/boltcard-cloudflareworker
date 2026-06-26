import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import type { DoPostRoutes, DoGetRoutes, DoRequestBody, DoResponseBody, PathWithOptionalQuery } from "../durableObjects/cardReplay/routes.js";
import { CARD_STATE } from "../utils/constants.js";
import { indexCard } from "../utils/cardIndex.js";
import type { CardStateRow } from "../types/core.js";

export const legacyCardState: CardStateRow = {
  state: CARD_STATE.LEGACY,
  latest_issued_version: 0,
  active_version: null,
  activated_at: null,
  terminated_at: null,
  keys_delivered_at: null,
  wipe_keys_fetched_at: null,
  balance: 0,
  counter: 0,
  key_provenance: null,
  key_fingerprint: null,
  key_label: null,
  first_seen_at: null,
  created_at: 0,
  updated_at: 0,
};

export function getCardStub(env: Env, uidHex: string): DurableObjectStub {
  const id: DurableObjectId = env.CARD_REPLAY.idFromName(uidHex.toLowerCase());
  return env.CARD_REPLAY.get(id);
}

export function requireDo(env: Env): void {
  if (!env?.CARD_REPLAY) {
    throw new Error("Replay protection Durable Object binding is not configured");
  }
}

export function doGet(stub: DurableObjectStub, path: string): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`));
}

export function doPost(stub: DurableObjectStub, path: string, body: unknown): Promise<Response> {
  return stub.fetch(new Request(`https://card-replay.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function doStateTransition<K extends DoPostRoutes>(
  env: Env, uidHex: string, path: K, body: DoRequestBody<K>, errorMsg: string,
  { legacyFallback, indexMetadata }: { legacyFallback?: DoResponseBody<K>; indexMetadata?: Record<string, unknown> } = {}
): Promise<DoResponseBody<K>> {
  requireDo(env);
  const stub: DurableObjectStub = getCardStub(env, uidHex);
  const response: Response = await doPost(stub, path, body);

  if (response.status === 404) {
    return (legacyFallback || { ...legacyCardState }) as DoResponseBody<K>;
  }

  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO error response", { path, error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.error || errorMsg));
  }

  const result = await response.json() as DoResponseBody<K>;

  if (indexMetadata) {
    await indexCard(env, uidHex, indexMetadata);
  }

  return result;
}

export async function doCounterPost<K extends "/check" | "/record-tap">(
  env: Env, uidHex: string, path: K, body: DoRequestBody<K>, errorMsg: string
): Promise<DoResponseBody<K>> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, path, body);
  const payload = await response.json() as DoResponseBody<K>;
  if (response.ok && payload.accepted) return payload;
  if (response.status === 409) return payload;
  throw new Error(payload.reason || errorMsg);
}

export async function doRequiredPost<K extends DoPostRoutes>(
  env: Env, uidHex: string, path: K, body: DoRequestBody<K>, errorMsg: string
): Promise<void> {
  requireDo(env);
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, path, body);
  if (!response.ok) {
    const payload = await response.json().catch((e: unknown) => { logger.warn("Failed to parse DO error response", { path: String(path), error: getErrorMessage(e) }); return {}; }) as Record<string, unknown>;
    throw new Error(String(payload.reason || errorMsg));
  }
}

export async function doSafeGet<K extends DoGetRoutes>(
  env: Env, uidHex: string, path: PathWithOptionalQuery<K>, fallback: DoResponseBody<K>
): Promise<DoResponseBody<K>> {
  if (!env?.CARD_REPLAY) return fallback;
  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, path);
  if (!response.ok) return fallback;
  return response.json() as Promise<DoResponseBody<K>>;
}

export async function doOptionalGet<K extends DoGetRoutes>(
  env: Env, uidHex: string, path: PathWithOptionalQuery<K>, fallback: DoResponseBody<K>
): Promise<DoResponseBody<K>> {
  if (!env?.CARD_REPLAY) return fallback;
  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, path);
  return response.json() as Promise<DoResponseBody<K>>;
}

export async function doOptionalPost<K extends DoPostRoutes>(
  env: Env, uidHex: string, path: K, body: DoRequestBody<K>, fallback: DoResponseBody<K>
): Promise<DoResponseBody<K>> {
  if (!env?.CARD_REPLAY) return fallback;
  const stub = getCardStub(env, uidHex);
  const response = await doPost(stub, path, body);
  return response.json() as Promise<DoResponseBody<K>>;
}

export async function doOptionalVoidPost<K extends DoPostRoutes>(
  env: Env, uidHex: string, path: K, body: DoRequestBody<K>
): Promise<void> {
  if (!env?.CARD_REPLAY) return;
  const stub = getCardStub(env, uidHex);
  await doPost(stub, path, body);
}
