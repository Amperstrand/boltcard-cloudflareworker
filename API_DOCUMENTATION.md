# Boltcard Cloudflare Worker API Documentation

## Overview

This document provides comprehensive API documentation for the Boltcard Cloudflare Worker, a production-ready LNURL/boltcard payment processing system with cryptographic validation. The API supports multiple payment methods, card management, and secure NFC card operations.

## Base URL

```
https://your-worker-domain.workers.dev
```

## Authentication

The API uses cryptographic validation for security:
- **AES-CMAC validation** for card authentication
- **Deterministic key generation** for card configuration
- **UID-based configuration** stored in Cloudflare KV or static configuration

## API Endpoints

### 1. NFC Payment Processing

#### GET `/nfc`
**LNURL Withdraw Request Entry Point**

**Description**: Serves an HTML interface for NFC scanning and LNURL payment processing. This endpoint provides a web-based interface for testing and processing Boltcard payments.

**Response**: HTML page with NFC scanning interface

**Features**:
- NFC card scanning with UID extraction
- QR code scanning for BOLT11 invoices
- Real-time payment processing
- Verifiable credentials display
- Interactive payment status

**Example Usage**:
```bash
curl -I https://your-worker.workers.dev/nfc
```

**Response Body**: Interactive HTML page with NFC capabilities

---

### 2. System Status

#### GET `/status`
**System Health Check**

**Description**: Returns system status and configuration information. Tests KV connectivity if available.

**Parameters**: None

**Responses**:

**Success (200) - HTML Status Page**:
```html
<!DOCTYPE html>
<html>
<head><title>Boltcard Setup</title></head>
<body>
  <h1>Boltcard Setup/Reset</h1>
  <!-- Contains QR codes for card programming and reset -->
</body>
</html>
```

**Success (200) - JSON Status (with KV binding)**:
```json
{
  "status": "OK",
  "kv_status": "working",
  "message": "Server is running"
}
```

**Error (500)**:
```json
{
  "status": "ERROR",
  "kv_status": "error",
  "error": "Error message details"
}
```

---

### 3. Card Management

#### POST `/api/v1/pull-payments/{id}/boltcards`
**Fetch BoltCard Keys**

**Description**: Returns cryptographic keys for card programming or reset operations. This endpoint is used by the Boltcard NFC Programmer app.

**Path Parameters**:
- `id` (string): Pull payment ID (e.g., `fUDXsnySxvb5LYZ1bSLiWzLjVuT`)

**Query Parameters**:
- `onExisting` (string, required): Action to perform
  - `UpdateVersion`: Generate new keys for card programming
  - `KeepVersion`: Regenerate existing keys for card reset

**Request Body**:
```json
{
  "UID": "04a071fa967380",
  "LNURLW": "lnurlw://example.com/ln?p=...&c=..."
}
```

**Validation**:
- For `UpdateVersion`: `UID` must be provided (14 hex characters)
- For `KeepVersion`: `LNURLW` must be provided with valid `p` and `c` parameters

**Success Response (200)**:
```json
{
  "protocol_name": "new_bolt_card_response",
  "protocol_version": 1,
  "card_name": "UID 04A071FA967380",
  "LNURLW": "lnurlw://boltcardpoc.psbt.me/ln",
  "K0": "K0_hex_value",
  "K1": "K1_hex_value", 
  "K2": "K2_hex_value",
  "K3": "K3_hex_value",
  "K4": "K4_hex_value"
}
```

**Error Responses**:

**Invalid Method (405)**:
```json
{
  "error": "Only POST allowed"
}
```

**Missing Parameters (400)**:
```json
{
  "error": "Must provide UID for programming, or LNURLW for reset"
}
```

**Invalid LNURLW (400)**:
```json
{
  "error": "Invalid LNURLW format: missing 'p' or 'c'"
}
```

**Configuration Error (400)**:
```json
{
  "error": "UID not found in config"
}
```

---

### 4. LNURL Payment Processing

#### POST `/boltcards/api/v1/lnurl/cb`
#### GET `/boltcards/api/v1/lnurl/cb/{pHex}`
**LNURL Payment Callback Handler**

**Description**: Handles LNURL payment callbacks and processes withdrawal requests. Supports both GET and POST methods.

**Path Parameters** (Optional):
- `pHex` (string): Encrypted payload hex string (alternative to query parameter)

**Query Parameters**:
- `k1` (string, required): CMAC validation key or contains p/c parameters
- `pr` (string, required for GET): BOLT11 invoice for payment

**Request Body** (POST):
```json
{
  "k1": "cHex_value"
}
```

**Processing Flow**:
1. Extract and validate `p` and `c` parameters
2. Decode UID and counter using cryptographic keys
3. Retrieve UID configuration
4. Process payment based on payment method:
   - `fakewallet`: Simulated payment with alternating success/failure
   - `clnrest`: Real payment via Core Lightning REST API
   - `proxy`: Forward request to external LNBits instance

