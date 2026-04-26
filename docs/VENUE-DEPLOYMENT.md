# Venue Deployment Guide

Deploy a closed-loop payment system for your event in under 30 minutes.

## What You Need

- A Cloudflare account (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed and authenticated
- NTAG424 NFC cards (bolt cards) — one per attendee
- Android phone with NFC for card programming, or a USB NFC reader
- At least one Android phone with NFC for POS taps (per stall)
- Optional: USB keyboard-wedge NFC readers for desktop POS terminals

## Step 1: Fork and Configure

```bash
git clone <your-fork-url> event-pay
cd event-pay
npm install
```

Edit `wrangler.toml`:

```toml
name = "event-pay-<venue-name>"
main = "index.js"
compatibility_date = "2025-02-28"

kv_namespaces = [
  { binding = "UID_CONFIG", id = "<your-kv-id>" }
]

[vars]
CURRENCY_LABEL = "GBP"
CURRENCY_DECIMALS = "2"

routes = [
  "https://pay.<your-venue-domain>.com/*"
]

[[durable_objects.bindings]]
name = "CARD_REPLAY"
class_name = "CardReplayDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CardReplayDO"]
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CURRENCY_LABEL` | No | `credits` | Display name for the unit (GBP, EUR, tokens, credits) |
| `CURRENCY_DECIMALS` | No | `0` | Decimal places for amounts (0 = whole numbers, 2 = cents/pence) |
| `MAX_TOPUP_AMOUNT` | No | unlimited | Maximum single top-up amount in minor units |
| `OPERATOR_PIN` | No (see below) | — | Shared operator PIN (set via secret) |
| `OPERATOR_SESSION_SECRET` | No (see below) | — | HMAC key for signing session cookies (set via secret) |
| `ISSUER_KEY` | No | dev key | Master key for deterministic card key derivation |

## Step 2: Create Cloudflare Resources

```bash
wrangler kv:namespace create "UID_CONFIG"
```

Copy the returned `id` into `wrangler.toml`.

## Step 3: Set Secrets

```bash
wrangler secret put ISSUER_KEY
wrangler secret put OPERATOR_PIN
wrangler secret put OPERATOR_SESSION_SECRET
```

- **ISSUER_KEY**: Generate with `node -e "console.log(require('crypto').randomBytes(16).toString('hex').toUpperCase())"`
- **OPERATOR_PIN**: Your chosen shared PIN (min 4 characters)
- **OPERATOR_SESSION_SECRET**: Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

If you skip the operator secrets, the system falls back to development defaults — fine for testing, not for production.

## Step 4: Deploy

```bash
npm test
npm run deploy
```

The deploy script runs tests, rebuilds key data, and deploys via Wrangler.

## Step 5: Program Cards

### Option A: Deterministic Keys (recommended for bulk)

If you set `ISSUER_KEY`, all card keys are derived deterministically from the card's UID. No per-card provisioning needed — just program the card URL:

1. Open the [Bolt Card NFC Programmer](https://github.com/nickfarrow/bolt-card-programmer) app on Android
2. Tap an unprogrammed NTAG424 card
3. Set the NDEF URL to: `https://pay.<your-domain>.com/`
4. The app will auto-detect and program the card using the standard bolt card protocol
5. Repeat for each card

### Option B: Per-Card via KV

For cards that need custom payment methods or per-card keys:

1. Navigate to `https://pay.<your-domain>.com/experimental/activate`
2. Enter the card UID (14 hex chars)
3. Select payment method and configure
4. Scan the QR code or tap the deeplink with the programmer app

### Option C: Via API

```bash
curl -X POST https://pay.<your-domain>.com/api/v1/pull-payments/default/boltcards \
  -H "Content-Type: application/json" \
  -H "Cookie: op_session=<session>" \
  -d '{"UID": "04aabbccdd7788"}'
```

## Step 6: Set Up POS Terminals

Each stall needs a device with NFC. Two options:

### Android Phone (Web NFC)
1. Open `https://pay.<your-domain>.com/operator/pos` in Chrome
2. Log in with the operator PIN
3. The page uses Web NFC — tap cards directly on the phone

### Desktop + USB Reader
1. Open `https://pay.<your-domain>.com/operator/pos` in Chrome/Edge
2. Log in with the operator PIN
3. Toggle to "USB Reader" mode
4. Plug in a keyboard-wedge NFC reader (ACS ACR122U, Identiv SCL3711, etc.)
5. Tap cards on the reader — data appears as keyboard input

### Configure Menu (per terminal)

1. From the POS page, click "Edit Menu"
2. Add items with names and prices
3. Save — the menu is stored in KV per terminal ID
4. Toggle between "Free Amount" and "Menu" mode

## Step 7: Set Up Top-Up and Refund Desks

### Top-Up Desk
1. Open `https://pay.<your-domain>.com/operator/topup`
2. Log in with the operator PIN
3. Accept cash from attendee, enter amount on keypad
4. Tap the attendee's card
5. Balance is credited immediately

### Refund Desk
1. Open `https://pay.<your-domain>.com/operator/refund`
2. Log in with the operator PIN
3. Tap card to read balance
4. Enter refund amount (or tap "Full Refund")
5. Pay out cash to attendee

## Currency Configuration Examples

### UK Pounds (pence internally)
```toml
[vars]
CURRENCY_LABEL = "GBP"
CURRENCY_DECIMALS = "2"
```
Top-up 10.00 GBP → send amount `1000` (pence).

### Euro cents
```toml
[vars]
CURRENCY_LABEL = "EUR"
CURRENCY_DECIMALS = "2"
```

### Festival tokens (whole numbers)
```toml
[vars]
CURRENCY_LABEL = "tokens"
CURRENCY_DECIMALS = "0"
```
Top-up 50 tokens → send amount `50`.

### Funfair credits
```toml
[vars]
CURRENCY_LABEL = "credits"
CURRENCY_DECIMALS = "0"
```

## Post-Deploy Checklist

After deploying, verify the following:

1. Open `https://pay.<your-domain>.com/status` — should return `{"ok":true}`
2. Log in at `/operator/login` with your PIN
3. Verify the POS terminal at `/operator/pos` loads correctly
4. Program a test card via `/experimental/activate`
5. Top up the card at `/operator/topup`
6. Charge at `/operator/pos`
7. Check the card appears in the registry at `/operator/cards`
8. View per-card analytics at `/experimental/analytics?uid=<UID>`
9. Refund the card at `/operator/refund`

Attendees can also check their own card balance at `/card` by tapping on an NFC-enabled phone.

## Security Notes

- The operator PIN is shared among all operators at a venue. Change it between shifts or events.
- Session cookies expire after 12 hours. Operators must re-authenticate.
- Login attempts are rate-limited to 10 per minute per IP.
- All card operations are replay-protected via Durable Objects — a tapped card counter cannot be reused.
- Card state (balance, transactions) lives in the Durable Object's SQLite storage — strongly consistent, not eventually consistent.
- The system has no offline mode. If the worker is unreachable, taps will fail.

## Multi-Deployment

Each venue gets its own:
- Cloudflare Worker deployment (separate `wrangler.toml`)
- KV namespace for card configs and menus
- Durable Object namespace for card state
- ISSUER_KEY (prevents cross-venue card use)
- Operator PIN

To set up a second venue, repeat all steps with a new project directory and new secrets.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| "Could not read card" | Card not programmed or wrong ISSUER_KEY | Re-program card with correct issuer key |
| "CMAC validation failed" | Card keys don't match | Wipe and reprogram the card |
| "Replay detected" | Card counter already used | Normal — each tap increments the counter |
| "Insufficient balance" (402) | Card doesn't have enough funds | Top up at the top-up desk |
| "Rate limited" on login | Too many failed PIN attempts | Wait 60 seconds |
| USB reader not working | Reader not in keyboard-wedge mode | Check reader documentation, install drivers |
| Web NFC not available | Browser or device doesn't support it | Use Chrome on Android; fall back to USB reader |
