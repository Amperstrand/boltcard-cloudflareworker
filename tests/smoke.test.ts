import { handleRequest } from "../index.js";
;
import { makeReplayNamespace, type ReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, computeAesCmac } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const POS_UID = "04d070fa967380";
const POS_UID_CONFIG_OBJECT = {
  K2: "6DA6F8D39F574BDF304FEFFA896D9B99",
  payment_method: "lnurlpay" as const,
  lnurlpay: {
    lightning_address: "test@getalby.com",
    min_sendable: 1000,
    max_sendable: 1000,
  },
};
const POS_UID_CONFIG = JSON.stringify(POS_UID_CONFIG_OBJECT);

function generateRealPandC(uidHex: string, counter: number, k1Hex: string) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);

  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xC7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;

  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));

  const ctrHex = bytesToHex(new Uint8Array([
    (counter >> 16) & 0xff,
    (counter >> 8) & 0xff,
    counter & 0xff,
  ]));

  return { pHex, ctrHex };
}

function computeRealC(uidHex: string, ctrHex: string, k2Hex: string) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

type TestEnv = Env & { CARD_REPLAY: ReplayNamespace };

function makeEnv(replayInitial: Record<string, number> = {}): TestEnv {
  const replay = makeReplayNamespace(replayInitial);
  replay.__cardConfigs.set(POS_UID, POS_UID_CONFIG_OBJECT);
  return {
    BOLT_CARD_K1: BOLT_CARD_K1,
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async (uid: string) => uid === POS_UID ? POS_UID_CONFIG : null,
      put: async () => {},
    } as unknown as KVNamespace,
    ...TEST_OPERATOR_AUTH,
  } as unknown as TestEnv;
}

describe("LNURL-pay smoke test: real crypto pipeline", () => {
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeAll(() => {
    const env = { BOLT_CARD_K1: BOLT_CARD_K1 } as Env;
    keys = getDeterministicKeys(POS_UID, env, 1);
  });

  test("Phase 1: card tap returns valid LUD-06 payRequest", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;

    expect(json.tag).toBe("payRequest");
    expect(json.minSendable).toBe(1000);
    expect(json.maxSendable).toBe(1000);

    expect(json.callback).toContain("/lnurlp/cb");
    expect(json.callback as string).toContain(`p=${pHex}`);
    expect(json.callback as string).toContain(`c=${cHex}`);

    expect(typeof json.metadata).toBe("string");
    const parsedMetadata = JSON.parse(json.metadata as string);
    expect(parsedMetadata[0][0]).toBe("text/plain");
    expect(parsedMetadata[0][1]).toContain("Order #1");

    expect(env.CARD_REPLAY.__counters.has(POS_UID)).toBe(false);
  });

  test("Phase 2: callback returns invoice from Lightning Address", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes(".well-known/lnurlp")) {
        return new Response(JSON.stringify({
          callback: "https://getalby.com/lnurlp/test/callback",
          tag: "payRequest",
          minSendable: 1000,
          maxSendable: 100000000,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (urlStr.includes("callback") && urlStr.includes("amount=")) {
        return new Response(JSON.stringify({
          pr: "lnbc10n1pj3testrealinvoice",
          routes: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    });

    try {
      const response = await handleRequest(
        new Request(`https://boltcardpoc.psbt.me/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`),
        env
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;
      expect(json.pr).toBe("lnbc10n1pj3testrealinvoice");
      expect(json.routes).toEqual([]);

      expect(env.CARD_REPLAY.__counters.get(POS_UID)).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Phase 3: replayed callback is rejected", async () => {
    const env = makeEnv({ [POS_UID]: 1 });
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`),
      env
    );

    expect(response.status).toBe(409);
    const json = await response.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/replay/i);
  });

  test("Phase 4: incrementing counter works", async () => {
    const env = makeEnv({ [POS_UID]: 1 });
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 2, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes(".well-known/lnurlp")) {
        return new Response(JSON.stringify({
          callback: "https://getalby.com/lnurlp/test/callback",
          tag: "payRequest",
          minSendable: 1000,
          maxSendable: 100000000,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ pr: "lnbc10n2next", routes: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const response = await handleRequest(
        new Request(`https://boltcardpoc.psbt.me/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`),
        env
      );

      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown>;
      expect(json.pr).toBe("lnbc10n2next");
      expect(env.CARD_REPLAY.__counters.get(POS_UID)).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Phase 5: initial tap shows counter=2 as Order #2", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 2, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    const metadata = JSON.parse(json.metadata as string);
    expect(metadata[0][1]).toContain("Order #2");
  });

  test("Phase 6: wrong CMAC is rejected", async () => {
    const env = makeEnv();
    const { pHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]!);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=deadbeefdeadbeef`),
      env
    );

    expect(response.status).toBe(403);
    const json = await response.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/CMAC/i);
  });

  test("Phase 7: full e2e flow — tap → payRequest → callback → invoice", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 3, BOLT_CARD_K1.split(",")[0]!);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const tapResponse = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );
    expect(tapResponse.status).toBe(200);
    const payReq = await tapResponse.json() as Record<string, unknown>;
    expect(payReq.tag).toBe("payRequest");
    expect(payReq.callback as string).toContain("/lnurlp/cb");

    expect(env.CARD_REPLAY.__counters.has(POS_UID)).toBe(false);

    const tap2 = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );
    expect(tap2.status).toBe(200);
    expect(env.CARD_REPLAY.__counters.has(POS_UID)).toBe(false);

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes(".well-known/lnurlp")) {
        return new Response(JSON.stringify({
          callback: "https://getalby.com/lnurlp/test/callback",
          tag: "payRequest",
          minSendable: 1000,
          maxSendable: 100000000,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ pr: "lnbc10n3e2e", routes: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const cbResponse = await handleRequest(
        new Request(`${payReq.callback}&amount=1000`),
        env
      );
      expect(cbResponse.status).toBe(200);
      const invoice = await cbResponse.json() as Record<string, unknown>;
      expect(invoice.pr).toBe("lnbc10n3e2e");

      expect(env.CARD_REPLAY.__counters.get(POS_UID)).toBe(3);

      const replay = await handleRequest(
        new Request(`${payReq.callback}&amount=1000`),
        env
      );
      expect(replay.status).toBe(409);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Phase 8: POS card programming via API stores lnurlpay config", async () => {
    const kvStore: Record<string, string> = {};
    const env: TestEnv = {
      ...makeEnv(),
      UID_CONFIG: {
        get: async (key: string) => kvStore[key] ?? null,
        put: async (key: string, value: string) => { kvStore[key] = value; },
      } as unknown as KVNamespace,
    };

    const response = await handleRequest(
      new Request(
        "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion&card_type=pos&lightning_address=test@getalby.com",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ UID: POS_UID }) }
      ),
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(json.K0).toBeDefined();
    expect(json.K1).toBeDefined();
    expect(json.K2).toBeDefined();
    expect(json.LNURLW as string).toContain("lnurlp://");

    const savedConfig = (env.CARD_REPLAY as unknown as { __cardConfigs: Map<string, Record<string, unknown>> }).__cardConfigs.get(POS_UID);
    expect(savedConfig).toBeDefined();
    expect(savedConfig!.payment_method).toBe("lnurlpay");
    expect((savedConfig!.lnurlpay as Record<string, unknown>)!.lightning_address).toBe("test@getalby.com");
  });
});