**Success Responses**:

**Payment Processed (200)**:
```json
{
  "status": "OK",
  "message": "Payment processed successfully"
}
```

**POST Acknowledgment (200)**:
```json
{
  "status": "200",
  "message": "POST received"
}
```

**Error Responses**:

**Missing Parameters (400)**:
```json
{
  "status": "ERROR",
  "reason": "Missing k1 parameter"
}
```

**Invalid K1 Format (400)**:
```json
{
  "status": "ERROR", 
  "reason": "Invalid k1 format, missing p or c"
}
```

**Decryption Failure (400)**:
```json
{
  "status": "ERROR",
  "reason": "Failed to decode UID"
}
```

**Configuration Not Found (400)**:
```json
{
  "status": "ERROR",
  "reason": "UID configuration not found"
}
```

**Payment Processing Error (400-500)**:
```json
{
  "status": "ERROR",
  "reason": "Payment processing error details"
}
```

---

### 5. Card Activation

#### GET `/activate`
**Card Activation Page**

**Description**: Serves an HTML form for card activation with NFC scanning capabilities.

**Response**: HTML page with activation form

**Features**:
- Manual UID input with validation
- NFC scanning for automatic UID capture
- Form validation for 14-character hex UID format
- Real-time status feedback

---

#### POST `/activate`
**Card Activation Submit**

**Description**: Processes card activation by generating cryptographic keys and storing configuration.

**Request Body**:
```json
{
  "uid": "04a071fa967380"
}
```

**Validation**:
- UID must be exactly 14 hexadecimal characters (7 bytes)
- UID will be normalized to lowercase

**Processing Flow**:
1. Validate UID format
2. Test KV storage access
3. Generate deterministic cryptographic keys
4. Create configuration with fakewallet payment method
5. Store configuration in Cloudflare KV
6. Verify successful storage

**Success Response (201)**:
```json
{
  "status": "SUCCESS",
  "message": "Card with UID 04a071fa967380 has been activated with fakewallet payment method.",
  "uid": "04a071fa967380",
  "config": {
    "K2": "K2_hex_value",
    "payment_method": "fakewallet"
  }
}
```

**Error Responses**:

**Invalid UID Format (400)**:
```json
{
  "status": "ERROR",
  "reason": "Invalid UID format. Must be 14 hexadecimal characters (7 bytes)."
}
```

**KV Access Failure (500)**:
```json
{
  "status": "ERROR",
  "reason": "KV access test failed: Error details"
}
```

**Key Generation Failure (500)**:
```json
{
  "status": "ERROR", 
  "reason": "Failed to generate keys for the UID."
}
```

**Storage Failure (500)**:
```json
{
  "status": "ERROR",
  "reason": "Failed to save card configuration: Error details"
}
```

---

## Payment Methods

### 1. Fakewallet
**Testing/Development Payment Method**

**Description**: Simulated payment processing for testing and development.

**Behavior**:
- Alternates between success and failure on each attempt
- No real financial transactions
- Useful for testing integration

**Configuration**:
```json
{
  "payment_method": "fakewallet",
  "K2": "K2_hex_value"
}
```

### 2. CLN REST
**Core Lightning Integration**

**Description**: Direct integration with Core Lightning REST API for real payments.

**Configuration Requirements**:
```json
{
  "payment_method": "clnrest",
  "K2": "K2_hex_value",
  "clnrest": {
    "protocol": "https",
    "host": "your-cln-node.com",
    "port": 3001,
    "rune": "your-rune-token"
  }
}
```

**Authentication**: Uses Rune token for API authentication

### 3. Proxy
**External Service Proxy**

**Description**: Forwards payment requests to external LNBits instances.

**Configuration Requirements**:
```json
{
  "payment_method": "proxy",
  "K2": "K2_hex_value", 
  "proxy": {
    "baseurl": "https://external-lnbits.com/boltcards/api/v1/scan/externalId"
  }
}
```

**Behavior**: Proxies all requests to the specified external URL

---

## Error Handling

### Standard Error Format

All API errors follow this format:

```json
{
  "status": "ERROR",
  "reason": "Human-readable error description"
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters or data |
| 405 | Method Not Allowed - Incorrect HTTP method |
| 500 | Internal Server Error - Server-side failure |

### Specific Error Scenarios

#### CMAC Validation Failure
```json
{
  "status": "ERROR",
  "reason": "CMAC validation failed"
}
```

#### UID Not Found
```json
{
  "status": "ERROR", 
  "reason": "UID not found in config"
}
```

#### KV Storage Error
```json
{
  "status": "ERROR",
  "reason": "KV access test failed: Error details"
}
```

---

## Configuration Management

### Static Configuration

UID configurations can be defined in `getUidConfig.js`:

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
  }
};
```

