import type { CARD_STATE, KEY_PROVENANCE, PAYMENT_METHOD } from "../utils/constants.js";

export type CardStateValue = (typeof CARD_STATE)[keyof typeof CARD_STATE];
export type PaymentMethodValue = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];
export type KeyProvenanceValue = (typeof KEY_PROVENANCE)[keyof typeof KEY_PROVENANCE];

export interface CardConfig {
  K2: string | null;
  payment_method: PaymentMethodValue;
  clnrest?: { host: string; rune: string; protocol?: string; port?: number };
  proxy?: { baseurl: string };
  cashu?: { backend_url: string };
  lnurlpay?: { lightning_address: string; min_sendable: number; max_sendable: number };
  card_type?: string;
  pull_payment_id?: string;
  config_json?: string;
  key_provenance?: KeyProvenanceValue;
  key_fingerprint?: string;
  key_label?: string;
}

export interface CardStateRow {
  state: CardStateValue;
  active_version: number | null;
  latest_issued_version: number;
  balance: number;
  counter?: number;
  activated_at: number | null;
  terminated_at: number | null;
  keys_delivered_at: number | null;
  wipe_keys_fetched_at: number | null;
  key_provenance: KeyProvenanceValue | null;
  key_fingerprint: string | null;
  key_label: string | null;
  first_seen_at: number | null;
  created_at?: number;
  updated_at?: number;
}

export interface SessionPayload {
  iat: number;
  exp: number;
  shiftId: string;
}

export interface BoltCardKeys {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
}

export interface KeyCandidate {
  hex: string;
  label?: string;
  provenance?: KeyProvenanceValue;
}

export interface TapRecord {
  id: number;
  uid_hex: string;
  counter_value: number;
  p_hex: string;
  c_hex: string;
  tap_type: "read" | "callback";
  bolt11: string | null;
  amount_msat: number | null;
  created_at: number;
  note: string | null;
}

export interface Transaction {
  id: number;
  counter: number | null;
  amount: number;
  balance_after: number;
  created_at: number;
  note: string | null;
  voided_at?: number | null;
}

export interface OpResult {
  ok: boolean;
  balance?: number;
  reason?: string;
  transaction?: Transaction;
  counter?: number;
  state?: CardStateValue;
}

export interface VoidResult {
  ok: boolean;
  reason?: string;
  balance?: number;
  voidedTransaction?: { id: number; amount: number; balance_after: number; note: string | null };
  newTransaction?: { id: number; amount: number; balance_after: number; created_at: number };
}

export interface CounterCheckResult {
  accepted: boolean;
  lastCounter: number | null;
  reason?: string;
}

export interface TapRecordResult {
  accepted: boolean;
  lastCounter?: number;
  tapRecorded?: boolean;
  reason?: string;
}

export interface TapEntry {
  counter: number | null;
  bolt11: string | null;
  status: string;
  payment_hash: string | null;
  amount_msat: number | null;
  user_agent: string | null;
  request_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface ListTapsResult {
  taps: TapEntry[];
}

export interface ClaimTapResult {
  claimed: boolean;
  reason?: string;
  bolt11?: string;
}

/** K1_FRESH (audit #13): result of issuing a withdraw challenge (DO /k1-issue) */
export interface K1ChallengeIssueResult {
  k1: string;
}

/** K1_FRESH (audit #13): result of verifying one (DO /k1-verify) — single-use on success */
export interface K1ChallengeVerifyResult {
  valid: boolean;
  reason?: string;
}

export interface AnalyticsResult {
  totalTaps: number;
  totalMsat: number;
  completedMsat: number;
  failedMsat: number;
  pendingMsat: number;
  completedTaps: number;
  failedTaps: number;
  pendingTaps: number;
}

export interface BalanceResult {
  balance: number;
}

export interface ListTransactionsResult {
  transactions: Transaction[];
}

export interface DiscoverResult {
  state: string;
  latest_issued_version?: number;
  active_version?: number | null;
  key_provenance?: string | null;
  key_fingerprint?: string | null;
  key_label?: string | null;
  first_seen_at?: number | null;
  already_exists?: boolean;
  balance?: number;
  counter?: number;
  activated_at?: number | null;
  terminated_at?: number | null;
  keys_delivered_at?: number | null;
  wipe_keys_fetched_at?: number | null;
  created_at?: number;
  updated_at?: number;
}

export interface MarkPendingResult {
  state: string;
  key_provenance?: string | null;
  key_fingerprint?: string | null;
  key_label?: string | null;
  first_seen_at?: number | null;
  already_exists?: boolean;
}

export interface IndexedCard {
  uidHex: string;
  state?: CardStateValue;
  balance?: number;
  lastActiveAt?: number;
  keyProvenance?: KeyProvenanceValue;
}

export type HandlerFn = (request: Request, env: Env, session?: SessionPayload) => Promise<Response> | Response;
export type PageHandlerFn = (request: Request, env: Env) => Promise<Response> | Response;

export interface Env {
  UID_CONFIG: KVNamespace;
  CARD_REPLAY: DurableObjectNamespace;
  RATE_LIMITS?: KVNamespace;

