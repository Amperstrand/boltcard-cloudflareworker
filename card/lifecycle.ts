import { logger, getErrorMessage } from "../utils/logger.js";
import type { Env, CardStateRow, MarkPendingResult, DiscoverResult } from "../types/core.js";
import { CARD_STATE } from "../utils/constants.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { doStateTransition, legacyCardState } from "./doFacade.js";
import { setCardK2 } from "./config.js";

export function resolveActiveVersion(cardState: CardStateRow): number {
  return cardState.active_version || cardState.latest_issued_version || 1;
}

export function resolveLatestVersion(cardState: CardStateRow): number {
  return cardState.latest_issued_version || cardState.active_version || 1;
}

export async function markPending(env: Env, uidHex: string, { key_provenance, key_fingerprint, key_label }: { key_provenance?: string; key_fingerprint?: string; key_label?: string } = {}): Promise<MarkPendingResult> {
  return doStateTransition(env, uidHex, "/mark-pending", {
    key_provenance: key_provenance || null,
    key_fingerprint: key_fingerprint || null,
    key_label: key_label || null,
  }, "Mark pending failed", {
    indexMetadata: {
      state: CARD_STATE.PENDING,
      keyProvenance: key_provenance,
      keyLabel: key_label,
      keyFingerprint: key_fingerprint,
    },
  });
}

export async function discoverCard(env: Env, uidHex: string, { key_provenance, key_fingerprint, key_label, active_version }: { key_provenance?: string; key_fingerprint?: string; key_label?: string; active_version?: number } = {}): Promise<DiscoverResult> {
  return doStateTransition(env, uidHex, "/discover", {
    key_provenance: key_provenance || null,
    key_fingerprint: key_fingerprint || null,
    key_label: key_label || null,
    active_version: active_version || null,
  }, "Discover card failed", {
    indexMetadata: {
      state: CARD_STATE.DISCOVERED,
      keyProvenance: key_provenance,
      keyLabel: key_label,
      keyFingerprint: key_fingerprint,
    },
  });
}

export async function deliverKeys(env: Env, uidHex: string): Promise<CardStateRow & { version: number }> {
  const result = await doStateTransition(env, uidHex, "/deliver-keys", {}, "Key delivery failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.KEYS_DELIVERED, latest_issued_version: 1, version: 1 },
    indexMetadata: { state: CARD_STATE.KEYS_DELIVERED },
  });
  try {
    const keys = getDeterministicKeys(uidHex, env, result.version);
    await setCardK2(env, uidHex, keys.k2);
  } catch (e: unknown) {
    logger.warn("Failed to persist K2 after deliverKeys", { uidHex, version: result.version, error: getErrorMessage(e) });
  }
  return result;
}

export async function activateCard(env: Env, uidHex: string, activeVersion: number): Promise<CardStateRow> {
  return doStateTransition(env, uidHex, "/activate", { active_version: activeVersion }, "Card activation failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.ACTIVE, active_version: activeVersion },
    indexMetadata: { state: CARD_STATE.ACTIVE },
  });
}

export async function terminateCard(env: Env, uidHex: string): Promise<CardStateRow> {
  return doStateTransition(env, uidHex, "/terminate", {}, "Card termination failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.TERMINATED },
    indexMetadata: { state: CARD_STATE.TERMINATED },
  });
}

export async function requestWipe(env: Env, uidHex: string): Promise<CardStateRow> {
  return doStateTransition(env, uidHex, "/request-wipe", {}, "Wipe request failed", {
    legacyFallback: { ...legacyCardState, state: CARD_STATE.NEW },
  });
}
