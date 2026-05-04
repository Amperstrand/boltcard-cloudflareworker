import aesjs from "aes-js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import type { Env, CardConfig, SessionPayload } from "../types/core.js";

const DEFAULT_BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const DEFAULT_ISSUER_KEY = "00000000000000000000000000000001";
const DEFAULT_UID = "04a39493cc8680";

export const TEST_OPERATOR_AUTH: {
  OPERATOR_PIN: string;
  OPERATOR_SESSION_SECRET: string;
  __TEST_OPERATOR_SESSION: SessionPayload;
} = {
  OPERATOR_PIN: "1234",
  OPERATOR_SESSION_SECRET: "test-session-secret-for-jest",
  __TEST_OPERATOR_SESSION: {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 43200,
    shiftId: "test-shift-00000000-0000-0000-0000-000000000000",
  },
};

interface VirtualTapResult {
  pHex: string;
  cHex: string;
}

export function virtualTap(uidHex: string, counter: number, k1Hex: string, k2Hex: string): VirtualTapResult {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctrHex = bytesToHex(
    new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff])
  );
  const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(k2Hex));
  const cHex = bytesToHex(vd.ct);
  return { pHex, cHex };
}

interface BuildCardTestEnvOptions {
  uid?: string;
  issuerKey?: string;
  paymentMethod?: string;
  balance?: number;
  cardState?: string;
  cardConfig?: CardConfig | null;
  kvData?: string | null;
  replayInitial?: Record<string, number>;
  initialCards?: Record<string, number>;
  operatorAuth?: boolean;
  exposeKvStore?: boolean;
  noIssuerKey?: boolean;
  extraEnv?: Partial<Env>;
}

export function buildCardTestEnv(options: BuildCardTestEnvOptions = {}): Env & { __kvStore?: Record<string, string> } {
  const {
    uid = DEFAULT_UID,
    issuerKey = DEFAULT_ISSUER_KEY,
    paymentMethod = "fakewallet",
    balance = 0,
    cardState = "active",
    cardConfig = null,
    kvData = null,
    replayInitial = {},
    initialCards = {},
    operatorAuth = false,
    exposeKvStore = false,
    noIssuerKey = false,
    extraEnv = {},
  } = options;

  const keys = issuerKey ? getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as Env, 1) : null;
  const replay = makeReplayNamespace(replayInitial, initialCards);

  const hasInitialCards = Object.keys(initialCards).length > 0;

  if (!hasInitialCards && cardState === "active") {
    replay.__activate(uid, 1);
  } else if (!hasInitialCards && cardState === "keys_delivered") {
    replay.__cardStates.set(uid.toLowerCase(), {
      state: "keys_delivered",
      latest_issued_version: 1,
      active_version: null,
      activated_at: null,
      terminated_at: null,
      keys_delivered_at: Math.floor(Date.now() / 1000),
      wipe_keys_fetched_at: null,
      balance: 0,
      key_provenance: null,
      key_fingerprint: null,
      key_label: null,
      first_seen_at: null,
    });
  }

  const effectiveConfig = cardConfig || (keys ? { K2: keys.k2, payment_method: paymentMethod } as CardConfig : null);
  if (effectiveConfig && cardState !== "new") {
    replay.__cardConfigs.set(uid.toLowerCase(), effectiveConfig);
  }

  if (balance > 0 && replay.__cardStates.has(uid.toLowerCase())) {
    replay.__cardStates.get(uid.toLowerCase())!.balance = balance;
  }

  const kvStore: Record<string, string> = {};
  if (kvData) kvStore[uid] = kvData;

  const env: Env & { __kvStore?: Record<string, string> } = {} as Env;

  if (!noIssuerKey && issuerKey) {
    env.ISSUER_KEY = issuerKey;
  }
  if (keys) {
    env.BOLT_CARD_K1 = keys.k1;
  } else {
    env.BOLT_CARD_K1 = DEFAULT_BOLT_CARD_K1;
  }
  env.CARD_REPLAY = replay as unknown as DurableObjectNamespace;
  env.UID_CONFIG = {
    get: async (key: string) => kvStore[key] ?? null,
    put: async (key: string, val: string) => {
      kvStore[key] = val;
    },
  } as KVNamespace;
  if (operatorAuth) {
    Object.assign(env, TEST_OPERATOR_AUTH);
  }
  if (exposeKvStore) {
    env.__kvStore = kvStore;
  }
  Object.assign(env, extraEnv);

  return env;
}