  ISSUER_KEY?: string;
  BOLT_CARD_K1?: string;
  BOLT_CARD_K1_0?: string;
  BOLT_CARD_K1_1?: string;

  OPERATOR_PIN?: string;
  OPERATOR_SESSION_SECRET?: string;

  // "operator" gates the key-material endpoints behind an operator session
  // (middleware/withKeyEndpointAuth.ts, audit #20); unset/"open" keeps the
  // demo/HIL posture.
  KEY_ENDPOINTS_AUTH?: string;

  // Truthy ("1"/"true"/"on"/"enforce") makes the three replay-check sites
  // reject counter replays with 409 instead of log-and-continue (audit #10;
  // see utils/validateCardTap.ts, handlers/lnurlwHandler.ts,
  // handlers/lnurlPayHandler.ts). Unset keeps the documented idempotent
  // posture (AGENTS.md) — the bolt11 claim machinery guards payments either
  // way.
  REPLAY_ENFORCE?: string;

  // Comma-separated host allow-list (audit #18). When set, card/LNURL-surface
  // requests whose Host is not in the list are refused with 400 (Go reference
  // behavior — middleware/withHostPinning.ts). Unset/empty keeps the current
  // open posture (bounded by the Cloudflare account host binding).
  ALLOWED_HOSTS?: string;

  // Truthy ("1"/"true"/"on"/"enforce") switches the fakewallet/clnrest
  // withdraw flow from the k1=c convention to a random server-stored
  // challenge with TTL (audit #13, Go parity — card/k1Challenges.ts, DO
  // routes /k1-issue + /k1-verify). Unset keeps k1=c (the HIL/bench
  // convention).
  K1_FRESH?: string;

  // K1_FRESH challenge TTL in seconds (Go default 60, lnurlw_request_timeout_sec).
  K1_FRESH_TTL_SECONDS?: string;

  WORKER_ENV?: string;
  ENVIRONMENT?: string;
  ENABLE_PERCARD_FALLBACK?: string;
  DEFAULT_PULL_PAYMENT_ID?: string;
  MAX_TOPUP_AMOUNT?: string;

  CURRENCY_LABEL?: string;
  CURRENCY_DECIMALS?: string;
  FAKEWALLET_CURRENCY?: string;
  FAKEWALLET_IBAN?: string;
  FAKEWALLET_ACCOUNT_NAME?: string;
  FAKEWALLET_DEFAULT_RAIL?: string;
  FAKEWALLET_UPI_PA?: string;
  FAKEWALLET_UPI_PN?: string;
  FAKEWALLET_SPAYD_ACC?: string;

  RECOVERY_ISSUER_KEYS?: string;
  POS_ADDRESS_POOL?: string;

  __TEST_OPERATOR_SESSION?: SessionPayload;
  ctx?: ExecutionContext;
}
