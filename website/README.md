# Nullspace Website

Web frontend for the Nullspace casino platform. Built with React, Vite, and TypeScript.

## Prerequisites

- Node.js 18+
- Local network running (simulator + validators)
- `website/.env.local` configured

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The website will be available at `http://localhost:5173`.

## Environment Configuration

Create `website/.env.local` with the following variables:

```bash
# Required: Network identity (96 hex bytes)
# Generate with: node scripts/generate-keys.mjs
VITE_IDENTITY=<96-byte-hex-identity>

# Required: Simulator URL (REST API)
VITE_URL=http://localhost:8080

# Optional: Gateway WebSocket URL (for session-based games)
VITE_GATEWAY_URL=ws://localhost:9010

# Optional: Auth service URL
VITE_AUTH_URL=http://localhost:4000

# Optional: Enable QA bet harness panel
VITE_QA_BETS=true

# Optional: Allow legacy browser key storage (dev only)
VITE_ALLOW_LEGACY_KEYS=true
```

### Local Development Template

Copy from `configs/local/.env.local`:

```bash
cp ../configs/local/.env.local .env.local
echo "VITE_QA_BETS=true" >> .env.local
echo "VITE_GATEWAY_URL=ws://localhost:9010" >> .env.local
echo "VITE_AUTH_URL=http://localhost:4000" >> .env.local
```

## QA Bet Harness

The QA Bet Harness is an automated testing tool that runs all bet types across all casino games. It appears as a floating panel in the bottom-left corner when `VITE_QA_BETS=true`.

### Requirements

1. **Local network running**: Simulator + 4 validators must be running
2. **Chain responsive**: The website must connect and receive seed data from validators
3. **Faucet available**: Tests auto-claim faucet credits when balance is low

### Running QA Tests

**Via UI:**
1. Navigate to any game screen
2. Click "Run All" in the QA Bets panel
3. Monitor progress in the log viewer

**Via Console (Playwright automation):**
```javascript
// Wait for QA harness to be ready
await page.waitForFunction(() => window.__qa?.isRunning !== undefined);

// Run all bet tests
const results = await page.evaluate(() => window.__qa.runAllBets());

// Check results
const failures = results.filter(r => !r.ok);
console.log(`${results.length} tests, ${failures.length} failures`);
```

### Troubleshooting

**"CHAIN OFFLINE" error:**
- Ensure local network is running: `./scripts/start-local-network.sh configs/local 4`
- Check simulator is accessible: `curl http://localhost:8080/healthz`
- Verify WebSocket origins: `ALLOWED_WS_ORIGINS` must include `http://localhost:5173`

**"Missing VITE_IDENTITY" error:**
- Generate keys: `node scripts/generate-keys.mjs`
- Or copy from local config: `cp configs/local/.env.local website/.env.local`

**"Vault locked" error:**
- Set `VITE_ALLOW_LEGACY_KEYS=true` in `.env.local` for development
- Or unlock vault via Security screen in the app

## Local Network Requirements

The website requires the following services for full functionality:

| Service | Port | Purpose |
|---------|------|---------|
| Simulator | 8080 | REST API, WebSocket updates, state queries |
| Validators | 9100+ | Consensus nodes (usually 4 for local) |
| Gateway | 9010 | Session-based game WebSocket connections |
| Auth | 4000 | Session auth, AI proxy |

### Starting Local Network

From the repository root:

```bash
# Start full local stack
./scripts/start-local-network.sh configs/local 4

# Or use the quickstart from README.md:
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 \
  ALLOWED_HTTP_ORIGINS="http://localhost:5173,http://localhost:3000" \
  ALLOWED_WS_ORIGINS="http://localhost:5173,http://localhost:3000" \
  ./scripts/start-local-network.sh configs/local 4 --no-build
```

## Build

```bash
# Production build
npm run build

# Preview production build
npm run preview
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
