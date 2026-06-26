import type { Env, CardStateRow, CardConfig } from "../types/core.js";
import { doSafeGet, doOptionalVoidPost, doGet, getCardStub } from "./doFacade.js";

export async function getCardState(env: Env, uidHex: string): Promise<CardStateRow> {
  if (!env?.CARD_REPLAY) {
    return { state: "new", latest_issued_version: 0, active_version: null, activated_at: null, terminated_at: null, keys_delivered_at: null, wipe_keys_fetched_at: null, balance: 0, counter: 0, key_provenance: null, key_fingerprint: null, key_label: null, first_seen_at: null, created_at: 0, updated_at: 0 };
  }
  const stub = getCardStub(env, uidHex);
  const response = await doGet(stub, "/card-state");
  if (response.status === 404) {
    const { legacyCardState } = await import("./doFacade.js");
    return legacyCardState;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(payload.reason || payload.error || "Card state unavailable"));
  }
  return response.json() as Promise<CardStateRow>;
}

export async function getCardConfig(env: Env, uidHex: string): Promise<CardConfig | null> {
  return doSafeGet(env, uidHex, "/get-config", null);
}

export async function setCardConfig(env: Env, uidHex: string, config: Record<string, unknown>): Promise<void> {
  return doOptionalVoidPost(env, uidHex, "/set-config", config);
}

export async function setCardK2(env: Env, uidHex: string, k2: string): Promise<void> {
  return doOptionalVoidPost(env, uidHex, "/set-k2", { K2: k2 });
}
