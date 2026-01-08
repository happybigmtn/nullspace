# Cross-Service Integration Tests

End-to-end tests that validate the full user journey across all services:

- **Auth Service** - User authentication via Ed25519 signatures
- **Gateway** - WebSocket API for real-time game communication
- **Simulator** - Blockchain backend for game state and transactions

## Test Coverage

| Test Suite | Description |
|------------|-------------|
| Service Health | Validates all services are running and responsive |
| User Journey | Signup → Auth → Connect → Register → Play |
| Game Flow | Deal → Play → Result across multiple games |
| Concurrent Connections | Multiple clients playing simultaneously |
| Error Scenarios | Invalid messages, insufficient balance, etc. |
| Balance Tracking | Win/loss balance changes, bet limits |

## Running Tests

### Prerequisites

1. **Rust toolchain** - For building the simulator
2. **Node.js 20+** - For gateway and tests
3. **pnpm** - Package manager

### Quick Start (Local Services)

Start each service in a separate terminal:

```bash
# Terminal 1: Start simulator
./scripts/start-local-network.sh configs/local 1

# Terminal 2: Start gateway
pnpm -C gateway start

# Terminal 3: Run tests
cd tests/integration
pnpm install
RUN_CROSS_SERVICE=true pnpm test
```

### Using Docker Compose

For a fully isolated test environment:

```bash
cd tests/integration

# Start all services
docker compose -f docker-compose.cross-service.yml up -d --wait

# Run tests
RUN_CROSS_SERVICE=true pnpm test

# Cleanup
docker compose -f docker-compose.cross-service.yml down -v
```

### CI Pipeline

Tests run automatically on:
- Push to `main`
- PRs touching `gateway/`, `services/auth/`, `simulator/`, `execution/`

See `.github/workflows/cross-service-integration.yml`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUN_CROSS_SERVICE` | `false` | Enable cross-service tests |
| `BACKEND_URL` | `http://localhost:8080` | Simulator HTTP URL |
| `GATEWAY_HTTP_URL` | `http://localhost:9010` | Gateway HTTP URL |
| `GATEWAY_WS_URL` | `ws://localhost:9010` | Gateway WebSocket URL |
| `AUTH_URL` | `http://localhost:4000` | Auth service URL |

## Test Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Runner (Vitest)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │   Auth      │    │   Gateway   │    │   Simulator     │ │
│  │   Service   │───▶│   (WS)      │───▶│   (Backend)     │ │
│  │   :4000     │    │   :9010     │    │   :8080         │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
│                                                              │
│  CrossServiceClient handles:                                 │
│  - Ed25519 key generation                                   │
│  - WebSocket connection management                          │
│  - Message serialization/deserialization                    │
│  - Auth challenge/response flow                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Tests timeout waiting for services

Check service logs:
```bash
# If using local services
cat /tmp/simulator.log
cat /tmp/gateway.log

# If using Docker
docker compose -f docker-compose.cross-service.yml logs
```

### Connection refused errors

Ensure all services are healthy:
```bash
curl http://localhost:8080/healthz  # Simulator
curl http://localhost:9010/healthz  # Gateway
curl http://localhost:4000/healthz  # Auth (optional)
```

### Auth tests skipped

The auth service requires Convex for full functionality. If running without
Convex, auth-dependent tests will be skipped automatically.

## Adding New Tests

1. Create test in `tests/integration/`
2. Use `CrossServiceClient` for service interactions
3. Add `describe.skipIf(!CROSS_SERVICE_ENABLED)` wrapper
4. Set appropriate timeouts (services can be slow)

Example:
```typescript
import { CrossServiceClient } from './helpers/client.js';

describe.skipIf(!CROSS_SERVICE_ENABLED)('My New Tests', () => {
  let client: CrossServiceClient;

  beforeEach(async () => {
    client = new CrossServiceClient();
    await client.connect();
    await client.waitForReady();
  }, 60000);

  afterEach(() => {
    client.disconnect();
  });

  it('should do something', async () => {
    const response = await client.sendAndReceive({ type: 'ping' });
    expect(response.type).toBe('pong');
  });
});
```
