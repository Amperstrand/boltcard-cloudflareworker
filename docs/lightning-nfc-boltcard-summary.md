# Lightning NFC Notes: LNURL Tags vs Bolt Cards vs HTTPS Landing Pages

## Executive summary

There are three distinct NFC design patterns in this space:

1. **Static `lnurlw://` tag**
2. **Bolt Card on NTAG424**
3. **`https://` landing-page tag with Lightning handoff**

They solve different problems and should not be treated as interchangeable.

## Key findings

### 1) `lnurlw://` is the native Bolt Card style, not `https://`

For a real Bolt Card, the final URI on the card is **`lnurlw://...`**.

The official manual programming flow shows that when using TagXplorer you temporarily start with an `https://` protocol prefix in the UI, but then explicitly remove that prefix by changing the NDEF URI-prepend byte from `04` (`https://`) to `00` (no prepend). The end result is a card that contains `lnurlw://...`, not `https://lnurlw://...`.

Implication: a standard Bolt Card is **not** fundamentally an HTTPS redirect tag.

### 2) What a Bolt Card actually does

A Bolt Card is an **NFC payment credential for Lightning**, not a wallet that stores sats locally.

The official system flow is:

- merchant PoS reads the card via NFC
- merchant/backend makes an **LNURL-withdraw** request
- the customer's Bolt Card backend validates the card data and rules
- the backend wallet/node makes the Lightning payment

Implication: the card is best understood as a **tap-to-authorize payment token** for a backend Lightning flow.

### 3) What the Bolt Card writer / programmer does

The writer/programmer app is a **card provisioning tool**.

It programs a blank **NXP NTAG424 DNA** card to behave like a Bolt Card by doing things such as:

- writing the `lnurlw://...` URI template
- enabling dynamic authentication fields
- verifying the written data
- rotating/changing card keys
- wiping/resetting a card when the keys are known
- optionally enabling UID privacy/randomization

Implication: the writer is **not** the wallet and **not** the merchant app. It only sets up the hardware credential.

### 4) Static `lnurlw://` NFC tags are a different pattern

A cheap NFC tag with a fixed `lnurlw://...` record is the simple version.

This is useful for:

- gift cards
- vouchers
- low-risk claims
- one-time or small-value withdraw flows

But it is weaker than a real Bolt Card because it is static and lacks the dynamic authenticated tap flow of NTAG424-based Bolt Cards.

### 5) `https://` landing-page tags are valid, but they are a web-first fallback design

You can put an **`https://...`** URL on an NFC tag and have it:

- open the browser first
- show human-readable instructions or a landing page
- offer a button or link into a Lightning wallet
- optionally try to redirect into a wallet

This can be the best option when you want:

- broad phone compatibility
- a normal web fallback
- analytics / reconfiguration / content
- multi-wallet handling
- dual purpose (web + Lightning)

But it comes with tradeoffs:

- browser opens first
- extra tap / more friction
- worse tap-to-pay feel
- deep-link redirects are less reliable than a native app-to-app flow

Implication: `https://` is excellent for **consumer phone compatibility**, but it is **not the canonical Bolt Card model**.

## Compare and contrast

### A) Static `lnurlw://` tag

**Best for**
- simple vouchers
- gift cards
- small balances
- low-cost NFC projects

**Strengths**
- cheap and simple
- direct wallet handling when supported
- no web page required

**Weaknesses**
- static
- less private
- less secure for repeated use
- depends on wallet support for the scheme

### B) Bolt Card on NTAG424

**Best for**
- repeated merchant payments
- tap-to-pay UX
- stronger authenticity checks
- more serious Lightning card deployments

**Strengths**
- proper contactless card model
- dynamic authenticated data on each tap
- stronger privacy/security than a static tag
- designed for PoS/backend payment flow

**Weaknesses**
- more setup complexity
- requires NTAG424 cards
- requires backend infrastructure
- requires key management and card programming

### C) `https://` landing-page tag

**Best for**
- maximum compatibility
- user education / fallback flows
- mixed web + Lightning use
- one tag serving multiple purposes

**Strengths**
- universally understood by phones/browsers
- easy to update server-side
- can support multiple wallets and fallbacks
- easiest way to get "dual purpose" behavior

**Weaknesses**
- browser opens first
- app handoff can be fragile
- more friction than direct wallet or PoS flows

## Recommended decision rule

Use this rule of thumb:

- choose **static `lnurlw://`** for simple voucher / withdraw scenarios
- choose **Bolt Card on NTAG424** for real merchant tap-to-pay
- choose **`https://` landing page** for dual-purpose consumer phone UX

## Practical answer to the redirect question

Yes: you **can** prefix an NFC tag with `https://` and then redirect or hand off to a Lightning wallet.

But that should be treated as:

- a **web landing-page pattern**
- not a standard Bolt Card implementation
- a compatibility / fallback approach rather than the ideal tap-to-pay path

For the cleanest experience, it is usually safer to let the landing page present an explicit **"Open in wallet"** action rather than relying on an automatic redirect.

## Notes on LNbits

LNbits documents both patterns:

- simple static LNURL-withdraw style vouchers / NFC cards for lower-risk use cases
- a dedicated **Bolt Cards** extension for **NTAG424** cards that generate new links on each tap for improved privacy and security

That makes LNbits a useful reference point because it clearly distinguishes:
- static NFC withdraw tags
- real dynamic Bolt Cards

## Sources

- Bolt Card main repo: https://github.com/boltcard/boltcard
- Bolt Card system overview: https://github.com/boltcard/boltcard/blob/main/docs/SYSTEM.md
- Bolt Card manual card creation: https://github.com/boltcard/boltcard/blob/main/docs/CARD_MANUAL.md
- Official Bolt Card programmer repo: https://github.com/boltcard/bolt-card-programmer
- Amperstrand fork of the programmer: https://github.com/Amperstrand/bolt-card-programmer
- LNbits Bolt Cards extension: https://github.com/lnbits/boltcards
- Chrome Android intents / app-launch behavior: https://developer.chrome.com/docs/android/intents

## Short version

- **Bolt Card** -> `lnurlw://...`, dynamic, backend-mediated, PoS-oriented
- **Static LNURL tag** -> simple and cheap, good for vouchers
- **HTTPS tag** -> best compatibility and dual-purpose behavior, but browser-first
