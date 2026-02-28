# Contributing to Boltcard Cloudflare Worker

Thank you for your interest in contributing to the Boltcard Cloudflare Worker project! This guide will help you set up your development environment and understand the contribution process.

## 🏗️ Development Setup

### Prerequisites

Before you start contributing, ensure you have:

- **Node.js** 18+ (required for ES modules and Cloudflare Workers)
- **npm** or **yarn** package manager
- **Git** for version control
- **GitHub account** (for pull requests)
- **Cloudflare account** with Workers access (for testing and deployment)

### Initial Setup

1. **Fork the Repository**
   ```bash
   # Fork the repository on GitHub
   # Clone your fork locally
   git clone https://github.com/your-username/boltcard-cloudflareworker.git
   cd boltcard-cloudflareworker
   ```

2. **Set Upstream Remote**
   ```bash
   git remote add upstream https://github.com/original-username/boltcard-cloudflareworker.git
   ```

3. **Install Dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

4. **Run Initial Tests**
   ```bash
   npm test
   ```
   All tests should pass before you start making changes.

## 🧪 Development Workflow

### 1. Create a Feature Branch

```bash
# Create a new feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/your-bug-fix

# Or for documentation
git checkout -b docs/your-doc-improvement
```

### 2. Development Environment

#### Local Development Server

```bash
# Start the development server
wrangler dev

# With specific configuration
wrangler dev --env development

# With local KV emulation
wrangler dev --local --kv-persist
```

The development server will provide you with a local URL where you can test your changes.

#### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- --testNamePattern="cryptoutils"

# Run tests with verbose output
npm test -- --verbose

# Run integration tests only
npm test tests/integration.test.js
```

### 3. Making Changes

#### Code Style Guidelines

- **ES Modules**: This project uses ES modules (`import/export`)
- **Modern JavaScript**: Use modern JS features (async/await, optional chaining, etc.)
- **Consistent Formatting**: Follow existing code patterns
- **Error Handling**: Always handle errors appropriately
- **Security**: Never commit secrets or sensitive data

#### File Structure

```
boltcard-cloudflareworker/
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
│   ├── statusHandler.js.js
│   └── withdrawHandler.js
├── tests/                     # Test files
│   ├── cryptoutils.test.js
│   ├── keygenerator.test.js
│   ├── worker.test.js
│   └── integration.test.js
├── docs/                      # Documentation
├── wrangler.toml              # Cloudflare configuration
├── jest.config.js             # Jest test configuration
└── package.json               # Project configuration
```

#### Adding New Features

1. **Plan Your Changes**
   - Create a todo list for complex features
   - Consider edge cases and error handling
   - Think about security implications

2. **Write Tests First** (TDD Approach)
   ```bash
   # Create test file for new functionality
   # Example: tests/newFeature.test.js
   
   # Write failing tests first
   # Then implement the feature to make tests pass
   ```

3. **Implementation Guidelines**
   - Keep functions small and focused
   - Use descriptive variable names
   - Add JSDoc comments for complex functions
   - Include error handling for all external calls

#### Example Code Structure

```javascript
/**
 * Validates and processes bolt card request
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @returns {Promise<Response>} - The response
 */
