# E35 - Integration tests: cross-service orchestration (from scratch)

Focus files:
- `/home/r/Coding/nullspace/tests/integration/cross-service.test.ts` (main test suite)
- `/home/r/Coding/nullspace/tests/integration/helpers/client.ts` (test client with Ed25519 auth)
- `/home/r/Coding/nullspace/tests/integration/helpers/services.ts` (service orchestration)
- `/home/r/Coding/nullspace/tests/integration/docker-compose.cross-service.yml` (Docker orchestration)
- `/home/r/Coding/nullspace/tests/integration/vitest.config.ts` (test configuration)

Goal: explain how cross-service integration tests validate the full stack working together end-to-end. These tests exercise the complete user journey across authentication, gateway WebSocket connections, and blockchain simulator boundaries. Unlike unit tests or single-service integration tests, these verify that service boundaries, session isolation, concurrent connections, and error propagation work correctly at the system level.

---

## 0) Feynman summary (why this lesson matters)

Individual service tests cannot catch bugs that only appear when services interact. Session handling might work perfectly in the gateway until you connect it to a real auth service. Balance updates might work in the simulator but fail to propagate through WebSocket messages. Concurrent clients might interfere with each other in ways that only appear under realistic load.

Cross-service integration tests answer these questions:

1) Can a new user authenticate, connect to the gateway, and complete a game end-to-end?
2) Does session state remain isolated between concurrent clients?
3) Do balance updates from the simulator propagate correctly through the gateway?
4) How does error handling work when errors cross service boundaries?

If any of these properties fail, the system becomes unreliable or unfair for players. That is why these tests exist.

---

## 1) Testing philosophy: system-level validation

Our testing strategy has multiple layers:

1) **Unit tests** validate individual functions and modules.
2) **Service-level integration tests** validate single services with real infrastructure (gateway integration tests in E15).
3) **Cross-service integration tests** validate the full stack working together.
4) **End-to-end tests** validate the complete user experience including UI.

Cross-service tests sit in layer 3. They bridge the gap between isolated service tests and full UI tests. They verify that:

- Services can discover and communicate with each other.
- Authentication flows work across service boundaries.
- State synchronization happens correctly.
- Error messages propagate cleanly through the stack.
- Multiple concurrent clients are handled safely.

---

## 2) The test stack: four services working together

Cross-service tests orchestrate four services:

1) **Convex** - Backend database for users, entitlements, and auth state.
2) **Auth service** - Handles Ed25519 challenge-response authentication.
3) **Simulator** - Blockchain simulator that processes transactions and maintains balances.
4) **Gateway** - WebSocket API that connects clients to the simulator.

The tests verify these services work correctly together, not just in isolation.

---

## 3) Service orchestration: health checks and startup sequencing

File: `/home/r/Coding/nullspace/tests/integration/helpers/services.ts`

Before running any tests, the framework must ensure all services are healthy. This prevents flaky test failures from services not being ready.

### 3.1 Service configuration

Lines 21-42 define the service list with health check URLs and timeouts:

```typescript
export const DEFAULT_SERVICES: ServiceConfig[] = [
  {
    name: 'convex',
    healthUrl: process.env.CONVEX_URL || 'http://localhost:3210',
    timeout: 30000,
  },
  {
    name: 'auth',
    healthUrl: process.env.AUTH_URL || 'http://localhost:4000',
    timeout: 30000,
  },
  {
    name: 'simulator',
    healthUrl: process.env.BACKEND_URL || 'http://localhost:8080',
    timeout: 60000,
  },
  {
    name: 'gateway',
    healthUrl: process.env.GATEWAY_HTTP_URL || 'http://localhost:9010',
    timeout: 30000,
  },
];
```

Each service has:
- A name for logging.
- A health URL (configurable via environment variables).
- A timeout (simulator gets 60 seconds because it can be slow to start).

This configuration makes tests portable: you can run against local services or Docker Compose or remote staging by changing environment variables.

### 3.2 Health check polling

Lines 54-69 implement `checkServiceHealth`:

```typescript
export async function checkServiceHealth(
  url: string,
  path = '/healthz'
): Promise<boolean> {
  try {
    const fullUrl = url.endsWith('/') ? `${url}${path.slice(1)}` : `${url}${path}`;
    const response = await fetch(fullUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

This is a simple health check: try to GET the health endpoint, return true if it responds with 2xx status. The 5-second timeout prevents hanging indefinitely on a non-responsive service.

Note that Convex uses `/version` instead of `/healthz` (line 79). This is handled by passing a different path parameter.

### 3.3 Waiting for services to be ready

Lines 74-93 implement `waitForService`:

```typescript
export async function waitForService(
  config: ServiceConfig,
  pollIntervalMs = 1000
): Promise<void> {
  const startTime = Date.now();
  const healthPath = config.name === 'convex' ? '/version' : '/healthz';

  while (Date.now() - startTime < config.timeout) {
    const healthy = await checkServiceHealth(config.healthUrl, healthPath);
    if (healthy) {
      console.log(`✓ ${config.name} is healthy at ${config.healthUrl}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Service ${config.name} failed to become healthy within ${config.timeout}ms`
  );
}
```

This polls the health endpoint every second until the service responds or the timeout expires. The timeout is per-service, so if the simulator takes 50 seconds to start, the test won't fail prematurely.

### 3.4 Sequential startup for dependency order

Lines 98-109 implement `waitForAllServices`:

```typescript
export async function waitForAllServices(
  services: ServiceConfig[] = DEFAULT_SERVICES
): Promise<void> {
  console.log('\n⏳ Waiting for services to be ready...\n');

  // Check services sequentially to maintain dependency order
  for (const service of services) {
    await waitForService(service);
  }

  console.log('\n✅ All services are healthy\n');
}
```

Services are checked **sequentially**, not in parallel. This is intentional: the services have dependencies. The auth service needs Convex to be ready. The gateway needs the simulator to be ready. Starting them in order respects these dependencies and provides clearer error messages when something fails.

This is a subtle but important design choice. Parallel health checks would be faster but would produce confusing failures if Convex wasn't ready when auth tried to connect.

---

## 4) Docker Compose orchestration

File: `/home/r/Coding/nullspace/tests/integration/docker-compose.cross-service.yml`

The test stack can be started with Docker Compose. This makes CI integration trivial: just run `docker compose up` before running tests.

### 4.1 Service definitions

The compose file defines four services with realistic configurations:

**Convex** (lines 12-30):
```yaml
convex:
  image: ghcr.io/get-convex/convex-backend:latest
  ports:
    - "3210:3210"
    - "3211:3211"
  environment:
    - CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210
    - DO_NOT_REQUIRE_SSL=true
    - DISABLE_BEACON=true
  healthcheck:
    test: curl -f http://localhost:3210/version
    interval: 5s
    timeout: 3s
    start_period: 10s
    retries: 5
```

The health check uses `/version` and gives the service 10 seconds of startup grace period before starting health checks.

**Auth service** (lines 33-54):
```yaml
auth:
  build:
    context: ../../services/auth
    dockerfile: Dockerfile
  ports:
    - "4000:4000"
  environment:
    - NODE_ENV=test
    - CONVEX_URL=http://convex:3210
  depends_on:
    convex:
      condition: service_healthy
  healthcheck:
    test: curl -f http://localhost:4000/healthz
```

Note `depends_on` with `condition: service_healthy`. This ensures the auth service only starts after Convex is healthy. This is the Docker Compose version of the sequential startup logic.

**Simulator** (lines 57-72):
```yaml
simulator:
  build:
    context: ../..
    dockerfile: simulator/Dockerfile
  ports:
    - "8080:8080"
  environment:
    - RUST_LOG=info
    - SIMULATOR_PORT=8080
  healthcheck:
    test: curl -f http://localhost:8080/healthz
    interval: 5s
    timeout: 3s
    start_period: 20s
    retries: 10
```

The simulator gets a longer `start_period` (20 seconds) and more retries (10) because it's a Rust binary that takes longer to compile and start.

**Gateway** (lines 75-96):
```yaml
gateway:
  build:
    context: ../../gateway
    dockerfile: Dockerfile
  ports:
    - "9010:9010"
  environment:
    - NODE_ENV=test
    - GATEWAY_PORT=9010
    - BACKEND_URL=http://simulator:8080
  depends_on:
    simulator:
      condition: service_healthy
  healthcheck:
    test: curl -f http://localhost:9010/healthz
```

The gateway depends on the simulator being healthy. This ensures the stack starts in the correct order: Convex → Auth and Simulator → Gateway.

### 4.2 Networking

Line 98-100 defines a custom network:

```yaml
networks:
  default:
    name: nullspace-integration
```

All services are on the same network and can reach each other by service name. For example, the gateway connects to `http://simulator:8080` (not `localhost:8080`). Docker's DNS resolver handles this mapping.

### 4.3 Docker orchestration helpers

Lines 114-148 in `services.ts` provide helpers for starting and stopping the stack:

```typescript
export async function startDockerStack(
  composeFile = 'tests/integration/docker-compose.cross-service.yml'
): Promise<void> {
  console.log('🐳 Starting Docker Compose stack...');

  try {
    await execAsync(`docker compose -f ${composeFile} up -d --wait`, {
      cwd: process.cwd(),
      timeout: 180000, // 3 minutes
    });
    console.log('✓ Docker Compose stack started');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start Docker stack: ${message}`);
  }
}
```

The `--wait` flag tells Docker Compose to wait for all health checks to pass before returning. This simplifies the test setup: just call `startDockerStack()` and when it returns, all services are ready.

---

## 5) CrossServiceClient: unified test client

File: `/home/r/Coding/nullspace/tests/integration/helpers/client.ts`

The `CrossServiceClient` class provides a high-level API for tests. It handles:
- Ed25519 keypair generation.
- WebSocket connection management.
- Message queueing and response matching.
- Authentication flows.
- Common game operations (blackjack, hi-lo).

This abstraction lets tests focus on "what to test" rather than "how to connect and send messages."

### 5.1 Ed25519 keypair generation

Lines 27-41 implement `generateTestKeypair`:

```typescript
export function generateTestKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const publicKeyHex = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32) // Ed25519 public key is last 32 bytes
    .toString('hex');

  const privateKeyHex = privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .subarray(-32) // Ed25519 private key is last 32 bytes
    .toString('hex');

  return { publicKey: publicKeyHex, privateKey: privateKeyHex };
}
```

This uses Node's built-in crypto module to generate Ed25519 keypairs. The public key is extracted from the last 32 bytes of the SPKI DER encoding. The private key is extracted from the last 32 bytes of the PKCS8 DER encoding.

Why extract just the last 32 bytes? Because DER encoding includes metadata and structure. The actual Ed25519 key material is in the final 32 bytes.

### 5.2 Message signing

Lines 46-60 implement `signMessage`:

```typescript
export function signMessage(message: string, privateKeyHex: string): string {
  const privateKeyDer = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 prefix
    Buffer.from(privateKeyHex, 'hex'),
  ]);

  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, Buffer.from(message), privateKey);
  return signature.toString('hex');
}
```

This reconstructs a PKCS8 DER private key from the 32-byte Ed25519 key by prepending the standard PKCS8 header (`302e020100300506032b657004220420`). Then it signs the message and returns the signature as hex.

This matches the auth service's signature verification logic. The message format must match exactly or verification will fail.

### 5.3 Client initialization

Lines 65-82 show the constructor:

```typescript
export class CrossServiceClient {
  private ws: WebSocket | null = null;
  private user: TestUser;
  private messageQueue: GameMessage[] = [];
  private messageHandlers: Map<string, (msg: GameMessage) => void> = new Map();
  private gatewayUrl: string;
  private authUrl: string;

