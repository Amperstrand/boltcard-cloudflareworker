# Physical Device Test Plan — Android + NFC

**Date**: ___________
**Device**: ___________ (Android, Chrome, NFC)
**Tester**: ___________
**Worker URL**: `https://boltcardpoc.psbt.me`
**Operator PIN**: `1234`
**Cards**: At least 3 NTAG424 cards (labeled A, B, C) — OR use the **Virtual Card Simulator** (no physical card needed)

## Pre-requisites

### With Physical Cards
- [ ] Android phone with NFC enabled
- [ ] Chrome browser (latest)
- [ ] ADB connected: `adb devices` shows device
- [ ] ADB port forwarding: `adb reverse tcp:8080 tcp:8080` (if testing locally)
- [ ] At least 3 NTAG424 cards programmed for this worker
- [ ] `curl` and `jq` available on host machine

### With Virtual Card Simulator (No Physical Card)
- [ ] Any browser (Chrome, Firefox, Safari — desktop or mobile)
- [ ] No NFC hardware needed
- [ ] Go to `/debug` → **📌 Virtual Card** tab

---

## 0. Virtual Card Simulator

*User story: "I don't have a physical NFC card. I can test the entire system from the debug console using a virtual card that generates real encrypted tap parameters."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 0.1 | Virtual Card tab renders | Navigate to `/debug`, click "📌 Virtual Card" tab | Shows Create Virtual Card button, description text | ☐ |
| 0.2 | Create virtual card | Click "Create Virtual Card" | Shows UID, K1, K2, Version. Tap Virtual Card button appears. | ☐ |
| 0.3 | Tap virtual card | Click "Tap Virtual Card" | Sends GET to `/?p=XXX&c=YYY` with real AES-ECB/CMAC params. Shows LNURL-withdraw JSON response. | ☐ |
| 0.4 | Multiple taps increment counter | Click "Tap Virtual Card" 3 more times | Each tap succeeds. Counter increments. Different `p` and `c` each time. | ☐ |
| 0.5 | Card discovered in registry | Go to `/operator/cards` after tapping | Virtual card shows state `discovered`, provenance `public_issuer` | ☐ |
| 0.6 | Auto-test lifecycle | Click "Run Auto-Test" button | Runs: discover → top-up 10000 → charge 3000 → refund 3000 → verify balance=10000. All steps pass. | ☐ |
| 0.7 | Auto-test shows step-by-step | Watch auto-test output | Each step shows pass/fail with details. Final summary shows all passed. | ☐ |
| 0.8 | Virtual card top-up | Top up the virtual card via `/operator/topup` using the tap button | Balance credited successfully | ☐ |
| 0.9 | Virtual card POS charge | Charge the virtual card via `/operator/pos` using the tap button | Balance debited successfully | ☐ |
| 0.10 | Virtual card refund | Refund the virtual card via `/operator/refund` using the tap button | Balance refunded, shows correct remaining | ☐ |
| 0.11 | Virtual card dashboard | Navigate to `/card`, tap the virtual card | Shows balance, state, transaction history | ☐ |
| 0.12 | Create second virtual card | Click "Create Virtual Card" again | New UID generated, different keys, previous card forgotten | ☐ |

## 1. Card Discovery & First Tap

*User story: "I have a new card that's never been used. I tap it and the system recognizes it."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 1.1 | Unknown card → first tap | Open `https://boltcardpoc.psbt.me/` on phone. Tap card A on phone. | Browser shows JSON `{"tag":"withdrawRequest",...}` or redirects to a readable page | ☐ |
| 1.2 | Card auto-discovered as `discovered` state | After 1.1, go to `/operator/cards` (log in first). Find card A. | Card A shows state `discovered`, provenance `public_issuer` | ☐ |
| 1.3 | Same card second tap | Tap card A again on `/` | Same `withdrawRequest` response. No error. | ☐ |
| 1.4 | Card from wrong issuer | Tap a card programmed for a different service (if available) | Should get CMAC validation error or `withdrawRequest` with wrong keys | ☐ |

## 2. Operator Login

