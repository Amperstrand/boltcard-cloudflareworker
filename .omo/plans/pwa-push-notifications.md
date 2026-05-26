# PWA Push Notifications — Deferred Plan

**Status**: Deferred. Focus on POC first.
**GitHub Issue**: #15
**Research completed**: 2026-05-26

## Why Deferred

Push notifications add significant complexity (VAPID crypto, subscription lifecycle, push service errors) that's not needed for the initial POC. The PWA already works offline with cached balance display.

## Recommended Library

`@pushforge/builder` — zero dependencies, Web Crypto API only, single `buildPushHTTPRequest()` call, tested on Cloudflare Workers.

```bash
npm install @pushforge/builder
```

Alternatives: `web-push-neo` (1 dep: jose), `web-push-browser` (0 deps, granular).

## Architecture

```
Cardholder taps card at POS
        │
        ▼
  POS handler debits card
        │
        ▼
  sendPushNotification(uid, { type: "charge", amount, balance })
        │
        ▼
  KV.get("push_sub:" + uid) → PushSubscription
        │
        ▼
  buildPushHTTPRequest({ privateJWK, subscription, message })
        │
        ▼
  fetch(pushServiceEndpoint, { POST, headers, body })
        │
        ▼
  Browser shows notification via SW push event
```

## Components

| Component | Work | File |
|---|---|---|
| VAPID keys | Generate, store in wrangler secrets | `wrangler secret put VAPID_PRIVATE_KEY` |
| VAPID public key | Serve to client for subscription | env var `VAPID_PUBLIC_KEY` |
| Subscribe endpoint | `POST /api/push/subscribe` — store in KV | New handler |
| Unsubscribe endpoint | `POST /api/push/unsubscribe` — delete from KV | New handler |
| Push utility | `sendPushNotification()` with fire-and-forget | New `utils/pushNotifications.ts` |
| SW push handler | `self.addEventListener('push', ...)` → `showNotification()` | `static/pwa-assets.ts` |
| SW click handler | `self.addEventListener('notificationclick', ...)` → open `/card` | `static/pwa-assets.ts` |
| Permission UI | Toggle on card dashboard | `static/js/card-dashboard.js` or new `static/js/push.js` |
| Push triggers | After POS charge, after top-up, after void | `posChargeHandler.ts`, `topupHandler.ts`, void handler |
| Subscription storage | KV prefix `push_sub:` with 7-day TTL | Existing `UID_CONFIG` KV |

## Subscription Storage

```typescript
// KV key: push_sub:{uid}
// Value: JSON.stringify(PushSubscription)
// TTL: 7 days (auto-cleanup)
```

## Push Triggers

| Event | Notification |
|---|---|
| POS charge | "Charged X credits. Balance: Y" |
| Top-up | "Topped up X credits. Balance: Y" |
| Void | "Transaction voided. X credits refunded" |
| Card terminated | "Your card has been terminated" |

## Error Handling

- Fire-and-forget: push failures never block the main response
- 410 Gone / 404: delete stale subscription from KV
- 429: log warning, no retry (not critical path)
- Log all failures via existing `logger.warn()`

## VAPID Key Generation

```bash
npx @pushforge/builder vapid
# Output: { publicKey, privateKey (JWK) }
# Store: wrangler secret put VAPID_PRIVATE_KEY
# Store: VAPID_PUBLIC_KEY in wrangler.toml [vars]
```

## Tests Needed

- Subscribe/unsubscribe handler tests
- Push trigger integration (POS charge → push sent)
- SW push event handling
- Stale subscription cleanup (410 response)
- Permission flow (mocked)
