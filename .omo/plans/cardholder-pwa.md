# Cardholder PWA Implementation Plan

## Goal
Transform `/card` into an installable Progressive Web App for festival attendees. One-tap access to balance, history, and card management after initial NFC enrollment.

## Target User Flow
1. Attendee sees QR code at venue: "Scan to get your festival wallet"
2. QR opens `https://boltcardpoc.psbt.me/card` in Chrome
3. Taps NFC card → card is linked to the PWA
4. Chrome prompts "Add to Home Screen"
5. Future opens: auto-loads card, shows balance instantly
6. Offline: shows last-known balance with stale indicator

## Architecture

### Existing (no changes needed)
- `GET /card/info?p=X&c=Y` — balance, history, analytics, state
- `POST /api/card/lock` — terminate card (CMAC auth)
- `POST /api/card/reactivate` — re-activate card
- `GET /api/receipt/:txnId?uid=X` — transaction receipt
- Web NFC scanner in `static/js/nfc.js`
- Dark theme Tailwind UI in `templates/cardDashboardPage.ts`

### New Files
1. `static/manifest.webmanifest` — PWA manifest (name, icons, theme, display)
2. `static/sw.js` — Service worker (cache shell, stale-while-revalidate API)
3. `static/icons/icon-192.png` — App icon 192x192
4. `static/icons/icon-512.png` — App icon 512x512

### Modified Files
1. `templates/cardDashboardPage.ts` — Add manifest link, sw registration, enhanced UI
2. `static/js/card-dashboard.js` — Add localStorage persistence, install prompt, pull-to-refresh
3. `templates/pageShell.ts` — Add manifest link to all pages (or card page only)
4. `index.ts` — Serve manifest.webmanifest and sw.js routes
5. `AGENTS.md` — Document new routes and PWA patterns

## Technical Decisions

### Service Worker Strategy
- **Shell**: Cache-first — HTML, CSS (Tailwind CDN), JS files cached on install
- **API (`/card/info`)**: Stale-while-revalidate — show cached data, update in background
- **Static assets**: Cache-first with versioned cache names
- **Non-API routes**: Network-only (don't cache operator pages)

### Card Credential Storage
- Store `p` and `c` params in `localStorage` after successful scan
- Key: `boltcard_params` → `{ p: "...", c: "...", savedAt: timestamp }`
- Auto-load on page open: if saved params exist, fetch `/card/info` immediately
- "Remove card" option to clear localStorage
- Privacy note: p/c are encrypted card params, not raw UID — acceptable for festival context

### Install Prompt
- Capture `beforeinstallprompt` event on first visit
- Show install banner after successful card scan (not before — earn the prompt)
- Dismiss permanently if user rejects
- Store dismissal in `localStorage`

### Offline Behavior
- Service worker serves cached shell + last API response
- UI shows "Last updated X min ago" banner when stale
- Pull-to-refresh (or refresh button) attempts network fetch
- If offline: banner says "Offline — showing last known balance"

### Icons
- Generate simple SVG-based icons (no external assets needed)
- Use inline SVG → PNG conversion or simple emoji-based icons
- Actually: use a simple generated SVG with the app initials, converted to PNG
- For now: placeholder icons (can be replaced with branded icons later)

## Implementation Steps

### Step 1: PWA Manifest
Create `static/manifest.webmanifest`:
```json
{
  "name": "My Bolt Card",
  "short_name": "Bolt Card",
  "description": "Your festival payment card",
  "start_url": "/card",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#10b981",
  "icons": [
    { "src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Step 2: Service Worker
Create `static/sw.js`:
- Install event: cache shell resources (HTML, JS, CSS CDN)
- Fetch event: route-based strategy
  - `/card/info` → stale-while-revalidate
  - `/static/js/*`, `/static/icons/*` → cache-first
  - `https://cdn.tailwindcss.com/*` → cache-first
  - Everything else → network-only
- Activate event: clean old caches

### Step 3: Generate Icons
Create simple PNG icons (192x192 and 512x512) with a bolt/lightning symbol.

### Step 4: Enhanced Card Dashboard
Modify `templates/cardDashboardPage.ts`:
- Add `<link rel="manifest" href="/static/manifest.webmanifest">`
- Add `<meta name="theme-color" content="#10b981">`
- Add service worker registration script
- Add localStorage check: if saved params, auto-load card info
- Enhanced balance display (larger, more prominent)
- Transaction history with better formatting
- "Last updated" timestamp
- Install prompt banner area

### Step 5: Enhanced Card JS
Modify `static/js/card-dashboard.js`:
- On successful card scan: save p/c to localStorage
- On page load: check localStorage, auto-fetch if params exist
- Add `beforeinstallprompt` handler
- Add pull-to-refresh gesture (touchstart/touchend on scroll container)
- Show stale data indicator when offline

### Step 6: Route Registration
Add to `index.ts`:
- `GET /static/manifest.webmanifest` → serve manifest with correct content-type
- `GET /static/sw.js` → serve service worker with correct content-type
- Service worker scope must cover `/card`

### Step 7: Page Shell Updates
Modify `templates/pageShell.ts`:
- Add manifest link and theme-color meta to all pages (or card page only)
- Scope: only card-related pages need PWA treatment

## Constraints
- No npm dependencies — vanilla JS service worker, no Workbox
- Service worker must work within Cloudflare Worker static asset constraints
- All static files served via existing `/static/*` route pattern
- Must pass existing lint rules (no innerHTML, staticScript for JS)
- Icons: simple generated PNGs, no design tool dependency

## Testing
- Manual: install PWA on Android Chrome, verify offline behavior
- Verify service worker registration in DevTools
- Verify manifest in Chrome DevTools > Application
- Test localStorage persistence across sessions
- Test offline mode (Airplane mode)
- Existing tests must still pass
