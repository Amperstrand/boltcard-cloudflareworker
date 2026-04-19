#!/usr/bin/env bash
# E2E test script for physical NTAG424 bolt cards
#
# Usage:
#   CARD_URL="lnurlw://boltcardpoc.psbt.me/?p=XXX&c=YYY" bash tests/e2e/physical-card.sh
#
# Or for https:// scheme cards:
#   CARD_URL="https://boltcardpoc.psbt.me/?p=XXX&c=YYY" bash tests/e2e/physical-card.sh
#
# Prerequisites: bash, curl, jq
#
# Make executable: chmod +x tests/e2e/physical-card.sh
#
# This script tests the full lifecycle of a physical bolt card:
#   1. Step 1: Card tap -> withdrawRequest
#   2. Step 2: Wallet callback with invoice -> payment
#   3. Replay protection: same counter rejected
#   4. Login: tap history retrieval
#   5. Wipe: card reset
#
# The CARD_URL comes from scanning the card with an NFC reader or the
# Bolt Card programmer app. It contains the encrypted p and c parameters.

set -uo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

WORKER_URL="${WORKER_URL:-https://boltcardpoc.psbt.me}"
CARD_URL="${CARD_URL:?CARD_URL environment variable is required -- scan your card and set CARD_URL to the full lnurlw:// or https:// URL}"