*User story: "I'm an operator. I log in with the PIN to access operator tools."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 2.1 | Login page renders | Navigate to `/operator/login` | PIN entry form shown, branded page | ☐ |
| 2.2 | Correct PIN login | Enter `1234`, submit | Redirected to `/operator/pos`. Session cookie set. | ☐ |
| 2.3 | Wrong PIN rejected | Enter `0000`, submit | Stays on login page, error message shown | ☐ |
| 2.4 | Session persists across pages | After login, navigate to `/operator/topup` | Page loads without redirect to login | ☐ |
| 2.5 | Logout clears session | Navigate to `/operator/logout`, then `/operator/pos` | Redirected to `/operator/login` | ☐ |
| 2.6 | Rate limiting | Enter wrong PIN 6 times quickly | After 5th attempt, get rate limited message | ☐ |

## 3. Top-Up Desk

*User story: "An attendee gives me cash. I credit their card."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 3.1 | Top-up page renders | Navigate to `/operator/topup` | Shows keypad, NFC scan area, amount display | ☐ |
| 3.2 | Top-up with NFC tap | Enter `1000` on keypad. Tap card A. | Shows "Top-up successful", balance = 1000 | ☐ |
| 3.3 | Top-up amount displayed correctly | After 3.2, check the balance shown | Balance shows correct currency format (e.g. "1,000 credits" or "10.00 GBP") | ☐ |
| 3.4 | Second top-up stacks | Enter `500` on keypad. Tap card A again. | Balance = 1500 | ☐ |
| 3.5 | Top-up with USB reader mode | Toggle to USB reader mode. Enter amount. Type card URL via keyboard. | Same as NFC tap result | ☐ |
| 3.6 | Top-up zero rejected | Enter `0` on keypad. | Should not allow tap / should show error | ☐ |
| 3.7 | Top-up cancelled | Enter amount, then press Clear | Amount resets to 0 | ☐ |

## 4. POS Terminal — Free Amount Mode

*User story: "An attendee wants to buy something. I enter the price and they tap their card."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 4.1 | POS page renders | Navigate to `/operator/pos` | Shows keypad, NFC scan area, CHARGE button, NEW SALE button | ☐ |
| 4.2 | Charge with sufficient balance | Top up card B to 2000. Enter `500` on POS keypad. Tap card B. | Shows "Charge successful", balance = 1500 | ☐ |
| 4.3 | Charge exact balance | Enter `1500` on POS. Tap card B. | Shows success, balance = 0 | ☐ |
| 4.4 | Charge with insufficient balance | Enter `100` on POS. Tap card B (balance 0). | Shows "Insufficient balance" with current balance shown | ☐ |
| 4.5 | NEW SALE resets | After a charge, press "NEW SALE" | Amount resets, NFC scanner reactivates | ☐ |
| 4.6 | Charge zero rejected | Enter `0` on POS keypad. | Should not allow charge / should show error | ☐ |
| 4.7 | NFC auto-starts after amount | Enter amount on POS, wait 1 second | NFC scanner starts automatically (debounced) | ☐ |
| 4.8 | Terminal ID shown | Check POS page for terminal ID | Default "unknown" or user-set terminal ID visible | ☐ |

## 5. POS Terminal — Menu Mode

*User story: "I sell specific items. I use the menu to build an order."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 5.1 | Menu editor page | Navigate to `/operator/pos/menu` | Shows menu editor with add/remove | ☐ |
| 5.2 | Add menu items | Add "Coffee" price 300, "Bagel" price 200. Click "Save Menu" | Items saved, confirmation shown | ☐ |
| 5.3 | Menu appears on POS | Go back to `/operator/pos`. Toggle to "Menu" mode | Coffee and Bagel shown with prices | ☐ |
| 5.4 | Build cart | Tap Coffee once, Bagel twice | Cart shows Coffee x1 (300), Bagel x2 (400), total 700 | ☐ |
| 5.5 | Charge from cart | Top up card C to 1000. Tap "Charge Card" in cart. Tap card C. | Success, balance = 300 | ☐ |
| 5.6 | Remove menu item | Go to menu editor, delete Bagel, save | Bagel gone from POS menu | ☐ |
| 5.7 | Empty menu fallback | Delete all items, go to POS in menu mode | Shows empty menu message or falls back to free amount | ☐ |
| 5.8 | Menu persistence | Reload POS page | Menu items still there (stored in KV) | ☐ |

