# Plan: Event-Ready Lite

## Goal

Transform the boltcard system from a Lightning payment demo into a deployable closed-loop payment system for festivals, funfairs, and small venues. Cash top-up at a desk, tap-to-pay at stalls, cash-back for residual balance at end of event. One Cloudflare Worker deployment per venue.

## Scope (Event-Ready Lite)

- Operator auth (shared PIN + session cookie)
- Currency label config (configurable denomination per deployment)
- Top-up desk (cash-in → credit balance)
- POS refit (direct debit, free-amount + menu modes)
- Refund / cash-out desk
- Keyboard-wedge NFC reader support for desktops

## Non-Goals

- Multi-tenant SaaS
- Stripe / real fiat rails
- KYC / AML / e-money compliance
- Offline POS
- Multi-currency per deployment
- Per-operator accounts (shared PIN only)
- Real-time dashboard
- Shift reconciliation report UI
- Factory card provisioning pipeline
- Lost-card automated balance transfer
- Thermal printer integration

## Decisions Locked In

| Decision | Choice |
|---|---|
| Deployment model | One Worker deploy per venue |
| Operator auth | Shared PIN + session cookie (12h expiry) |
| Top-up method | Cash-only, operator enters amount |
| POS modes | Free-amount + menu, configurable per terminal |
| Refund | Operator refunds any amount on demand |
| Hardware | Web NFC (Android) + keyboard-wedge USB readers (desktop) |
| Currency | Configurable via `CURRENCY_LABEL` env var, default "credits" |
| POS route | `/operator/pos` (301 from `/pos`) |
| Customer login | `/recover` (301 from `/login`) |
| Menu editor | Inline table UI |
| Top-up cap | Optional `MAX_TOPUP_AMOUNT` env var |
| PIN min length | 4 characters |

## Phases

### Phase 0 — Foundations

**0.1 Currency label config**
- [ ] Add `CURRENCY_LABEL` (default `"credits"`) + `CURRENCY_DECIMALS` (default `0`) env vars to `wrangler.toml`
- [ ] Create `utils/currency.js` with `formatAmount(raw, env)` and `parseAmount(input, env)`
- [ ] Add `tests/currency.test.js`
- [ ] Commit: `feat: add currency label config for closed-loop denominations`

**0.2 Operator auth middleware**
- [ ] Add `OPERATOR_PIN` + `OPERATOR_SESSION_SECRET` env vars
- [ ] Create `middleware/operatorAuth.js`: `requireOperator(request, env)`, cookie sign/verify, constant-time PIN compare
- [ ] Create `handlers/operatorLoginHandler.js` + `templates/operatorLoginPage.js`
- [ ] Add routes: `GET /operator/login`, `POST /operator/login`, `POST /operator/logout`
- [ ] Gate existing routes with auth: `/debug`, `/experimental/*`, `/api/keys`, `/api/bulk-wipe-keys`, `/api/v1/pull-payments/*/boltcards`
- [ ] Rate-limit `/operator/login` by IP
- [ ] Add `tests/operatorAuth.test.js`
- [ ] Commit: `feat: add operator authentication with shared PIN and session cookies`

**0.3 Route reorganization**
- [ ] Rename `/login` (customer key recovery) → `/recover` with 301 redirect
- [ ] Move `/pos` → `/operator/pos` with 301 redirect
- [ ] Update all internal links
- [ ] Commit: `refactor: rename customer login to /recover and move POS to /operator/pos`

### Phase 1 — Top-Up Desk

**1.1 Top-up handler + page**
- [ ] Create `handlers/topupHandler.js` + `templates/topupPage.js`
- [ ] Route `GET /operator/topup` (auth-gated): numeric keypad + tap card prompt
- [ ] Route `POST /operator/topup/apply`: validate p+c, CMAC, replay, DO credit
- [ ] Audit note: `topup:<shiftId>:<sessionId>`

**1.2 Keyboard-wedge NFC support**
- [ ] Add `wedgeReaderListener()` to `templates/browserNfc.js`
- [ ] Detect NDEF URL or bare UID from USB reader input

**1.3 Shift bootstrap**
- [ ] Generate `shiftId` UUID on login, embed in session cookie

### Phase 2 — POS Refit

**2.1 Replace `/pos` demo with real POS**
- [ ] Create `templates/operatorPosPage.js` with free-amount + menu modes
- [ ] Mode toggle persisted in `localStorage` per device
- [ ] Menu JSON stored in KV: `pos_menu:<terminalId>`

**2.2 Charge endpoint**
- [ ] Route `POST /operator/pos/charge`: validate p+c, CMAC, replay, DO debit
- [ ] Insufficient balance → 402 with current balance
- [ ] Return new balance + txn ID

**2.3 Receipt**
- [ ] Route `GET /operator/pos/receipt/:txnId` → plain-text receipt

### Phase 3 — Refund / Cash-Out Desk

**3.1 Refund handler + page**
- [ ] Route `GET /operator/refund` (auth-gated): tap card, show balance, enter refund amount
- [ ] Route `POST /operator/refund/apply`: DO debit with `refund:<shiftId>:<sessionId>` note
- [ ] Full refund (balance to zero) or partial

### Phase 4 — Documentation

**4.1 Venue deployment guide** — `docs/VENUE-DEPLOYMENT.md`
**4.2 Operator quick-start** — `docs/OPERATOR-GUIDE.md`
**4.3 README update** — add "Closed-Loop Event Mode" section

### Phase 5 — Tests

- [ ] `tests/topupHandler.test.js`
- [ ] `tests/operatorPosHandler.test.js`
- [ ] `tests/refundHandler.test.js`
- [ ] Full test suite green (existing 287 + new)

## Minimum Shippable Cut

Phase 0 + 1 + 2 = auth + top-up + POS. Can run an event without on-site refunds (use `/experimental/` tools manually) but not without auth, top-up, and POS.