  constructor(
    user?: TestUser,
    options?: { gatewayUrl?: string; authUrl?: string }
  ) {
    this.user = user || {
      ...generateTestKeypair(),
    };
    this.gatewayUrl = options?.gatewayUrl || SERVICE_URLS.gatewayWs;
    this.authUrl = options?.authUrl || SERVICE_URLS.auth;
  }
```

The client generates a new keypair by default. Tests can optionally provide a specific user or URLs for custom environments.

The client maintains:
- `ws`: WebSocket connection (null when disconnected).
- `user`: Test user with keypair, sessionId, and balance.
- `messageQueue`: Received messages waiting to be consumed.
- `messageHandlers`: Type-specific handlers for waiting on specific message types.

### 5.4 WebSocket connection

Lines 94-130 implement `connect`:

```typescript
async connect(timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket connection timeout'));
    }, timeoutMs);

    this.ws = new WebSocket(this.gatewayUrl);

    this.ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });

    this.ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as GameMessage;
        this.messageQueue.push(message);

        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        }
      } catch {
        // Ignore parse errors
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
    });
  });
}
```

The connection logic:
1) Start a timeout to prevent hanging forever.
2) Create the WebSocket connection.
3) Resolve the promise when the connection opens.
4) Reject on errors.
5) On incoming messages:
   - Parse JSON.
   - Add to queue for later consumption.
   - Trigger type-specific handlers if registered.
6) Clear the WebSocket reference on close.

This design supports two consumption patterns:
- **Polling**: Check the queue for a specific message type.
- **Waiting**: Register a handler and wait for a specific message.

### 5.5 Waiting for specific message types

Lines 157-181 implement `waitForMessage`:

```typescript
async waitForMessage(messageType: string, timeoutMs = 30000): Promise<GameMessage> {
  // Check queue first
  const index = this.messageQueue.findIndex((msg) => msg.type === messageType);
  if (index !== -1) {
    const message = this.messageQueue[index]!;
    this.messageQueue.splice(index, 1);
    return message;
  }

  // Wait for new message
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.messageHandlers.delete(messageType);
      reject(new Error(`Timeout waiting for message: ${messageType}`));
    }, timeoutMs);

    const handler = (message: GameMessage) => {
      clearTimeout(timer);
      this.messageHandlers.delete(messageType);
      resolve(message);
    };

    this.messageHandlers.set(messageType, handler);
  });
}
```

This first checks the queue for an already-received message of the requested type. If found, it removes it from the queue and returns it immediately.

If not found, it registers a handler and waits. When a message of the requested type arrives, the handler fires, clears the timeout, and resolves.

This pattern is important for handling out-of-order messages. The gateway might send multiple messages quickly. If you only registered handlers without checking the queue, you could miss messages that arrived before you started waiting.

### 5.6 Send and receive

Lines 186-208 implement `sendAndReceive`:

```typescript
async sendAndReceive(
  message: object,
  timeoutMs = 30000
): Promise<GameMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Response timeout'));
    }, timeoutMs);

    const handler = (data: WebSocket.Data) => {
      clearTimeout(timer);
      this.ws?.off('message', handler);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    };

    this.ws?.on('message', handler);
    this.send(message);
  });
}
```

This is simpler than `waitForMessage`: it sends a message and waits for the **next** message, regardless of type. This works for request-response patterns where you know the response will be the next message.

### 5.7 Waiting for session ready and registration

Lines 213-230 implement `waitForReady`:

```typescript
async waitForReady(timeoutMs = 60000): Promise<void> {
  // Wait for session_ready
  const sessionMsg = await this.waitForMessage('session_ready', timeoutMs);
  this.user.sessionId = sessionMsg.sessionId as string;

  // Poll for registration and balance
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const balance = await this.sendAndReceive({ type: 'get_balance' });
    if (balance.registered && balance.hasBalance) {
      this.user.balance = BigInt(String(balance.balance ?? 0));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('Registration timeout');
}
```

This mirrors the pattern from the gateway integration tests (E15). It:
1) Waits for `session_ready` to confirm the gateway established the session.
2) Polls `get_balance` until registration and balance are confirmed.

The polling is necessary because registration happens asynchronously. The gateway sends `session_ready` immediately, but the backend might still be processing the registration transaction. Polling ensures the account is fully usable before tests start placing bets.

### 5.8 Authentication flow

Lines 252-294 implement the full authentication flow:

```typescript
async getAuthChallenge(): Promise<string> {
  const response = await fetch(`${this.authUrl}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: this.user.publicKey }),
  });

  if (!response.ok) {
    throw new Error(`Auth challenge failed: ${response.status}`);
  }

  const data = await response.json();
  return data.challenge;
}

async authenticate(): Promise<{ token: string; userId: string }> {
  const challenge = await this.getAuthChallenge();

  // Build auth message matching server format
  const message = `Sign this message to authenticate:\n${challenge}`;
  const signature = signMessage(message, this.user.privateKey);

  const response = await fetch(`${this.authUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: this.user.publicKey,
      challenge,
      signature,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Auth verify failed: ${response.status} - ${error}`);
  }

  return response.json();
}
```

The authentication flow:
1) Request a challenge from the auth service with the public key.
2) Sign the challenge with the private key.
3) Send the signature back to verify.
4) Receive a JWT token and user ID.

