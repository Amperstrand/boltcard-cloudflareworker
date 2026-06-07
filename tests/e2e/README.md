# E2E Tests

## Architecture

Three-tier testing:

| Tier | Runner | Environment | Speed |
|------|--------|------------|-------|
| Unit | Vitest (node) | Mocked DO | Fast |
| Integration | Vitest (miniflare) | Real SQLite | Medium |
| E2E (Playwright) | Playwright | Live production | Slow |
| E2E (Vitest) | Vitest (miniflare) | In-memory DO | Fast |

## Vitest E2E Tests

No external dependencies. Run as part of `npm test`.

```bash
npm test                                  # All unit + vitest E2E
npm test -- --testPathPattern="e2e/"      # Just E2E files
```

### Test Files

| File | Coverage |
|------|----------|
| `virtual-card.test.ts` | LNURL-withdraw/pay lifecycle, replay protection, auto-discovery |
| `operator-flows.test.ts` | Top-up, refund, POS charge via operator API |
| `card-lifecycle.test.ts` | Full card lifecycle: provision → pay → wipe → re-provision |
| `cardholder-selfservice.test.ts` | Card lock, reactivate via NFC tap |
| `external-payment.test.ts` | CLN REST, proxy relay payment modes |
| `pages.test.ts` | Page rendering, security headers, auth redirects |
| `pwa.test.ts` | Manifest, service worker, PWA assets |

All vitest E2E tests use the `VirtualCard` helper class (`tests/helpers/virtualCard.ts`) which wraps the full Worker pipeline with an in-memory DO mock.

## Playwright E2E Tests

Run against **live production** (`https://boltcardpoc.psbt.me`).

```bash
npx playwright test                              # Headless (virtual provider)
HEADED=1 npx playwright test                     # Visible Chrome
TEST_PROVIDER=usb HEADED=1 npx playwright test   # Physical card via USB reader
```

### Provider Architecture

Tests use a `CardProvider` abstraction (`tests/e2e/providers/`) to simulate card taps:

| Provider | Source | Use Case |
|----------|--------|----------|
| `virtual` | Browser JS hooks (`_vcTap()`) | CI/automated — no hardware needed |
| `usb` | pcscd bridge → Omnikey reader | Physical card testing |

Selected via `TEST_PROVIDER` env var (default: `virtual`).

### Test Files

| File | Coverage |
|------|----------|
| `financial-flows.spec.ts` | Top-up, POS charge, refund, void, reconciliation |
| `virtual-card.spec.ts` | Virtual card simulator UI, auto-test lifecycle |
| `operator-ui.spec.ts` | Login, POS/topup/refund page rendering, auth protection |

### USB Reader Setup

For physical card testing with an Omnikey USB reader:

```bash
# Install dependencies
pip3 install pyscard ndeflib

# Start the pcscd bridge
python3 scripts/pcscd-bridge.py --port 4321

# In another terminal, run tests
TEST_PROVIDER=usb HEADED=1 npx playwright test
```

The bridge (`scripts/pcscd-bridge.py`) reads NTAG424 NDEF records via PC/SC and exposes them as HTTP endpoints:
- `GET /status` — Bridge health check
- `GET /tap` — Read card, return `{p, c}` params (waits for card)
- `GET /card-info` — Return card UID + keys

### Manual Card Testing

For quick manual testing without the full test suite:

```bash
# With pcscd bridge running:
curl http://localhost:4321/tap   # Tap card when prompted

# Or with a phone/card app — get the URL from the card:
curl "https://boltcardpoc.psbt.me/?p=YOUR_P&c=YOUR_C"
```

## Shared Helpers

| File | Purpose |
|------|---------|
| `tests/e2e/helpers.ts` | Playwright shared helpers: operatorLogin, makeApiHelpers |
| `tests/e2e/providers/` | CardProvider interface + virtual/usb implementations |
| `tests/helpers/virtualCard.ts` | Vitest VirtualCard class |
| `tests/testHelpers.ts` | Core test utilities: virtualTap, buildCardTestEnv |
