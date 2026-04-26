# Operator Quick-Start Guide

This guide covers the day-of-event workflows for operators running top-up, POS, and refund stations.

## Logging In

1. Open the operator page: `https://pay.<your-venue>.com/operator`
2. Enter the shared PIN (given by your event coordinator)
3. You're logged in for 12 hours. If you see the login page again, re-enter the PIN.

**Important**: Do not share the PIN with attendees. Log out when leaving your station (`POST /operator/logout` or close the browser).

## Top-Up Desk

The top-up desk is where attendees trade cash for card balance.

### Workflow

1. Open `https://pay.<your-venue>.com/operator/topup`
2. Wait for an attendee
3. Accept their cash payment
4. Type the amount on the on-screen keypad (or use the USB reader to type)
5. The attendee taps their card on the phone/reader
6. Screen shows "Top-up successful" with the new balance
7. The card is ready to use

### Input Modes

- **NFC tap** (default): Tap the card directly on the phone. Works on Android with Chrome.
- **USB reader**: Toggle the switch at the top of the page. Card data comes in as keyboard input from a USB NFC reader.

### Tips

- The keypad is always in focus — just start typing numbers
- Press the decimal point (.) if your currency has decimals (e.g., GBP 10.50)
- Press Clear to reset the amount
- If a tap fails, the card's counter still advances — just tap again
- If you see "Could not read card", the card may not be programmed for this venue

## POS Terminal

The POS terminal is where attendees pay for goods at stalls.

### Setup

1. Open `https://pay.<your-venue>.com/operator/pos`
2. Log in with the PIN
3. Set your terminal ID (defaults to "pos-1", change if you have multiple terminals at the same stall)
4. Choose your input mode: NFC tap or USB reader

### Free Amount Mode

1. Make sure the mode toggle says "Free Amount"
2. Type the price on the keypad
3. Attendee taps their card
4. Screen shows success or "Insufficient balance" with current balance

### Menu Mode

1. Toggle to "Menu" mode
2. Tap items to add them to the cart (tap again to increase quantity)
3. The cart bar at the bottom shows the total
4. Tap "Charge Card" in the cart bar
5. Attendee taps their card
6. Screen shows success with remaining balance

### Editing the Menu

1. From the POS page, click "Edit Menu"
2. Add items: type a name and price, click "+ Add"
3. Remove items: click the trash icon
4. Edit prices: click the price field and change it
5. Click "Save Menu" when done

The menu is stored per terminal ID. Each terminal can have its own menu.

### Handling Errors

| Screen Message | What To Do |
|---|---|
| Insufficient balance | Tell the attendee their remaining balance. They need to top up. |
| Could not read card | Card may be damaged or from a different venue. |
| Replay detected | Normal — the card was tapped twice quickly. Have them tap once more. |
| Card not active | Card needs to be activated. Send to the programming desk. |

## Refund Desk

The refund desk handles cash-back for attendees leaving the event.

### Workflow

1. Open `https://pay.<your-venue>.com/operator/refund`
2. Attendee taps their card
3. Screen shows the current balance
4. Choose one of:
   - **Full Refund**: Tap the "Full Refund" button. Card balance goes to zero.
   - **Partial Refund**: Type the refund amount on the keypad, tap "Refund"
5. Pay out cash to the attendee
6. Screen confirms the refund with the new balance

### Notes

- You cannot refund more than the card's balance
- Refunds are recorded in the transaction log
- A refunded card can still be used for any remaining balance

## Card Status Reference

| Status | Meaning | Action |
|---|---|---|
| `new` | Card was programmed but never tapped | Will auto-activate on first tap at top-up or POS |
| `pending` | Keys fetched but card never tapped | Will upgrade to `discovered` on first tap |
| `discovered` | Card tapped and auto-recognized by key | Working — treated like `active` |
| `keys_delivered` | Operator programmed keys, awaiting first tap | Will auto-activate on first tap |
| `active` | Card is working normally | No action needed |
| `terminated` | Card has been wiped | Must be reprogrammed |
| `wipe_requested` | Card wipe is pending | Must be reprogrammed |

## Card Registry

The card registry at `/operator/cards` shows all cards that have been indexed by the system. Cards are automatically indexed when they transition between states (provisioned, discovered, activated, wiped, terminated).

Use this page to:
- See all known cards and their current states
- Filter by state (active, discovered, terminated, etc.)
- Navigate to per-card analytics
- Monitor card provenance (where keys came from)

Note: The registry may lag up to 60 seconds due to KV eventual consistency.

## Quick Reference: All Operator URLs

| URL | Purpose |
|---|---|
| `/operator` | Redirects to POS |
| `/operator/login` | PIN login |
| `/operator/topup` | Top-up desk |
| `/operator/pos` | POS terminal |
| `/operator/pos/menu` | Menu editor |
| `/operator/refund` | Refund desk |
| `/operator/cards` | Card registry audit |
| `/operator/logout` | Log out |
| `/card` | Cardholder dashboard (public — tap to see balance) |
| `/debug` | Card debug tools (advanced) |
| `/experimental/activate` | Card programming |
| `/experimental/analytics` | Per-card analytics |

All operator pages require authentication. Sessions expire after 12 hours.
