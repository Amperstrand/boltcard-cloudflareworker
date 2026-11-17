import type { K1IssuePayload, K1VerifyPayload } from "./types.js";
import { nowSec } from "./types.js";

// K1_FRESH (audit #13, default OFF — handlers/withdrawHandler.ts +
// handlers/lnurlHandler.ts gate on the env flag). Go parity:
//   - 16 random bytes, hex-encoded (boltcard/boltcard crypto.Create_k1)
//   - single-use: deleted on successful verify (Paid_flag in Go)
//   - TTL-checked by the caller (lnurlw_request_timeout_sec, default 60s)
// Table schema in schema.ts; keyed by k1 so repeated step-1 fetches keep
// every outstanding challenge valid (Go keeps one payment row per
// Response()).

const K1_BYTES = 16;

function randomK1Hex(): string {
  const bytes = new Uint8Array(K1_BYTES);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleK1Issue(sql: SqlStorage, request: Request): Promise<Response> {
  const { counterValue, maxAgeSec } = await request.json() as K1IssuePayload;
  if (!Number.isInteger(counterValue) || counterValue < 0) {
    return Response.json({ error: "Invalid counter value" }, { status: 400 });
  }

  const now = nowSec();
  // Opportunistic cleanup: expired challenges never verified out of the
  // table (single-use only deletes the presented one).
  const maxAge = typeof maxAgeSec === "number" && Number.isInteger(maxAgeSec) && maxAgeSec > 0 ? maxAgeSec : 0;
  if (maxAge > 0) {
    sql.exec("DELETE FROM k1_challenges WHERE created_at < ?", now - maxAge);
  }

  const k1 = randomK1Hex();
  sql.exec(
    "INSERT OR REPLACE INTO k1_challenges (k1, counter, created_at) VALUES (?, ?, ?)",
    k1,
    counterValue,
    now
  );
  return Response.json({ k1 });
}

export async function handleK1Verify(sql: SqlStorage, request: Request): Promise<Response> {
  const { k1, counterValue, ttlSeconds } = await request.json() as K1VerifyPayload;
  if (typeof k1 !== "string" || k1.length === 0 || !Number.isInteger(counterValue) || counterValue < 0) {
    return Response.json({ valid: false, reason: "Invalid k1 verify request" }, { status: 400 });
  }

  const rows = sql.exec(
    "SELECT counter, created_at FROM k1_challenges WHERE k1 = ?",
    k1
  ).toArray();

  if (rows.length === 0) {
    return Response.json({ valid: false, reason: "Unknown or already used k1" });
  }

  const row = rows[0] as { counter: number; created_at: number };
  if (row.counter !== counterValue) {
    // Belongs to a different (still outstanding) tap of this card — keep it.
    return Response.json({ valid: false, reason: "k1 does not match this card tap" });
  }

  const ttlNum = typeof ttlSeconds === "number" && Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 0;
  const expired = row.created_at + ttlNum <= nowSec();
  sql.exec("DELETE FROM k1_challenges WHERE k1 = ?", k1);

  if (expired) {
    return Response.json({ valid: false, reason: "k1 challenge expired" });
  }
  return Response.json({ valid: true });
}
