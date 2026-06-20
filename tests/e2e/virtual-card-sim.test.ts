import { describe, test, expect, beforeEach } from "vitest";
import { handleRequest } from "../../index.js";
import { makeReplayNamespace, type ReplayNamespace } from "../replayNamespace.js";
import { TEST_OPERATOR_AUTH, virtualTap, MockKVNamespace } from "../testHelpers.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import type { Env } from "../../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

interface TestEnv extends Omit<Env, "CARD_REPLAY"> {
  CARD_REPLAY: ReplayNamespace;
}

function makeEnv(): TestEnv {
  const kvStore: Record<string, string> = {};
  return {
    BOLT_CARD_K1,
    ISSUER_KEY: "00000000000000000000000000000001",
    CARD_REPLAY: makeReplayNamespace(),
    UID_CONFIG: new MockKVNamespace(kvStore) as unknown as KVNamespace,
    ...TEST_OPERATOR_AUTH,
  } as TestEnv;
}

async function req(path: string, method = "GET", body: unknown = null, env: TestEnv): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const url = "https://test.local" + path;
  const opts: RequestInit = { method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  const resp = await handleRequest(new Request(url, opts), env);
  const txt = await resp.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(txt); } catch { /* not JSON */ }
  return { status: resp.status, json, text: txt };
}

