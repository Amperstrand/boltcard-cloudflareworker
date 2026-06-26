import { test, expect, type Page } from "@playwright/test";
import { createProvider } from "./providers/index.js";
import type { TapResult } from "./providers/index.js";
import { operatorLogin } from "./helpers.js";

const provider = createProvider();

async function credentialIssue(page: Page, tap: TapResult, params?: { alg?: string; format?: string }): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let url = "/api/credential?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c);
  if (params?.alg) url += "&alg=" + encodeURIComponent(params.alg);
  if (params?.format) url += "&format=" + encodeURIComponent(params.format);
  return page.evaluate(async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, url);
}

async function credentialVerify(page: Page, credential: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  return page.evaluate(async (credential: string) => {
    const r = await fetch("/api/verify-credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, credential);
}

async function discoverCardWithVC(page: Page, tap: TapResult): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  return page.evaluate(async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, data: await r.json() };
  }, "/?p=" + encodeURIComponent(tap.p) + "&c=" + encodeURIComponent(tap.c));
}

test.describe(`Credential Flows (${provider.name} provider)`, () => {
  test.beforeEach(async ({ page }) => {
    await operatorLogin(page);
    await provider.setup(page);
  });

  // ─── Page Rendering ──────────────────────────────────────────────

  test("credential page renders with issue and verify sections", async ({ page }) => {
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("CREDENTIAL");
    await expect(page.locator("#state-idle")).toBeVisible();
    await expect(page.locator("#verify-input")).toBeVisible();
    await expect(page.locator("#btn-verify-input")).toBeVisible();
  });

  test("credential page has NFC status indicator", async ({ page }) => {
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#nfc-status")).toBeVisible();
  });

  // ─── VC-JWT Issuance (ES256) ─────────────────────────────────────

  test("issue VC-JWT with ES256 and verify it", async ({ page }) => {
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap, { alg: "ES256" });
    expect(issue.ok).toBeTruthy();
    expect(issue.data.credential).toBeTruthy();
    expect(typeof issue.data.credential).toBe("string");
    expect((issue.data.credential as string).split(".")).toHaveLength(3);
    expect(issue.data.alg).toBe("ES256");
    expect(issue.data.issuer).toMatch(/^did:key:z/);

    const verify = await credentialVerify(page, issue.data.credential as string);
    expect(verify.data.valid).toBe(true);
    expect(verify.data.payload).toBeDefined();
  });

  test("issue VC-JWT with EdDSA and verify it", async ({ page }) => {
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap, { alg: "EdDSA" });
    expect(issue.ok).toBeTruthy();
    expect(issue.data.alg).toBe("EdDSA");

    const verify = await credentialVerify(page, issue.data.credential as string);
    expect(verify.data.valid).toBe(true);
  });

  test("VC-JWT contains correct credential subject claims", async ({ page }) => {
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap);
    expect(issue.data.decoded).toBeDefined();
    const decoded = issue.data.decoded as Record<string, unknown>;
    const vc = decoded.vc as Record<string, unknown>;
    const subject = vc.credentialSubject as Record<string, unknown>;
    expect(subject.cardUid).toBeTruthy();
    expect(subject.name).toMatch(/^Operator-/);
    expect(subject.role).toBeTruthy();
    expect(subject.department).toBeTruthy();
    expect(subject.clearance).toMatch(/^Level /);
  });

  test("VC-JWT issuer is consistent across multiple taps", async ({ page }) => {
    const tap1 = await provider.tap(page);
    const issue1 = await credentialIssue(page, tap1);
    const issuer1 = issue1.data.issuer;

    const tap2 = await provider.tap(page);
    const issue2 = await credentialIssue(page, tap2);
    const issuer2 = issue2.data.issuer;

    expect(issuer2).toBe(issuer1);
  });

  // ─── Data Integrity Proof Format ─────────────────────────────────

  test("issue Data Integrity proof and verify it", async ({ page }) => {
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap, { format: "di" });
    expect(issue.ok).toBeTruthy();
    expect(issue.data.format).toBe("di");
    const vc = issue.data.credential as Record<string, unknown>;
    expect(vc.proof).toBeDefined();
    const proof = vc.proof as Record<string, unknown>;
    expect(proof.type).toBe("DataIntegrityProof");
    expect(proof.cryptosuite).toBe("jcs-eddsa-2025");
    expect(proof.proofValue).toBeTruthy();
    expect(proof.verificationMethod).toMatch(/^did:key:z/);

    const verify = await credentialVerify(page, JSON.stringify(vc));
    expect(verify.data.valid).toBe(true);
  });

  // ─── SD-JWT Selective Disclosure ─────────────────────────────────

  test("issue SD-JWT and verify with disclosures", async ({ page }) => {
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap, { format: "sdjwt" });
    expect(issue.ok).toBeTruthy();
    expect(issue.data.format).toBe("sdjwt");
    const sdJwt = issue.data.credential as string;
    expect(sdJwt).toContain("~");

    const verify = await credentialVerify(page, sdJwt);
    expect(verify.data.valid).toBe(true);
    expect(verify.data.disclosures).toBeDefined();
    expect((verify.data.disclosures as unknown[]).length).toBeGreaterThan(0);
  });

  // ─── Verification Failures ───────────────────────────────────────

  test("verify rejects malformed JWT", async ({ page }) => {
    const verify = await credentialVerify(page, "not.a.valid.jwt");
    expect(verify.data.valid).toBe(false);
  });

  test("verify rejects tampered JWT", async ({ page }) => {
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap);
    const jwt = issue.data.credential as string;
    const parts = jwt.split(".");
    const tampered = parts[0] + "." + parts[1]!.slice(0, -1) + "X." + parts[2];
    const verify = await credentialVerify(page, tampered);
    expect(verify.data.valid).toBe(false);
  });

  test("verify rejects empty string", async ({ page }) => {
    const verify = await credentialVerify(page, "");
    expect(verify.data.valid).toBe(false);
  });

  test("verify rejects random string", async ({ page }) => {
    const verify = await credentialVerify(page, "totally-fake-jwt-string");
    expect(verify.data.valid).toBe(false);
  });

  // ─── Issuer Endpoint ─────────────────────────────────────────────

  test("issuer endpoint returns did:key", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const r = await fetch("/api/credential/issuer");
      return await r.json() as { issuer: string };
    });
    expect(result.issuer).toMatch(/^did:key:z/);
  });

  // ─── Card Tap Returns VC in LNURL Response ───────────────────────

  test("card tap LNURL response includes verifiableCredential", async ({ page }) => {
    const tap = await provider.tap(page);
    const disc = await discoverCardWithVC(page, tap);
    expect(disc.ok).toBeTruthy();
    expect(disc.data.tag).toBe("withdrawRequest");
    expect(disc.data.verifiableCredential).toBeTruthy();
    expect(typeof disc.data.verifiableCredential).toBe("string");

    const vc = disc.data.verifiableCredential as string;
    expect(vc.split(".")).toHaveLength(3);

    const verify = await credentialVerify(page, vc);
    expect(verify.data.valid).toBe(true);
  });

  // ─── Credential Page UI Flow ─────────────────────────────────────

  test("credential page: issue → display → verify", async ({ page }) => {
    const tap = await provider.tap(page);
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapCredential(t.p, t.c);
    }, tap);

    await expect(page.locator("#state-issued")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#claim-name")).not.toHaveText("—");
    await expect(page.locator("#vc-jwt-display")).not.toHaveText("—");
    await expect(page.locator("#issuer-did")).toContainText("did:key:z");

    const jwt = await page.locator("#vc-jwt-display").textContent();
    expect(jwt).toBeTruthy();
    expect(jwt!.split(".")).toHaveLength(3);

    await page.locator("#verify-input").fill(jwt!);
    await page.locator("#btn-verify-input").click();
    await expect(page.locator("#verify-status")).toContainText("VALID", { timeout: 5000 });
  });

  test("credential page: algorithm toggle ES256 → EdDSA", async ({ page }) => {
    const tap = await provider.tap(page);
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapCredential(t.p, t.c);
    }, tap);

    await expect(page.locator("#state-issued")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#credential-alg")).toHaveText("ES256");

    await page.locator("#btn-toggle-alg").click();

    await expect(page.locator("#credential-alg")).toHaveText("EdDSA", { timeout: 10000 });
  });

  test("credential page: reset returns to idle state", async ({ page }) => {
    const tap = await provider.tap(page);
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapCredential(t.p, t.c);
    }, tap);

    await expect(page.locator("#state-issued")).toBeVisible({ timeout: 10000 });
    await page.locator("#btn-reset").click();
    await expect(page.locator("#state-idle")).toBeVisible();
  });

  test("credential page: verify section rejects empty input", async ({ page }) => {
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await page.locator("#btn-verify-input").click();
    await expect(page.locator("#verify-result")).toBeHidden();
  });

  test("credential page: copy JWT button visible after issue", async ({ page }) => {
    const tap = await provider.tap(page);
    await page.goto("/credential", { waitUntil: "domcontentloaded" });
    await page.evaluate((t: TapResult) => {
      (window as any)._vcTapCredential(t.p, t.c);
    }, tap);

    await expect(page.locator("#state-issued")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#btn-copy-jwt")).toBeVisible();
  });

  // ─── Cross-Format Consistency ────────────────────────────────────

  test("same card produces consistent issuer across all formats", async ({ page }) => {
    const tap = await provider.tap(page);

    const jwtIssue = await credentialIssue(page, tap);
    expect(jwtIssue.ok).toBeTruthy();

    const diIssue = await credentialIssue(page, tap, { format: "di" });
    expect(diIssue.ok).toBeTruthy();

    const sdIssue = await credentialIssue(page, tap, { format: "sdjwt" });
    expect(sdIssue.ok).toBeTruthy();

    const jwtIssuer = jwtIssue.data.issuer as string;
    expect(jwtIssuer).toMatch(/^did:key:z/);

    const diCredential = diIssue.data.credential as Record<string, unknown> | undefined;
    expect(diCredential).toBeDefined();
    expect(diCredential!.issuer).toBe(jwtIssuer);

    const sdJwt = sdIssue.data.credential as string;
    const sdParts = sdJwt.split("~")[0]!.split(".");
    const sdPayload = JSON.parse(atob(sdParts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(sdPayload.iss).toBe(jwtIssuer);
  });

  test("credential subject cardUid matches card UID", async ({ page }) => {
    const cardInfo = await provider.getCardInfo(page);
    const tap = await provider.tap(page);
    const issue = await credentialIssue(page, tap);
    expect(issue.ok).toBeTruthy();
    const decoded = issue.data.decoded as Record<string, unknown> | undefined;
    expect(decoded).toBeDefined();
    const vc = decoded!.vc as Record<string, unknown>;
    const subject = vc.credentialSubject as Record<string, unknown>;
    expect(subject.cardUid).toBe(cardInfo.uid);
  });
});
