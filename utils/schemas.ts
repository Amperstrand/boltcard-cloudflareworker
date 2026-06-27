import * as v from "valibot";

export const cardTapBodySchema = v.object({
  p: v.string(),
  c: v.string(),
});

export const cardTapWithAmountSchema = v.object({
  p: v.string(),
  c: v.string(),
  amount: v.union([v.string(), v.number()]),
});

export const posChargeBodySchema = v.object({
  p: v.string(),
  c: v.string(),
  amount: v.union([v.string(), v.number()]),
  items: v.optional(
    v.pipe(v.array(v.object({ name: v.pipe(v.string(), v.maxLength(200)), price: v.optional(v.number()), qty: v.optional(v.number()) })), v.maxLength(100))
  ),
  terminalId: v.optional(v.pipe(v.string(), v.maxLength(256))),
});

export const topupBodySchema = v.object({
  p: v.string(),
  c: v.string(),
  amount: v.union([v.string(), v.number()]),
});

export const refundBodySchema = v.object({
  p: v.string(),
  c: v.string(),
  amount: v.optional(v.union([v.string(), v.number()])),
  fullRefund: v.optional(v.boolean()),
});

export const voidBodySchema = v.object({
  p: v.string(),
  c: v.string(),
  transactionId: v.union([v.string(), v.number()]),
});

export const cardLockBodySchema = v.object({
  p: v.string(),
  c: v.string(),
});

export const cardReactivateBodySchema = v.object({
  p: v.string(),
  c: v.string(),
});

export const activateCardBodySchema = v.object({
  uid: v.optional(v.string()),
});

export const batchActionSchema = v.object({
  uids: v.array(v.string()),
  action: v.string(),
});

export const identityProfileBodySchema = v.object({
  p: v.string(),
  c: v.string(),
  emoji: v.optional(v.string()),
});

export const menuUpdateSchema = v.object({
  items: v.array(
    v.object({
      name: v.string(),
      price: v.number(),
    })
  ),
});

export const fetchBoltCardKeysBodySchema = v.object({
  UID: v.optional(v.string()),
  LNURLW: v.optional(v.string()),
});

export const getKeysBodySchema = v.object({
  UID: v.optional(v.string()),
  uid: v.optional(v.string()),
});

export const bulkWipeBodySchema = v.object({
  key: v.optional(v.string()),
});

export const loginBodySchema = v.object({
  p: v.optional(v.string()),
  c: v.optional(v.string()),
  uid: v.optional(v.string()),
  action: v.optional(v.string()),
  amount: v.optional(v.union([v.string(), v.number()])),
});

export const verifyCredentialBodySchema = v.object({
  credential: v.string(),
});

export const pairNostrBodySchema = v.object({
  p: v.string(),
  c: v.string(),
  npub: v.string(),
});

export const unpairNostrBodySchema = v.object({
  p: v.string(),
  c: v.string(),
});

export type CardTapBody = v.InferOutput<typeof cardTapBodySchema>;
export type PosChargeBody = v.InferOutput<typeof posChargeBodySchema>;
export type TopupBody = v.InferOutput<typeof topupBodySchema>;
export type RefundBody = v.InferOutput<typeof refundBodySchema>;
export type VoidBody = v.InferOutput<typeof voidBodySchema>;
export type BatchActionBody = v.InferOutput<typeof batchActionSchema>;
export type MenuUpdateBody = v.InferOutput<typeof menuUpdateSchema>;
export type ActivateCardBody = v.InferOutput<typeof activateCardBodySchema>;
export type IdentityProfileBody = v.InferOutput<typeof identityProfileBodySchema>;
export type BulkWipeBody = v.InferOutput<typeof bulkWipeBodySchema>;
export type LoginBody = v.InferOutput<typeof loginBodySchema>;
export type VerifyCredentialBody = v.InferOutput<typeof verifyCredentialBodySchema>;
export type PairNostrBody = v.InferOutput<typeof pairNostrBodySchema>;
export type UnpairNostrBody = v.InferOutput<typeof unpairNostrBodySchema>;

export async function parseValidatedBody<T>(
  request: Request,
  schema: v.BaseSchema<any, T, any>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
  const result = v.safeParse(schema, raw);
  if (result.success) {
    return { ok: true, data: result.output };
  }
  const issues = result.issues.map((i) => i.message || String(i.path?.[0]?.key || "unknown")).join(", ");
  return { ok: false, error: `Validation failed: ${issues}` };
}
