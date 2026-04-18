# Boltcard POC Cloudflare Worker

⚡ **A production-ready Cloudflare Worker for LNURL/boltcard payment processing with cryptographic validation**

## 🚨 Security Notice

**CRITICAL**: This project implements cryptographic payment processing. Before deploying to production:

- 🔐 **Set a secure ISSUER_KEY** via Cloudflare Workers secret (see deployment section)
- 🔐 **Set explicit K1 decryption keys** via `BOLT_CARD_K1_0` / `BOLT_CARD_K1_1` (or `BOLT_CARD_K1`) instead of relying on development fallbacks
- 🔐 **Review all cryptographic constants** and ensure they match your security requirements

## 🔑 Development Key

**For POC and Development Only**: 

This project currently uses the development key:
```
ISSUER_KEY: 00000000000000000000000000000001
```

**⚠️ IMPORTANT**: This key is **ONLY SAFE FOR DEVELOPMENT AND TESTING**. It is publicly known and should **NEVER** be used in production.

### **Why This Development Key?**

- **Deterministic Testing**: Ensures consistent key generation across environments
- **Development Safety**: Clearly identifiable as a test key, preventing accidental production use
- **Educational Purpose**: Demonstrates the key generation process safely

### **When to Replace This Key:**

- ❌ **Keep for**: Local development, testing, proof-of-concept demonstrations
- ✅ **Replace for**: Any production deployment, real financial transactions, live systems

## 🎯 Project Overview

This project implements a Cloudflare Worker for handling LNURL/boltcard payment requests. It supports two methods for managing UID configurations:

1. **Static Configuration (`staticUidConfig` in getUidConfig.js)**  
   A JavaScript object that exports UID configuration. Useful for development or smaller deployments.

2. **Dynamic Configuration via Cloudflare KV**  
   Each UID is stored as an individual key in a Cloudflare KV namespace. Scales well for production deployments.

The worker first attempts to fetch the UID configuration from KV. If no entry is found (or if KV binding is not set up), it falls back to the static configuration.

## ✅ Key Features

- 🔐 **Cryptographic Security**: AES-CMAC validation with deterministic key generation
- 💳 **Multi-Payment Support**: clnrest, proxy, and fakewallet payment methods  
- 🌐 **LNURL Protocol**: Complete LNURL-withdraw implementation
- 📱 **NFC Card Programming**: Card activation and programming endpoints
- 🔒 **Replay Protection**: Atomic counter-based replay protection using Durable Objects with SQLite storage — strongly consistent, not eventually consistent
- 🛡️ **DDoS Rate Limiting**: IP-based fixed-window rate limiting (100 req/min default)
- 🧪 **Tested**: Comprehensive test suite with 59 passing tests across 4 test suites

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cloudflare    │    │   Request       │    │   Payment       │
│    Worker       │───▶│   Routing       │───▶│   Method        │
│   (index.js)    │    │   Logic         │    │   Handlers      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Configuration │    │   Cryptographic │    │   External      │
│   Management    │◀───│   Validation    │◀───│   Services      │
│   (KV + Static) │    │   (AES-CMAC)    │    │   (LNBits/CLN)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Rate Limiter  │    │ Replay Protection│   │   Durable       │
│   (KV-based)    │    │ (replayProtection│   │   Objects       │
│                 │    │     .js)         │───▶│ (CardReplayDO)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers enabled
- Wrangler CLI installed
- Bolt Card NFC Programmer app (iOS/Android)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd boltcard-cloudflareworker

# Install dependencies
npm install

# Run tests
npm test

