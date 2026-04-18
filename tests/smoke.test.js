import { handleRequest } from "../index.js";
import { jest } from "@jest/globals";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, computeAesCmac } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const POS_UID = "04d070fa967380";

// Real crypto: encrypt a valid p parameter and compute valid c for a given UID + counter
function generateRealPandC(uidHex, counter, k1Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);

  // Counter in little-endian at positions 8-10
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xC7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;

  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));

  // Extract counter as decryptP would return it (big-endian after reversal)
  const ctrHex = bytesToHex(new Uint8Array([
    (counter >> 16) & 0xff,
    (counter >> 8) & 0xff,
    counter & 0xff,
  ]));

  return { pHex, ctrHex };
}

// Compute a valid BoltCard CMAC (c) for given UID, ctr (big-endian hex), K2
function computeRealC(uidHex, ctrHex, k2Hex) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  const k2 = hexToBytes(k2Hex);
  const vd = buildVerificationData(uid, ctr, k2);
  return bytesToHex(vd.ct);
}

function makeEnv(replayInitial = {}) {
  return {
    BOLT_CARD_K1: BOLT_CARD_K1,
    CARD_REPLAY: makeReplayNamespace(replayInitial),
  };
}

describe("LNURL-pay smoke test: real crypto pipeline", () => {
  let keys;

  beforeAll(async () => {
    const env = { BOLT_CARD_K1: BOLT_CARD_K1 };
    keys = await getDeterministicKeys(POS_UID, env);
  });

  test("Phase 1: card tap returns valid LUD-06 payRequest", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    // Verify LUD-06 payRequest structure
    expect(json.tag).toBe("payRequest");
    expect(json.minSendable).toBe(1000);
    expect(json.maxSendable).toBe(1000);

    // Callback URL must contain p and c so wallet can call it with amount
    expect(json.callback).toContain("/lnurlp/cb");
    expect(json.callback).toContain(`p=${pHex}`);
    expect(json.callback).toContain(`c=${cHex}`);

    // Metadata must be a string containing a JSON array with text/plain
    expect(typeof json.metadata).toBe("string");
    const parsedMetadata = JSON.parse(json.metadata);
    expect(parsedMetadata[0][0]).toBe("text/plain");
    expect(parsedMetadata[0][1]).toContain("Order #1");

    // Counter should NOT be recorded yet
    expect(env.CARD_REPLAY.__counters.has(POS_UID)).toBe(false);
  });

  test("Phase 2: callback returns invoice from Lightning Address", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
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
      const json = await response.json();
      expect(json.pr).toBe("lnbc10n1pj3testrealinvoice");
      expect(json.routes).toEqual([]);

      // Counter must now be recorded
      expect(env.CARD_REPLAY.__counters.get(POS_UID)).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Phase 3: replayed callback is rejected", async () => {
    const env = makeEnv({ [POS_UID]: 1 });
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/lnurlp/cb?p=${pHex}&c=${cHex}&amount=1000`),
      env
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.reason).toMatch(/replay/i);
  });

  test("Phase 4: incrementing counter works", async () => {
    const env = makeEnv({ [POS_UID]: 1 });
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 2, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
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
      const json = await response.json();
      expect(json.pr).toBe("lnbc10n2next");
      expect(env.CARD_REPLAY.__counters.get(POS_UID)).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Phase 5: initial tap shows counter=2 as Order #2", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 2, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const metadata = JSON.parse(json.metadata);
    expect(metadata[0][1]).toContain("Order #2");
  });

  test("Phase 6: wrong CMAC is rejected", async () => {
    const env = makeEnv();
    const { pHex } = generateRealPandC(POS_UID, 1, BOLT_CARD_K1.split(",")[0]);

    const response = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=deadbeefdeadbeef`),
      env
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.reason).toMatch(/CMAC/i);
  });

  test("Phase 7: full e2e flow — tap → payRequest → callback → invoice", async () => {
    const env = makeEnv();
    const { pHex, ctrHex } = generateRealPandC(POS_UID, 3, BOLT_CARD_K1.split(",")[0]);
    const cHex = computeRealC(POS_UID, ctrHex, keys.k2);

    // Step 1: Initial tap
    const tapResponse = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );
    expect(tapResponse.status).toBe(200);
    const payReq = await tapResponse.json();
    expect(payReq.tag).toBe("payRequest");
    expect(payReq.callback).toContain("/lnurlp/cb");

    // Counter should NOT be advanced yet
    expect(env.CARD_REPLAY.__counters.has(POS_UID)).toBe(false);

    // Step 2: Same tap again (simulating repeated scan) — should still work
    const tap2 = await handleRequest(
      new Request(`https://boltcardpoc.psbt.me/?p=${pHex}&c=${cHex}`),
      env
    );
    expect(tap2.status).toBe(200);
    expect(env.CARD_REPLAY.__counters.has(POS_UID)).toBe(false);

    // Step 3: Wallet calls callback with amount
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
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
      const invoice = await cbResponse.json();
      expect(invoice.pr).toBe("lnbc10n3e2e");

      // NOW counter is advanced
      expect(env.CARD_REPLAY.__counters.get(POS_UID)).toBe(3);

      // Step 4: Replay same callback — must fail
      const replay = await handleRequest(
        new Request(`${payReq.callback}&amount=1000`),
        env
      );
      expect(replay.status).toBe(400);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("Phase 8: POS card programming via API stores lnurlpay config", async () => {
    const kvStore = {};
    const env = {
      ...makeEnv(),
      UID_CONFIG: {
        get: async (key) => kvStore[key] ?? null,
        put: async (key, value) => { kvStore[key] = value; },
      },
    };

    const response = await handleRequest(
      new Request(
        "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion&card_type=pos&lightning_address=test@getalby.com",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ UID: POS_UID }) }
      ),
      env
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(json.K0).toBeDefined();
    expect(json.K1).toBeDefined();
    expect(json.K2).toBeDefined();
    expect(json.LNURLW).toContain("lnurlp://");

    const savedConfig = JSON.parse(kvStore[POS_UID]);
    expect(savedConfig.payment_method).toBe("lnurlpay");
    expect(savedConfig.lnurlpay.lightning_address).toBe("test@getalby.com");
  });
});
