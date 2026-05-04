interface Env {
  ISSUER_KEY?: string;
  OPERATOR_PIN?: string;
  BOLT_CARD_K1?: string;
  DEFAULT_PULL_PAYMENT_ID?: string;
  FAKEWALLET_DEFAULT_RAIL?: string;
  FAKEWALLET_UPI_PA?: string;
  FAKEWALLET_UPI_PN?: string;
  FAKEWALLET_SPAYD_ACC?: string;
  WORKER_ENV?: string;
  RATE_LIMITS?: KVNamespace;
  ctx?: ExecutionContext;
  __TEST_OPERATOR_SESSION?: string;
}
