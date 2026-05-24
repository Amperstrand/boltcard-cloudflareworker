import { handleRequest } from "../../index.js";
import { makeReplayNamespace } from "../replayNamespace.js";
import { TEST_OPERATOR_AUTH, virtualTap, buildCardTestEnv } from "../testHelpers.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import type { Env } from "../../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

const worker = (await import("../../index.js")).default;

async function req(path: string, method = "GET", body: Record<string, unknown> | null = null, env: Env, headers: Record<string, string> = {}) {
  const url = "https://boltcardpoc.psbt.me" + path;
  const opts: RequestInit = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return handleRequest(new Request(url, opts), env);
}

function makePageEnv(): Env {
  return {
    BOLT_CARD_K1,
    ISSUER_KEY: "00000000000000000000000000000001",
    CARD_REPLAY: makeReplayNamespace() as unknown as DurableObjectNamespace,
    UID_CONFIG: {
      get: async () => null,
      put: async () => {},
    } as unknown as KVNamespace,
    ...TEST_OPERATOR_AUTH,
  } as Env;
}

describe("E2E: PWA — manifest", () => {
  it("GET /static/manifest.webmanifest returns valid manifest JSON", async () => {
    const env = makePageEnv();
    const resp = await req("/static/manifest.webmanifest", "GET", null, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/manifest+json");
    const json = await resp.json() as Record<string, unknown>;
    expect(json.name).toBe("My Bolt Card");
    expect(json.short_name).toBe("Bolt Card");
    expect(json.start_url).toBe("/card");
    expect(json.display).toBe("standalone");
    expect(json.theme_color).toBe("#10b981");
    expect(json.background_color).toBe("#111827");
    expect(json.orientation).toBe("portrait");
  });

  it("manifest includes SVG icon", async () => {
    const env = makePageEnv();
    const resp = await req("/static/manifest.webmanifest", "GET", null, env);
    const json = await resp.json() as Record<string, unknown>;
    const icons = json.icons as Array<Record<string, string>>;
    expect(icons).toHaveLength(1);
    expect(icons[0]!.src).toBe("/static/icons/bolt.svg");
    expect(icons[0]!.type).toBe("image/svg+xml");
  });

  it("manifest is cacheable", async () => {
    const env = makePageEnv();
    const resp = await req("/static/manifest.webmanifest", "GET", null, env);
    expect(resp.headers.get("Cache-Control")).toContain("max-age=3600");
  });
});

describe("E2E: PWA — service worker", () => {
  it("GET /sw.js returns service worker script", async () => {
    const env = makePageEnv();
    const resp = await req("/sw.js", "GET", null, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(resp.headers.get("Service-Worker-Allowed")).toBe("/");
    const text = await resp.text();
    expect(text).toContain("install");
    expect(text).toContain("activate");
    expect(text).toContain("fetch");
    expect(text).toContain("CACHE_NAME");
  });

  it("service worker is not cached (always revalidate)", async () => {
    const env = makePageEnv();
    const resp = await req("/sw.js", "GET", null, env);
    const cc = resp.headers.get("Cache-Control");
    expect(cc).toContain("max-age=0");
  });

  it("service worker uses deploy-specific cache name", async () => {
    const env = makePageEnv();
    const resp = await req("/sw.js", "GET", null, env);
    const text = await resp.text();
    expect(text).toContain("boltcard-");
    expect(text).toContain("install");
    expect(text).toContain("fetch");
  });

  it("service worker handles /card/info with stale-while-revalidate", async () => {
    const env = makePageEnv();
    const resp = await req("/sw.js", "GET", null, env);
    const text = await resp.text();
    expect(text).toContain("'/card/info'");
    // Should cache and revalidate
    expect(text).toContain("cache.match");
    expect(text).toContain("cache.put");
  });
});

describe("E2E: PWA — icon", () => {
  it("GET /static/icons/bolt.svg returns SVG icon", async () => {
    const env = makePageEnv();
    const resp = await req("/static/icons/bolt.svg", "GET", null, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/svg+xml");
    const svg = await resp.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("#10b981"); // emerald
    expect(svg).toContain("#111827"); // dark bg
  });

  it("icon is cached for 24h", async () => {
    const env = makePageEnv();
    const resp = await req("/static/icons/bolt.svg", "GET", null, env);
    const cc = resp.headers.get("Cache-Control");
    expect(cc).toContain("max-age=86400");
  });
});

describe("E2E: PWA — card dashboard has PWA elements", () => {
  it("page includes manifest link in <head>", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/static/manifest.webmanifest");
  });

  it("page includes theme-color meta", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain('name="theme-color"');
    expect(html).toContain("#10b981");
  });

  it("page includes install banner (hidden)", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain("install-banner");
    expect(html).toContain("btn-install");
  });

  it("page includes offline banner (hidden)", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain("offline-banner");
  });

  it("page includes saved card banner (hidden)", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain("saved-card");
    expect(html).toContain("btn-forget");
    expect(html).toContain("btn-scan-different");
  });

  it("page includes stale data banner (hidden)", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain("stale-banner");
    expect(html).toContain("stale-time");
    expect(html).toContain("btn-refresh-stale");
  });

  it("page loads sw-register.js via staticScript", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain("sw-register.js");
  });

  it("balance display uses larger text", async () => {
    const env = makePageEnv();
    const resp = await req("/card", "GET", null, env);
    const html = await resp.text();
    // The balance element should have text-lg font-bold classes
    expect(html).toContain("card-balance");
    // Find the balance span and verify it has larger text classes
    const balanceMatch = html.match(/id="card-balance"[^>]*class="[^"]*"/);
    expect(balanceMatch).toBeTruthy();
    expect(balanceMatch![0]).toContain("text-lg");
    expect(balanceMatch![0]).toContain("font-bold");
  });

  it("manifest link appears on all pages (not just /card)", async () => {
    const env = makePageEnv();
    const resp = await req("/login", "GET", null, env);
    const html = await resp.text();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
  });
});

describe("E2E: PWA — service worker registration script", () => {
  it("GET /static/js/sw-register.js returns registration code", async () => {
    const env = makePageEnv();
    const resp = await req("/static/js/sw-register.js", "GET", null, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("application/javascript");
    const text = await resp.text();
    expect(text).toContain("serviceWorker");
    expect(text).toContain("register");
    expect(text).toContain("/sw.js");
  });
});

describe("E2E: PWA — security headers on PWA assets", () => {
  it("manifest has security headers", async () => {
    const env = makePageEnv();
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/static/manifest.webmanifest"), env, {} as ExecutionContext);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("service worker has security headers", async () => {
    const env = makePageEnv();
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/sw.js"), env, {} as ExecutionContext);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("icon has security headers", async () => {
    const env = makePageEnv();
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/static/icons/bolt.svg"), env, {} as ExecutionContext);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
