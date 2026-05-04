import { logger } from "./logger.js";
import type { Env, CardStateRow } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import { KV_LIST_LIMIT, CARD_INDEX_TTL } from "./constants.js";

const KEY_PREFIX = "card_idx:";

interface CardIndexMetadata {
  state?: string;
  keyProvenance?: string | null;
  keyLabel?: string | null;
  keyFingerprint?: string | null;
  paymentMethod?: string | null;
  balance?: number;
}

interface IndexedCard {
  uid: string;
  state: string;
  keyProvenance?: string | null;
  keyLabel?: string | null;
  keyFingerprint?: string | null;
  paymentMethod?: string | null;
  balance?: number;
  updatedAt: number;
}


function indexKey(uidHex: string): string {
  return KEY_PREFIX + uidHex.toLowerCase();
}

export async function indexCard(env: Env | undefined, uidHex: string | undefined, metadata: CardIndexMetadata) {
  if (!env?.UID_CONFIG || !uidHex) return;
  try {
    const key = indexKey(uidHex);
    const record: IndexedCard = {
      uid: uidHex.toLowerCase(),
      state: metadata.state || "unknown",
      keyProvenance: metadata.keyProvenance || null,
      keyLabel: metadata.keyLabel || null,
      keyFingerprint: metadata.keyFingerprint || null,
      paymentMethod: metadata.paymentMethod || null,
      balance: metadata.balance ?? 0,
      updatedAt: Date.now(),
    };
    await env.UID_CONFIG.put(key, JSON.stringify(record), {
      expirationTtl: CARD_INDEX_TTL,
    });
  } catch (e: unknown) {
    logger.warn("Failed to index card", { uidHex, error: getErrorMessage(e) });
  }
}

export async function _deindexCard(env: Env | undefined, uidHex: string | undefined) {
  if (!env?.UID_CONFIG || !uidHex) return;
  try {
    await env.UID_CONFIG.delete(indexKey(uidHex));
  } catch (e: unknown) {
    logger.warn("Failed to deindex card", { uidHex, error: getErrorMessage(e) });
  }
}

export async function _getIndexedCard(env: Env | undefined, uidHex: string): Promise<IndexedCard | null> {
  if (!env?.UID_CONFIG) return null;
  try {
    const raw = await env.UID_CONFIG.get(indexKey(uidHex));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e: unknown) {
    logger.warn("Failed to get indexed card", { uidHex, error: getErrorMessage(e) });
    return null;
  }
}

export async function repairCardIndex(env: Env, getCardStateFn: (env: Env, uid: string) => Promise<{ state: string }>) {
  if (!env?.UID_CONFIG || !env?.CARD_REPLAY) {
    return { scanned: 0, repaired: 0, errors: [] as Array<{ uid: string; error: string }> };
  }

  const scanned: IndexedCard[] = [];
  let cursor: string | undefined = undefined;
  let listComplete = false;

  while (!listComplete) {
    const listResult: KVNamespaceListResult<unknown> = await env.UID_CONFIG!.list({
      prefix: KEY_PREFIX,
      limit: KV_LIST_LIMIT,
      cursor,
    });

    const values = await Promise.all(
      listResult.keys.map((key: KVNamespaceListKey<unknown>) =>
        env.UID_CONFIG!.get(key.name)
          .then((raw) => {
            if (!raw) return null;
            try { return { key: key.name, ...JSON.parse(raw) }; }
            catch { return null; }
          })
          .catch(() => null)
      )
    );

    for (const card of values) {
      if (card) scanned.push(card);
    }

    listComplete = listResult.list_complete;
    cursor = !listResult.list_complete ? listResult.cursor : undefined;
  }

  const errors: Array<{ uid: string; error: string }> = [];
  let repaired = 0;

  for (const card of scanned) {
    try {
      const realState = await getCardStateFn(env, card.uid);

      if (realState.state && realState.state !== card.state) {
        await indexCard(env, card.uid, {
          state: realState.state,
          keyProvenance: card.keyProvenance,
          keyLabel: card.keyLabel,
          keyFingerprint: card.keyFingerprint,
          paymentMethod: card.paymentMethod,
          balance: card.balance,
        });
        repaired++;
      }
    } catch (e: unknown) {
      errors.push({ uid: card.uid, error: getErrorMessage(e) });
    }
  }

  return { scanned: scanned.length, repaired, errors };
}

export async function listIndexedCards(env: Env | undefined, { state, prefix, limit = KV_LIST_LIMIT, cursor }: { state?: string; prefix?: string; limit?: number; cursor?: string | null } = {}) {
  if (!env?.UID_CONFIG) return { cards: [] as IndexedCard[], cursor: null as string | null, total: 0 };
  try {
    const listResult = await env.UID_CONFIG.list({
      prefix: KEY_PREFIX + (prefix || ""),
      limit,
      cursor: cursor || undefined,
    });

    const cards: IndexedCard[] = [];
    const values = await Promise.all(
      listResult.keys.map((key) =>
        env.UID_CONFIG!.get(key.name).then((raw) => {
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch (e: unknown) {
            logger.warn("Failed to parse indexed card", { key: key.name, error: getErrorMessage(e) });
            return null;
          }
        }).catch((e: unknown) => {
          logger.warn("Failed to read indexed card", { key: key.name, error: getErrorMessage(e) });
          return null;
        })
      )
    );
    for (const card of values) {
      if (card && (!state || card.state === state)) {
        cards.push(card);
      }
    }

    return {
      cards,
      cursor: listResult.list_complete ? null : listResult.cursor,
      total: listResult.keys.length,
    };
  } catch (e: unknown) {
    logger.warn("Failed to list indexed cards", { error: getErrorMessage(e) });
    return { cards: [] as IndexedCard[], cursor: null as string | null, total: 0 };
  }
}