# Normalize lnurlw:// to https://
if [[ "$CARD_URL" == lnurlw://* ]]; then
  CARD_URL="https://${CARD_URL#lnurlw://}"
fi

# Extract p and c from the card URL
P_PARAM=$(echo "$CARD_URL" | grep -oP 'p=\K[^&]+' || true)
C_PARAM=$(echo "$CARD_URL" | grep -oP 'c=\K[^&]+' || true)

if [[ -z "$P_PARAM" || -z "$C_PARAM" ]]; then
  echo "FAIL: Could not extract p and c from CARD_URL"
  echo "  CARD_URL=$CARD_URL"
  exit 1
fi

# Check prerequisites
for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "FAIL: '$cmd' is required but not found in PATH"
    exit 1
  fi
done

PASS=0
FAIL=0
SKIP=0

# ─── Helpers ──────────────────────────────────────────────────────────────────

pass() { echo "  PASS: $1"; ((PASS++)) || true; }
fail() { echo "  FAIL: $1"; ((FAIL++)) || true; }
skip() { echo "  SKIP: $1"; ((SKIP++)) || true; }
separator() { echo ""; echo "-- $1 --"; }

# Make a request and capture status + body
# Sets HTTP_STATUS and BODY globals
do_request() {
  local method="$1"
  local url="$2"
  local data="$3"

  if [[ -n "$data" ]]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "$url")
  else
    RESPONSE=$(curl -s -w "\n%{http_code}" -X "$method" "$url")
  fi

  HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
}

# ─── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo " Physical Bolt Card E2E Test"
echo "========================================"
echo "  Worker:  $WORKER_URL"
echo "  Card p:  ${P_PARAM:0:16}..."
echo "  Card c:  $C_PARAM"
echo "========================================"

# ─── Test 1: Step 1 -- Card tap returns withdrawRequest ───────────────────────

separator "Step 1: Card tap (GET /)"
do_request GET "${WORKER_URL}/?p=${P_PARAM}&c=${C_PARAM}" ""

if [[ "$HTTP_STATUS" == "200" ]]; then
  TAG=$(echo "$BODY" | jq -r '.tag // empty')
  CALLBACK=$(echo "$BODY" | jq -r '.callback // empty')
  K1=$(echo "$BODY" | jq -r '.k1 // empty')

  if [[ "$TAG" == "withdrawRequest" ]]; then
    pass "Returns withdrawRequest"
  else
    fail "Expected tag=withdrawRequest, got tag=$TAG"
  fi

  if [[ -n "$CALLBACK" ]]; then
    pass "Callback URL present: ${CALLBACK:0:60}..."
  else
    fail "Missing callback URL"
  fi

  if [[ -n "$K1" ]]; then
    pass "K1 challenge present"
  else
    fail "Missing k1"
  fi
else
  fail "Expected HTTP 200, got $HTTP_STATUS"
  echo "  Body: $BODY"
fi

# ─── Test 2: Step 1 again -- repeated tap still succeeds (checkReplayOnly) ────

separator "Step 1 repeated: Same counter (should still work)"
do_request GET "${WORKER_URL}/?p=${P_PARAM}&c=${C_PARAM}" ""

if [[ "$HTTP_STATUS" == "200" ]]; then
  pass "Repeated tap accepted (checkReplayOnly does not record)"
else
  BODY_REASON=$(echo "$BODY" | jq -r '.reason // .error // empty')
  if [[ "$BODY_REASON" =~ replay|counter ]]; then
    fail "Step 1 should not reject replays (checkReplayOnly) -- got: $BODY_REASON"
  else
    fail "Unexpected error: $BODY_REASON"
  fi
fi

# ─── Test 3: Step 2 -- Wallet callback records tap ───────────────────────────

separator "Step 2: Wallet callback (records tap)"
# Use a fake bolt11 invoice. The callback will process the request but the
# payment itself will fail. That's fine -- we just want to confirm the tap
# gets recorded (i.e. the counter is accepted, not rejected as replay).
CALLBACK_URL="${WORKER_URL}/boltcards/api/v1/lnurl/cb/${P_PARAM}?k1=${C_PARAM}&pr=lnbc10n1ptestinvoice000000000000000000"

do_request GET "$CALLBACK_URL" ""

# The callback may succeed or fail depending on payment method, but it should
# at least process the request (not 409 from replay protection).
if [[ "$HTTP_STATUS" != "409" ]]; then
  pass "Callback processed (status=$HTTP_STATUS)"
else
  BODY_REASON=$(echo "$BODY" | jq -r '.reason // empty')
  fail "Callback rejected as replay: $BODY_REASON (counter should have been accepted)"
fi

# ─── Test 4: Step 2 replay -- Same counter rejected ──────────────────────────

separator "Step 2 replay: Same counter should be rejected"
do_request GET "$CALLBACK_URL" ""

if [[ "$HTTP_STATUS" == "409" ]]; then
  pass "Replayed callback correctly rejected (409)"
elif [[ "$HTTP_STATUS" == "400" ]]; then
  BODY_REASON=$(echo "$BODY" | jq -r '.reason // empty')
  if [[ "$BODY_REASON" =~ replay|counter ]]; then
    pass "Replayed callback rejected with replay error"
  else
    fail "Expected replay error, got: $BODY_REASON"
  fi
else
  fail "Expected 409/400 for replay, got $HTTP_STATUS"
fi

# ─── Test 5: Login -- Tap history ─────────────────────────────────────────────

separator "Login: Verify tap history"
do_request POST "${WORKER_URL}/login" "{\"p\":\"${P_PARAM}\",\"c\":\"${C_PARAM}\"}"

if [[ "$HTTP_STATUS" == "200" ]]; then
  SUCCESS=$(echo "$BODY" | jq -r '.success // false')
  TAP_HISTORY=$(echo "$BODY" | jq -r '.tapHistory // [] | length')

  if [[ "$SUCCESS" == "true" ]]; then
    pass "Login successful"
  else
    fail "Login failed"
  fi

  if [[ "$TAP_HISTORY" -gt 0 ]]; then
    pass "Tap history has $TAP_HISTORY entries"
    echo "  Latest tap:"
    echo "$BODY" | jq -r '.tapHistory[0] | "    counter=\(.counter) status=\(.status) bolt11=\(.bolt11 // "null" | .[0:30])..."'
  else
    # Expected if the card was never used with a callback before this test run
    skip "No tap history (card may not have been used before)"
  fi
else
  fail "Login request failed: $HTTP_STATUS"
fi

# ─── Test 6: Wipe -- Card reset ───────────────────────────────────────────────

separator "Wipe: Reset card state"
# Extract UID from the login response
LOGIN_BODY="$BODY"
UID_HEX=$(echo "$LOGIN_BODY" | jq -r '.uidHex // empty')

if [[ -n "$UID_HEX" && "$UID_HEX" != "null" ]]; then
  do_request GET "${WORKER_URL}/wipe?uid=${UID_HEX}" ""

  if [[ "$HTTP_STATUS" == "200" ]]; then
    # The wipe endpoint returns an HTML page, but it may also return JSON
    KEYS=$(echo "$BODY" | jq -r '.K0 // empty' 2>/dev/null || echo "")
    if [[ -n "$KEYS" ]]; then
      pass "Wipe returned card keys for reprogramming"
    else
      pass "Wipe acknowledged"
    fi
  else
    fail "Wipe failed: $HTTP_STATUS"
  fi
else
  skip "Could not extract UID for wipe (login may have failed)"
fi

# ─── Test 7: After wipe -- Same counter accepted again ───────────────────────

separator "Post-wipe: Same counter should work again"
do_request GET "${WORKER_URL}/?p=${P_PARAM}&c=${C_PARAM}" ""

if [[ "$HTTP_STATUS" == "200" ]]; then
  pass "Card accepted after wipe (counter reset)"
else
  fail "Card still rejected after wipe: $HTTP_STATUS"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

separator "RESULTS"
echo ""
echo "  Passed:  $PASS"
echo "  Failed:  $FAIL"
echo "  Skipped: $SKIP"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo "SOME TESTS FAILED"
  exit 1
else
  echo "ALL TESTS PASSED"
  exit 0
fi