# Deploy to Cloudflare
npm run deploy
```

### Configuration

1. **Set ISSUER_KEY Secret** (CRITICAL):
   
   The ISSUER_KEY is now configured via Cloudflare Workers secrets for security:
   
   ```bash
   # For development (uses fallback key)
   # No action needed - uses 00000000000000000000000000000001
   
   # For production deployment:
   wrangler secret put ISSUER_KEY
   
   # When prompted, enter your secure 16-byte hex key, e.g.:
   # A1B2C3D4E5F60718293A4B5C6D7E8F901
   ```
   
   **Key Generation** (for production):
   ```javascript
   // Generate a secure random key
   const crypto = require('crypto');
   const secureKey = crypto.randomBytes(16).toString('hex').toUpperCase();
   console.log(secureKey); // e.g., "A1B2C3D4E5F60718293A4B5C6D7E8F901"
   ```

2. **Set K1 decryption keys** (recommended for production):
   ```bash
   wrangler secret put BOLT_CARD_K1_0
   wrangler secret put BOLT_CARD_K1_1
   ```

   The worker supports either two separate secrets (`BOLT_CARD_K1_0`, `BOLT_CARD_K1_1`) or a single comma-separated value in `BOLT_CARD_K1`. If none are set, it falls back to development keys for local testing only.

3. **Setup Cloudflare KV**:
   ```bash
   # Create KV namespace
   wrangler kv:namespace create "boltcard-config"
   
   # Update wrangler.toml with your namespace ID
   ```

4. **Setup Rate Limit KV** (optional, for DDoS protection):
   ```bash
   # Create rate limit namespace
   wrangler kv:namespace create "RATE_LIMITS"
   
   # Update wrangler.toml with the returned namespace ID
   ```

5. **Review `wrangler.toml` bindings before deploy**:
   - Replace the placeholder `RATE_LIMITS_KV_ID` if you want DDoS throttling enabled
   - Confirm your `UID_CONFIG` namespace ID is correct
   - Keep the `CARD_REPLAY` Durable Object binding and `v1` migration in place

## 📚 API Documentation

### Core Endpoints

#### GET `/`
**LNURL Withdraw Flow Entry Point**
- **Description**: Main LNURL-withdraw flow
- **Parameters**: 
  - `p` (hex): Encrypted payload
  - `c` (hex): CMAC validation
- **Response**: LNURL withdraw request object

#### GET `/nfc`
**NFC Scanner Page**
- **Description**: Serves an HTML page for NFC scanning
- **Response**: HTML page

#### GET `/status`
**System Status / Health Check**
- **Description**: Health check endpoint. Redirects to `/activate` if no KV configuration is found
- **Response**: System status and configuration info, or redirect to activation page

#### GET `/activate`
**Card Activation Page**
- **Description**: HTML page for card activation with QR codes
- **Response**: HTML page with activation form and QR codes

#### GET `/wipe?uid=XXX`
**Card Wipe Page**
- **Description**: HTML page for wiping a card's configuration
- **Parameters**:
  - `uid` (query): Card UID to wipe
- **Response**: HTML page

#### POST `/api/v1/pull-payments/{id}/boltcards`
**Card Programming / Reset**
- **Description**: Returns card programming keys, supports both UpdateVersion and KeepVersion modes, including old app compatibility (UID) and new app (LNURLW)
- **Body**: `{ "UID": "hex_string" }`
- **Response**: Card keys (K0, K1, K2, K3, K4)

#### POST `/boltcards/api/v1/lnurl/cb`
**LNURL Callback Handler**
- **Description**: Handles LNURL payment callbacks. Supports both GET with `pr` param and POST with `k1` body field
- **Body**: JSON with invoice, amount, k1
- **Response**: Payment confirmation

## 🔧 Configuration Options

### Static Configuration Example

```javascript
export const staticUidConfig = {
  "044561fa967380": {
    K2: "33268DEA5B5511A1B3DF961198FA46D5",
    payment_method: "clnrest",
    clnrest: {
      protocol: "https",
      host: "your-cln-node.com",
      port: 3001,
      rune: "your-rune-token"
    }
  },
  "04a071fa967380": {
    K2: "EFCF2DD0528E57FF2E674E76DFC6B3B1",
    payment_method: "fakewallet"
  }
};
```

### Payment Methods

#### clnrest
- **Description**: Direct integration with Core Lightning REST API
- **Required**: `host`, `port`, `rune`
- **Protocol**: HTTPS recommended
- **Status check**: Uses HTTP 201 response + JSON body to verify invoice creation

#### proxy
- **Description**: Proxy requests to external LNBits instance
- **Required**: `baseurl` with external ID
- **Use Case**: Third-party payment processing
- **Note**: When K2 is absent, the worker skips local CMAC validation and relays to the downstream service, which performs validation itself

#### fakewallet
- **Description**: Testing/development payment method
- **Use Case**: Development and testing only

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --testNamePattern="cryptoutils"

# Run with verbose output
npm test -- --verbose
```

### Test Coverage

- **✅ cryptoutils.test.js**: Cryptographic functions
- **✅ keygenerator.test.js**: Deterministic key generation  
- **✅ worker.test.js**: API endpoints and request handling
- **✅ integration.test.js**: End-to-end integration tests
- **Total**: 119 passing tests across 8 test suites

