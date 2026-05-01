import { logger } from "./logger.js";
import { KV_LIST_LIMIT, CARD_INDEX_TTL } from "./constants.js";

const KEY_PREFIX = "card_idx:";

function indexKey(uidHex) {
  return KEY_PREFIX + uidHex.toLowerCase();
}

export async function indexCard(env, uidHex, metadata) {
  if (!env?.UID_CONFIG || !uidHex) return;
  try {
    const key = indexKey(uidHex);
    const record = {
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
  } catch (e) {
    logger.warn("Failed to index card", { uidHex, error: e.message });
  }
}

export async function _deindexCard(env, uidHex) {
  if (!env?.UID_CONFIG || !uidHex) return;
  try {
    await env.UID_CONFIG.delete(indexKey(uidHex));
  } catch (e) {
    logger.warn("Failed to deindex card", { uidHex, error: e.message });
  }
}

export async function _getIndexedCard(env, uidHex) {
  if (!env?.UID_CONFIG) return null;
  try {
    const raw = await env.UID_CONFIG.get(indexKey(uidHex));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    logger.warn("Failed to get indexed card", { uidHex, error: e.message });
    return null;
  }
}

export async function repairCardIndex(env, getCardStateFn) {
  if (!env?.UID_CONFIG || !env?.CARD_REPLAY) {
    return { scanned: 0, repaired: 0, errors: [] };
  }

  const scanned = [];
  let cursor = undefined;
  let listComplete = false;

  while (!listComplete) {
    const listResult = await env.UID_CONFIG.list({
      prefix: KEY_PREFIX,
      limit: KV_LIST_LIMIT,
      cursor,
    });

    const values = await Promise.all(
      listResult.keys.map((key) =>
        env.UID_CONFIG.get(key.name)
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
    cursor = listResult.cursor;
  }

  const errors = [];
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
    } catch (e) {
      errors.push({ uid: card.uid, error: e.message });
    }
  }

  return { scanned: scanned.length, repaired, errors };
}

export async function listIndexedCards(env, { state, prefix, limit = KV_LIST_LIMIT, cursor } = {}) {
  if (!env?.UID_CONFIG) return { cards: [], cursor: null, total: 0 };
  try {
    const listResult = await env.UID_CONFIG.list({
      prefix: KEY_PREFIX + (prefix || ""),
      limit,
      cursor: cursor || undefined,
    });

    const cards = [];
    const values = await Promise.all(
      listResult.keys.map((key) =>
        env.UID_CONFIG.get(key.name).then((raw) => {
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch (e) {
            logger.warn("Failed to parse indexed card", { key: key.name, error: e.message });
            return null;
          }
        }).catch((e) => {
          logger.warn("Failed to read indexed card", { key: key.name, error: e.message });
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
  } catch (e) {
    logger.warn("Failed to list indexed cards", { error: e.message });
    return { cards: [], cursor: null, total: 0 };
  }
}
