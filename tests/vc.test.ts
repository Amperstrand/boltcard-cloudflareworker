import {
  base64urlEncode,
  base64urlDecode,
  issueVcJwt,
  verifyVcJwt,
  decodeVcJwt,
  getIssuerDid,
  issueDataIntegrityProof,
  verifyDataIntegrityProof,
  issueSdJwt,
  verifySdJwt,
  _resetCachedIssuerKeys,
} from "../utils/vc.js";
import type { Env } from "../types/core.js";
import type { VcAlgorithm } from "../utils/vc.js";

type KvStore = Record<string, string>;

function makeKvEnv(store: KvStore = {}): Env & { __store: KvStore } {
  return {
    UID_CONFIG: {
      get: async (key: string) => store[key] ?? null,
      put: async (key: string, val: string) => { store[key] = val; },
      list: async () => ({ keys: [], list_complete: true, cursor: null }),
    } as unknown as KVNamespace,
    __store: store,
  } as Env & { __store: KvStore };
}

const SAMPLE_UID = "04a39493cc8680";
const SAMPLE_PROFILE = { name: "Operator-04A3", role: "Administrator", dept: "Engineering", level: "Level 3" };
const ALGORITHMS: VcAlgorithm[] = ["ES256", "EdDSA"];

describe("base64urlEncode / base64urlDecode", () => {
  it("roundtrips arbitrary bytes", () => {
    const input = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
    const encoded = base64urlEncode(input);
    const decoded = base64urlDecode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(input));
  });

  it("produces URL-safe output", () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const encoded = base64urlEncode(input);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("roundtrips empty array", () => {
    const encoded = base64urlEncode(new Uint8Array());
    expect(encoded).toBe("");
    expect(base64urlDecode(encoded).length).toBe(0);
  });

  it("decodes standard base64url without padding", () => {
    expect(new TextDecoder().decode(base64urlDecode("aGVsbG8"))).toBe("hello");
  });
});

describe.each(ALGORITHMS)("getIssuerDid [%s]", (alg) => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("returns a did:key string", async () => {
    const env = makeKvEnv();
    const did = await getIssuerDid(env);
    expect(did).toMatch(/^did:key:z/);
  });

  it("persists keys to KV on first call", async () => {
    const env = makeKvEnv();
    await getIssuerDid(env);
    expect(env.__store["vc_issuer_keys"]).toBeDefined();
    const stored = JSON.parse(env.__store["vc_issuer_keys"]!);
    expect(stored.privateRaw).toBeInstanceOf(Array);
    expect(stored.publicRaw).toBeInstanceOf(Array);
  });

  it("returns the same did:key loading from KV on fresh env", async () => {
    const store: KvStore = {};
    const did1 = await getIssuerDid(makeKvEnv(store));
    _resetCachedIssuerKeys();
    const did2 = await getIssuerDid(makeKvEnv(store));
    expect(did2).toBe(did1);
  });
});

describe.each(ALGORITHMS)("issueVcJwt [%s]", (alg) => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("produces a 3-part JWT", async () => {
    const jwt = await issueVcJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it(`encodes ${alg} algorithm in header`, async () => {
    const jwt = await issueVcJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(jwt.split(".")[0]!)));
    expect(header.alg).toBe(alg);
    expect(header.typ).toBe("JWT");
  });

  it("includes correct VC payload structure", async () => {
    const jwt = await issueVcJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const decoded = decodeVcJwt(jwt);
    expect(decoded).not.toBeNull();
    expect(decoded!.payload.sub).toBe("boltcard:" + SAMPLE_UID);
    expect(decoded!.payload.iss).toMatch(/^did:key:z/);
    expect(decoded!.payload.vc["@context"]).toContain("https://www.w3.org/ns/credentials/v2");
    expect(decoded!.payload.vc.type).toContain("VerifiableCredential");
    expect(decoded!.payload.vc.type).toContain("BoltcardAccessBadge");
    expect(decoded!.payload.vc.credentialSubject.cardUid).toBe(SAMPLE_UID);
    expect(decoded!.payload.vc.credentialSubject.name).toBe(SAMPLE_PROFILE.name);
  });

  it("sets iat and exp with 1-hour TTL", async () => {
    const jwt = await issueVcJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const decoded = decodeVcJwt(jwt)!;
    expect(decoded.payload.exp - decoded.payload.iat).toBe(3600);
  });
});