### Dynamic Configuration (KV Storage)

For production deployments, use Cloudflare KV storage:

1. **KV Namespace Setup**:
```bash
wrangler kv:namespace create "boltcard-config"
```

2. **Configuration Storage**:
```javascript
// Store configuration
await env.UID_CONFIG.put(uid, JSON.stringify(config));

// Retrieve configuration  
const configStr = await env.UID_CONFIG.get(uid);
const config = JSON.parse(configStr);
```

3. **Fallback Strategy**:
- KV storage checked first
- Static configuration used as fallback
- Deterministic key generation as final fallback

---

## Security Considerations

### Critical Security Items

1. **Cryptographic Keys**:
   - Never use default hardcoded keys in production
   - Generate cryptographically secure random keys
   - Store keys securely using Cloudflare Workers secrets

2. **CMAC Validation**:
   - Currently using dummy validation for development
   - MUST implement real CMAC validation before production
   - Ensure proper key generation and storage

3. **Environment Configuration**:
   - Use Cloudflare Workers secrets for sensitive data
   - Never commit secrets to version control
   - Rotate keys regularly

### Production Security Checklist

- [ ] Changed all default cryptographic keys
- [ ] Implemented real CMAC validation
- [ ] Configured proper environment variables
- [ ] Enabled HTTPS for all endpoints
- [ ] Set up proper error logging
- [ ] Tested with real hardware
- [ ] Reviewed payment method configurations
- [ ] Set up monitoring and alerts

---

## Testing

### API Test Endpoints

#### Test Card Activation
```bash
curl -X POST https://your-worker.workers.dev/activate \
  -H "Content-Type: application/json" \
  -d '{"uid": "04a071fa967380"}'
```

#### Test Card Key Generation
```bash
curl -X POST "https://your-worker.workers.dev/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion" \
  -H "Content-Type: application/json" \
  -d '{"UID": "04a071fa967380"}'
```

#### Test LNURL Payment
```bash
curl "https://your-worker.workers.dev/boltcards/api/v1/lnurl/cb?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE&pr=lnbc1...invoice"
```

### Test Vectors

Use these test vectors for validation:

```bash
# LNURL verification tests
curl 'https://your-worker.domain/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE'
curl 'https://your-worker.domain/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4'  
curl 'https://your-worker.domain/?p=0DBF3C59B59B0638D60B5842A997D4D1&c=CC61660C020B4D96'
```

---

## Integration Guide

### Card Programming Integration

1. **Generate Programming URL**:
```
https://your-worker.workers.dev/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion
```

2. **Boltcard NFC Programmer**:
- Use the provided programming URL in the Boltcard app
- Scan the generated QR code
- Follow app instructions for card programming

### Payment Integration

1. **LNURL Integration**:
```javascript
// Example LNURL withdraw request
const lnurlwUrl = `https://your-worker.workers.dev/?p=${pHex}&c=${cHex}`;

// Fetch LNURL details
const response = await fetch(lnurlwUrl);
const lnurlData = await response.json();

// Process payment
const paymentUrl = `${lnurlData.callback}?k1=${lnurlData.k1}&pr=${invoice}`;
const paymentResponse = await fetch(paymentUrl);
```

2. **Webhook Integration**:
- Configure webhook URLs in payment processor
- Handle payment confirmation callbacks
- Implement retry logic for failed payments

---

## Troubleshooting

### Common Issues

#### CMAC Validation Failed
**Symptoms**: Payments failing with CMAC errors
**Solutions**:
- Check K2 key configuration
- Ensure proper key generation
- Verify hex string formats
- Implement real CMAC validation

#### KV Connection Errors
**Symptoms**: 500 errors, KV test failures  
**Solutions**:
- Verify KV namespace binding in wrangler.toml
- Check Cloudflare account permissions
- Ensure KV namespace exists

#### Card Programming Issues
**Symptoms**: "Last check not green" in programming app
**Solutions**:
- Verify UID format (16-character hex string)
- Check network connectivity
- Ensure server accessibility from mobile device

### Debug Logging

Enable debug logging by checking Cloudflare Worker logs:
```javascript
console.log("Processing request for UID:", uidHex);
console.log("Configuration:", JSON.stringify(config));
```

---

## Rate Limiting

The API currently does not implement rate limiting. For production deployments, consider implementing:

- Request rate limiting per UID
- IP-based rate limiting  
- Payment amount limits
- Concurrent transaction limits

---

## Version Information

- **API Version**: 1.0
- **Protocol Version**: LNURL specification compliant
- **Compatibility**: Cloudflare Workers Runtime

---

## Support

For issues and questions:
1. Check this documentation first
2. Review error messages and logs
3. Test with provided test vectors
4. Create GitHub issues with detailed information

---

**⚠️ Security Notice**: This is financial software. Test thoroughly and ensure proper security measures before production deployment.