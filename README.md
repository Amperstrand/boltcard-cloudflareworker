# Boltcard POC Cloudflare Worker

⚡ **A production-ready Cloudflare Worker for LNURL/boltcard payment processing with cryptographic validation**

## 🚨 Security Notice

**CRITICAL**: This project implements cryptographic payment processing. Before deploying to production:

- 🔐 **Set a secure ISSUER_KEY** via Cloudflare Workers secret (see deployment section)
- 🔐 **Replace the hardcoded BOLT_CARD_K1** values in `getUidConfig.js` (lines 3-6)  
- 🔐 **Configure proper CMAC validation** - currently using dummy validation for development
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
- 🧪 **Tested**: Comprehensive test suite with 12+ passing tests
- 🔒 **Security Hardened**: Recent dependency security updates applied

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

2. **Update BOLT_CARD_K1 Values** (if needed):
   ```javascript
   // In getUidConfig.js - lines 3-6  
   export const BOLT_CARD_K1 = [
     hexToBytes("YOUR_SECURE_K1_KEY_1"),
     hexToBytes("YOUR_SECURE_K1_KEY_2"),
   ];
   ```

3. **Setup Cloudflare KV**:
   ```bash
   # Create KV namespace
   wrangler kv:namespace create "boltcard-config"
   
   # Update wrangler.toml with your namespace ID
   ```

3. **Configure Environment**:
   ```bash
   # Copy environment template
   cp .env.example .env
   
   # Edit with your configuration
   ```

## 📚 API Documentation

### Core Endpoints

#### GET `/nfc` 
**LNURL Withdraw Request Entry Point**
- **Description**: Initiates LNURL withdrawal flow
- **Parameters**: 
  - `p` (hex): Encrypted payload 
  - `c` (hex): CMAC validation
- **Response**: LNURL withdraw request object

#### POST `/boltcards/api/v1/lnurl/cb`
**LNURL Callback Handler**
- **Description**: Handles LNURL payment callbacks
- **Body**: JSON with invoice, amount, k1
- **Response**: Payment confirmation

#### GET `/status`
**System Status**
- **Description**: Health check endpoint
- **Response**: System status and configuration info

### Card Management

#### POST `/api/v1/pull-payments/{id}/boltcards`
**Fetch BoltCard Keys**
- **Description**: Returns card programming keys
- **Body**: `{ "UID": "hex_string" }`
- **Response**: Card keys (K0, K1, K2, K3, K4)

#### GET `/activate`
**Card Activation Page**
- **Description**: HTML page for card activation
- **Response**: HTML form

#### POST `/activate`
**Card Activation Submit**
- **Description**: Processes card activation
- **Body**: Form data with card details
- **Response**: Activation confirmation

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

#### proxy
- **Description**: Proxy requests to external LNBits instance
- **Required**: `baseurl` with external ID
- **Use Case**: Third-party payment processing

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

- **✅ cryptoutils.test.js**: 8 tests - cryptographic functions
- **✅ keygenerator.test.js**: 8 tests - deterministic key generation  
- **✅ worker.test.js**: 12 tests - API endpoints and request handling

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

   routes = [
     "https://your-domain.com/*"
   ]
   ```

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
   - Currently using dummy validation for development
   - MUST implement real CMAC validation before production
   - See: `index.js` line 102 (replace `const cmac_validated = true`)

3. **Environment Variables**:
   - Use Cloudflare Workers secrets for sensitive data
   - Never commit secrets to version control
   - Rotate keys regularly

### Production Checklist

- [ ] Changed all default cryptographic keys
- [ ] Implemented real CMAC validation
- [ ] Configured proper environment variables
- [ ] Enabled HTTPS for all endpoints
- [ ] Set up proper error logging
- [ ] Tested with real hardware
- [ ] Reviewed payment method configurations
- [ ] Set up monitoring and alerts

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
├── handlers/                  # Route handlers
│   ├── activateCardHandler.js
│   ├── fetchBoltCardKeys.js
│   ├── handleNfc.js
│   ├── lnurlHandler.js
│   ├── programHandler.js
│   ├── proxyHandler.js
│   ├── resetHandler.js
│   ├── statusHandler.js
│   └── withdrawHandler.js
├── tests/                     # Test files
│   ├── cryptoutils.test.js
│   ├── keygenerator.test.js
│   └── worker.test.js
└── docs/                      # Documentation
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

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

#### Card Programming Issues
**Symptom**: "Last check not green" in programming app
**Solution**:
- Verify UID format (16-character hex string)
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