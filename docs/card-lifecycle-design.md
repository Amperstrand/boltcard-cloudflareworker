# Card Lifecycle Design — Key Versioning & Activation

> Status: **DRAFT — pending user decision**
> Date: 2026-04-19
> Affects: `keygenerator.js`, `durableObjects/CardReplayDO.js`, `replayProtection.js`, `handlers/fetchBoltCardKeys.js`, `handlers/resetHandler.js`, `getUidConfig.js`, UI pages

---

## Table of Contents

1. [Two "Version" Concepts](#1-two-version-concepts)
2. [Current State](#2-current-state)
3. [Proposed Lifecycle](#3-proposed-lifecycle)
4. [Data Model](#4-data-model)
5. [Version Detection on First Tap](#5-version-detection-on-first-tap)
6. [API Changes](#6-api-changes)
7. [UI Changes](#7-ui-changes)
8. [Research: What Others Do](#8-research-what-others-do)
9. [Open Questions](#9-open-questions)
10. [Recommendation](#10-recommendation)

---

## 1. Two "Version" Concepts

There are **two completely independent** "version" concepts in NTAG 424 DNA systems. They must not be confused.

### 1.1 Hardware Key Version (on the chip)

| Property | Value |
|----------|-------|
| **Size** | 1 byte (0x00–0xFF) |
| **Storage** | Per-key slot on the NTAG 424 DNA chip |
| **Set by** | `ChangeKey` command (part of card personalization) |
| **Read by** | `GetKeyVersion` command |
| **Purpose** | Lets the chip distinguish which key version is loaded |
| **Used in crypto?** | **No** — not part of PICCData, not part of SUN CMAC calculation |
| **Who uses it** | NFC programmer app checks `getKeyVersion('01')` — if != 0x00, card is already programmed |

The hardware key version is a per-slot attribute. The boltcard NFC programmer app (`boltcard/bolt-nfc-android-app`) checks it to detect blank vs. programmed cards:

```javascript
// SetupBoltcard.js line 98-100
const key1Version = await Ntag424.getKeyVersion('01');
if (key1Version != '00')
  throw new Error('TRY AGAIN AFTER RESETING YOUR CARD!');
```

**We do not currently set or read this value.**

### 1.2 Application-Level Version (server-side)

| Property | Value |
|----------|-------|
| **Size** | 4 bytes, little-endian unsigned integer (uint32) |
| **Storage** | Server-side database only — NOT on the card |
| **Defined by** | boltcard DETERMINISTIC.md spec |
| **Used in** | Key derivation: `CardKey = CMAC(IssuerKey, "2d003f75" || UID || version_le32)` |
| **Effect** | Different version → different K0/K2/K3/K4. K1 stays the same. |
| **Max value** | 4,294,967,295 (~4.3 billion reprogrammings) |

This is the `version` parameter in our `deriveKeysFromHex(uid, issuerKey, version=1)`. Currently hardcoded to `1` everywhere.

**This is what we want to make dynamic.**

### Why the Distinction Matters

```
deriveKeysFromHex("04996c6a926980", issuerKey, version=1) → K2 = "B457..."
deriveKeysFromHex("04996c6a926980", issuerKey, version=2) → K2 = "XXXX..."  ← completely different
deriveKeysFromHex("04996c6a926980", issuerKey, version=1) → K1 = "55DA..."  ← same regardless of version
```

K1 is derived from `IssuerKey` directly (`CMAC(IssuerKey, "2d003f77")`), NOT from CardKey. So when the version changes:
- ✅ We can always decrypt the `p` parameter (K1 never changes)
- ✅ We can always extract the UID from any card, regardless of version
- ⚠️ We MUST know the version to derive the correct K2 for CMAC validation

### Key Derivation Diagram (with version)

```
IssuerKey
├── CardKey = CMAC(IssuerKey, "2d003f75" || UID || version_le32)  ← version HERE
│   ├── K0 = CMAC(CardKey, "2d003f76")  ← changes with version
│   ├── K2 = CMAC(CardKey, "2d003f78")  ← changes with version
│   ├── K3 = CMAC(CardKey, "2d003f79")  ← changes with version
│   └── K4 = CMAC(CardKey, "2d003f7a")  ← changes with version
├── K1 = CMAC(IssuerKey, "2d003f77")    ← always same (version-independent)
└── ID = CMAC(IssuerKey, "2d003f7b" || UID)  ← always same (version-independent)
```

---

## 2. Current State

### What We Have Now

- **Version hardcoded to 1** in all callers:
  - `getDeterministicKeys(uid, env)` → `deriveKeysFromHex(uid, issuerKey, 1)`
  - `generateKeyResponse(uid, env, baseUrl, cardType)` → `getDeterministicKeys(uid, env, 1)`
- **No card state tracking** — any UID can get keys at any time
- **No single-use enforcement** — write keys can be retrieved unlimited times
- **No activation detection** — we don't know if a card was actually written
- **Wipe = write** — same keys, same endpoint, same version

### What's Missing

| Gap | Risk |
|-----|------|
| No version tracking | Can't rotate keys per card |
| No single-use write | Someone could pre-fetch keys and counterfeit cards |
| No activation state | Don't know which cards are actually in circulation |
| No version in response | NFC programmer can't report which keyset was written |
| No version in UI | Can't see card lifecycle status |

---

## 3. Proposed Lifecycle

### 3.1 Card States

```
                    ┌─────────┐
                    │   new   │  ← UID never seen, DO doesn't exist
                    └────┬────┘
                         │ Write keys requested (POST /boltcards)
                         │ version increments (1 → N)
                         │ single-use: keys delivered once
                         ▼
                    ┌──────────────┐
              ┌─────│keys_delivered│
              │     └──────┬───────┘
              │            │ Card taps server (GET /?p=...&c=...)
              │            │ Brute-force version scan detects active version
              │            ▼
              │     ┌────────┐
              │     │ active │  ← card confirmed via successful tap
              │     └───┬────┘
              │         │ Wipe keys requested (GET /wipe?uid=...)
              │         │ Wipe keys unlimited, always for active_version
              │         ▼
              │     ┌───────────┐
              └─────│terminated │──┐
                    └───────────┘  │
                         ▲         │ Re-activate: POST /boltcards again
                         │         │ version increments (N → N+1)
                         └─────────┘
```

### 3.2 Version Tracking: Two Counters

| Field | Type | Purpose |
|-------|------|---------|
| `latest_issued_version` | uint32 | Most recent version for which write keys were given out. Only increments on write. |
| `active_version` | uint32 or null | Version detected on the physical card via CMAC brute-force. Only set on first successful tap after write. Used for wipe key derivation. |

**Why both?**

- `latest_issued_version` tracks what we've handed out (write side)
- `active_version` tracks what's on the physical card (tap side)
- They're usually the same, but can differ if:
  - Card was never written after keys were delivered → `active_version` is null or stale
  - Card has old keys from a previous version → `active_version` < `latest_issued_version`

### 3.3 Flow Details

#### Write (single-use, increments version)

1. Programmer POSTs UID to `/api/v1/pull-payments/{id}/boltcards`
2. Server creates/gets DO for UID
3. Server increments `latest_issued_version` (new card → 1, re-activation → N+1)
4. Server derives K0-K4 with `latest_issued_version`
5. Server stores `latest_issued_version` in DO, sets state = `keys_delivered`
6. Server returns keys + `Version` field to programmer
7. **Keys can NOT be re-fetched for the same version** (single-use)

#### Activation (first tap after write)

1. Card taps, sends `p` and `c` parameters
2. Server decrypts `p` with K1 (version-independent) → gets UID
3. Server gets DO, finds state = `keys_delivered`, `latest_issued_version = N`
4. Server brute-force scans: derive K2 for version N, N-1, N-2... until CMAC validates
5. Once found: store `active_version` in DO, set state = `active`
6. Normal tap processing continues

#### Wipe (unlimited, uses active_version)

1. User requests wipe for UID (`/wipe?uid=...`)
2. Server gets DO, checks state is `active` (or `terminated` for re-wipe)
3. Server derives K0-K4 with `active_version` (NOT `latest_issued_version`)
4. Server sets state = `terminated`
5. Returns wipe keys
6. Can be called unlimited times — always returns same keys for `active_version`

#### Re-activation

1. After termination, programmer requests write keys again
2. `latest_issued_version` increments (N → N+1)
3. Goes through write → activation flow as above

---

## 4. Data Model

### DO Schema Changes (CardReplayDO)

Current tables: `replay_state`, `taps`

New table: `card_state`

```sql
CREATE TABLE IF NOT EXISTS card_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  state TEXT NOT NULL DEFAULT 'new',
  latest_issued_version INTEGER NOT NULL DEFAULT 0,
  active_version INTEGER,
  activated_at INTEGER,
  terminated_at INTEGER,
  keys_delivered_at INTEGER
);
```

| Column | Type | Description |
|--------|------|-------------|
| `state` | TEXT | One of: `new`, `keys_delivered`, `active`, `terminated` |
| `latest_issued_version` | INTEGER | Last version for which write keys were given out |
| `active_version` | INTEGER or NULL | Version detected on physical card. NULL until first successful tap. |
| `activated_at` | INTEGER | Unix timestamp of first successful tap |
| `terminated_at` | INTEGER | Unix timestamp of last termination |
| `keys_delivered_at` | INTEGER | Unix timestamp of last key delivery |

### New DO Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/card-state` | GET | Returns current state, versions, timestamps |
| `/deliver-keys` | POST | Increments `latest_issued_version`, sets state to `keys_delivered` |
| `/activate` | POST | Sets `active_version`, state to `active` |
| `/terminate` | POST | Sets state to `terminated` |

---

## 5. Version Detection on First Tap

When a card with state = `keys_delivered` taps for the first time, we don't know which version is on the physical card. We brute-force scan:

```javascript
async function detectActiveVersion(uid, pHex, cHex, env, doState) {
  // Start from most recently issued, scan backwards
  const startVersion = doState.latest_issued_version;
  const minVersion = Math.max(1, startVersion - 10); // cap scan depth at 10

  const uidBytes = hexToBytes(uid);
  const ctrBytes = hexToBytes(extractUIDAndCounter(pHex, env).ctr);

  for (let v = startVersion; v >= minVersion; v--) {
    const keys = await getDeterministicKeys(uid, env, v);
    const k2Bytes = hexToBytes(keys.k2);
    const result = validate_cmac(uidBytes, ctrBytes, cHex, k2Bytes);
    if (result.cmac_validated) {
      return v; // Found the version on the card
    }
  }

  return null; // No version matched — card may have different IssuerKey
}
```

**Scan depth**: Start from `latest_issued_version`, scan back up to 10 versions. In practice, it will almost always be the most recent version. The cap prevents DoS via excessive computation.

---

## 6. API Changes

### 6.1 Write Response (NEW_BOLT_CARD_RESPONSE)

Add `Version` field (matching BTCPayServer's `RegisterBoltcardResponse`):

```json
{
  "CARD_NAME": "UID 04996C6A926980",
  "ID": "1",
  "Version": 3,
  "K0": "...",
  "K1": "...",
  "K2": "...",
  "K3": "...",
  "K4": "...",
  "LNURLW_BASE": "lnurlw://boltcardpoc.psbt.me/",
  "LNURLW": "lnurlw://boltcardpoc.psbt.me/",
  "PROTOCOL_NAME": "NEW_BOLT_CARD_RESPONSE",
  "PROTOCOL_VERSION": "1"
}
```

### 6.2 Write Endpoint — Single-Use Enforcement

```
POST /api/v1/pull-payments/{id}/boltcards

Before:
  - Always returns keys, no state check

After:
  - Get DO state
  - If state = 'active': reject (card is live — terminate first)
  - If state = 'keys_delivered': reject (keys already given out)
  - If state = 'new' or 'terminated': increment version, deliver keys, set state = 'keys_delivered'
```

Wait — re-evaluating. The user's latest guidance was:

> "only allow once and always increment the counter"
> "then only if a tap comes in from a card do we activate the card"
> "at that point it becomes possible to ask for the wipe keys"

This means:
- Write keys → single-use, always increments version
- After first tap → card becomes `active`, wipe keys become available
- Wipe keys → unlimited, always for the `active_version`

### 6.3 Wipe Endpoint — Requires Active Card

```
GET /wipe?uid=...

Before:
  - Always returns keys derived from version=1

After:
  - Get DO state
  - If state != 'active' and state != 'terminated': reject
  - Derive keys with active_version (not latest_issued_version)
  - Set state = 'terminated'
  - Return keys
```

---

## 7. UI Changes

### 7.1 Login Page (`/login`)

Currently shows tap history. Add:
- Card status badge: `NEW` / `KEYS DELIVERED` / `ACTIVE` / `TERMINATED`
- Key version: `Version 3`
- Activation timestamp: `Activated 2026-04-19 14:30`
- If `keys_delivered`: show "Awaiting first tap" message

### 7.2 Analytics Page (`/analytics`)

Add per-card:
- Key version column
- Card state
- Last activated / terminated timestamps

### 7.3 Wipe Page (`/wipe`)

Add:
- Current card state and version
- If card is not `active`: explain why wipe isn't available
- If `terminated`: show "Card already terminated" with option to re-activate

---

## 8. Research: What Others Do

### BTCPayServer

- Returns `Version` (int) in `RegisterBoltcardResponse`
- Stores `BoltcardRegistration(UID, Version, Counter)` in database
- `OnExistingBehavior.UpdateVersion` → increments version on re-programming
- `OnExistingBehavior.KeepVersion` → same version (for wipe/reset)
- Version is derived from database, NOT from the card
- NFC programmer app ignores the `Version` field (only uses K0-K4, LNURLW)

Source: `BTCPayServer.Client/Models/RegisterBoltcardRequest.cs`, `GreenfieldPullPaymentController.cs`, `BoltcardDataExtensions.cs`

### LNBits

- Returns `PROTOCOL_VERSION: "1"` (hardcoded string) — this is protocol version, not key version
- K3 = K1, K4 = K2 (deviation from deterministic spec)
- No key versioning — no version stored, no version tracking
- Cards have `card_name`, `uid`, `k0`-`k4` in database, but no version column

Source: `lnbits/boltcards/views_lnurl.py`

### boltcard NFC Programmer App

- Only extracts K0-K4 and LNURLW from API response
- Does NOT read or use `Version` field
- Checks hardware key version via `Ntag424.getKeyVersion('01')` to detect blank vs. programmed card
- Does NOT set hardware key version during programming

Source: `boltcard/bolt-nfc-android-app/src/components/SetupBoltcard.js`

### boltcard DETERMINISTIC.md Spec

- Defines version as "4-bytes little endian version number"
- "This must be incremented every time the user re-programs (reset/setup) the same BoltCard on the same LNUrl Withdraw Service"
- Version is used in CardKey derivation only
- No guidance on lifecycle management (activation, termination)

Source: `boltcard/boltcard/blob/master/docs/DETERMINISTIC.md`

---

## 9. Open Questions

### Q1: Should we set the hardware key version when writing?

The hardware key version (1 byte, per key slot) could be set to match our application version (mod 256). This would let the chip itself reject old key versions.

**Current consensus**: Skip for now. No boltcard implementation uses it. The NFC programmer app only checks blank/non-blank (0x00 vs. anything else). We can add it later.

### Q2: Should we fall back to brute-force scan on every CMAC failure?

If a card that was `active` at version 3 starts failing CMAC, should we scan for version 2, 1?

**Recommendation**: No. Once `active_version` is set, only validate with that version. If CMAC fails, it means the card was tampered with or has a different IssuerKey. Don't auto-downgrade.

### Q3: What happens to taps during `keys_delivered` state?

If someone taps a card that hasn't been activated yet (e.g., old card with version 2 keys, but we just issued version 3):

**Recommendation**: During `keys_delivered`, try version scan (N down to N-10). If match found, activate with that version. If not, reject with clear error.

### Q4: Should `terminated` state reset the DO counter and taps?

**Current behavior**: `/wipe` calls `resetReplayProtection()` which clears taps and counter. This makes sense for wipe — the card is being decommissioned.

**Recommendation**: Yes, keep this. On termination, reset counter and taps. Fresh start on re-activation.

---

## 10. Recommendation

### What I recommend implementing

**Adopt the lifecycle model with these specifics:**

1. **4 states**: `new` → `keys_delivered` → `active` → `terminated`
2. **Single-use write**: Write keys can only be retrieved once per activation cycle. Always increments `latest_issued_version`.
3. **First-tap activation**: Brute-force version scan (up to 10 versions back) on first tap after write. Sets `active_version`.
4. **Unlimited wipe**: After activation, wipe keys can be retrieved unlimited times. Uses `active_version`.
5. **Version in response**: Add `Version` field to `NEW_BOLT_CARD_RESPONSE` (matches BTCPayServer).
6. **DO as source of truth**: All state and version stored in `card_state` table in CardReplayDO.
7. **UI updates**: Show state, version, timestamps in `/login` and `/analytics`.

### What I recommend skipping for now

- **Hardware key version**: Don't set it. No one uses it. Add later if needed.
- **CMAC failure fallback**: Don't auto-scan on every failure. Only scan during `keys_delivered` → `active` transition.
- **Stale key delivery cleanup**: No auto-timeout for `keys_delivered` state. If keys are delivered but card is never tapped, the user can wipe (terminate) through the wipe page and re-activate.

### Implementation order

1. Add `card_state` table to DO
2. Add new DO endpoints (`/card-state`, `/deliver-keys`, `/activate`, `/terminate`)
3. Modify `fetchBoltCardKeys` to enforce single-use + increment version
4. Modify `handleLnurlw` to do version scan on first tap
5. Modify `handleReset` to check card state and use `active_version`
6. Add `Version` to `buildBoltCardResponse`
7. Update `getUidConfig` to accept/use version parameter
8. Update UI pages (login, analytics, wipe) to show state and version
9. Update existing tests + add lifecycle tests
10. Update e2e tests for version-aware flows