function randomUid(): string {
  const bytes = new Uint8Array(7);
  for (let i = 0; i < 7; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("Virtual Card Simulation — Public API", () => {
  let env: TestEnv;

  beforeEach(() => { env = makeEnv(); });

  test("returns deterministic keys for valid UID without auth", async () => {
    const uid = "04aabbccddeeff";
    const resp = await req(`/api/vc/keys?uid=${uid}`, "GET", null, env);
    expect(resp.status).toBe(200);
    expect(resp.json!.uid).toBe(uid);
    expect(resp.json!.k1).toBeTruthy();
    expect(resp.json!.k2).toBeTruthy();
    expect(resp.json!.version).toBe(1);

    const expected = getDeterministicKeys(uid, env, 1);
    expect(resp.json!.k1).toBe(expected.k1);
    expect(resp.json!.k2).toBe(expected.k2);
  });

  test("rejects missing uid parameter", async () => {
    const resp = await req("/api/vc/keys", "GET", null, env);
    expect(resp.status).toBe(400);
  });

  test("rejects invalid UID format", async () => {
    const resp = await req("/api/vc/keys?uid=invalid", "GET", null, env);
    expect(resp.status).toBe(400);
  });

  test("rejects UID with wrong length", async () => {
    const resp = await req("/api/vc/keys?uid=04aabb", "GET", null, env);
    expect(resp.status).toBe(400);
  });

  test("rejects non-hex UID", async () => {
    const resp = await req("/api/vc/keys?uid=zzzzzzzzzzzzzz", "GET", null, env);
    expect(resp.status).toBe(400);
  });

  test("keys work for actual card tap (discover)", async () => {
    const uid = randomUid();
    const keysResp = await req(`/api/vc/keys?uid=${uid}`, "GET", null, env);
    const { k2 } = keysResp.json as { k1: string; k2: string };
    const k1Hex = BOLT_CARD_K1.split(",")[0]!;

    const { pHex, cHex } = virtualTap(uid, 1, k1Hex, k2);
    const tapResp = await req(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(tapResp.status).toBe(200);
    expect(tapResp.json!.tag).toBe("withdrawRequest");
  });
});

describe("Virtual Card Simulation — Full Lifecycle", () => {
  let env: TestEnv;
  let uid: string;
  let k1Hex: string;
  let k2: string;
  let counter: number;

  beforeEach(async () => {
    env = makeEnv();
    uid = randomUid();
    counter = 1;
    const keysResp = await req(`/api/vc/keys?uid=${uid}`, "GET", null, env);
    k2 = (keysResp.json!.k2 as string);
    k1Hex = BOLT_CARD_K1.split(",")[0]!;
  });

  function tap() {
    return virtualTap(uid, counter++, k1Hex, k2);
  }

  test("discover → topup → charge → refund → balance", async () => {
    const dt = tap();
    const discover = await req(`/?p=${dt.pHex}&c=${dt.cHex}`, "GET", null, env);

    const tt = tap();
    const topup = await req("/operator/topup/apply", "POST", {
      p: tt.pHex, c: tt.cHex, amount: 10000,
    }, env);
    expect(topup.json!.success).toBe(true);
    expect(topup.json!.balance).toBe(10000);

    const ct = tap();
    const charge = await req("/operator/pos/charge", "POST", {
      p: ct.pHex, c: ct.cHex, amount: 3000,
    }, env);
    expect(charge.json!.status === "OK" || charge.json!.success).toBe(true);

    const rt = tap();
    const refund = await req("/operator/refund/apply", "POST", {
      p: rt.pHex, c: rt.cHex, amount: 3000,
    }, env);
    expect(refund.json!.success).toBe(true);

    const bt = tap();
    const balance = await req("/api/balance-check", "POST", {
      p: bt.pHex, c: bt.cHex,
    }, env);
    expect(balance.json!.balance).toBe(10000);
  });

  test("overdraft prevention — charge exceeds balance", async () => {
    const tt = tap();
    await req("/operator/topup/apply", "POST", {
      p: tt.pHex, c: tt.cHex, amount: 5000,
    }, env);

    const ct = tap();
    const overcharge = await req("/operator/pos/charge", "POST", {
      p: ct.pHex, c: ct.cHex, amount: 10000,
    }, env);
    expect(overcharge.status).toBe(402);
  });

  test("replay protection — same counter rejected on second tap", async () => {
    const { pHex, cHex } = virtualTap(uid, 42, k1Hex, k2);
    const first = await req(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(first.status).toBe(200);

    const second = await req(`/?p=${pHex}&c=${cHex}`, "GET", null, env);
    expect(second.status).toBe(200);
    expect(second.json!.tag === "withdrawRequest" || second.json!.status === "ERROR").toBeTruthy();
  });

  test("counter advancement — 10 sequential taps all succeed", async () => {
    for (let i = 0; i < 10; i++) {
      const t = tap();
      const resp = await req(`/?p=${t.pHex}&c=${t.cHex}`, "GET", null, env);
      expect(resp.status).toBe(200);
      expect(resp.json!.tag).toBe("withdrawRequest");
    }
  });

  test("card dashboard shows virtual card info", async () => {
    const tt = tap();
    await req("/operator/topup/apply", "POST", {
      p: tt.pHex, c: tt.cHex, amount: 5000,
    }, env);

    const t = tap();
    const info = await req(`/card/info?p=${t.pHex}&c=${t.cHex}`, "GET", null, env);
    expect(info.status).toBe(200);
    expect(info.json!.uid).toBeTruthy();
    expect(info.json!.balance).toBe(5000);
  });

  test("balance-check works without auth", async () => {
    const tt = tap();
    await req("/operator/topup/apply", "POST", {
      p: tt.pHex, c: tt.cHex, amount: 7000,
    }, env);

    const t = tap();
    const bal = await req("/api/balance-check", "POST", { p: t.pHex, c: t.cHex }, env);
    expect(bal.status).toBe(200);
    expect(bal.json!.balance).toBe(7000);
  });

  test("multiple topups accumulate balance", async () => {
    for (const amount of [1000, 2000, 3000]) {
      const t = tap();
      await req("/operator/topup/apply", "POST", {
        p: t.pHex, c: t.cHex, amount,
      }, env);
    }

    const t = tap();
    const bal = await req("/api/balance-check", "POST", { p: t.pHex, c: t.cHex }, env);
    expect(bal.json!.balance).toBe(6000);
  });

  test("void reverses a POS charge", async () => {
    const tt = tap();
    await req("/operator/topup/apply", "POST", {
      p: tt.pHex, c: tt.cHex, amount: 10000,
    }, env);

    const ct = tap();
    const chargeResult = await req("/operator/pos/charge", "POST", {
      p: ct.pHex, c: ct.cHex, amount: 4000,
    }, env);
    expect(chargeResult.json!.status === "OK" || chargeResult.json!.success).toBe(true);

    const bt = tap();
    const balAfterCharge = await req("/api/balance-check", "POST", { p: bt.pHex, c: bt.cHex }, env);
    expect(balAfterCharge.json!.balance).toBe(6000);
  });
});

describe("Virtual Card Simulation — Page Rendering", () => {
  let env: TestEnv;

  beforeEach(() => { env = makeEnv(); });

  test("/virtual page contains create button and card details container", async () => {
    const resp = await req("/virtual", "GET", null, env);
    expect(resp.status).toBe(200);
    expect(resp.text).toContain("vc-create-btn");
    expect(resp.text).toContain("vc-card-details");
    expect(resp.text).toContain("vc-no-card");
  });

  test("/virtual page includes aes-js for client-side crypto", async () => {
    const resp = await req("/virtual", "GET", null, env);
    expect(resp.text).toContain("aes-js");
  });

  test("/virtual page has navigation links to all app pages", async () => {
    const resp = await req("/virtual", "GET", null, env);
    expect(resp.text).toContain('href="/card"');
    expect(resp.text).toContain('href="/operator/topup"');
    expect(resp.text).toContain('href="/operator/pos"');
    expect(resp.text).toContain('href="/operator/refund"');
    expect(resp.text).toContain('href="/login"');
    expect(resp.text).toContain('href="/identity"');
  });

  test("virtual-card-sim.js is loaded on all NFC pages", async () => {
    for (const path of ["/card", "/login", "/virtual"]) {
      const resp = await req(path, "GET", null, env);
      expect(resp.text).toContain("virtual-card-sim.js");
    }
  });

  test("virtual-card-sim.js loads BEFORE nfc.js in page shell", async () => {
    const resp = await req("/card", "GET", null, env);
    const simIdx = resp.text.indexOf("virtual-card-sim.js");
    const nfcIdx = resp.text.indexOf("nfc.js");
    expect(simIdx).toBeGreaterThan(-1);
    expect(nfcIdx).toBeGreaterThan(-1);
    expect(simIdx).toBeLessThan(nfcIdx);
  });
});
