import { logger, getErrorMessage } from "../../utils/logger.js";
import type { CardConfig } from "../../types/core.js";
import type { SetK2Payload } from "./types.js";
import { nowSec } from "./types.js";

export function handleGetConfig(sql: SqlStorage): Response {
  const rows = sql.exec(
    `SELECT K2, payment_method, config_json, pull_payment_id, updated_at FROM card_config WHERE singleton = 1`
  ).toArray();
  if (rows.length === 0) {
    return Response.json(null);
  }
  const row = rows[0] as Record<string, unknown>;
  let config: Record<string, unknown> = { payment_method: row.payment_method };
  if (row.K2) config.K2 = row.K2;
  if (row.pull_payment_id) config.pull_payment_id = row.pull_payment_id;
  if (row.config_json) {
    try {
      const extra = JSON.parse(row.config_json as string) as Record<string, unknown>;
      config = { ...config, ...extra };
    } catch (e: unknown) {
      logger.warn("Failed to parse card_config.config_json", { error: getErrorMessage(e) });
    }
  }
  return Response.json(config);
}

export async function handleSetConfig(sql: SqlStorage, request: Request): Promise<Response> {
  const config = await request.json() as CardConfig;
  const { K2, payment_method, pull_payment_id, ...rest } = config;
  const method: string = payment_method || "fakewallet";
  const k2: string | null = K2 || null;
  const pullPaymentId: string | null = pull_payment_id || null;
  const configJson: string | null = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
  const now = nowSec();

  sql.exec(
    `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(singleton) DO UPDATE SET
       K2 = excluded.K2,
       payment_method = excluded.payment_method,
       config_json = excluded.config_json,
       pull_payment_id = excluded.pull_payment_id,
       updated_at = excluded.updated_at`,
    k2, method, configJson, pullPaymentId, now
  );

  return Response.json({ ok: true });
}

export async function handleSetK2(sql: SqlStorage, request: Request): Promise<Response> {
  const { K2 } = await request.json() as SetK2Payload;
  const k2: string | null = K2 || null;
  const now = nowSec();
  const existing = sql.exec(
    `SELECT 1 FROM card_config WHERE singleton = 1`
  ).toArray();
  if (existing.length > 0) {
    sql.exec(
      `UPDATE card_config SET K2 = ?, updated_at = ? WHERE singleton = 1`,
      k2, now
    );
  } else {
    sql.exec(
      `INSERT INTO card_config (singleton, K2, payment_method, config_json, pull_payment_id, updated_at)
       VALUES (1, ?, 'fakewallet', NULL, NULL, ?)`,
      k2, now
    );
  }
  return Response.json({ ok: true });
}
