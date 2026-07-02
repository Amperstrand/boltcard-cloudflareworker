#!/bin/bash
# Physical card evidence capture — full lifecycle test sequence
# Records screenshots + video for each step
# Usage: ./scripts/phone-evidence.sh [step-number]
# If no step given, runs interactively from the beginning

set -e

EVIDENCE_DIR="phone-evidence"
mkdir -p "$EVIDENCE_DIR"
VIDEO_PID=""

adb_screenshot() {
  local name="$1"
  local path="$EVIDENCE_DIR/${name}.png"
  adb shell screencap -p /sdcard/ev.png 2>/dev/null
  adb pull /sdcard/ev.png "$path" 2>/dev/null
  echo "  Screenshot: $path"
}

adb_video_start() {
  local name="$1"
  adb shell screenrecord --bit-rate 4000000 --time-limit 60 /sdcard/${name}.mp4 &
  VIDEO_PID=$!
  echo "  Video recording..."
}

adb_video_stop() {
  local name="$1"
  [ -n "$VIDEO_PID" ] && kill $VIDEO_PID 2>/dev/null
  wait $VIDEO_PID 2>/dev/null
  sleep 2
  local path="$EVIDENCE_DIR/${name}.mp4"
  adb pull /sdcard/${name}.mp4 "$path" 2>/dev/null && echo "  Video: $path" || echo "  Video: (none)"
}

step() {
  local num="$1"
  local phase="$2"
  local title="$3"
  local action="$4"

  echo ""
  echo "=================================================="
  echo "  Step $num [$phase]: $title"
  echo "=================================================="
  echo "  $action"
  echo ""

  adb_video_start "step${num}"
  echo "  Press ENTER when ready to capture..."
  read -r
  adb_screenshot "step${num}"
  adb_video_stop "step${num}"
  echo "  Step $num done"
}

should_run() { [ -z "$RUN_STEP" ] || [ "$RUN_STEP" == "$1" ]; }

adb devices | grep -q "device$" || { echo "No phone connected"; exit 1; }
echo "Phone: $(adb shell getprop ro.product.model 2>/dev/null)"

if [ -n "$1" ] && [ "$1" != "all" ]; then
  RUN_STEP="$1"
else
  RUN_STEP=""
fi

# PHASE 1: INSPECT & PROGRAM
should_run "01" && step "01" "INSPECT" "Check card state" "Go to home screen. Tap card. Chrome opens = programmed. Nothing = blank."
should_run "02" && step "02" "PROGRAM" "Open Bolt Card NFC Writer" "Open NFC Writer app. Enter URL: https://boltcardpoc.psbt.me/"
should_run "03" && step "03" "PROGRAM" "Write keys to card" "Place card on phone. App writes NDEF URL + AES keys."
should_run "04" && step "04" "PROGRAM" "Verify NDEF URL" "Home screen. Tap card. Chrome opens with boltcardpoc.psbt.me/?p=...&c=..."
should_run "05" && step "05" "PROGRAM" "First server contact" "Chrome opened with card URL. Server auto-discovers card."

# PHASE 2: IDENTITY & CREDENTIALS
should_run "06" && step "06" "IDENTITY" "Card state check" "Navigate to /card. Tap card. Shows UID, state, balance=0."
should_run "07" && step "07" "IDENTITY" "Credential issuance ES256" "Navigate to /credential. Tap card. VC-JWT displayed."
should_run "08" && step "08" "IDENTITY" "Verify credential" "Copy VC-JWT, paste in verify box, click Verify. Shows VALID."
should_run "09" && step "09" "IDENTITY" "Toggle to EdDSA" "Click Switch to EdDSA. Re-tap. Shows EdDSA badge."
should_run "10" && step "10" "IDENTITY" "Identity demo" "Navigate to /identity. Tap card. ACCESS GRANTED + profile."
should_run "11" && step "11" "IDENTITY" "2FA codes" "Navigate to /2fa. Tap card. TOTP + HOTP codes shown."
should_run "12" && step "12" "IDENTITY" "Nostr pairing" "Navigate to /pair-nostr. Connect NIP-07. Tap card. Paired."
should_run "13" && step "13" "IDENTITY" "VC with Nostr npub" "Navigate to /credential. Tap card. VC includes nostrNpub."
should_run "14" && step "14" "IDENTITY" "Cardholder dashboard" "Navigate to /card. Tap card. Balance, state, history shown."

# PHASE 3: FINANCIAL FLOWS
should_run "15" && step "15" "FINANCIAL" "Operator login" "Navigate to /operator/login. Enter PIN 1234."
should_run "16" && step "16" "FINANCIAL" "Top-up 10000" "Navigate to /operator/topup. Enter 10000. Tap card."
should_run "17" && step "17" "FINANCIAL" "Verify balance" "Navigate to /card. Tap card. Balance = 10000."
should_run "18" && step "18" "FINANCIAL" "POS charge 3000" "Navigate to /operator/pos. Enter 3000. Tap card."
should_run "19" && step "19" "FINANCIAL" "Verify balance" "Navigate to /card. Tap card. Balance = 7000."
should_run "20" && step "20" "FINANCIAL" "Refund 1000" "Navigate to /operator/refund. Enter 1000. Tap card."
should_run "21" && step "21" "FINANCIAL" "Void transaction" "Navigate to /operator/void. Void last charge."
should_run "22" && step "22" "FINANCIAL" "VC with balance" "Navigate to /credential. Tap card. VC includes cardBalance."
should_run "23" && step "23" "FINANCIAL" "Reconciliation" "Navigate to /operator/reconciliation. Totals shown."

# PHASE 4: SELF-SERVICE
should_run "24" && step "24" "SELFSERVICE" "Lock card" "Navigate to /card. Tap card. Click Lock Card."
should_run "25" && step "25" "SELFSERVICE" "Verify locked" "Navigate to /credential. Tap card. Should fail."
should_run "26" && step "26" "SELFSERVICE" "Reactivate" "Navigate to /card. Tap card. Click Reactivate."
should_run "27" && step "27" "SELFSERVICE" "Verify active" "Navigate to /credential. Tap card. VC issues."

# PHASE 5: CLEANUP (DESTRUCTIVE)
should_run "28" && step "28" "CLEANUP" "Server wipe" "Navigate to /experimental/wipe. Tap card. Server removes record."
should_run "29" && step "29" "CLEANUP" "Verify wiped" "Navigate to /card/info. Tap card. New/unknown card."
should_run "30" && step "30" "CLEANUP" "Physical wipe" "Open Bolt Card Writer app. Wipe to factory."
should_run "31" && step "31" "CLEANUP" "Verify blank" "Home screen. Tap card. Nothing opens."

echo ""
echo "=================================================="
echo "  Evidence: $EVIDENCE_DIR/"
echo "  Files: $(ls -1 "$EVIDENCE_DIR/" 2>/dev/null | wc -l | awk '{print $1}')"
echo "  Size: $(du -sh "$EVIDENCE_DIR/" 2>/dev/null | awk '{print $1}')"
echo "=================================================="
