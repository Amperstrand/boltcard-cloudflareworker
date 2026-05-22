# Draft: Closed-Loop Payment Platform (Productized SaaS)

## User's Vision
Turn the existing boltcard cloudflare worker (Lightning-based NFC payment system) into a **multi-tenant SaaS** that lets venue operators (funfairs, concerts, festivals, theme parks) run closed-loop payment systems on top of NFC cards/wristbands. Customers top up with fiat (cash/card), get denominated credits/tokens/loyalty points, spend them at POS terminals across the venue.

The existing Lightning/bolt11 plumbing (`fakewallet` mode) becomes the **internal accounting fabric** — same crypto, same tap-and-go UX, but the unit of account becomes USD/GBP/EUR/credits/tokens/loyalty points instead of sats.

## Current Capabilities (Built So Far)

### Crypto & Card Mechanics
- NFC card tap → encrypted PICCData (`p`) + CMAC (`c`) → decrypt UID + counter, validate CMAC
- Deterministic key derivation from UID + ISSUER_KEY (K0-K4, version-aware)
- Card lifecycle: new → keys_delivered → active → wipe_requested → terminated
- Replay protection via Durable Object (counter must monotonically increase)
- Multi-version key support (cards can be re-keyed without losing identity)
- AES-128, AES-CMAC implemented in pure JS (`aes-js`) — Workers-compatible
- Web NFC reader for browser-based POS (Chrome on Android)

### Storage
- **KV**: per-card config (UID → payment_method, K2, callbacks)
- **Durable Objects** (SQLite-backed): `CardReplayDO` per UID — counter, balance, lifecycle state, version

### Payment Methods (Existing)
- `fakewallet` — internal balance debit, generates fake bolt11 invoices (THIS IS THE PRIMITIVE WE EXTEND)
- `clnrest` — Core Lightning REST
- `proxy` — relay to LNBits
- `lnurlpay` — LNURL-pay flow
- `twofactor` — NFC-based OTP

### Demos Built
- `/identity` — verify card → fake employee profile (NFC access control demo)
- `/pos` — accept fakewallet payment (cash register demo)
- `/login` — NFC login + key recovery
- `/2fa` — OTP via NFC
- `/experimental/activate` — card programming UI
- `/experimental/analytics` — per-card stats
- `/experimental/bulkwipe` — batch operations

### Engineering Foundation
- 287 tests / 20 suites, all green
- Deterministic fallback (cards without DO config still resolve via UID-derived keys)
- Single Cloudflare Worker, itty-router v5
- Production deployed (`b62001eb-...`)

## Gap Analysis: SaaS Requirements vs Current State

### Tenancy (CURRENT: single-tenant)
- All cards live in one global KV namespace + one DO class
- No concept of "venue" or "merchant" or "tenant"
- All operations assume single ISSUER_KEY in env
- **Need**: tenant isolation, per-venue ISSUER_KEY, tenant-scoped routing

### Currency & Denomination (CURRENT: sats-only mental model)
- Balance stored as integer (msat-shaped) but no explicit currency tag
- No concept of credits/tokens/loyalty/fiat
- **Need**: currency-aware balance ledger, multi-denomination per tenant

### Top-Up / Cash-In (CURRENT: none)
- No way to add value to a card except via direct DO mutation in tests
- **Need**: Stripe integration, cash kiosk flow, admin top-up UI, audit trail

### Merchant / POS (CURRENT: single demo POS page)
- One generic `/pos` page, no per-merchant identity
- No POS terminal management, no merchant settlement
- **Need**: merchant accounts, POS terminal registration, real-time settlement

### Refunds & Cash-Out (CURRENT: none)
- Cannot refund a transaction
- Cannot return residual balance to customer
- **Need**: refund flows, cash-out at end-of-event, lost card recovery

### Operator Dashboard (CURRENT: scattered debug pages)
- No unified operator view
- No real-time event monitoring
- **Need**: live event dashboard, balance reports, fraud alerts, reconciliation

### Compliance & Trust (CURRENT: nothing)
- No ToS, no privacy policy
- No KYC for large top-ups
- E-money license considerations not addressed (UK/EU thresholds: ~€150 unspent → potentially regulated; FCA SVF rules)
- No PCI scope analysis (Stripe handles cards but webhook/redirect flow needs review)
- **Need**: full compliance posture for EU/UK/US operation

### Anti-Fraud (CURRENT: replay protection only)
- Counter replay rejected (good)
- No velocity limits, no geo-fencing, no anomaly detection
- No card cloning detection (counter gap analysis)
- **Need**: layered fraud controls, suspicious activity alerts

### Offline Tolerance (CURRENT: online-only)
- Every tap requires hitting the Worker
- Fairgrounds have patchy WiFi
- **Need**: offline POS mode (queue txns, settle later) — HARD problem with double-spend risk

### Audit & Ledger Integrity (CURRENT: best-effort balance updates in DO)
- Balance is mutated in place
- No append-only transaction log
- **Need**: immutable double-entry ledger, event sourcing, exportable audit trail

## Open Product Questions
- (to be filled after exploration + interview)

## Technical Decisions
- (to be filled)

## Scope Boundaries
- **INCLUDE**: full phased roadmap from current state to productized SaaS
- **INCLUDE**: identification of work that requires external vendors (Stripe, fraud, KYC)
- **INCLUDE**: identification of work that requires legal/compliance counsel (NOT a substitute for it)
- **EXCLUDE**: actual legal advice — plan flags compliance milestones, doesn't replace lawyers
- **EXCLUDE**: hardware POS terminal procurement (we'll target web-based POS on Android tablets via Web NFC initially)
