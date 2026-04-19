# E2E Tests

## Virtual Card Tests (automated)

No physical card needed. Runs as part of `npm test`.

```bash
npm test -- --testPathPattern="e2e/virtual-card"
```

Tests the full LNURL-withdraw and LNURL-pay lifecycle using simulated card crypto.

## Physical Card Tests (manual)

Requires a physical NTAG424 bolt card and `curl` + `jq`.

```bash
# 1. Scan your card (NFC reader, Bolt Card app, or phone)
# 2. Get the URL from the card (looks like lnurlw://boltcardpoc.psbt.me/?p=XXX&c=YYY)
# 3. Run the test:

CARD_URL="lnurlw://boltcardpoc.psbt.me/?p=YOUR_P&c=YOUR_C" bash tests/e2e/physical-card.sh

# Optional: override the worker URL
WORKER_URL="https://boltcardpoc.psbt.me" CARD_URL="..." bash tests/e2e/physical-card.sh
```

### What it tests

1. Card tap returns valid withdrawRequest
2. Repeated taps succeed (checkReplayOnly)
3. Wallet callback records tap with payment state
4. Replay protection rejects stale counters
5. Login shows tap history
6. Wipe resets card state
7. Post-wipe card works again