## 6. Refund Desk

*User story: "An attendee is leaving. They want their remaining balance back as cash."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 6.1 | Refund page renders | Navigate to `/operator/refund` | Shows NFC scan area, balance display, refund buttons | ☐ |
| 6.2 | Read balance via tap | Tap card C (balance 300 from 5.5) | Shows current balance 300 | ☐ |
| 6.3 | Full refund | Tap "Full Refund" | Balance goes to 0. Confirmation shown with amount refunded. | ☐ |
| 6.4 | Partial refund | Top up card A to 500. Enter `200` on refund keypad. Tap "Refund". | Balance = 300. Confirmation shows 200 refunded. | ☐ |
| 6.5 | Refund exceeds balance | Enter `99999` on refund keypad. Tap card A (balance 300). | Error: cannot refund more than balance | ☐ |
| 6.6 | Refund to zero then charge | After full refund, try to charge card A at POS | Insufficient balance | ☐ |

## 7. Cardholder Dashboard (PWA)

*User story: "I'm an attendee. I want to check my balance and see my transaction history."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 7.1 | Card dashboard loads | Navigate to `/card` | Shows "MY CARD" title, NFC scan prompt | ☐ |
| 7.2 | Tap card to see balance | Tap card A on `/card` page | Shows balance, state, UID (masked), provenance | ☐ |
| 7.3 | Transaction history shown | After tapping card A | Shows history entries with amounts, timestamps, status | ☐ |
| 7.4 | Balance format correct | Check the balance display | Shows correct currency (e.g. "300 credits" or "3.00 GBP") | ☐ |
| 7.5 | Pull-to-refresh | While on card info, pull down on screen | Refreshes card info, updates balance | ☐ |
| 7.6 | Card saved to localStorage | Close tab, reopen `/card` | Auto-loads last card without needing to tap again | ☐ |
| 7.7 | Forget card | Click "Remove" on saved card banner | Card params cleared, goes back to scan screen | ☐ |
| 7.8 | Manual URL entry | Paste a card URL in the text input, click Load | Shows card info same as NFC tap | ☐ |
| 7.9 | Install prompt | On supported device, check for install banner | "Install this app for quick access" banner appears | ☐ |
| 7.10 | Offline mode | Enable airplane mode, reload `/card` | Shows "Offline" banner, shows last cached balance | ☐ |
| 7.11 | Stale data indicator | Wait 30+ seconds on card info page | Shows stale time indicator (e.g. "32s ago") | ☐ |
| 7.12 | Card state display | Check a terminated card's dashboard | Shows "Terminated" state in red | ☐ |

## 8. Cardholder Self-Service

*User story: "I lost my card or it was stolen. I want to terminate it myself."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 8.1 | Terminate card from dashboard | On `/card`, tap card, click "Terminate Card" button | Confirmation prompt appears | ☐ |
| 8.2 | Confirm termination | Click "Confirm Terminate" | Card state changes to "terminated". Balance inaccessible. | ☐ |
| 8.3 | Terminated card cannot be charged | Try to charge terminated card at POS | Gets 403 error | ☐ |
| 8.4 | Reactivation prompt | After termination, check dashboard | Shows reactivation section with NFC scan prompt | ☐ |
| 8.5 | Reactivate via NFC tap | Tap terminated card on reactivation scan area | Card reactivated with new version. Shows success. | ☐ |
| 8.6 | Reactivated card works | After reactivation, top up and charge | Works normally with new version | ☐ |

## 9. Card Lifecycle & State Machine