export async function handleBoltCardRequest(request, env) {
  try {
    // Validate input
    if (!validateRequest(request)) {
      return new Response('Invalid request', { status: 400 });
    }

    // Process request
    const result = await processBoltCard(request, env);
    
    // Return response
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Bolt card processing error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
```

### 4. Testing Your Changes

#### Unit Tests

```javascript
// Example test structure
describe('Cryptographic Utilities', () => {
  describe('hexToBytes function', () => {
    test('converts hex string to byte array', () => {
      const hex = '48656c6c6f'; // "Hello" in hex
      const expected = new Uint8Array([72, 101, 108, 108, 111]);
      expect(hexToBytes(hex)).toEqual(expected);
    });
  });
});
```

#### Integration Tests

The project includes comprehensive integration tests for end-to-end flows:

```javascript
describe('Complete Payment Flow', () => {
  test('successful payment from initiation to callback', async () => {
    // Test the entire payment flow
    const paymentFlow = await simulateCompletePayment();
    expect(paymentFlow.status).toBe('completed');
  });
});
```

#### Testing with KV

For testing Cloudflare KV functionality:

```javascript
// Mock KV for testing
const mockKV = {
  get: jest.fn(),
  put: jest.fn(),
  delete: jest.fn()
};

// Test KV operations
test('fetches config from KV', async () => {
  mockKV.get.mockResolvedValue(JSON.stringify(testConfig));
  const config = await getUidConfig('test-uid', { UID_CONFIG: mockKV });
  expect(config).toEqual(testConfig);
});
```

### 5. Running the Development Server

```bash
# Start development server with local KV
wrangler dev --local

# With specific port
wrangler dev --local --port 8080

# With KV persistence across restarts
wrangler dev --local --kv-persist
```

The development server provides:
- **Local Testing**: Test your changes locally
- **Hot Reload**: Changes are automatically reloaded
- **KV Emulation**: Test KV operations locally
- **Debug Logging**: Enhanced error reporting

### 6. Building and Deployment

```bash
# Build and deploy to Cloudflare
npm run deploy

# Or using wrangler directly
wrangler deploy

# Deploy to staging environment
wrangler deploy --env staging

# Dry run deployment check
wrangler deploy --dry-run
```

## 📝 Pull Request Process

### 1. Before Submitting

- ✅ **All tests pass**: `npm test`
- ✅ **Code follows project style**: Match existing patterns
- ✅ **New functionality has tests**: Maintain test coverage
- ✅ **Documentation updated**: Add/update relevant docs
- ✅ **Security review**: No secrets or sensitive data

### 2. Commit Guidelines

Use **conventional commit** format:

```bash
# Feature addition
git commit -m "feat: add new payment method support"

# Bug fix
git commit -m "fix: resolve CMAC validation timeout issue"

# Documentation
git commit -m "docs: update API documentation"

# Refactoring
git commit -m "refactor: simplify cryptographic key generation"

# Test changes
git commit -m "test: add integration tests for payment flow"
```

### 3. Pull Request Template

When creating a pull request, include:

```markdown
## Summary
Brief description of changes and why they're needed.

## Changes Made
- [ ] Added new feature
- [ ] Fixed bug
- [ ] Updated documentation
- [ ] Added/updated tests

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Security Considerations
- [ ] No sensitive data committed
- [ ] Cryptographic functions reviewed
- [ ] Input validation added

## Related Issues
Closes #123, #456
```

### 4. Submitting the PR

```bash
# Push your branch
git push origin feature/your-feature-name

# Create pull request
# Visit GitHub and create PR from your branch to main branch
```

## 🔍 Debugging and Troubleshooting

### Common Development Issues

#### 1. Module Import Errors

```javascript
// Error: Cannot use import statement outside a module
// Solution: Ensure your files have .js extension and package.json has "type": "module"
```

#### 2. KV Connection Issues

```javascript
// Error: KV namespace binding not found
// Solution: Check wrangler.toml configuration
// or use local KV emulation for development
```

#### 3. Cryptographic Test Failures

```javascript
// Error: Test vectors don't match
// Solution: Check hex string formats, byte array conversions
// Verify key generation algorithms match specification
```

### Debug Tools

#### Console Logging

```javascript
// Use structured logging for debugging
console.log('DEBUG:', { 
  uid: 'test-uid', 
  timestamp: Date.now(), 
  data: requestObject 
});
```

#### Development Server Debugging

```bash
# Enable verbose logging
wrangler dev --local --verbose

# Inspect requests
wrangler dev --local --inspect
```

#### Test Debugging

```bash
# Run tests with detailed output
npm test -- --verbose --detectOpenHandles --forceExit

# Debug specific test
npm test -- --testNamePattern="specific test" --verbose
```

## 🛠️ Development Tools

### Essential Tools

- **VS Code** with these extensions:
  - ES Lint
  - Prettier
  - Jest Runner
  - Cloudflare Workers extension

- **Git Tools**:
  - Git CLI or GUI client
  - GitHub CLI (for PR management)

- **Testing Tools**:
  - Jest (unit tests)
  - Miniflare (local Cloudflare emulation)
  - Postman/curl (API testing)

### Useful Commands

```bash
# List all available npm scripts
npm run

# Check for outdated dependencies
npm outdated

# Update dependencies
npm update

# Audit for security vulnerabilities
npm audit

# Fix security issues
npm audit fix
```

## 📚 Understanding the Codebase

### Key Concepts

#### 1. LNURL Protocol
The project implements LNURL-withdraw specification for Lightning Network payments.

#### 2. Cryptographic Operations
- **AES-CMAC**: Message authentication
- **Deterministic Key Generation**: Card keys from UID
- **Hex Encoding**: Data serialization

#### 3. Payment Methods
- **clnrest**: Direct Core Lightning integration
- **proxy**: External payment processor proxy
- **fakewallet**: Development/testing payment method

#### 4. Configuration Management
- **Static Config**: JavaScript object for small deployments
- **KV Config**: Cloudflare KV for scalable production

### Architecture Flow

```
Request → Router → Handler → Payment Method → Response
                   ↓
              Configuration (KV/Static)
                   ↓
              Cryptographic Validation
```

## 🤝 Getting Help

### Resources

1. **Documentation**
   - [Project README](README.md)
   - [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
   - [LNURL Specification](https://github.com/lnurl/luds)

2. **Community**
   - GitHub Issues and Discussions
   - Lightning Network communities
   - Cloudflare Developers Discord

3. **Debugging Help**
   - Check existing issues first
   - Provide detailed error reports
   - Include reproduction steps

### When to Ask for Help

- You're stuck on a technical problem after trying solutions
- You need clarification on requirements
- You want to discuss architecture decisions
- You found a potential security issue

### How to Report Issues

```markdown
## Issue Description
Brief description of the problem

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- Node.js version: XX.X.X
- Operating system: XXX
- Browser/device (if applicable): XXX

## Additional Context
Any other relevant information
```

## 🏆 Recognition

Contributors are recognized in:
- **Release Notes**: Your contributions will be mentioned
- **Contributors List**: Added to project contributors
- **GitHub Profile**: Your contributions appear on your profile

Thank you for helping improve the Boltcard Cloudflare Worker project! 🚀