### Test Vectors

Use these test vectors for validation:

```bash
# LNURL verification tests
curl 'https://your-worker.domain/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE'
curl 'https://your-worker.domain/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4'
curl 'https://your-worker.domain/?p=0DBF3C59B59B0638D60B5842A997D4D1&c=CC61660C020B4D96'
```

## 🚀 Deployment

### Cloudflare Deployment

1. **Configure wrangler.toml**:
   ```toml
   name = "boltcard-worker"
   type = "javascript"
   compatibility_date = "2025-02-28"

   kv_namespaces = [
     { binding = "UID_CONFIG", id = "your-kv-namespace-id" }
   ]

   [[durable_objects.bindings]]
   name = "CARD_REPLAY"
   class_name = "CardReplayDO"

   [[migrations]]
   tag = "v1"
   new_sqlite_classes = ["CardReplayDO"]

   kv_namespaces = [
     { binding = "UID_CONFIG", id = "your-kv-namespace-id" },
     { binding = "RATE_LIMITS", id = "your-rate-limit-kv-id" } # optional
   ]

   routes = [
     "https://your-domain.com/*"
   ]
   ```

   > **Note**: The Durable Object binding and migration are already configured in the repo's `wrangler.toml`. The first `wrangler deploy` will create the DO namespace and run the migration automatically. The `RATE_LIMITS` binding is optional and only provides coarse DDoS throttling.

2. **Deploy**:
   ```bash
   # Test deployment
   wrangler dev
   
   # Production deployment
   wrangler deploy
   ```

### DNS Setup

1. **Add CNAME Record**:
   - **Type**: CNAME
   - **Name**: boltcard (or your preferred subdomain)
   - **Target**: workers.dev (or your custom domain)
   - **Proxy**: Enabled (orange cloud)

2. **Configure Custom Domain** in Cloudflare Dashboard

## 🔒 Security Considerations

### Critical Security Items

1. **Cryptographic Keys**: 
   - NEVER use the default hardcoded keys in production
   - Generate cryptographically secure random keys
   - Store keys securely (environment variables, secrets manager)

2. **CMAC Validation**:
   - AES-CMAC validation (RFC 4493) is implemented and validates card requests using K2 keys
   - In proxy mode, CMAC validation is optional: if K2 is absent, validation is delegated to the downstream service

3. **Environment Variables**:
   - Use Cloudflare Workers secrets for sensitive data
   - Never commit secrets to version control
   - Rotate keys regularly

4. **Replay Protection**:
   - Implemented via Durable Objects with SQLite storage — each card UID gets its own DO instance
   - Counter validation is **atomic** using SQL `INSERT ... ON CONFLICT ... WHERE last_counter < new RETURNING`
   - Strongly consistent (not eventually consistent like KV) — all requests for a given card are serialized through a single DO instance
   - Fails **closed**: if the DO is unreachable, the request is rejected (500) rather than allowed through
   - Replay state is automatically reset on card wipe, reprogramming, and activation

5. **Rate Limiting**:
   - Implemented as a KV-backed fixed-window counter on `CF-Connecting-IP`
   - Intended as **best-effort DDoS throttling**, not a strict security boundary
   - KV read/write is not atomic, so treat it as coarse abuse reduction rather than precise enforcement

### Production Checklist

- [ ] Changed all default cryptographic keys
- [ ] Configured proper environment variables
- [ ] Enabled HTTPS for all endpoints
- [ ] Set up proper error logging
- [ ] Tested with real hardware
- [ ] Reviewed payment method configurations
- [ ] Set up monitoring and alerts
- [ ] Verified Durable Object binding is active (replay protection)
- [ ] Created RATE_LIMITS KV namespace if DDoS throttling is desired

## 🛠️ Development

### Local Development

```bash
# Install dependencies
npm install

# Start development server
wrangler dev

# Run tests in watch mode  
npm test -- --watch

# Lint code
npm run lint
```

### Project Structure