*User story: "As an admin, I need to manage card states."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 9.1 | Activate via API | Log in. Go to `/experimental/activate`. Enter UID of card A. | Card moves to `keys_delivered` → first tap → `active` | ☐ |
| 9.2 | Card registry shows all cards | Navigate to `/operator/cards` | Shows all tapped cards with state, provenance, balance | ☐ |
| 9.3 | Filter cards by state | Use state filter dropdown | Only cards matching filter shown | ☐ |
| 9.4 | Batch terminate | Select multiple cards, choose "Terminate" | All selected cards show `terminated` | ☐ |
| 9.5 | Batch activate | Select terminated cards, choose "Activate" | Cards back to `active` | ☐ |
| 9.6 | Card index repair | Navigate to `/operator/cards`, click "Repair Index" | KV index synced with DO state | ☐ |
| 9.7 | Wipe single card | Navigate to `/experimental/wipe?uid=<UID>` | Card wiped, counter reset, shows keys for reprogramming | ☐ |
| 9.8 | Bulk wipe | Navigate to `/experimental/bulkwipe` | Shows bulk wipe interface | ☐ |

## 10. Reconciliation

*User story: "At the end of the day, I need to reconcile all transactions."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 10.1 | Reconciliation page | Navigate to `/operator/reconciliation` | Shows shift summaries, totals, per-shift breakdown | ☐ |
| 10.2 | Summary cards show totals | Check top-of-page summary cards | Total charges, total top-ups, total refunds, net balance | ☐ |
| 10.3 | Per-shift breakdown | Scroll to shift table | Each shift shows operator, time range, totals | ☐ |
| 10.4 | Shift matches operations | Do 3 top-ups, 2 charges, 1 refund. Check reconciliation | Numbers match: 3 top-ups, 2 charges, 1 refund | ☐ |

## 11. Void Transaction

*User story: "I made a mistake. I need to void a charge."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 11.1 | Void page renders | Navigate to `/operator/void` | Shows NFC scan prompt | ☐ |
| 11.2 | Scan card shows recent charges | Tap a card that has recent charges | Shows list of recent charge transactions | ☐ |
| 11.3 | Void a charge | Tap "Void" on a recent charge | Charge voided, balance credited back | ☐ |
| 11.4 | Voided transaction marked | Check card dashboard or card info | Original transaction shows `voided_at` timestamp | ☐ |
| 11.5 | Void only for debits | Try to void a top-up or refund | Should not appear in void list | ☐ |

## 12. Replay Protection & Security

*User story: "The system prevents double-spending and card cloning."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 12.1 | Replay callback rejected | Use `physical-card.sh` or manual: send same callback twice | Second callback gets 409 Conflict | ☐ |
| 12.2 | Counter auto-increments | Tap card, then tap again (different counter) | Both succeed, balance only debited once per tap | ☐ |
| 12.3 | Card tap URL changes each tap | Read the URL from 3 consecutive taps | `c` parameter changes each time (different CMAC) | ☐ |
| 12.4 | Tampered CMAC rejected | Manually modify `c` parameter in URL, submit | 403 CMAC validation failed | ☐ |
| 12.5 | Tampered p parameter rejected | Manually modify `p` parameter, submit | 403 or decryption error | ☐ |
| 12.6 | Missing parameters | Navigate to `/?p=xxx` without `c` | Error response | ☐ |
| 12.7 | CSRF protection | Try POST to `/operator/pos/charge` without CSRF cookie | 403 Forbidden | ☐ |

## 13. Debug Console

*User story: "I need to debug a card issue on-site."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 13.1 | Debug page renders | Navigate to `/debug` | Shows tabbed debug console (Console, Identify, Wipe, 2FA, Identity, POS) | ☐ |
| 13.2 | Console tab NFC scan | On Console tab, tap card | Shows decrypted UID, counter, CMAC validation result | ☐ |
| 13.3 | Identify tab | Switch to Identify tab, tap card | Shows card identification info | ☐ |
| 13.4 | 2FA tab | Switch to 2FA tab, tap card | Shows TOTP/HOTP codes | ☐ |

## 14. Identity Demo

