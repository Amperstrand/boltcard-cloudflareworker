// Audit #18 gate: withHostPinning (middleware/withHostPinning.ts).
// Default OPEN keeps the current posture (bounded by the Cloudflare account
// host binding); ALLOWED_HOSTS=a.example,b.org refuses Host mismatches with
// 400 on the card/LNURL surface — the Go reference behavior
// (lnurlw_request.go / lnurlw_callback.go: `req.Host != HOST_DOMAIN`).

import { describe, it, expect } from "vitest";
import { withHostPinning, parseAllowedHosts } from "../middleware/withHostPinning.js";
import { handleRequest } from "../index.js";
import { buildCardTestEnv, virtualTap } from "./testHelpers.js";
import { getDeterministicKeys } from "../keygenerator.js";
import type { Env } from "../types/core.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function handler(_request: Request, _env: Env): Response {
  return new Response("LNURL", { status: 200 });
}

function gateRequest(host: string): Request {
  return new Request(`https://${host}/boltcards/api/v1/lnurl/cb/abc?k1=def&amount=1`);
}

describe("parseAllowedHosts", () => {
  it("splits, trims, lowercases and drops empties", () => {
    expect([...parseAllowedHosts(" A.Example , b.org ,, ")].sort()).toEqual(["a.example", "b.org"]);
    expect(parseAllowedHosts(undefined).size).toBe(0);
    expect(parseAllowedHosts("  , ").size).toBe(0);
  });
});

describe("withHostPinning (audit #18 gate)", () => {
  it("default (unset): open — handler runs", async () => {
    const env = buildCardTestEnv({}) as unknown as Env;
    const resp = await withHostPinning(handler)(gateRequest("evil.example") as never, env);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("LNURL");
  });

  it('ALLOWED_HOSTS="" (explicit empty): still open', async () => {
    const env = buildCardTestEnv({ extraEnv: { ALLOWED_HOSTS: "" } as never }) as unknown as Env;
    const resp = await withHostPinning(handler)(gateRequest("evil.example") as never, env);
    expect(resp.status).toBe(200);
  });

  it("ALLOWED_HOSTS set: mismatched host → 400", async () => {
    const env = buildCardTestEnv({ extraEnv: { ALLOWED_HOSTS: "boltcardpoc.psbt.me" } as never }) as unknown as Env;
    const resp = await withHostPinning(handler)(gateRequest("evil.example") as never, env);
    expect(resp.status).toBe(400);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.reason).toContain("Host not allowed");
  });

  it("ALLOWED_HOSTS set: matching host passes (case-insensitive list, host header case ignored)", async () => {
    const env = buildCardTestEnv({ extraEnv: { ALLOWED_HOSTS: " BoltcardPoc.psbt.me , staging.example " } as never }) as unknown as Env;
    const resp = await withHostPinning(handler)(gateRequest("boltcardpoc.psbt.me") as never, env);
    expect(resp.status).toBe(200);
  });

  it("multiple entries: any listed host passes", async () => {
    const env = buildCardTestEnv({ extraEnv: { ALLOWED_HOSTS: "a.example,boltcardpoc.psbt.me" } as never }) as unknown as Env;
    const resp = await withHostPinning(handler)(gateRequest("a.example") as never, env);
    expect(resp.status).toBe(200);
  });

  it("port-bearing host must match the listed spelling", async () => {
    const env = buildCardTestEnv({ extraEnv: { ALLOWED_HOSTS: "boltcardpoc.psbt.me" } as never }) as unknown as Env;
    const resp = await withHostPinning(handler)(gateRequest("boltcardpoc.psbt.me:8443") as never, env);
    expect(resp.status).toBe(400);
  });
});

describe("withHostPinning — wired into the card/LNURL surface (routes/public.ts)", () => {
  function tapUrl(counter: number): string {
    const keys = getDeterministicKeys(UID, { ISSUER_KEY } as unknown as Env, 1);
    const { pHex, cHex } = virtualTap(UID, counter, keys.k1, keys.k2);
    return `/?p=${pHex}&c=${cHex}`;
  }

  it("mismatched Host on the tap entry point (GET /?p&c) → 400 before the withdraw response", async () => {
    const env = buildCardTestEnv({
      uid: UID,
      issuerKey: ISSUER_KEY,
      extraEnv: { ALLOWED_HOSTS: "boltcardpoc.psbt.me" } as never,
    });
    const resp = await handleRequest(new Request(`https://evil.example${tapUrl(2)}`), env as unknown as Env);
    expect(resp.status).toBe(400);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.reason).toContain("Host not allowed");
  });

  it("listed Host: the same tap returns the withdrawRequest (route unaffected)", async () => {
    const env = buildCardTestEnv({
      uid: UID,
      issuerKey: ISSUER_KEY,
      extraEnv: { ALLOWED_HOSTS: "good.example" } as never,
    });
    const resp = await handleRequest(new Request(`https://good.example${tapUrl(3)}`), env as unknown as Env);
    expect(resp.status).toBe(200);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.tag).toBe("withdrawRequest");
  });

  it("mismatched Host on the withdraw callback → 400", async () => {
    const env = buildCardTestEnv({
      uid: UID,
      issuerKey: ISSUER_KEY,
      extraEnv: { ALLOWED_HOSTS: "boltcardpoc.psbt.me" } as never,
    });
    const resp = await handleRequest(
      new Request("https://evil.example/boltcards/api/v1/lnurl/cb/abc?k1=def&amount=500"),
      env as unknown as Env,
    );
    expect(resp.status).toBe(400);
    expect((await resp.json() as Record<string, unknown>).reason).toContain("Host not allowed");
  });

  it("default: no pinning — any Host reaches the handlers (current posture)", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const resp = await handleRequest(new Request(`https://anything.example${tapUrl(4)}`), env as unknown as Env);
    expect(resp.status).toBe(200);
  });
});