This is Ed25519 challenge-response authentication. The auth service generates a random challenge, the client signs it with their private key, and the server verifies the signature using the public key. This proves the client owns the private key without transmitting it.

The message format (`Sign this message to authenticate:\n${challenge}`) must match exactly what the auth service expects. If the format differs, signature verification will fail.

### 5.9 Game helpers

Lines 299-343 provide convenience methods for common game operations:

```typescript
async playBlackjackHand(betAmount: number): Promise<{
  gameStarted: GameMessage;
  result: GameMessage;
}> {
  // Start game
  const gameStarted = await this.sendAndReceive({
    type: 'blackjack_deal',
    amount: betAmount,
  });

  if (gameStarted.type === 'error') {
    throw new Error(`Game start failed: ${gameStarted.code}`);
  }

  // Simple strategy: always stand
  const result = await this.sendAndReceive({ type: 'blackjack_stand' });

  return { gameStarted, result };
}

async playHiLoRound(
  betAmount: number,
  guess: 'higher' | 'lower'
): Promise<GameMessage> {
  // Start game
  const gameStarted = await this.sendAndReceive({
    type: 'hilo_deal',
    amount: betAmount,
  });

  if (gameStarted.type === 'error') {
    throw new Error(`Game start failed: ${gameStarted.code}`);
  }

  // Make guess
  const result = await this.sendAndReceive({
    type: 'hilo_guess',
    guess,
  });

  return result;
}
```

These helpers encode common game flows so tests can focus on assertions rather than protocol details. For example, `playBlackjackHand` handles the deal → stand sequence and returns both the start and result messages for inspection.

Tests can use these helpers for happy path testing or call the lower-level `sendAndReceive` for error scenarios.

---

## 6) Test structure and organization

File: `/home/r/Coding/nullspace/tests/integration/cross-service.test.ts`

The test file is organized into logical sections with clear responsibilities.

### 6.1 Opt-in execution

Line 23:

```typescript
const CROSS_SERVICE_ENABLED = process.env.RUN_CROSS_SERVICE === 'true';
```

Line 25:

```typescript
describe.skipIf(!CROSS_SERVICE_ENABLED)('Cross-Service Integration Tests', () => {
```

