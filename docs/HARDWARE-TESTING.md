# Hardware E2E Testing

End-to-end testing with physical NTAG424 cards via USB reader.

## Architecture

```
Playwright (Chromium)           pcscd bridge              Worker
      |                              |                       |
  test.spec.ts                   :4321                    :443/:8787
      |                              |                       |
      |--- provider.tap() --------->|                       |
      |                              |--- PC/SC read ------->|
      |                              |<-- NDEF (p,c) --------|
      |<-- {p, c} ------------------|                       |
      |                              |                       |
      |--- fetch(/topup, {p,c}) --------------------------->|
      |<-- {balance, ok} ------------------------------------|
```

Playwright drives the browser. The USB provider reads the physical card through the pcscd bridge for each `tap()` call. The browser sends `fetch()` requests to the worker with the fresh card params. All cookies (session, CSRF) are handled by the browser context.

## Prerequisites

### Hardware

| Item | Example | Notes |
|------|---------|-------|
| USB NFC Reader | ACS ACR1252 Dual Reader | PC/SC compatible, ISO 14443-4 |
| NTAG424 DNA card | Any boltcard programmed for the worker | Must have SDM enabled |
| USB connection | — | Reader appears as two PC/SC devices (SAM + PICC) |

### Software

```bash
# Python bridge dependencies
pip3 install pyscard ndeflib pycryptodome requests

# Node.js test dependencies (already in package.json)
npm install  # installs @playwright/test
```

### Card State

The card must be:
- Programmed with the worker URL (e.g., `https://boltcardpoc.psbt.me/?p=***&c=***`)
- SDM enabled (encrypted PICC data + CMAC mirroring)
- Keys matching the worker's ISSUER_KEY
- State: `active` or `discovered` on the worker

## Running Tests

### 1. Start the pcscd bridge

```bash
python3 scripts/pcscd-bridge.py --port 4321
```

Verify: `curl http://localhost:4321/status` should return `{"bridge": "ok", ...}`.

### 2. Place card on reader

The card stays on the reader for the entire test run. Each `tap()` reads fresh SDM params (counter auto-increments). No need to remove and re-place the card between taps.

### 3. Run Playwright tests

```bash
# All hardware tests
TEST_PROVIDER=usb npx playwright test tests/e2e/hardware-financial.spec.ts

# Headed mode (see browser)
TEST_PROVIDER=usb HEADED=1 npx playwright test tests/e2e/hardware-financial.spec.ts

# Single test
TEST_PROVIDER=usb npx playwright test -g "top-up increases balance"

# Against local dev server
TEST_PROVIDER=usb PLAYWRIGHT_BASE_URL=http://127.0.0.1:8787 npx playwright test
```

### Quick smoke test (no Playwright)

```bash
# Ensure bridge is running, then:
python3 scripts/financial-flow-test.py --topup 1000 --charge 500 --refund 250
```

## Test Inventory

### `tests/e2e/hardware-financial.spec.ts`

| Test | Operations | Balance Taps | Verifies |
|------|-----------|--------------|----------|
| top-up increases balance | topUp(1000) | 3 | Balance += 1000 |
| POS charge decreases balance | topUp(2000) + charge(500) | 4 | Balance += 1500 |
| overdraft returns 402 | charge(999999999) | 2 | HTTP 402, balance unchanged |
| refund credits after charge | topUp + charge + refund | 5 | Balance delta correct |
| void restores after charge | topUp + charge + void | 5 | Balance = post-topup |
| multiple sequential charges | topUp + 3x charge | 6 | Running balance tracks |
| card info returns valid state | tap + GET /card/info | 1 | State, balance, history |

**Total**: 7 tests, ~25 card taps, ~90 seconds

### Key Design Decisions

**Balance-delta assertions**: Hardware tests check `balance === initialBalance + expectedDelta`, not absolute values. The card accumulates state across test runs — initial balance varies.

**Auto-skip for virtual provider**: All hardware tests use `test.skip(provider.name !== "usb")`. They are silently skipped when running with the virtual provider (default).

**Self-contained beforeEach**: Each test records its own `initialBalance` via a fresh tap. No shared state between tests.

## Card Management

### Checking card state

```bash
# Via bridge
curl http://localhost:4321/inspect

# Via worker
curl http://localhost:4321/tap  # Get fresh params
# Then use those params with the worker
```

### Wiping a card

```bash
# Via bridge (requires current keys)
curl -X POST http://localhost:4321/wipe \
  -H "Content-Type: application/json" \
  -d '{"keys": ["K0_HEX", "K1_HEX", "K2_HEX", "K3_HEX", "K4_HEX"]}'
```

### Programming a card

```bash
# Via bridge (factory key required for new cards)
curl -X POST http://localhost:4321/burn \
  -H "Content-Type: application/json" \
  -d '{
    "urlTemplate": "https://boltcardpoc.psbt.me/?p=********************************&c=****************",
    "keys": ["K0", "K1", "K2", "K3", "K4"],
    "keyVersion": 1,
    "currentKey": "00000000000000000000000000000000"
  }'
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "No smart card inserted" | Card not on PICC slot | Place card on reader, check `/status` shows 2 readers |
| "CMAC validation failed" | Counter desync or wrong keys | Wait 2s, tap again (counter auto-increments) |
| "CSRF validation failed" | Session expired | Tests auto-login in `beforeEach`; for manual scripts, re-login |
| Bridge returns 500 | pyscard can't connect | Restart bridge, check reader USB connection |
| `op_csrf: NOT SET` | Didn't visit operator page after login | GET `/operator/pos` before making API calls |
| Test timeout at `provider.tap()` | Card removed or bridge down | Verify bridge running + card on reader |
| Balance doesn't match | Previous test left partial state | Tests use delta checks; verify `initialBalance` was recorded |

## CI Strategy

Hardware tests **never run in CI** — they require physical hardware. The CI pipeline runs:

1. Unit tests (`npm test`) — mocked DO, fast
2. DO integration tests (`npm run test:do`) — real SQLite
3. Worker integration tests (`npm run test:integration`) — full pipeline via Miniflare
4. Smoke test (post-deploy) — 5 HTTP requests to live worker

Playwright tests (both virtual and hardware) are **manual/local only**:

| When | What | Provider |
|------|------|----------|
| Before deploy (UI changes) | Full Playwright suite | `virtual` (default) |
| Card/firmware changes | Hardware test spec | `usb` |
| New payment flow | `financial-flow-test.py` | `usb` via bridge |
| Periodic validation | Full Playwright suite | both `virtual` + `usb` |

## pcscd Bridge API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | Reader health check |
| GET | `/tap` | Read card, return `{p, c}` |
| GET | `/card-info` | Cached card info (UID, keys) |
| GET | `/inspect` | Full card inspection (UID, NDEF, SDM, keys) |
| POST | `/burn` | Program card (URL, SDM, keys) |
| POST | `/wipe` | Reset card to factory defaults |

Bridge source: `scripts/pcscd-bridge.py`
