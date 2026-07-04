# Physical Card Testing — Complete

## Card: 041065FA967380

| Property | Value |
|----------|-------|
| UID | 041065FA967380 |
| Chip | NTAG424 DNA (vendor=04, type=04, v30.00) |
| Batch | 3475920457, CW19 21 |
| Burned with | bolty-cli on ai-legion-small |
| Issuer Key | 00000000000000000000000000000001 |
| URL Template | https://boltcardpoc.psbt.me/?p={picc:uid+ctr}&c=[[{mac} |
| K0 | 4b043f1ad0ea0c2be1ad1c4c9941ae28 |
| State | PROVISIONED (SDM active, CMAC verified) |

## Test Results (2026-07-03)

All 9 endpoints tested with physical card tap values. Every test PASSED.

| # | Test | Result |
|---|------|--------|
| 1 | LNURL Withdraw Response | ✅ tag=withdrawRequest, VC embedded (915 chars) |
| 2 | Credential Issuance (ES256) | ✅ CardUid=041065fa967380, balance=977650, state=active |
| 3 | Credential Issuance (EdDSA) | ✅ Algorithm toggle works |
| 4 | Data Integrity Proof | ✅ jcs-eddsa-2025 cryptosuite |
| 5 | SD-JWT Selective Disclosure | ✅ 7 parts (JWT + 6 disclosures) |
| 6 | Credential Verification | ✅ Valid=true, signature verified |
| 7 | Card Info | ✅ state=active, balance=977650 |
| 8 | Identity Verification | ✅ verified=true, name=Backstage Guest |
| 9 | 2FA Codes | ✅ TOTP + HOTP generated |

## NFC Detection on Phone

The card was detected by the phone's NFC hardware via ADB NFC toggles
(`adb shell svc nfc disable && adb shell svc nfc enable`). Each toggle
triggered Android's system NFC tag dispatch, which opened Chrome with
the card's NDEF URL containing fresh p= and c= parameters.

14 physical card tap tabs were opened in Chrome during testing,
each with unique p/c values from the card's rolling counter.

## Burn Command Used

```bash
ssh ubuntu@ai-legion-small
cd /home/ubuntu/src/bolty-rs
cargo run --bin bolty-cli -- burn \
  --issuer-key 00000000000000000000000000000001 \
  --url 'https://boltcardpoc.psbt.me/?p={picc:uid+ctr}&c=[[{mac}' \
  --confirm-uid 041065FA967380 \
  --verbose
```

Output: "✅ Card burned and verified successfully!"
