# Contributing to Boltcard Cloudflare Worker

Thank you for your interest in contributing to the Boltcard Cloudflare Worker project! This guide will help you set up your development environment and understand the contribution process.

## Development Setup

### Prerequisites

Before you start contributing, ensure you have:

- **Node.js** 18+ (required for ES modules and Cloudflare Workers)
- **npm** package manager
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

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run Tests**
   ```bash
   npm test
   ```
   All 1395 tests should pass before you start making changes.

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# Or for bug fixes
git checkout -b fix/your-bug-fix
# Or for documentation
git checkout -b docs/your-doc-improvement
```

### 2. Testing

```bash
# Run all unit tests (1343 tests)
npm test

# Run DO integration tests (52 tests, real SQLite)
npm run test:do

# Run both
npm run test:all

# Run tests in watch mode
npm test -- --watch

# Run specific tests by name
npm test -- --testNamePattern="cryptoutils"

# Type check
npm run typecheck
```

### 3. Making Changes

#### Code Style Guidelines

- **TypeScript**: This project uses TypeScript with `strict: true`
- **ES Modules**: This project uses ES modules (`import/export`)
- **Runtime**: Cloudflare Workers — no Node.js APIs available in production
- **Error Handling**: Always handle errors appropriately with `errorResponse()` from `utils/responses.ts`
- **Template System**: Use `renderTailwindPage()` + `rawHtml` tagged template for all HTML pages; browser JS in `static/js/` loaded via `<script src>` tags
- **DO Facade**: Use generic helpers from `replayProtection.ts` (`doRequiredPost`, `doCounterPost`, etc.) — avoid manual getStub→doPost→parseJSON
- **Security**: Never commit secrets or sensitive data

#### File Structure

```
boltcard-cloudflareworker/
├── index.ts                     # Main worker entry point + routing
├── boltCardHelper.ts            # Card validation & CMAC logic
├── cryptoutils.ts               # Crypto utilities (AES-CMAC)
├── getUidConfig.ts              # Configuration management
├── keygenerator.ts              # Deterministic key generation
├── replayProtection.ts          # Replay check + balance/txn helpers
├── rateLimiter.ts               # IP-based rate limiting
├── middleware/
│   └── operatorAuth.ts          # PIN auth, session cookies
├── handlers/                    # 36 route handlers
├── templates/                   # 18 HTML pages (Tailwind CSS, rawHtml tagged template)
├── static/js/                   # 17 browser JS files (classic scripts, no ES modules)
├── utils/                       # 20 utility modules
├── durableObjects/
│   └── CardReplayDO.ts          # Per-card SQLite Durable Object
├── tests/                       # 1395 tests across 73 suites
│   ├── testHelpers.ts           # Test utilities
│   ├── replayNamespace.ts       # In-memory DO mock
│   ├── e2e/                     # End-to-end tests
│   └── do/                      # DO integration tests
├── types/                       # Shared TypeScript types
├── docs/                        # Documentation
├── wrangler.toml                # Cloudflare configuration
├── vitest.config.js             # Vitest test configuration
└── package.json                 # Project configuration
```

#### Adding New Features

1. **Plan Your Changes** — consider edge cases and security implications
2. **Write Tests First** (TDD Approach) — create `tests/newFeature.test.ts`
3. **Implementation**:
   - Keep functions small and focused
   - Use `errorResponse()` from `utils/responses.ts` for error paths
   - Use `resolveCardIdentity()` from `utils/cardAuth.ts` for card auth
   - Add route handler in `handlers/` and register in `index.ts`
   - Wrap all DO calls in try/catch with specific error messages

### 4. Running the Development Server

```bash
wrangler dev
```

### 5. Building and Deployment

```bash
# Full deploy (tests → typecheck → build_keys → wrangler deploy)
npm run deploy
```

## Pull Request Process

### Before Submitting

- All tests pass: `npm run test:all`
- TypeScript compiles: `npm run typecheck`
- Code follows project style
- New functionality has tests
- No secrets or sensitive data

### Commit Guidelines

Use conventional commit format:

```bash
git commit -m "feat: add new payment method support"
git commit -m "fix: resolve CMAC validation timeout issue"
git commit -m "docs: update API documentation"
git commit -m "refactor: simplify cryptographic key generation"
git commit -m "test: add integration tests for payment flow"
```

## Resources

- [Project README](README.md) — architecture, endpoints, configuration
- [Agent Context](AGENTS.md) — full technical reference for development
- [Venue Deployment Guide](docs/VENUE-DEPLOYMENT.md) — deployment instructions
- [Operator Guide](docs/OPERATOR-GUIDE.md) — operator workflows
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [LNURL Specification](https://github.com/lnurl/luds)

Thank you for helping improve the Boltcard Cloudflare Worker project!