Tests only run when `RUN_CROSS_SERVICE=true`. This prevents them from running in quick local test loops (they're slow and require infrastructure) but ensures they run in CI.

This is the same pattern used in the gateway integration tests (E15). It keeps local development fast while ensuring thorough testing in CI.

### 6.2 Setup and teardown

Lines 28-38:

```typescript
beforeAll(async () => {
  // Verify all services are healthy before running tests
  await waitForAllServices();
}, 120000);

beforeEach(() => {
  client = new CrossServiceClient();
});

afterAll(() => {
  client?.disconnect();
});
```

The `beforeAll` hook waits for all services to be healthy with a 2-minute timeout. This ensures tests don't start until the full stack is ready.

The `beforeEach` hook creates a fresh client for each test. This ensures tests are isolated: one test's state doesn't leak into another.

The `afterAll` hook disconnects the client to clean up WebSocket connections.

### 6.3 Service health tests

Lines 41-56:

```typescript
describe('Service Health', () => {
  it('should have healthy simulator/backend', async () => {
    const healthy = await checkServiceHealth(SERVICE_URLS.simulator);
    expect(healthy).toBe(true);
  });

  it('should have healthy gateway', async () => {
    const healthy = await checkServiceHealth(SERVICE_URLS.gatewayHttp);
    expect(healthy).toBe(true);
  });

  it('should have healthy auth service', async () => {
    const healthy = await checkServiceHealth(SERVICE_URLS.auth);
    expect(healthy).toBe(true);
  });
});
```

These are smoke tests: verify each service responds to health checks. If these fail, something is wrong with the infrastructure setup, not the tests.

These tests also serve as documentation: they explicitly list which services must be running.

---

## 7) Full user journey: signup → auth → gateway → backend

Lines 58-106 test the complete user flow.

### 7.1 Session establishment

Lines 59-66:

```typescript
it('should connect to gateway and receive session_ready', async () => {
  await client.connect();
  const sessionReady = await client.waitForMessage('session_ready');

  expect(sessionReady.type).toBe('session_ready');
  expect(sessionReady.sessionId).toBeDefined();
  expect(sessionReady.publicKey).toBeDefined();
}, 30000);
```

This tests the most basic property: can a client connect to the gateway and receive a session?

The test verifies:
- The connection succeeds.
- A `session_ready` message arrives.
- The message includes a session ID and public key.

If this test fails, the gateway isn't responding to new connections correctly.

### 7.2 Registration and initial balance

Lines 68-77:

```typescript
it('should register new user and receive initial balance', async () => {
  await client.connect();
  await client.waitForReady();

  const balance = await client.getBalance();

  expect(balance.registered).toBe(true);
  expect(balance.hasBalance).toBe(true);
  expect(balance.publicKey).toBeDefined();
}, 60000);
```

This tests that new users are automatically registered and receive an initial balance. This is a critical flow: without it, users can't play games.

The test uses `waitForReady()` which polls until registration completes. The 60-second timeout accounts for the asynchronous registration flow.

### 7.3 Ping/pong

Lines 79-87:

```typescript
it('should respond to ping/pong', async () => {
  await client.connect();
  await client.waitForMessage('session_ready');

  const response = await client.sendAndReceive({ type: 'ping' });

  expect(response.type).toBe('pong');
  expect(response.timestamp).toBeDefined();
}, 30000);
```

This tests the keep-alive mechanism. Ping/pong messages verify the connection is alive and the gateway is responding to messages.

### 7.4 Full authentication flow

Lines 89-105:

```typescript
it('should complete full authentication flow with auth service', async () => {
  try {
    const result = await client.authenticate();
    expect(result.token).toBeDefined();
    expect(result.userId).toBeDefined();
  } catch (error) {
    // Auth service may require Convex - mark as skipped in that case
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('CONVEX') || message.includes('fetch')) {
      console.log('Skipping auth test - requires full Convex integration');
      return;
    }
    throw error;
  }
}, 30000);
```

This tests the Ed25519 challenge-response authentication flow:
1) Request challenge.
2) Sign challenge.
3) Verify signature.
4) Receive JWT token.

The try-catch with conditional skip handles environments where Convex isn't available. This makes tests more robust in partial environments while still validating the flow when all services are present.

---

## 8) Game flow: deal → play → result

Lines 108-144 test complete game flows.

### 8.1 Blackjack hand

Lines 118-126:

```typescript
it('should start and complete a blackjack game', async () => {
  const { gameStarted, result } = await client.playBlackjackHand(100);

  expect(gameStarted.type).toBe('game_started');
  expect(gameStarted.bet).toBe('100');

  // Result should be one of: game_result, game_move, or move_accepted
  expect(['game_result', 'game_move', 'move_accepted']).toContain(result.type);
}, 60000);
```

This tests a complete blackjack game:
1) Client connects and waits for ready (in `beforeEach`).
2) Client deals a hand.
3) Gateway starts the game and responds with `game_started`.
4) Client stands.
5) Gateway returns a result.

The test verifies the message types but doesn't check payout correctness. That's the responsibility of game engine unit tests. This test focuses on protocol correctness: can the full stack execute a game end-to-end?

### 8.2 Multiple consecutive games

Lines 128-134:

```typescript
it('should handle multiple consecutive games', async () => {
  // Play 3 consecutive games
  for (let i = 0; i < 3; i++) {
    const { gameStarted } = await client.playBlackjackHand(100);
    expect(gameStarted.type).toBe('game_started');
  }
}, 120000);
```

This tests that a single client can play multiple games without issues. It verifies:
- Balance tracking works across multiple games.
- Session state is properly reset between games.
- No resource leaks accumulate.

The 2-minute timeout accounts for three full game flows.

### 8.3 Hi-Lo game

Lines 136-143:

```typescript
it('should start a hi-lo game', async () => {
  const result = await client.playHiLoRound(50, 'higher');

  // Should get either game_result or error if deck exhausted
  expect(['game_result', 'game_move', 'move_accepted', 'error']).toContain(
    result.type
  );
}, 60000);
```

This tests a different game type to ensure the protocol isn't hardcoded to blackjack. The test allows `error` as a valid result because hi-lo can exhaust the deck, which is a legitimate outcome.

---

## 9) Concurrent connections: isolation and uniqueness

Lines 146-195 test concurrent client behavior.

### 9.1 Multiple simultaneous clients

Lines 147-166:

```typescript
it('should handle multiple simultaneous clients', async () => {
  const clients = Array.from({ length: 5 }, () => new CrossServiceClient());

  try {
    // Connect all clients in parallel
    await Promise.all(clients.map((c) => c.connect()));

    // Wait for session_ready on all
    const sessions = await Promise.all(
      clients.map((c) => c.waitForMessage('session_ready'))
    );

    // Verify all sessions are unique
    const sessionIds = sessions.map((s) => s.sessionId as string);
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(clients.length);
  } finally {
    clients.forEach((c) => c.disconnect());
  }
}, 60000);
```

