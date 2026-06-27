import type { Env } from "../types/core.js";
import { logger } from "./logger.js";
import { bech32 } from "@scure/base";

const KV_PREFIX = "nostr_profile:";
const CACHE_TTL = 3600;
const RELAY_TIMEOUT_MS = 5000;

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.damus.io",
];

export interface NostrProfile {
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  website?: string;
}

export function npubToPubkey(npub: string): string | null {
  try {
    const decoded = bech32.decode(npub);
    if (decoded.prefix !== "npub") return null;
    const bytes = bech32.fromWords(decoded.words);
    const hex = Array.from(bytes).map((b: number) => b.toString(16).padStart(2, "0")).join("");
    return hex;
  } catch {
    return null;
  }
}

export async function getNostrProfile(env: Env, npub: string): Promise<NostrProfile | null> {
  try {
    const cached = await env.UID_CONFIG.get(KV_PREFIX + npub);
    if (cached) {
      return JSON.parse(cached) as NostrProfile;
    }
  } catch { }

  const pubkey = npubToPubkey(npub);
  if (!pubkey) return null;

  const profile = await fetchProfileFromRelays(pubkey);
  if (!profile) return null;

  try {
    await env.UID_CONFIG.put(KV_PREFIX + npub, JSON.stringify(profile), {
      expirationTtl: CACHE_TTL,
    });
  } catch { }

  return profile;
}

async function fetchProfileFromRelays(pubkey: string): Promise<NostrProfile | null> {
  for (const relayUrl of DEFAULT_RELAYS) {
    try {
      const profile = await fetchFromRelay(relayUrl, pubkey);
      if (profile) {
        logger.info("Nostr profile fetched from relay", { relay: relayUrl, pubkey: pubkey.substring(0, 16) });
        return profile;
      }
    } catch (err: unknown) {
      logger.debug("Relay fetch failed", { relay: relayUrl, error: String(err) });
    }
  }
  return null;
}

async function fetchFromRelay(relayUrl: string, pubkey: string): Promise<NostrProfile | null> {
  const wsUrl = relayUrl.replace("wss://", "https://").replace("ws://", "http://");

  const resp = await fetch(wsUrl, {
    headers: { Upgrade: "websocket" },
  });

  const ws = (resp as unknown as { webSocket: WebSocket }).webSocket;
  if (!ws) return null;

  ws.accept();

  return new Promise<NostrProfile | null>((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { }
      resolve(null);
    }, RELAY_TIMEOUT_MS);

    const subId = "profile-" + Math.random().toString(36).slice(2, 8);

    ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as unknown[];
        if (data[0] === "EOSE" && data[1] === subId) {
          clearTimeout(timeout);
          try { ws.close(); } catch { }
          resolve(null);
          return;
        }
        if (data[0] === "EVENT" && data[1] === subId) {
          const nostrEvent = data[2] as { content?: string };
          if (nostrEvent?.content) {
            const metadata = JSON.parse(nostrEvent.content) as NostrProfile;
            clearTimeout(timeout);
            try { ws.close(); } catch { }
            resolve(metadata);
          }
        }
      } catch { }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });

    ws.send(JSON.stringify(["REQ", subId, { kinds: [0], authors: [pubkey], limit: 1 }]));
  });
}