*User story: "I want to use my card as an access badge."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 14.1 | Identity page renders | Navigate to `/identity` | Shows NFC scan prompt, identity verification UI | ☐ |
| 14.2 | Tap card for identity | Tap card on identity page | Shows verification result (may be rejected if not enrolled) | ☐ |
| 14.3 | Identity profile | If enrolled, check profile display | Shows fake profile (name, role, department) derived from UID | ☐ |

## 15. Analytics

*User story: "I want to see per-card usage statistics."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 15.1 | Analytics page | Navigate to `/experimental/analytics` | Shows UID input | ☐ |
| 15.2 | Per-card analytics | Enter a UID that's been used | Shows taps, payments, success rate, total spent | ☐ |
| 15.3 | Analytics data API | `GET /experimental/analytics/data?uid=<UID>` | JSON with tap stats | ☐ |

## 16. PWA Install & Offline

*User story: "I install the cardholder app on my phone for quick access."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 16.1 | Service worker registers | Open DevTools → Application → Service Workers | SW registered and active | ☐ |
| 16.2 | Manifest valid | DevTools → Application → Manifest | Name "My Bolt Card", display "standalone", icon present | ☐ |
| 16.3 | Cache populated | DevTools → Application → Cache Storage | `boltcard-<hash>` cache exists with shell assets | ☐ |
| 16.4 | Install PWA | Click "Install" banner or browser menu → Install | App installed, opens in standalone mode (no browser chrome) | ☐ |
| 16.5 | Offline launch | Close all tabs, enable airplane mode, launch PWA from home screen | App opens, shows cached UI, "Offline" banner | ☐ |
| 16.6 | Offline balance display | While offline, open PWA with cached card | Shows last cached balance with stale indicator | ☐ |
| 16.7 | Online recovery | Disable airplane mode, pull-to-refresh | Balance updates, stale indicator disappears | ☐ |
| 16.8 | New deploy clears old cache | Deploy a new version, then open PWA | Old cache purged, new cache created | ☐ |

## 17. Receipts

*User story: "I want to see a receipt for my transaction."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 17.1 | Transaction receipt | Get a `txnId` from a charge, navigate to `/api/receipt/<txnId>` | Plain text receipt with amount, date, card UID (masked) | ☐ |
| 17.2 | Invalid receipt ID | Navigate to `/api/receipt/invalid-id` | 404 or error response | ☐ |

## 18. Balance Check API

*User story: "I want to check my balance without going through the full dashboard."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 18.1 | Balance check via POST | `POST /api/balance-check` with card p/c params | Returns balance, state | ☐ |
| 18.2 | Balance check invalid card | POST with wrong params | Error response | ☐ |

## 19. Edge Cases & Error Recovery

*User story: "Things go wrong at events. How does the system handle it?"*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 19.1 | Rapid double-tap | Tap card twice very quickly at POS | First tap succeeds, second gets replay error or succeeds with new counter | ☐ |
| 19.2 | Card removed mid-read | Start NFC scan, pull card away quickly | Graceful error, can retry | ☐ |
| 19.3 | Multiple browser tabs | Open `/operator/pos` in 2 tabs, charge same card from both | Both work (different counters), no double-charge | ☐ |
| 19.4 | Session expiry mid-operation | Wait 12+ hours (or simulate), try to charge | Redirected to login, no data loss | ☐ |
| 19.5 | Page refresh during NFC | Refresh page while NFC scan is active | Scan stops cleanly, page reloads, can restart scan | ☐ |
| 19.6 | Back button after charge | Press browser back after successful charge | Doesn't re-charge (GET is idempotent, POST requires NFC) | ☐ |
| 19.7 | Very large top-up | Top up 999,999,999 | Succeeds or hits MAX_BALANCE gracefully | ☐ |
| 19.8 | Very small charge | Charge 1 unit | Succeeds | ☐ |
| 19.9 | Negative amount attempt | Try to submit negative amount via modified request | Rejected with 400 | ☐ |
| 19.10 | Network timeout during charge | Enable network throttling in DevTools, charge card | Error shown, balance unchanged | ☐ |

## 20. Mobile UX & Responsiveness

