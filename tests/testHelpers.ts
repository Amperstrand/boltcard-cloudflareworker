import aesjs from "aes-js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { makeReplayNamespace, type ReplayNamespace } from "./replayNamespace.js";
import type { Env, CardConfig, SessionPayload } from "../types/core.js";

const DEFAULT_BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const DEFAULT_ISSUER_KEY = "00000000000000000000000000000001";
const DEFAULT_UID = "04a39493cc8680";

export type TestEnv = Omit<Env, "CARD_REPLAY"> & {
  CARD_REPLAY: ReplayNamespace;
  UID_CONFIG: KVNamespace;
  __kvStore?: Record<string, string>;
};

export class MockKVNamespace implements KVNamespace {
  private store = new Map<string, string>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        this.store.set(k, v);
      }
    }
  }

  get(key: string, options?: Partial<KVNamespaceGetOptions<undefined>>): Promise<string | null>;
  get(key: string, type: "text"): Promise<string | null>;
  get<ExpectedValue = unknown>(key: string, type: "json"): Promise<ExpectedValue | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: string, type: "stream"): Promise<ReadableStream | null>;
  get(key: string, options?: KVNamespaceGetOptions<"text">): Promise<string | null>;
  get<ExpectedValue = unknown>(key: string, options?: KVNamespaceGetOptions<"json">): Promise<ExpectedValue | null>;
  get(key: string, options?: KVNamespaceGetOptions<"arrayBuffer">): Promise<ArrayBuffer | null>;
  get(key: string, options?: KVNamespaceGetOptions<"stream">): Promise<ReadableStream | null>;
  get(key: Array<string>, type: "text"): Promise<Map<string, string | null>>;
  get<ExpectedValue = unknown>(key: Array<string>, type: "json"): Promise<Map<string, ExpectedValue | null>>;
  get(key: Array<string>, options?: Partial<KVNamespaceGetOptions<undefined>>): Promise<Map<string, string | null>>;
  get(key: Array<string>, options?: KVNamespaceGetOptions<"text">): Promise<Map<string, string | null>>;
  get<ExpectedValue = unknown>(key: Array<string>, options?: KVNamespaceGetOptions<"json">): Promise<Map<string, ExpectedValue | null>>;
  async get(key: string | Array<string>, typeOrOptions?: unknown): Promise<unknown> {
    if (Array.isArray(key)) {
      const result = new Map<string, unknown>();
      for (const k of key) {
        result.set(k, this.store.get(k) ?? null);
      }
      return result;
    }
    const val = this.store.get(key) ?? null;
    if (val === null) return null;
    const typeStr = typeof typeOrOptions === "string" ? typeOrOptions : (typeof typeOrOptions === "object" && typeOrOptions !== null && "type" in typeOrOptions ? (typeOrOptions as { type: string }).type : undefined);
    if (typeStr === "json") {
      return JSON.parse(val) as unknown;
    }
    if (typeStr === "arrayBuffer") {
      return new TextEncoder().encode(val).buffer as ArrayBuffer;
    }
    if (typeStr === "stream") {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(val));
          controller.close();
        },
      });
    }
    return val;
  }

  async list<Metadata = unknown>(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<Metadata>> {
    let keys = [...this.store.keys()];
    if (options?.prefix) {
      keys = keys.filter((k) => k.startsWith(options.prefix!));
    }
    if (options?.limit) {
      keys = keys.slice(0, options.limit);
    }
    return {
      list_complete: true,
      keys: keys.map((name) => ({ name })),
      cacheStatus: null,
    };
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, _options?: KVNamespacePutOptions): Promise<void> {
    if (typeof value === "string") {
      this.store.set(key, value);
    } else if (value instanceof ArrayBuffer) {
      this.store.set(key, new TextDecoder().decode(value));
    } else if (ArrayBuffer.isView(value)) {
      this.store.set(key, new TextDecoder().decode(value));
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
      }
      this.store.set(key, new TextDecoder().decode(combined));
    }
  }

  async getWithMetadata<Metadata = unknown>(key: string, options?: Partial<KVNamespaceGetOptions<undefined>>): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: string, type: "text"): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
  async getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(key: string, type: "json"): Promise<KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: string, type: "arrayBuffer"): Promise<KVNamespaceGetWithMetadataResult<ArrayBuffer, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: string, type: "stream"): Promise<KVNamespaceGetWithMetadataResult<ReadableStream, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: string, options: KVNamespaceGetOptions<"text">): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
  async getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(key: string, options: KVNamespaceGetOptions<"json">): Promise<KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: string, options: KVNamespaceGetOptions<"arrayBuffer">): Promise<KVNamespaceGetWithMetadataResult<ArrayBuffer, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: string, options: KVNamespaceGetOptions<"stream">): Promise<KVNamespaceGetWithMetadataResult<ReadableStream, Metadata>>;
  async getWithMetadata<Metadata = unknown>(key: Array<string>, type: "text"): Promise<Map<string, KVNamespaceGetWithMetadataResult<string, Metadata>>>;
  async getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(key: Array<string>, type: "json"): Promise<Map<string, KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>>;
  async getWithMetadata<Metadata = unknown>(key: Array<string>, options?: Partial<KVNamespaceGetOptions<undefined>>): Promise<Map<string, KVNamespaceGetWithMetadataResult<string, Metadata>>>;
  async getWithMetadata<Metadata = unknown>(key: Array<string>, options?: KVNamespaceGetOptions<"text">): Promise<Map<string, KVNamespaceGetWithMetadataResult<string, Metadata>>>;
  async getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(key: Array<string>, options?: KVNamespaceGetOptions<"json">): Promise<Map<string, KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>>;
  async getWithMetadata(_key: string | Array<string>, _typeOrOptions?: unknown): Promise<unknown> {
    return { value: null, metadata: null, cacheStatus: null };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export function createMockKV(initial?: Record<string, string>): KVNamespace {
  return new MockKVNamespace(initial) as unknown as KVNamespace;
}

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
  extraEnv?: Partial<TestEnv>;
}

export function buildCardTestEnv(options: BuildCardTestEnvOptions = {}): TestEnv {
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

  const env: TestEnv = {
    UID_CONFIG: new MockKVNamespace(kvStore) as unknown as KVNamespace,
    CARD_REPLAY: replay,
    BOLT_CARD_K1: keys ? keys.k1 : DEFAULT_BOLT_CARD_K1,
  } as TestEnv;

  if (!noIssuerKey && issuerKey) {
    env.ISSUER_KEY = issuerKey;
  }
  if (operatorAuth) {
    Object.assign(env, TEST_OPERATOR_AUTH);
  }
  if (exposeKvStore) {
    env.__kvStore = kvStore;
  }
  Object.assign(env, extraEnv);

  return env;
}