This is a lightweight load test. It creates 5 clients, connects them in parallel, and verifies:
- All connections succeed.
- All clients receive `session_ready`.
- All session IDs are unique (no collisions or reuse).

The `finally` block ensures cleanup even if the test fails. This prevents leaked connections.

This test catches concurrency bugs in session management. If the gateway used a global session counter without proper locking, you might see duplicate session IDs.

### 9.2 Game state isolation

Lines 168-194:

```typescript
it('should isolate game state between clients', async () => {
  const client1 = new CrossServiceClient();
  const client2 = new CrossServiceClient();

  try {
    // Connect both clients
    await Promise.all([client1.connect(), client2.connect()]);
    await Promise.all([client1.waitForReady(), client2.waitForReady()]);

    // Start game on client1 only
    const game1 = await client1.sendAndReceive({
      type: 'blackjack_deal',
      amount: 100,
    });
    expect(game1.type).toBe('game_started');

    // Client2 should not have an active game
    const response = await client2.sendAndReceive({
      type: 'blackjack_stand',
    });
    expect(response.type).toBe('error');
    expect(response.code).toBe('NO_ACTIVE_GAME');
  } finally {
    client1.disconnect();
    client2.disconnect();
  }
}, 60000);
```

This tests a critical security property: **session isolation**. Client 1 starts a game. Client 2 tries to stand (a move in an active game). The gateway should reject client 2's move because client 2 has no active game.

If this test fails, the gateway is mixing up session state. That would be a serious bug: clients could interfere with each other's games or see each other's balances.

This is the kind of bug that only appears with concurrent clients. A single-client test would never catch it.

---

## 10) Error scenarios: validation and propagation

Lines 198-264 test error handling across service boundaries.

### 10.1 Invalid message types

Lines 215-222:

```typescript
it('should reject invalid message types', async () => {
  const response = await client.sendAndReceive({
    type: 'invalid_message_type_xyz',
  });

  expect(response.type).toBe('error');
  expect(response.code).toBe('INVALID_MESSAGE');
});
```

This verifies the gateway rejects unknown message types with a clear error code.

### 10.2 Move without active game

Lines 224-231:

```typescript
it('should reject move without active game', async () => {
  const response = await client.sendAndReceive({
    type: 'blackjack_stand',
  });

  expect(response.type).toBe('error');
  expect(response.code).toBe('NO_ACTIVE_GAME');
});
```

This verifies that game state is enforced. You can't make a move without starting a game first.

### 10.3 Invalid bet amounts

Lines 233-242 and 244-251:

```typescript
it('should reject invalid bet amounts', async () => {
  const response = await client.sendAndReceive({
    type: 'blackjack_deal',
    amount: -100,
  });

  expect(response.type).toBe('error');
  expect(['INVALID_BET', 'INVALID_MESSAGE']).toContain(response.code);
});

it('should reject zero bet amount', async () => {
  const response = await client.sendAndReceive({
    type: 'blackjack_deal',
    amount: 0,
  });

  expect(response.type).toBe('error');
});
```

These verify input validation for bet amounts. Negative and zero bets should be rejected.

The first test allows two error codes because the exact validation order depends on implementation. Both are acceptable error codes for this input.

### 10.4 Malformed JSON

Lines 253-263:

```typescript
it('should handle malformed JSON gracefully', async () => {
  // Send raw malformed data
  const ws = (client as unknown as { ws: WebSocket | null }).ws;
  if (ws) {
    ws.send('not valid json {{{');

    // Should not crash - connection should remain open
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.isConnected()).toBe(true);
  }
});
```

This tests resilience to malformed input. The client sends invalid JSON. The gateway should:
- Not crash.
- Keep the connection open.
- Optionally send an error response (though the test doesn't require it).

If the gateway crashes or closes the connection, a malicious client could DoS the service by sending garbage data.

---

## 11) Balance and betting flow

Lines 266-312 test balance tracking across games.

### 11.1 Balance changes after games

Lines 283-297:

```typescript
it('should track balance changes after wins/losses', async () => {
  const initialBalance = await client.getBalance();
  const startBalance = BigInt(initialBalance.balance);

  // Play a game
  await client.playBlackjackHand(100);

  // Check balance changed
  const finalBalance = await client.getBalance();
  const endBalance = BigInt(finalBalance.balance);

  // Balance should have changed (win or loss)
  // Note: Could be same if push, but generally will differ
  expect(endBalance).not.toBe(startBalance);
}, 60000);
```

This verifies that balance updates propagate from the simulator through the gateway to the client. After playing a game, the balance should change (unless it's a push, which the comment acknowledges).

This tests the full data flow:
1) Gateway sends bet to simulator.
2) Simulator processes game and updates balance.
3) Balance update flows back to gateway.
4) Client queries balance and sees the update.

If any step in this flow fails, the test catches it.

### 11.2 Insufficient balance

Lines 299-311:

```typescript
it('should reject bet exceeding balance', async () => {
  const balance = await client.getBalance();
  const currentBalance = BigInt(balance.balance);

  // Try to bet more than balance
  const response = await client.sendAndReceive({
    type: 'blackjack_deal',
    amount: Number(currentBalance) + 1000000,
  });

  expect(response.type).toBe('error');
  expect(response.code).toBe('INSUFFICIENT_BALANCE');
}, 30000);
```