*User story: "The POS operator is using a phone, not a desktop."*

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 20.1 | POS page fits phone screen | Open `/operator/pos` in portrait | All elements visible, no horizontal scroll | ☐ |
| 20.2 | Keypad works with touch | Tap keypad buttons with finger | Numbers register correctly | ☐ |
| 20.3 | NFC scan prompt visible | Check NFC scan area | Clear "tap your card" instruction | ☐ |
| 20.4 | Menu items tappable | In menu mode, tap items | Items highlight, cart updates | ☐ |
| 20.5 | Success/error messages visible | After charge | Large enough to read, color-coded | ☐ |
| 20.6 | Card dashboard responsive | Open `/card` in portrait | Balance prominent, history scrollable | ☐ |
| 20.7 | Landscape orientation | Rotate phone to landscape | Layout adapts, still usable | ☐ |
| 20.8 | Font sizes readable | Check all pages at default zoom | All text readable without zooming | ☐ |

---

## ADB-Assisted Tests

These can be run from the host machine while the phone is connected via ADB.

### Automated: Physical Card Script

```bash
# Get card URL by tapping card on phone's NFC reader, then:
CARD_URL="lnurlw://boltcardpoc.psbt.me/?p=XXX&c=YYY" bash tests/e2e/physical-card.sh
```

### ADB Commands for Testing

```bash
# Open URL on phone
adb shell am start -a android.intent.action.VIEW -d "https://boltcardpoc.psbt.me/operator/pos"

# Take screenshot
adb shell screencap -p /sdcard/screen.png && adb pull /sdcard/screen.png

# Check Chrome version
adb shell dumpsys package com.android.chrome | grep versionName

# Clear Chrome data (fresh login test)
adb shell pm clear com.android.chrome

# Enable/disable NFC
adb shell svc nfc enable
adb shell svc nfc disable

# Network throttling (simulate poor connectivity)
adb shell settings put global airplane_mode_on 1
adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true
# ... test ...
adb shell settings put global airplane_mode_on 0
adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false

# Logcat for errors
adb logcat -s Chrome:* chromium:* | grep -i error
```

### Screenshot Verification Checklist

After each major flow, take a screenshot and verify:

- [ ] Login page renders correctly
- [ ] POS page with keypad and NFC prompt
- [ ] Successful charge (green confirmation)
- [ ] Insufficient balance (red error)
- [ ] Top-up success with balance
- [ ] Refund confirmation
- [ ] Cardholder dashboard with balance and history
- [ ] Reconciliation dashboard with summaries
- [ ] Card registry with state filters
- [ ] PWA installed (standalone mode, no browser chrome)

---

## Summary Template

| Section | Tests | Pass | Fail | Skip |
|---------|-------|------|------|------|
| 0. Virtual Card | 12 | | | |
| 1. Discovery | 4 | | | |
| 2. Login | 6 | | | |
| 3. Top-Up | 7 | | | |
| 4. POS Free Amount | 8 | | | |
| 5. POS Menu | 8 | | | |
| 6. Refund | 6 | | | |
| 7. Cardholder Dashboard | 12 | | | |
| 8. Cardholder Self-Service | 6 | | | |
| 9. Card Lifecycle | 8 | | | |
| 10. Reconciliation | 4 | | | |
| 11. Void | 5 | | | |
| 12. Replay & Security | 7 | | | |
| 13. Debug Console | 4 | | | |
| 14. Identity | 3 | | | |
| 15. Analytics | 3 | | | |
| 16. PWA Install & Offline | 8 | | | |
| 17. Receipts | 2 | | | |
| 18. Balance Check | 2 | | | |
| 19. Edge Cases | 10 | | | |
| 20. Mobile UX | 8 | | | |
| **TOTAL** | **133** | | | |

---

## Bug Report Template

```
### Bug #___: [Title]
- **Section**: (e.g. "4. POS Free Amount")
- **Test**: (e.g. "4.4 Charge with insufficient balance")
- **Device**: (phone model, Android version, Chrome version)
- **Steps**: (what you did)
- **Expected**: (what should happen)
- **Actual**: (what happened instead)
- **Screenshot**: (adb screencap)
- **Network**: (if relevant, DevTools network tab)
```
