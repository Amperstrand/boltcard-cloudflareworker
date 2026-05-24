/**
 * Typed route contract map for CardReplayDO communication.
 *
 * Every route the DO dispatcher handles is listed here with its HTTP method,
 * request body type, and response body type. The facade helpers in
 * replayProtection.ts are generic over this map so that:
 *   - `path` must be a valid route key (compile-time checked)
 *   - request payload type is inferred from the route
 *   - response type is inferred from the route
 */

import type {
  CardConfig,
  CardStateRow,
  CounterCheckResult,
  TapRecordResult,
  ListTapsResult,
  ClaimTapResult,
  AnalyticsResult,
  BalanceResult,
  ListTransactionsResult,
  DiscoverResult,
  MarkPendingResult,
  OpResult,
  VoidResult,
} from "../../types/core.js";

// ---------------------------------------------------------------------------
// Request payload types — one per route where the DO expects a body
// ---------------------------------------------------------------------------

/** POST /check, POST /check-readonly */
export interface CheckReq {
  counterValue: number;
}

/** POST /record-tap */
export interface RecordTapReq {
  counterValue: number;
  bolt11?: string | null;
  amountMsat?: number | null;
  userAgent?: string | null;
  requestUrl?: string;
}

/** POST /record-read */
export interface RecordReadReq {
  counterValue: number | null;
  userAgent?: string | null;
  requestUrl?: string;
}

/** POST /update-tap-status */
export interface UpdateTapStatusReq {
  counter: number;
  status: string;
  bolt11?: string | null;
  amountMsat?: number | null;
}

/** POST /claim-tap */
export interface ClaimTapReq {
  counter: number;
  bolt11: string | null;
  amountMsat: number | null;
}

/** POST /activate */
export interface ActivateReq {
  active_version: number;
}

/** POST /mark-pending */
export interface SetProvenanceReq {
  key_provenance: string | null;
  key_fingerprint: string | null;
  key_label: string | null;
}

/** POST /discover */
export interface DiscoverReq {
  key_provenance: string | null;
  key_fingerprint: string | null;
  key_label: string | null;
  active_version: number | null;
}

/** POST /set-k2 */
export interface SetK2Req {
  K2: string;
}

/** POST /debit */
export interface DebitReq {
  counter: number;
  amount: number;
  note: string;
}

/** POST /credit */
export interface CreditReq {
  amount: number;
  note: string;
}

/** POST /void */
export interface VoidReq {
  transactionId: number;
}

/** No body expected (e.g. /deliver-keys, /terminate, /request-wipe, /reset) */
export type EmptyReq = Record<string, never>;

// ---------------------------------------------------------------------------
// Response types for routes that don't reuse a core type
// ---------------------------------------------------------------------------

export interface RecordReadRes {
  recorded: boolean;
}

export interface UpdateTapStatusRes {
  updated: boolean;
}

export interface ResetRes {
  reset: boolean;
}

export interface SimpleOkRes {
  ok: boolean;
}

/** POST /deliver-keys returns CardStateRow plus the version */
export type DeliverKeysRes = CardStateRow & { version: number };

// ---------------------------------------------------------------------------
// Route map — the single source of truth for DO route contracts
// ---------------------------------------------------------------------------

export interface DoRouteMap {
  "/check":             { method: "POST"; req: CheckReq;         res: CounterCheckResult };
  "/check-readonly":    { method: "POST"; req: CheckReq;         res: CounterCheckResult };
  "/record-tap":        { method: "POST"; req: RecordTapReq;     res: TapRecordResult };
  "/record-read":       { method: "POST"; req: RecordReadReq;    res: RecordReadRes };
  "/update-tap-status": { method: "POST"; req: UpdateTapStatusReq; res: UpdateTapStatusRes };
  "/claim-tap":         { method: "POST"; req: ClaimTapReq;      res: ClaimTapResult };
  "/list-taps":         { method: "GET";  req: void;             res: ListTapsResult };
  "/analytics":         { method: "GET";  req: void;             res: AnalyticsResult };
  "/card-state":        { method: "GET";  req: void;             res: CardStateRow };
  "/deliver-keys":      { method: "POST"; req: EmptyReq;         res: DeliverKeysRes };
  "/activate":          { method: "POST"; req: ActivateReq;      res: CardStateRow };
  "/terminate":         { method: "POST"; req: EmptyReq;         res: CardStateRow };
  "/request-wipe":      { method: "POST"; req: EmptyReq;         res: CardStateRow };
  "/get-config":        { method: "GET";  req: void;             res: CardConfig | null };
  "/set-config":        { method: "POST"; req: Record<string, unknown>; res: SimpleOkRes };
  "/set-k2":            { method: "POST"; req: SetK2Req;         res: SimpleOkRes };
  "/debit":             { method: "POST"; req: DebitReq;         res: OpResult };
  "/credit":            { method: "POST"; req: CreditReq;        res: OpResult };
  "/void":              { method: "POST"; req: VoidReq;          res: VoidResult };
  "/balance":           { method: "GET";  req: void;             res: BalanceResult };
  "/transactions":      { method: "GET";  req: void;             res: ListTransactionsResult };
  "/reset":             { method: "POST"; req: EmptyReq;         res: ResetRes };
  "/mark-pending":      { method: "POST"; req: SetProvenanceReq; res: MarkPendingResult };
  "/discover":          { method: "POST"; req: DiscoverReq;      res: DiscoverResult };
}

// ---------------------------------------------------------------------------
// Derived helper types
// ---------------------------------------------------------------------------

/** Union of all DO route path literals */
export type DoRoutePath = keyof DoRouteMap;

/** Extract the request body type for a given route */
export type DoRequestBody<K extends DoRoutePath> = DoRouteMap[K]["req"];

/** Extract the response body type for a given route */
export type DoResponseBody<K extends DoRoutePath> = DoRouteMap[K]["res"];

/** POST routes only */
export type DoPostRoutes = {
  [K in DoRoutePath]: DoRouteMap[K]["method"] extends "POST" ? K : never;
}[DoRoutePath];

/** GET routes only */
export type DoGetRoutes = {
  [K in DoRoutePath]: DoRouteMap[K]["method"] extends "GET" ? K : never;
}[DoRoutePath];

/** Accepts base path or base path + query string (for GET routes) */
export type PathWithOptionalQuery<P extends string> = P | `${P}?${string}`;
