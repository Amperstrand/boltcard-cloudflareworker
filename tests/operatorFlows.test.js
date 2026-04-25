import { describe, it, expect, beforeAll, beforeEach } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import aesjs from "aes-js";
import { buildCardTestEnv } from "./testHelpers.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04aabbccdd7788";
const K1_HEX = BOLT_CARD_K1.split(",")[0];

function generatePandC(uidHex, counter, k1Hex) {
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

function computeC(uidHex, ctrHex, k2Hex) {
  const vd = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctrHex), hexToBytes(k2Hex));
  return bytesToHex(vd.ct);
}

function makeEnv() {
  return buildCardTestEnv({ replayInitial: { [TEST_UID]: 1 }, operatorAuth: true, exposeKvStore: true, extraEnv: { BOLT_CARD_K1 } });
}

async function provisionCard(env) {
  const keys = getDeterministicKeys(TEST_UID, env);
  const config = {
    K2: keys.k2,
    payment_method: "fakewallet",
  };
  const kvStore = env.__kvStore;
  kvStore[TEST_UID] = JSON.stringify(config);
  const replayId = env.CARD_REPLAY.idFromName(TEST_UID.toLowerCase());
  const stub = env.CARD_REPLAY.get(replayId);
  await stub.fetch(new Request("https://internal/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1 }),
  }));
  return keys;
}

async function tapCard(keys, counter = 2) {
  const { pHex, ctrHex } = generatePandC(TEST_UID, counter, K1_HEX);
  const cHex = computeC(TEST_UID, ctrHex, keys.k2);
  return { p: pHex, c: cHex };
}

let keys;

beforeAll(async () => {
  keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 });
});

describe("Top-up flow", () => {
  let env;
  let counter = 2;

  beforeEach(async () => {
    env = makeEnv();
    await provisionCard(env);
    counter = 2;
  });

  it("tops up card balance", async () => {
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 500 }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.amount).toBe(500);
    expect(data.balance).toBe(500);
    expect(data.note).toMatch(/^topup:/);
  });

  it("rejects missing card parameters", async () => {
    const response = await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ amount: 100 }),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it("rejects invalid amount", async () => {
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: -5 }),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it("rejects replayed card tap", async () => {
    const tap = await tapCard(keys, counter);
    const resp1 = await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 100 }),
      }),
      env,
    );
    expect(resp1.status).toBe(200);
    const resp2 = await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 200 }),
      }),
      env,
    );
    expect(resp2.status).toBe(400);
  });

  it("respects MAX_TOPUP_AMOUNT", async () => {
    env.MAX_TOPUP_AMOUNT = "100";
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 500 }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("maximum");
  });
});

describe("POS charge flow", () => {
  let env;
  let counter = 2;

  beforeEach(async () => {
    env = makeEnv();
    await provisionCard(env);
    counter = 2;
  });

  async function topUp(amount) {
    const tap = await tapCard(keys, counter++);
    await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount }),
      }),
      env,
    );
  }

  it("charges card and returns new balance", async () => {
    await topUp(1000);
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 300, terminalId: "test-terminal" }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.amount).toBe(300);
    expect(data.balance).toBe(700);
    expect(data.note).toContain("pos:");
    expect(data.note).toContain("test-terminal");
  });

  it("returns 402 for insufficient balance", async () => {
    await topUp(100);
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 500 }),
      }),
      env,
    );
    expect(response.status).toBe(402);
    const data = await response.json();
    expect(data.currentBalance).toBe(100);
  });

  it("accepts items array", async () => {
    await topUp(1000);
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({
          p: tap.p,
          c: tap.c,
          amount: 450,
          terminalId: "bar-1",
          items: [{ name: "beer", qty: 3, unitPrice: 100 }, { name: "burger", qty: 1, unitPrice: 150 }],
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.balance).toBe(550);
    expect(data.note).toContain("beer:3");
  });

  it("rejects missing card parameters", async () => {
    const response = await handleRequest(
      new Request("https://test.local/operator/pos/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ amount: 100 }),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });
});

describe("Refund flow", () => {
  let env;
  let counter = 2;

  beforeEach(async () => {
    env = makeEnv();
    await provisionCard(env);
    counter = 2;
  });

  async function topUp(amount) {
    const tap = await tapCard(keys, counter++);
    await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount }),
      }),
      env,
    );
  }

  it("full refund zeroes balance", async () => {
    await topUp(1000);
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/refund/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, fullRefund: true }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.amount).toBe(1000);
    expect(data.balance).toBe(0);
  });

  it("partial refund reduces balance", async () => {
    await topUp(1000);
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/refund/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 300 }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.amount).toBe(300);
    expect(data.balance).toBe(700);
  });

  it("partial refund exceeding balance rejected", async () => {
    await topUp(100);
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/refund/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: 500 }),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it("full refund on zero balance succeeds with zero", async () => {
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/operator/refund/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c, fullRefund: true }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.amount).toBe(0);
  });
});

describe("Balance check", () => {
  let env;
  let counter = 2;

  beforeEach(async () => {
    env = makeEnv();
    await provisionCard(env);
    counter = 2;
  });

  it("returns balance for valid card", async () => {
    const tap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.balance).toBe(0);
    expect(data.uidHex).toBe(TEST_UID);
  });

  it("returns balance after top-up", async () => {
    const topUpTap = await tapCard(keys, counter++);
    await handleRequest(
      new Request("https://test.local/operator/topup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: topUpTap.p, c: topUpTap.c, amount: 500 }),
      }),
      env,
    );
    const checkTap = await tapCard(keys, counter++);
    const response = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: checkTap.p, c: checkTap.c }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.balance).toBe(500);
  });
});

describe("Menu CRUD", () => {
  let env;
  let counter = 2;

  beforeEach(async () => {
    env = makeEnv();
    await provisionCard(env);
    counter = 2;
  });

  it("returns empty menu for new terminal", async () => {
    const response = await handleRequest(
      new Request("https://test.local/api/pos/menu?t=new-terminal", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.items).toEqual([]);
  });

  it("saves and retrieves menu items", async () => {
    const menu = { items: [{ name: "Beer", price: 500 }, { name: "Burger", price: 800 }] };
    const saveResp = await handleRequest(
      new Request("https://test.local/operator/pos/menu?t=bar-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify(menu),
      }),
      env,
    );
    expect(saveResp.status).toBe(200);

    const getResp = await handleRequest(
      new Request("https://test.local/api/pos/menu?t=bar-1", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(getResp.status).toBe(200);
    const data = await getResp.json();
    expect(data.items).toHaveLength(2);
    expect(data.items[0].name).toBe("Beer");
    expect(data.items[0].price).toBe(500);
  });

  it("rejects menu with missing name", async () => {
    const menu = { items: [{ price: 100 }] };
    const response = await handleRequest(
      new Request("https://test.local/operator/pos/menu?t=test", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify(menu),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });
});
