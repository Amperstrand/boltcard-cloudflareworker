export const DEFAULT_PULL_PAYMENT_ID = "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
export const DEFAULT_FALLBACK_HOST = "https://boltcardpoc.psbt.me";
export const DEFAULT_TAP_LIMIT = 50;
export const DEFAULT_TXN_LIMIT = 50;
export const RECEIPT_TXN_LOOKUP_LIMIT = 200;
export const BATCH_MAX_CARDS = 100;
export const HISTORY_LIMIT = 25;
export const VERSION_SCAN_RANGE = 10;
export const MAX_ISSUER_CANDIDATES = 50;
export const KV_LIST_LIMIT = 100;
export const CARD_INDEX_TTL = 7 * 24 * 60 * 60;
export const AUDIT_LOG_TTL = 90 * 24 * 60 * 60;
export const CARD_AUDIT_DEFAULT_LIMIT = 50;
export const CARD_AUDIT_MAX_LIMIT = 500;
export const AUDIT_LIST_DEFAULT_LIMIT = 50;
export const REQUEST_ID_LENGTH = 8;
export const FETCH_TIMEOUT_MS = 10000;
export const CLN_REST_PAY_PATH = "/v1/pay";

export const WITHDRAW_MIN_MSAT = 1000;
export const WITHDRAW_MAX_MSAT_FAKWALLET = 1000000;

export const LOGIN_RATE_LIMIT_REQUESTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW = 900;

export const OPERATOR_SESSION_MAX_AGE = 12 * 60 * 60;
export const OPERATOR_CSRF_MAX_AGE = 12 * 60 * 60;

export const OTP_DOMAIN_TAG_HOTP = "2d003f80";
export const OTP_DOMAIN_TAG_TOTP = "2d003f81";

export const CARD_STATE = {
  NEW: "new",
  PENDING: "pending",
  DISCOVERED: "discovered",
  KEYS_DELIVERED: "keys_delivered",
  ACTIVE: "active",
  WIPE_REQUESTED: "wipe_requested",
  TERMINATED: "terminated",
  LEGACY: "legacy",
};

export function isCardUsable(state) { return state === CARD_STATE.ACTIVE || state === CARD_STATE.DISCOVERED; }
export function isCardTerminated(state) { return state === CARD_STATE.TERMINATED; }
export function canAutoActivate(state) { return state === CARD_STATE.KEYS_DELIVERED; }
export function isCardNew(state) { return state === CARD_STATE.NEW || state === CARD_STATE.LEGACY; }
export function canTransact(state) { return isCardUsable(state) || canAutoActivate(state); }

export const UID_VALIDATION_MSG = "Invalid UID: must be exactly 14 hex characters";

export const KEY_PROVENANCE = {
  UNKNOWN: "unknown",
  PUBLIC_ISSUER: "public_issuer",
  ENV_ISSUER: "env_issuer",
  PERCARD: "percard",
  USER_PROVISIONED: "user_provisioned",
};

export const PAYMENT_METHOD = {
  FAKEWALLET: "fakewallet",
  CLNREST: "clnrest",
  PROXY: "proxy",
  LNURLPAY: "lnurlpay",
  TWOFACTOR: "twofactor",
};
