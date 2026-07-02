# Physical Card Test Plan

Full lifecycle testing of an NTAG424 boltcard on a physical Android phone via ADB.

## Prerequisites

- Android phone connected via USB with ADB debugging
- Chrome browser installed
- Bolt Card NFC Writer app (by One and Zero's Technology)
- Blank or programmable NTAG424 DNA card
- NFC enabled on phone

## Test Sequence

The sequence follows the card lifecycle state machine. Each phase depends on the previous one.

### Phase 1: Inspect & Program

| Step | Action | Expected Result | Evidence |
|------|--------|-----------------|----------|
| 01 | Tap card on home screen | Nothing opens (blank card) | step01.png/mp4 |
| 02 | Open Bolt Card NFC Writer app | App shows programming UI | step02.png/mp4 |
| 03 | Enter URL + program card | App writes NDEF + AES keys | step03.png/mp4 |
| 04 | Tap card on home screen | Chrome opens with boltcard URL | step04.png/mp4 |
| 05 | Server processes first tap | Card auto-discovered (DO row created) | step05.png/mp4 |

### Phase 2: Identity & Credentials (non-destructive)

| Step | Action | Expected Result | Evidence |
|------|--------|-----------------|----------|
| 06 | /card + tap | Shows UID, state=discovered, balance=0 | step06.png/mp4 |
| 07 | /credential + tap | VC-JWT issued (ES256), claims displayed | step07.png/mp4 |
| 08 | Verify VC in verify box | Status: VALID | step08.png/mp4 |
| 09 | Toggle EdDSA | VC re-issued with EdDSA badge | step09.png/mp4 |
| 10 | /identity + tap | ACCESS GRANTED, profile shown | step10.png/mp4 |
| 11 | /2fa + tap | TOTP + HOTP codes generated | step11.png/mp4 |
| 12 | /pair-nostr + NIP-07 + tap | Paired to Nostr npub | step12.png/mp4 |
| 13 | /credential + tap | VC includes nostrNpub field | step13.png/mp4 |
| 14 | /card + tap | Dashboard: balance, state, history | step14.png/mp4 |

### Phase 3: Financial Flows (non-destructive to card)

| Step | Action | Expected Result | Evidence |
|------|--------|-----------------|----------|
| 15 | Operator login (PIN 1234) | Redirect to /operator/pos | step15.png/mp4 |
| 16 | Top-up 10000 | Balance = 10000 | step16.png/mp4 |
| 17 | /card + tap | Balance shows 10000 | step17.png/mp4 |
| 18 | POS charge 3000 | Balance = 7000 | step18.png/mp4 |
| 19 | /card + tap | Balance shows 7000 | step19.png/mp4 |
| 20 | Refund 1000 | Balance = 8000 | step20.png/mp4 |
| 21 | Void transaction | Balance restored | step21.png/mp4 |
| 22 | /credential + tap | VC includes cardBalance attestation | step22.png/mp4 |
| 23 | /operator/reconciliation | Totals: topups, charges, refunds | step23.png/mp4 |

### Phase 4: Self-Service (semi-destructive)

| Step | Action | Expected Result | Evidence |
|------|--------|-----------------|----------|
| 24 | /card + lock card | Card terminated | step24.png/mp4 |
| 25 | /credential + tap | Fails — card terminated | step25.png/mp4 |
| 26 | /card + reactivate | Card active again | step26.png/mp4 |
| 27 | /credential + tap | VC issues successfully | step27.png/mp4 |

### Phase 5: Cleanup (destructive — run last)

| Step | Action | Expected Result | Evidence |
|------|--------|-----------------|----------|
| 28 | /experimental/wipe + tap | Server removes card record | step28.png/mp4 |
| 29 | /card/info + tap | New/unknown card state | step29.png/mp4 |
| 30 | Bolt Card Writer: factory wipe | Card physically blank | step30.png/mp4 |
| 31 | Tap on home screen | Nothing opens (blank) | step31.png/mp4 |

## Running the tests

```bash
# Interactive — all steps in order
./scripts/phone-evidence.sh

# Single step
./scripts/phone-evidence.sh 07

# All steps non-interactive (press ENTER through)
yes "" | ./scripts/phone-evidence.sh
```

Evidence saved to `phone-evidence/` (gitignored). Each step produces:
- `stepNN.png` — screenshot at capture moment
- `stepNN.mp4` — 60-second video of the interaction

## Card State Machine

```
BLANK ──program──→ PROGRAMMED ──first tap──→ DISCOVERED
                                                    │
                                                    ↓
                                                 ACTIVE ←──reactivate──┐
                                                    │                   │
                                              ┌─────┼─────┐           │
                                              ↓     ↓     ↓           │
                                          topped  charged locked──────┘
                                          up      spent   (terminated)
                                              │     │
                                              ↓     ↓
                                          wiped (server) ──factory wipe──→ BLANK
```

## Dependencies

```
Step 01 (inspect)     → determines if Step 02-03 needed
Step 02-03 (program)  → required for all subsequent steps
Step 05 (discover)    → required for all identity/financial steps
Step 16 (topup)       → required for Steps 18-21 (need balance)
Step 24 (lock)        → must come AFTER all identity/financial tests
Step 28-30 (wipe)     → must come LAST (destructive)
```
