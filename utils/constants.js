export const DEFAULT_PULL_PAYMENT_ID = "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
export const DEFAULT_FALLBACK_HOST = "https://boltcardpoc.psbt.me";

export const DEFAULT_TAP_LIMIT = 50;
export const DEFAULT_TXN_LIMIT = 50;
export const RECEIPT_TXN_LOOKUP_LIMIT = 200;
export const HISTORY_LIMIT = 25;
export const VERSION_SCAN_RANGE = 10;
export const REQUEST_ID_LENGTH = 8;
export const FETCH_TIMEOUT_MS = 10000;

export const WITHDRAW_MIN_MSAT = 1000;
export const WITHDRAW_MAX_MSAT_FAKWALLET = 1000000;
export const WITHDRAW_MAX_MSAT_DEFAULT = 1000000000;

export const LOGIN_RATE_LIMIT_REQUESTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW = 900;

export const OPERATOR_SESSION_MAX_AGE = 12 * 60 * 60;
export const OPERATOR_CSRF_MAX_AGE = 12 * 60 * 60;

export const OTP_DOMAIN_TAG_HOTP = "2d003f80";
export const OTP_DOMAIN_TAG_TOTP = "2d003f81";

export const CARD_STATE = {
  NEW: "new",
  KEYS_DELIVERED: "keys_delivered",
  ACTIVE: "active",
  WIPE_REQUESTED: "wipe_requested",
  TERMINATED: "terminated",
  LEGACY: "legacy",
};

export const PAYMENT_METHOD = {
  FAKEWALLET: "fakewallet",
  CLNREST: "clnrest",
  PROXY: "proxy",
  LNURLPAY: "lnurlpay",
  TWOFACTOR: "twofactor",
};