describe.each(ALGORITHMS)("verifyVcJwt [%s]", (alg) => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("verifies a freshly issued JWT", async () => {
    const env = makeKvEnv();
    const jwt = await issueVcJwt(env, SAMPLE_UID, SAMPLE_PROFILE, alg);
    const result = await verifyVcJwt(env, jwt);
    expect(result.valid).toBe(true);
    expect(result.payload!.sub).toBe("boltcard:" + SAMPLE_UID);
  });

  it("rejects malformed JWT", async () => {
    const result = await verifyVcJwt(makeKvEnv(), "not.a.valid.jwt");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed");
  });

  it("rejects tampered payload", async () => {
    const env = makeKvEnv();
    const jwt = await issueVcJwt(env, SAMPLE_UID, SAMPLE_PROFILE, alg);
    const parts = jwt.split(".");
    const tamperedPayload = parts[1]!.slice(0, -1) + (parts[1]!.slice(-1) === "A" ? "B" : "A");
    const result = await verifyVcJwt(env, parts[0] + "." + tamperedPayload + "." + parts[2]);
    expect(result.valid).toBe(false);
  });

  it("rejects tampered signature", async () => {
    const env = makeKvEnv();
    const jwt = await issueVcJwt(env, SAMPLE_UID, SAMPLE_PROFILE, alg);
    const parts = jwt.split(".");
    const sig = parts[2]!;
    // Flip first character — last char may be base64url padding bits only
    const flipChar = sig[0] === "A" ? "B" : "A";
    const tamperedSig = flipChar + sig.slice(1);
    const result = await verifyVcJwt(env, parts[0] + "." + parts[1] + "." + tamperedSig);
    expect(result.valid).toBe(false);
  });

  it("rejects unsupported algorithm", async () => {
    const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "HS256" })));
    const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({ iss: "x", sub: "x", iat: 1, exp: 9999999999, vc: {} })));
    const sig = base64urlEncode(new Uint8Array(64));
    const result = await verifyVcJwt(makeKvEnv(), header + "." + payload + "." + sig);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("algorithm");
  });

  it("rejects expired credential", async () => {
    const env = makeKvEnv();
    const jwt = await issueVcJwt(env, SAMPLE_UID, SAMPLE_PROFILE, alg);
    const decoded = decodeVcJwt(jwt)!;
    const expiredPayload = {
      ...decoded.payload,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const headerB64 = jwt.split(".")[0]!;
    const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(expiredPayload)));
    const sigB64 = jwt.split(".")[2]!;
    const result = await verifyVcJwt(env, headerB64 + "." + payloadB64 + "." + sigB64);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });
});

describe("decodeVcJwt", () => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("decodes a valid JWT", async () => {
    const jwt = await issueVcJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE);
    const decoded = decodeVcJwt(jwt);
    expect(decoded).not.toBeNull();
    expect(decoded!.payload.sub).toBe("boltcard:" + SAMPLE_UID);
  });

  it("returns null for malformed JWT", () => {
    expect(decodeVcJwt("not-a-jwt")).toBeNull();
    expect(decodeVcJwt("only.two")).toBeNull();
    expect(decodeVcJwt("")).toBeNull();
  });
});