```
├── index.js                    # Main worker entry point
├── boltCardHelper.js          # Card validation & CMAC logic
├── cryptoutils.js             # Crypto utilities (AES-CMAC)
├── getUidConfig.js            # Configuration management
├── keygenerator.js            # Deterministic key generation
├── rateLimiter.js             # IP-based DDoS rate limiting
├── replayProtection.js        # Replay protection helper (routes to DO)
├── durableObjects/            # Durable Object classes
│   └── CardReplayDO.js        # Per-card SQLite-backed replay counter
├── handlers/                  # Route handlers
│   ├── activateCardHandler.js
│   ├── fetchBoltCardKeys.js
│   ├── handleNfc.js
│   ├── loginHandler.js        # NFC login + key recovery
│   ├── lnurlHandler.js
│   ├── programHandler.js
│   ├── proxyHandler.js
│   ├── resetHandler.js
│   ├── statusHandler.js
│   └── withdrawHandler.js
├── keys/                      # Key recovery CSV files (source of truth)
│   ├── _default.csv           # Default issuer keys (tried for all cards)
│   ├── boltcardpoc.psbt.me.csv
│   └── _percard_k.psbt.me.csv # Per-card keys from k.psbt.me
├── scripts/
│   └── build_keys.js          # CSV → JS bundler (run before deploy)
├── utils/
│   ├── generatedKeyData.js    # AUTO-GENERATED — bundled key data
│   ├── keyLookup.js           # Key lookup functions
│   ├── lightningAddress.js
│   ├── logger.js
│   ├── otp.js
│   └── responses.js
├── tests/                     # Test files
│   ├── cloudflare-workers-shim.js
│   ├── cryptoutils.test.js
│   ├── integration.test.js
│   ├── keygenerator.test.js
│   ├── keyLookup.test.js
│   └── worker.test.js
└── docs/                      # Documentation
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

## 🔑 Bolt Card Key Recovery

This service helps bolt card owners recover their cards. If you have an NTAG424 bolt card from a defunct or abandoned service, tap it on the [login page](https://boltcardpoc.psbt.me/login) — if we have your keys, you'll see them and get a link to wipe and repurpose the card.

### How It Works

1. Card owner taps their card on the login page (Web NFC) or scans the card URL
2. The server tries to decrypt the card using all known issuer keys and per-card key dumps
3. If a match is found, the card's keys (K0–K4) are displayed
4. For recovered cards, a "wipe and reprogram" deeplink opens the Bolt Card programmer app

### Submitting Keys — Pull Requests Welcome

If you run (or ran) a bolt card service and want to help users recover their cards, submit a pull request with a key file.

**Option A: Issuer key** — if you used deterministic key derivation (one master key for all cards):

Create `keys/your-domain.example.csv`:
```csv
issuer_key,label
your32charhexkey,your-service-name
```

**Option B: Per-card keys** — if you used per-card keys (e.g. LNBits):

Create `keys/_percard_your-domain.example.csv`:
```csv
uid,k0,k1,k2,card_name
040a69fa967380,d6672015...,3db8852a...,ce08c579...,optional-name
```

**Exporting from LNBits:**
```bash
sqlite3 /path/to/ext_boltcards.sqlite3 -csv -header \
  "SELECT uid, k0, k1, k2 FROM boltcards.cards;" > keys/_percard_your-domain.csv
```

Then run `node scripts/build_keys.js` and `npm test` to regenerate the bundled key data and verify.

### Important Notes

- **These keys are already public** — they were stored on the card's NFC chip. Publishing them lets owners verify and repurpose their cards.
- **For LNBits cards**: K3 = K1 and K4 = K2 (per LNBits convention).
- **Counter values are not needed** for key recovery and should not be included in exports.

## 📚 Programming Guide

For detailed card programming instructions, see [guide.md](guide.md).

## 🔍 Troubleshooting

### Common Issues

#### CMAC Validation Failed
**Symptom**: Payments failing with CMAC errors
**Solution**: 
- Check K2 key configuration
- Ensure proper key generation
- Verify hex string formats

#### KV Connection Errors  
**Symptom**: 500 errors, KV test failures
**Solution**:
- Verify KV namespace binding in wrangler.toml
- Check Cloudflare account permissions
- Ensure KV namespace exists
- If using rate limiting, replace the placeholder `RATE_LIMITS_KV_ID` in `wrangler.toml`

#### Card Programming Issues
**Symptom**: "Last check not green" in programming app
**Solution**:
- Verify UID format (14-character hex string / 7 bytes)
- Check network connectivity
- Ensure server accessibility from mobile device

### Debug Logging

Enable debug logging by setting:
```javascript
const DEBUG = true;  // In relevant files
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

For issues and questions:
- Check the troubleshooting section first
- Review existing GitHub issues
- Create a new issue with detailed information

---

**⚠️ Remember: This is financial software. Test thoroughly and ensure proper security measures before production deployment.**