This tests a critical validation: you can't bet more than your balance. The test:
1) Queries current balance.
2) Tries to bet way more than that.
3) Expects an `INSUFFICIENT_BALANCE` error.

This validation must happen in the simulator (not the gateway) because the gateway doesn't know the authoritative balance. This test verifies the error propagates correctly from simulator → gateway → client.

---

## 12) Test configuration

File: `/home/r/Coding/nullspace/tests/integration/vitest.config.ts`

Lines 4-17:

```typescript
export default defineConfig({
  test: {
    testTimeout: 120000, // 2 minutes for cross-service tests
    hookTimeout: 180000, // 3 minutes for setup/teardown
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    reporters: ['verbose'],
    pool: 'forks', // Use separate processes to avoid state leakage
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially for cross-service reliability
      },
    },
  },
});
```

Key configuration choices:

**Timeouts**:
- `testTimeout: 120000` (2 minutes): Individual tests can be slow because they involve multiple service calls.
- `hookTimeout: 180000` (3 minutes): Setup hooks need even more time because they wait for all services to be healthy.

**Pool configuration**:
- `pool: 'forks'`: Run tests in separate processes to avoid state leakage.
- `singleFork: true`: Run tests sequentially, not in parallel.

Why sequential? Cross-service tests interact with shared state (the simulator, the database). Running them in parallel could cause flaky failures from race conditions. Sequential execution trades speed for reliability.

This is different from unit tests, which can run in parallel because they're isolated. Cross-service tests must be careful about shared state.

---

## 13) What cross-service tests do not cover

It's important to understand the limitations:

### 13.1 Not performance tests

These tests verify correctness, not performance. They don't measure latency, throughput, or resource usage under load.

For performance testing, you'd use tools like k6, Locust, or Artillery with thousands of concurrent clients and realistic workloads.

### 13.2 Not UI tests

These tests don't verify the frontend works. They test the backend APIs that the frontend uses.

For UI testing, you'd use Playwright, Cypress, or visual regression tests (covered in E15).

### 13.3 Not security tests

These tests verify basic security properties (session isolation, input validation) but don't test for vulnerabilities like SQL injection, XSS, or cryptographic weaknesses.

For security testing, you'd use tools like OWASP ZAP, Burp Suite, or dedicated security audits.

### 13.4 Not chaos engineering

These tests assume all services are healthy and responsive. They don't test behavior when services crash, networks partition, or disk fills up.

For chaos testing, you'd use tools like Chaos Mesh, Pumba, or Gremlin to inject failures and verify recovery.

---

## 14) Running the tests

### 14.1 With Docker Compose

```bash
# Start the stack
docker compose -f tests/integration/docker-compose.cross-service.yml up -d --wait

# Run tests
RUN_CROSS_SERVICE=true pnpm test:cross-service

# Stop the stack
docker compose -f tests/integration/docker-compose.cross-service.yml down -v
```

This is the recommended approach for CI and local testing. Docker Compose handles all service orchestration.

### 14.2 With manually started services

```bash
# Terminal 1: Start Convex
docker run -p 3210:3210 -p 3211:3211 ghcr.io/get-convex/convex-backend:latest

# Terminal 2: Start auth service
cd services/auth && pnpm start

# Terminal 3: Start simulator
cargo run --release --bin simulator

# Terminal 4: Start gateway
cd gateway && pnpm start

# Terminal 5: Run tests
RUN_CROSS_SERVICE=true pnpm test:cross-service
```

This approach is useful for debugging individual services but is tedious for regular testing.

### 14.3 In CI

The tests are typically run in a GitHub Actions workflow:

```yaml
- name: Start services
  run: docker compose -f tests/integration/docker-compose.cross-service.yml up -d --wait

- name: Run integration tests
  run: RUN_CROSS_SERVICE=true pnpm test:cross-service
  timeout-minutes: 30

- name: Stop services
  if: always()
  run: docker compose -f tests/integration/docker-compose.cross-service.yml down -v
```

The `timeout-minutes: 30` ensures tests don't hang forever in CI. The `if: always()` ensures services are stopped even if tests fail.

---

## 15) Operational guidance

### 15.1 When to run these tests

Run cross-service tests:
- Before merging PRs that touch multiple services.
- Before deploying to staging or production.
- On a schedule (nightly or weekly) to catch gradual regressions.

Don't run them:
- In quick local test loops (they're too slow).
- For every commit (use unit tests for that).

### 15.2 Debugging failures

If a cross-service test fails:

1) **Check service health**: Are all services healthy? Look at Docker Compose logs.
2) **Check timeouts**: Did the test timeout waiting for a service? Increase timeouts or investigate slow services.
3) **Check test isolation**: Did a previous test leave state that interferes? Verify `beforeEach` creates a fresh client.
4) **Check service logs**: Look at individual service logs for errors or warnings.
5) **Reproduce locally**: Start services manually and run the test with verbose logging.

### 15.3 Test maintenance

As the system evolves:

- **Add tests for new features**: If you add a new game type, add a cross-service test.
- **Update tests for protocol changes**: If message formats change, update tests to match.
- **Remove obsolete tests**: If a feature is removed, remove its tests.
- **Keep timeouts realistic**: If services get faster, reduce timeouts. If they get slower, increase them.

### 15.4 Flakiness prevention

Cross-service tests are prone to flakiness because they involve timing and external state. To minimize flakiness:

- Use `waitForReady()` instead of fixed delays.
- Use health checks before running tests.
- Run tests sequentially, not in parallel.
- Use generous timeouts (30-120 seconds).
- Clean up state in `afterEach` and `beforeEach` hooks.
- Avoid hardcoded sleep delays; use polling with timeouts instead.

---

## 16) Limits and management callouts

### 16.1 Docker resource limits

The Docker Compose file doesn't set resource limits. In CI, this can cause OOM kills if services consume too much memory. Consider adding limits:

```yaml
services:
  simulator:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'
```

This prevents one service from starving others.

### 16.2 Connection limits

The gateway has connection limits (`MAX_CONNECTIONS_PER_IP`). If tests create too many clients from the same IP (which they do), they might hit this limit and fail.

For tests, either:
- Increase the limit in test environments.
- Add a bypass for localhost connections.
- Reuse connections across tests instead of creating new ones.

### 16.3 Database cleanup

If tests create users in Convex or Postgres, they should clean up after themselves. Otherwise, test data accumulates and can cause failures in later runs.

Use test-specific user IDs or namespaces to isolate test data. Or use database transactions that roll back after tests.

### 16.4 Service startup time

Services can take 30-60 seconds to start, especially in cold CI environments. The health check timeouts account for this, but very slow environments might need longer timeouts.

Consider caching Docker images in CI to speed up builds. Or use prewarmed environments for integration tests.

---

## 17) Feynman recap

Cross-service integration tests validate properties that only emerge when services work together:

1) **Service orchestration**: Can all services start, discover each other, and communicate?
2) **Session management**: Are sessions isolated between clients? Are session IDs unique?
3) **Authentication**: Does Ed25519 challenge-response work end-to-end?
4) **State synchronization**: Do balance updates propagate from simulator → gateway → client?
5) **Error propagation**: Do errors from the simulator surface correctly in client responses?
6) **Concurrent clients**: Can multiple clients connect and play without interfering?

The test framework provides:
- `CrossServiceClient`: Unified client with Ed25519 auth, WebSocket management, and game helpers.
- Service orchestration helpers: Health checks, startup sequencing, Docker Compose integration.
- Test organization: Service health, user journeys, game flows, concurrency, errors, balance tracking.

These tests bridge the gap between isolated service tests and full UI tests. They catch integration bugs that unit tests miss while being faster and more focused than UI tests.

If you can explain these tests to someone new, you understand:
- How the services discover and communicate.
- What invariants must hold across service boundaries.
- Why session isolation and balance tracking are critical.
- How Ed25519 authentication works end-to-end.

More importantly, you understand what these tests protect and what they don't. They validate correctness, not performance. They verify protocols, not user experience. They catch integration bugs, not security vulnerabilities. Knowing the limits of your tests is as important as knowing what they cover.

---

## 18) Key takeaways

1) **Cross-service tests validate integration properties** that can't be tested in isolation: session management, state synchronization, error propagation, concurrent client handling.

2) **Service orchestration is critical**: Health checks, sequential startup, and Docker Compose ensure services are ready before tests run.

3) **Ed25519 authentication requires careful implementation**: Message formats must match exactly, DER encoding must be handled correctly, and challenge-response flow must be secure.

4) **WebSocket connection management is subtle**: Message queueing, type-specific handlers, and timeout handling require careful design to avoid race conditions.

5) **Test isolation matters**: Fresh clients, sequential execution, and cleanup hooks prevent state leakage and flaky failures.

6) **Error handling must span service boundaries**: Errors from the simulator must propagate cleanly through the gateway to clients with clear error codes.

7) **Balance tracking is end-to-end**: Updates must flow from simulator → gateway → client consistently.

8) **Concurrent clients must be isolated**: Session state, game state, and balances must not leak between clients.

9) **Timeouts must be realistic**: 30-120 seconds for operations that cross service boundaries, longer for health checks and setup.

10) **Cross-service tests have limits**: They don't test performance, security, UI, or chaos scenarios. Know what they cover and what they don't.

---

## 19) Exercises

1) Explain why services are started sequentially rather than in parallel during health checks. What would happen if auth started before Convex was ready?

2) The `CrossServiceClient` checks the message queue before registering a handler in `waitForMessage`. Why is this important? What race condition does it prevent?

3) Why does the balance tracking test allow the balance to not change (acknowledging pushes)? How would you modify the test to ensure the balance actually changes?

4) The concurrent client test creates 5 clients and verifies unique session IDs. How would you extend this test to verify that session IDs don't collide even after 10,000 connections?

5) Why does the Docker Compose file use `depends_on` with `condition: service_healthy` instead of just `depends_on`? What problems does the health check condition solve?

---

## Next lessons

- E15 - Testing strategy: Multi-layered testing including gateway integration, node simulation, protocol fuzzing, visual regression.
- E12 - CI/Docker: Building and running services in containers.
- L32 - Auth server: Ed25519 challenge-response authentication implementation.