describe("cross-algorithm issue + verify", () => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("issues and verifies for multiple UIDs across both algorithms", async () => {
    const uids = ["04a39493cc8680", "ff000000000001", "1234567890abcd"];
    for (const alg of ALGORITHMS) {
      const store: KvStore = {};
      for (const uid of uids) {
        _resetCachedIssuerKeys();
        const profile = { name: "Op-" + uid.slice(0, 4), role: "Specialist", dept: "Security", level: "Level 2" };
        const env = makeKvEnv(store);
        const jwt = await issueVcJwt(env, uid, profile, alg);
        _resetCachedIssuerKeys();
        const result = await verifyVcJwt(makeKvEnv(store), jwt);
        expect(result.valid).toBe(true);
        expect(result.payload!.vc.credentialSubject.cardUid).toBe(uid);
      }
    }
  });

  it("produces different JWTs for ES256 vs EdDSA for same UID", async () => {
    const uid = "04a39493cc8680";
    _resetCachedIssuerKeys();
    const jwtEs = await issueVcJwt(makeKvEnv(), uid, SAMPLE_PROFILE, "ES256");
    _resetCachedIssuerKeys();
    const jwtEd = await issueVcJwt(makeKvEnv(), uid, SAMPLE_PROFILE, "EdDSA");
    expect(jwtEs).not.toBe(jwtEd);
    const headerEs = JSON.parse(new TextDecoder().decode(base64urlDecode(jwtEs.split(".")[0]!)));
    const headerEd = JSON.parse(new TextDecoder().decode(base64urlDecode(jwtEd.split(".")[0]!)));
    expect(headerEs.alg).toBe("ES256");
    expect(headerEd.alg).toBe("EdDSA");
  });
});

describe("Data Integrity Proof (JCS + Ed25519)", () => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("issues a VC with proof block", async () => {
    const vc = await issueDataIntegrityProof(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE);
    expect(vc.proof).toBeDefined();
    expect(vc.proof.type).toBe("DataIntegrityProof");
    expect(vc.proof.cryptosuite).toBe("jcs-eddsa-2025");
    expect(vc.proof.proofValue).toBeTruthy();
    expect(vc.proof.verificationMethod).toMatch(/^did:key:z/);
    expect(vc.proof.proofPurpose).toBe("assertionMethod");
  });

  it("includes correct credential payload", async () => {
    const vc = await issueDataIntegrityProof(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE);
    expect(vc["@context"]).toContain("https://www.w3.org/ns/credentials/v2");
    expect(vc.type).toContain("VerifiableCredential");
    expect(vc.type).toContain("BoltcardAccessBadge");
    expect(vc.credentialSubject.cardUid).toBe(SAMPLE_UID);
    expect(vc.credentialSubject.name).toBe(SAMPLE_PROFILE.name);
    expect(vc.issuer).toMatch(/^did:key:z/);
  });

  it("verifies a freshly issued VC", async () => {
    const store: KvStore = {};
    const env = makeKvEnv(store);
    const vc = await issueDataIntegrityProof(env, SAMPLE_UID, SAMPLE_PROFILE);
    _resetCachedIssuerKeys();
    const result = await verifyDataIntegrityProof(makeKvEnv(store), vc);
    expect(result.valid).toBe(true);
  });

  it("rejects tampered credential subject", async () => {
    const store: KvStore = {};
    const vc = await issueDataIntegrityProof(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE);
    _resetCachedIssuerKeys();
    const tampered = { ...vc, credentialSubject: { ...vc.credentialSubject, name: "Hacker" } };
    const result = await verifyDataIntegrityProof(makeKvEnv(store), tampered);
    expect(result.valid).toBe(false);
  });

  it("rejects tampered proof value", async () => {
    const store: KvStore = {};
    const vc = await issueDataIntegrityProof(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE);
    _resetCachedIssuerKeys();
    const tampered = {
      ...vc,
      proof: {
        ...vc.proof,
        proofValue: vc.proof.proofValue.slice(0, -2) + "AA",
      },
    };
    const result = await verifyDataIntegrityProof(makeKvEnv(store), tampered as typeof vc);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong proof cryptosuite", async () => {
    const store: KvStore = {};
    const vc = await issueDataIntegrityProof(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE);
    _resetCachedIssuerKeys();
    const wrongSuite = { ...vc, proof: { ...vc.proof, cryptosuite: "eddsa-2022" as "jcs-eddsa-2025" } };
    const result = await verifyDataIntegrityProof(makeKvEnv(store), wrongSuite);
    expect(result.valid).toBe(false);
  });

  it("works for multiple different UIDs", async () => {
    const store: KvStore = {};
    const uids = ["04a39493cc8680", "ff000000000001", "1234567890abcd"];
    for (const uid of uids) {
      _resetCachedIssuerKeys();
      const vc = await issueDataIntegrityProof(makeKvEnv(store), uid, SAMPLE_PROFILE);
      _resetCachedIssuerKeys();
      const result = await verifyDataIntegrityProof(makeKvEnv(store), vc);
      expect(result.valid).toBe(true);
      expect(vc.credentialSubject.cardUid).toBe(uid);
    }
  });
});

describe.each(ALGORITHMS)("SD-JWT [%s]", (alg) => {
  beforeEach(() => _resetCachedIssuerKeys());

  it("produces an SD-JWT with ~ separator", async () => {
    const sdJwt = await issueSdJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    expect(sdJwt).toContain("~");
    const parts = sdJwt.split("~");
    expect(parts.length).toBe(5); // jwt + 4 disclosures
    expect(parts[0]!.split(".")).toHaveLength(3); // JWT part has 3 segments
  });

  it("JWT payload contains _sd array with 4 hashes", async () => {
    const sdJwt = await issueSdJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const jwtPart = sdJwt.split("~")[0]!;
    const decoded = decodeVcJwt(jwtPart)!;
    const cs = decoded.payload.vc.credentialSubject as unknown as Record<string, unknown>;
    expect(Array.isArray(cs._sd)).toBe(true);
    expect((cs._sd as unknown[]).length).toBe(4);
    expect(cs._sd_alg).toBe("sha-256");
  });

  it("cardUid is always visible (not selectively disclosed)", async () => {
    const sdJwt = await issueSdJwt(makeKvEnv(), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const jwtPart = sdJwt.split("~")[0]!;
    const decoded = decodeVcJwt(jwtPart)!;
    expect(decoded.payload.vc.credentialSubject.cardUid).toBe(SAMPLE_UID);
  });

  it("verifies a freshly issued SD-JWT", async () => {
    const store: KvStore = {};
    const sdJwt = await issueSdJwt(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE, alg);
    _resetCachedIssuerKeys();
    const result = await verifySdJwt(makeKvEnv(store), sdJwt);
    expect(result.valid).toBe(true);
  });

  it("returns decoded disclosures on verification", async () => {
    const store: KvStore = {};
    const sdJwt = await issueSdJwt(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE, alg);
    _resetCachedIssuerKeys();
    const result = await verifySdJwt(makeKvEnv(store), sdJwt);
    expect(result.disclosures).toBeDefined();
    expect(result.disclosures!.length).toBe(4);
    const claimNames = result.disclosures!.map((d) => d.claimName).sort();
    expect(claimNames).toEqual(["clearance", "department", "name", "role"]);
  });

  it("rejects if a disclosure is tampered", async () => {
    const store: KvStore = {};
    const sdJwt = await issueSdJwt(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const parts = sdJwt.split("~");
    // Tamper with first disclosure (change last char)
    const tamperedDisclosure = parts[1]!.slice(0, -1) + (parts[1]!.slice(-1) === "A" ? "B" : "A");
    const tamperedSdJwt = parts[0] + "~" + tamperedDisclosure + "~" + parts.slice(2).join("~");
    _resetCachedIssuerKeys();
    const result = await verifySdJwt(makeKvEnv(store), tamperedSdJwt);
    expect(result.valid).toBe(false);
  });

  it("rejects if an extra bogus disclosure is appended", async () => {
    const store: KvStore = {};
    const sdJwt = await issueSdJwt(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE, alg);
    const bogusDisclosure = base64urlEncode(new TextEncoder().encode(JSON.stringify(["fakesalt", "bogus", "value"])));
    _resetCachedIssuerKeys();
    const result = await verifySdJwt(makeKvEnv(store), sdJwt + "~" + bogusDisclosure);
    expect(result.valid).toBe(false);
  });

  it("rejects plain JWT without ~ separator", async () => {
    const store: KvStore = {};
    const jwt = await issueVcJwt(makeKvEnv(store), SAMPLE_UID, SAMPLE_PROFILE, alg);
    _resetCachedIssuerKeys();
    const result = await verifySdJwt(makeKvEnv(store), jwt);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("~");
  });
});
