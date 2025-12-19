# Simulator to Real Node Migration - Architecture Research

**Date:** 2025-12-18
**Purpose:** Document the migration path from simulator to real consensus nodes

---

## Executive Summary

The nullsociety codebase currently has both a **simulator** (for local development) and **node** (for production consensus network) that expose similar APIs. The frontend is designed to connect to either through environment configuration. This document maps the architecture of both systems to understand the migration path.

---

## 1. Current Simulator Architecture

### 1.1 Core Components

**Location:** `/home/r/Coding/nullsociety/simulator/`

**Entry Point:** `simulator/src/main.rs` (lines 1-72)
- Binds to configurable host/port (default: 127.0.0.1:8080)
- Creates `Simulator` with optional explorer retention limits
- Initializes Axum HTTP server with API router

**Core State:** `simulator/src/lib.rs` (lines 18-53)
```rust
pub struct Simulator {
    identity: Identity,
    config: SimulatorConfig,
    state: Arc<RwLock<State>>,
    explorer: Arc<RwLock<ExplorerState>>,
    update_tx: broadcast::Sender<InternalUpdate>,
    mempool_tx: broadcast::Sender<Pending>,
}
```

**State Management:** `simulator/src/state.rs` (lines 34-48)
```rust
pub struct State {
    seeds: BTreeMap<u64, Seed>,
    nodes: BTreeMap<u64, Digest>,
    leaves: BTreeMap<u64, Variable<Digest, Value>>,
    keys: HashMap<Digest, BTreeMap<u64, (u64, Variable<Digest, Value>)>>,
    progress: BTreeMap<u64, (Progress, Certificate<MinSig, Digest>)>,
    submitted_events: HashSet<u64>,
    submitted_state: HashSet<u64>,
}
```

### 1.2 API Endpoints

**HTTP Routes:** `simulator/src/api/mod.rs` (lines 53-72)
```rust
.route("/healthz", get(http::healthz))
.route("/config", get(http::config))
.route("/submit", post(http::submit))
.route("/seed/:query", get(http::query_seed))
.route("/state/:query", get(http::query_state))
.route("/updates/:filter", get(ws::updates_ws))
.route("/mempool", get(ws::mempool_ws))

// Explorer endpoints
.route("/explorer/blocks", get(explorer::list_blocks))
.route("/explorer/blocks/:id", get(explorer::get_block))
.route("/explorer/tx/:hash", get(explorer::get_transaction))
.route("/explorer/account/:pubkey", get(explorer::get_account_activity))
.route("/explorer/games/:pubkey", get(explorer::get_game_history))
.route("/explorer/search", get(explorer::search_explorer))
```

**WebSocket Endpoints:**
1. **Updates Stream** (`/updates/:filter`): `simulator/src/api/ws.rs` (lines 67-206)
   - Accepts `UpdatesFilter` (All or Account-specific)
   - Broadcasts `InternalUpdate` events (Seed, Events)
   - Implements event filtering for specific accounts
   - Validates WebSocket origin via `ALLOWED_WS_ORIGINS` env var

2. **Mempool Stream** (`/mempool`): `simulator/src/api/ws.rs` (lines 208-269)
   - Broadcasts pending transactions
   - No filtering applied

### 1.3 Submission Flow

**HTTP Handler:** `simulator/src/api/http.rs` (lines 35-215)
```rust
async fn submit(simulator, body) {
    // Decodes Submission enum (Seed | Transactions | Summary)
    match submission {
        Submission::Seed(seed) => {
            // Verifies seed signature
            simulator.submit_seed(seed).await;
        }
        Submission::Transactions(txs) => {
            simulator.submit_transactions(txs);
        }
        Submission::Summary(summary) => {
            // Verifies summary
            // Splits into events and state
            simulator.submit_events(summary, events_digests).await;
            simulator.submit_state(summary, state_digests).await;
        }
    }
}
```

### 1.4 Explorer Functionality

**Location:** `simulator/src/explorer.rs` (lines 1-150+)

**Data Structures:**
```rust
pub struct ExplorerState {
    indexed_blocks: BTreeMap<u64, ExplorerBlock>,
    blocks_by_hash: HashMap<Digest, ExplorerBlock>,
    txs_by_hash: HashMap<Digest, ExplorerTransaction>,
    accounts: HashMap<PublicKey, AccountActivity>,
    game_events: HashMap<PublicKey, Vec<IndexedGameEvent>>,
    // Retention limits
    max_blocks: Option<usize>,
    max_account_entries: Option<usize>,
}
```

**Indexing:** Automatically indexes blocks/transactions/events from submitted summaries
**Retention:** Enforces configurable limits on stored data

---

## 2. Real Node Architecture

### 2.1 Core Components

**Location:** `/home/r/Coding/nullsociety/node/`

**Entry Point:** `node/src/main.rs` (lines 173-430)
- Loads configuration from YAML file
- Initializes P2P network with authenticated discovery
- Creates consensus engine
- Connects to indexer client

**Key Actors:**
1. **Engine** (`node/src/engine.rs`)
2. **Application** (`node/src/application/`)
3. **Aggregator** (`node/src/aggregator/`)
4. **Seeder** (`node/src/seeder/`)

### 2.2 Configuration

**Config File:** `node/src/lib.rs` (lines 69-142)

**Required Fields:**
```yaml
private_key: <hex>
share: <hex>
polynomial: <hex>
port: 9000
metrics_port: 9090
directory: "./data"
worker_threads: 4
log_level: "info"
indexer: "http://localhost:8080"  # Points to indexer/simulator
bootstrappers: []
```

**Important:** The node DOES NOT expose HTTP/WebSocket APIs directly. Instead:
- It connects to an **indexer** (which could be the simulator) for submitting results
- The indexer exposes the APIs that the frontend connects to

### 2.3 Indexer Integration

**Trait:** `node/src/indexer.rs` (lines 41-59)
```rust
pub trait Indexer: Clone + Send + Sync + 'static {
    fn submit_seed(&self, seed: Seed) -> Future<Output = Result<()>>;
    fn listen_mempool(&self) -> Future<Output = Stream<Pending>>;
    fn submit_summary(&self, summary: Summary) -> Future<Output = Result<()>>;
}
```

**Implementation for nullspace_client::Client:** `node/src/indexer.rs` (lines 130-146)
- The node uses the **client SDK** to talk to the indexer
- The indexer is configured via `config.indexer` URL

### 2.4 P2P Network Setup

**Network Channels:** `node/src/main.rs` (lines 22-29)
```rust
const PENDING_CHANNEL: u32 = 0;
const RECOVERED_CHANNEL: u32 = 1;
const RESOLVER_CHANNEL: u32 = 2;
const BROADCASTER_CHANNEL: u32 = 3;
const BACKFILL_BY_DIGEST_CHANNEL: u32 = 4;
const SEEDER_CHANNEL: u32 = 5;
const AGGREGATOR_CHANNEL: u32 = 6;
const AGGREGATION_CHANNEL: u32 = 7;
```

**Network Creation:** `node/src/main.rs` (lines 291-355)
- Uses `authenticated::Network` from commonware-p2p
- Registers authorized peers from peers file
- Configures rate limits per channel

---

## 3. Client SDK (Connects Frontend to Backend)

### 3.1 Client Architecture

**Location:** `/home/r/Coding/nullsociety/client/`

**Main Client:** `client/src/client.rs` (lines 61-409)
```rust
pub struct Client {
    pub base_url: Url,          // HTTP base URL
    pub ws_url: Url,            // WebSocket URL
    pub http_client: HttpClient,
    pub identity: Identity,     // Network identity for verification
    retry_policy: RetryPolicy,
}
```

**Key Methods:**
```rust
// Transaction submission
async fn submit_transactions(txs: Vec<Transaction>) -> Result<()>
async fn submit_summary(summary: Summary) -> Result<()>
async fn submit_seed(seed: Seed) -> Result<()>

// State queries
async fn query_state(key: &Key) -> Result<Option<Lookup>>

// WebSocket streams
async fn connect_updates(filter: UpdatesFilter) -> Result<Stream<Update>>
async fn connect_mempool() -> Result<Stream<Pending>>
```

**URL Construction:** `client/src/client.rs` (lines 76-92)
- Converts `http://` → `ws://`
- Converts `https://` → `wss://`
- Validates scheme is http or https

### 3.2 Retry Policy

**Config:** `client/src/client.rs` (lines 38-58)
```rust
pub struct RetryPolicy {
    pub max_attempts: usize,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    pub retry_non_idempotent: bool,  // Default: false for POST
}
```

**Retryable Status Codes:** `client/src/client.rs` (lines 411-422)
- 408 Request Timeout
- 429 Too Many Requests
- 500 Internal Server Error
- 502 Bad Gateway
- 503 Service Unavailable
- 504 Gateway Timeout

---

## 4. Frontend Integration

### 4.1 Environment Configuration

**File:** `/home/r/Coding/nullsociety/website/.env`
```bash
VITE_IDENTITY=<network_identity_hex>
VITE_URL=http://localhost:8080
```

### 4.2 Client Initialization

**Hook:** `website/src/hooks/useChainService.ts` (lines 41-123)
```typescript
const initChain = async () => {
    // Initialize WASM
    const wasm = new WasmWrapper();
    await wasm.init();

    // Get identity from env
    const identityHex = import.meta.env.VITE_IDENTITY;
    const keypair = wasm.generateKeypairFromHex(identityHex);

    // Get base URL from env or default to /api
    const baseUrl = import.meta.env.VITE_URL || '/api';

    // Create client
    const client = new CasinoClient(baseUrl, keypair);

    // Initialize chain service
    const service = new CasinoChainService(client);
}
```

### 4.3 Frontend Client API

**File:** `website/src/api/client.js` (lines 14-200+)

**Connection Types:**
1. **HTTP Requests:** Submit transactions, query state
2. **WebSocket Streams:**
   - Updates (filtered by account or all)
   - Mempool transactions

**Event Handling:** Events are decoded and normalized from snake_case to camelCase

### 4.4 Explorer API

**File:** `website/src/api/explorerClient.ts` (lines 1-69)

**Functions:**
```typescript
async function fetchBlocks(offset, limit)
async function fetchBlock(id)
async function fetchTransaction(hash)
async function fetchAccount(pubkey)
async function searchExplorer(query)
```

**Base Path:** `/api/explorer/*` (proxied to simulator/indexer)

---

## 5. Deployment Architecture

### 5.1 Simulator Deployment

**Dockerfile:** `/home/r/Coding/nullsociety/Dockerfile` (lines 1-78)
- Multi-stage build (Rust builder + Debian runtime)
- Exposes port 8080
- Health check: `curl -f http://localhost:8080/healthz`
- Entry point: `nullspace-simulator`

**Arguments:**
```bash
--host 127.0.0.1
--port 8080
--identity <hex_encoded_identity>
--explorer-max-blocks <optional>
--explorer-max-account-entries <optional>
```

### 5.2 Node Deployment (Production)

**Configuration Files Required:**
1. **Config YAML:** Node configuration (private key, indexer URL, etc.)
2. **Peers File:** List of peer addresses
   ```yaml
   addresses:
     "<pubkey_hex>": "ip:port"
   ```

**Or Hosts File:** When using commonware-deployer
```yaml
hosts:
  - name: "peer-1"
    ip: "10.0.1.1"
```

### 5.3 Architecture Patterns

**Development:**
```
Frontend (localhost:5173)
    ↓ VITE_URL=http://localhost:8080
Simulator (localhost:8080)
    - HTTP API
    - WebSocket streams
    - Explorer endpoints
```

**Production (Future):**
```
Frontend (browser)
    ↓ VITE_URL=https://indexer.example.com
Indexer/Simulator (https://indexer.example.com)
    ↓ indexer: "https://indexer.example.com"
Node 1 (consensus)
    ↑ P2P connections
Node 2 (consensus)
    ↑ P2P connections
Node N (consensus)
```

**Alternative Production:**
```
Frontend
    ↓
Dedicated Indexer (exposes APIs)
    ↑ Queries state
    ↓ Submits txs
Consensus Network (nodes communicate via P2P)
```

---

## 6. Key Migration Considerations

### 6.1 API Compatibility

**The simulator and indexer expose the same API endpoints:**
- `/submit` - Transaction/Seed/Summary submission
- `/state/:query` - State queries
- `/seed/:query` - Seed queries
- `/updates/:filter` - WebSocket updates stream
- `/mempool` - WebSocket mempool stream
- `/explorer/*` - Block explorer endpoints

**This means the frontend can switch between simulator and indexer by changing VITE_URL**

### 6.2 WebSocket Origin Validation

**Simulator:** `simulator/src/api/ws.rs` (lines 26-65)
- Checks `ALLOWED_WS_ORIGINS` environment variable
- Empty or unset = allow all (dev mode)
- Set = comma-separated list of allowed origins

**Production Recommendation:**
```bash
ALLOWED_WS_ORIGINS="https://app.example.com,https://www.example.com"
```

### 6.3 State Verification

**Critical:** Both client and simulator verify cryptographic proofs
- Summaries are verified before acceptance
- State lookups include Merkle proofs
- Seeds are signature-verified
- Client verifies responses against network identity

**Files:**
- `simulator/src/api/http.rs` (lines 194-215) - Summary verification
- `client/src/client.rs` (lines 274-280) - Lookup verification

### 6.4 Rate Limiting

**Simulator:** `simulator/src/api/mod.rs` (lines 36-51)
```rust
GovernorConfigBuilder::default()
    .per_nanosecond(1)  // ~1B req/s for local dev
    .burst_size(2_000_000)
```

**Production:** Should configure stricter limits based on expected load

---

## 7. Migration Checklist

### Phase 1: Deploy Indexer (Simulator Mode)
- [ ] Deploy simulator with production configuration
- [ ] Configure `ALLOWED_WS_ORIGINS` for production domains
- [ ] Set up proper rate limiting
- [ ] Configure explorer retention limits
- [ ] Set up SSL/TLS termination
- [ ] Configure health checks and monitoring

### Phase 2: Deploy Consensus Network
- [ ] Generate network identity and shares
- [ ] Create node configurations (YAML files)
- [ ] Deploy initial validators
- [ ] Configure P2P networking and firewall rules
- [ ] Point all nodes to indexer URL
- [ ] Verify consensus is producing blocks

### Phase 3: Frontend Migration
- [ ] Update `VITE_URL` to point to production indexer
- [ ] Update `VITE_IDENTITY` to production network identity
- [ ] Test WebSocket connections
- [ ] Verify transaction submission
- [ ] Test explorer functionality
- [ ] Monitor for errors and latency

### Phase 4: Monitoring
- [ ] Set up metrics collection (Prometheus compatible)
  - Node metrics port: configurable (default 9090)
- [ ] Monitor WebSocket connection stability
- [ ] Track transaction submission success rate
- [ ] Monitor consensus health
- [ ] Set up alerting for failures

---

## 8. File Reference Index

### Simulator
- Entry: `/home/r/Coding/nullsociety/simulator/src/main.rs`
- Library: `/home/r/Coding/nullsociety/simulator/src/lib.rs`
- API Router: `/home/r/Coding/nullsociety/simulator/src/api/mod.rs`
- HTTP Handlers: `/home/r/Coding/nullsociety/simulator/src/api/http.rs`
- WebSocket Handlers: `/home/r/Coding/nullsociety/simulator/src/api/ws.rs`
- State Management: `/home/r/Coding/nullsociety/simulator/src/state.rs`
- Explorer: `/home/r/Coding/nullsociety/simulator/src/explorer.rs`

### Node
- Entry: `/home/r/Coding/nullsociety/node/src/main.rs`
- Library: `/home/r/Coding/nullsociety/node/src/lib.rs`
- Engine: `/home/r/Coding/nullsociety/node/src/engine.rs`
- Indexer Trait: `/home/r/Coding/nullsociety/node/src/indexer.rs`
- Application: `/home/r/Coding/nullsociety/node/src/application/`

### Client SDK
- Client: `/home/r/Coding/nullsociety/client/src/client.rs`
- Library: `/home/r/Coding/nullsociety/client/src/lib.rs`
- Events: `/home/r/Coding/nullsociety/client/src/events.rs`

### Frontend
- Chain Hook: `/home/r/Coding/nullsociety/website/src/hooks/useChainService.ts`
- Client: `/home/r/Coding/nullsociety/website/src/api/client.js`
- WASM: `/home/r/Coding/nullsociety/website/src/api/wasm.js`
- Explorer: `/home/r/Coding/nullsociety/website/src/api/explorerClient.ts`
- Service: `/home/r/Coding/nullsociety/website/src/services/CasinoChainService.ts`
- Environment: `/home/r/Coding/nullsociety/website/.env`

### Deployment
- Dockerfile: `/home/r/Coding/nullsociety/Dockerfile`

---

## 9. Architecture Diagrams

### Current Development Setup
```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (Vite Dev Server :5173)                            │
│  - React Application                                        │
│  - WASM Runtime                                             │
│  - Environment: VITE_URL=http://localhost:8080              │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/WebSocket
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ Simulator (:8080)                                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ HTTP API                                             │   │
│  │  - /submit (POST)                                    │   │
│  │  - /state/:query (GET)                               │   │
│  │  - /seed/:query (GET)                                │   │
│  │  - /explorer/* (GET)                                 │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ WebSocket API                                        │   │
│  │  - /updates/:filter (WS)                             │   │
│  │  - /mempool (WS)                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ State Management                                     │   │
│  │  - Seeds (BTreeMap)                                  │   │
│  │  - State (Merkle proofs)                             │   │
│  │  - Events (indexed)                                  │   │
│  │  - Mempool (pending txs)                             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Explorer                                             │   │
│  │  - Blocks index                                      │   │
│  │  - Transactions index                                │   │
│  │  - Account activity                                  │   │
│  │  - Game events                                       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Production Network (Target Architecture)
```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (Browser)                                          │
│  - VITE_URL=https://indexer.example.com                     │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS/WSS
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ Indexer (Public-facing)                                     │
│  - Same API as simulator                                    │
│  - WebSocket origin validation                              │
│  - Rate limiting                                            │
│  - SSL/TLS termination                                      │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP (internal)
                     │ - submit_summary()
                     │ - listen_mempool()
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ Consensus Network (P2P)                                     │
│                                                             │
│  ┌──────────────┐       ┌──────────────┐                   │
│  │   Node 1     │◄─────►│   Node 2     │                   │
│  │  :9000       │  P2P  │  :9000       │                   │
│  └──────┬───────┘       └──────┬───────┘                   │
│         │                      │                            │
│         │ P2P           P2P    │                            │
│         │ ┌──────────────┐    │                            │
│         └►│   Node 3     │◄───┘                            │
│           │  :9000       │                                  │
│           └──────────────┘                                  │
│                                                             │
│  Each Node:                                                 │
│   - Consensus Engine                                        │
│   - Application (executes transactions)                     │
│   - Seeder (produces randomness)                            │
│   - Aggregator (produces summaries)                         │
│   - Connects to Indexer via HTTP                            │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow: Transaction Submission
```
Frontend                 Indexer/Simulator           Node Network
   │                            │                         │
   │ 1. Sign & Submit Tx        │                         │
   ├───────────────────────────►│                         │
   │    POST /submit            │                         │
   │                            │                         │
   │                            │ 2. Broadcast to Mempool │
   │                            ├────────────────────────►│
   │                            │                         │
   │◄───────────────────────────┤                         │
   │    200 OK                  │                         │
   │                            │                         │
   │ 3. Listen for confirmation │                         │
   │◄───────────────────────────┤                         │
   │    WS: /mempool            │                         │
   │    (tx appears)            │                         │
   │                            │                         │
   │                            │ 4. Execute & Finalize   │
   │                            │◄────────────────────────┤
   │                            │    submit_summary()     │
   │                            │                         │
   │ 5. Event notification      │                         │
   │◄───────────────────────────┤                         │
   │    WS: /updates/:filter    │                         │
   │    (CasinoGameStarted)     │                         │
```

---

## 10. Security Considerations

### Cryptographic Verification
- All summaries verified before acceptance
- State lookups include Merkle proofs
- Client verifies all responses against network identity
- Seeds are signature-verified

### Network Security
- WebSocket origin validation in production
- Rate limiting on all endpoints
- P2P network uses authenticated discovery
- Configurable firewall rules for P2P ports

### Key Management
- Private keys stored in YAML config files (nodes)
- Frontend generates ephemeral keypairs from identity seed
- Network identity distributed to all participants
- Threshold signatures for consensus

---

## Conclusion

The migration from simulator to real nodes is straightforward due to:

1. **API Compatibility:** Simulator and indexer expose identical APIs
2. **Client Abstraction:** Frontend uses SDK that works with both
3. **Environment Configuration:** Simple URL change via `VITE_URL`
4. **Verification:** Cryptographic proofs ensure integrity

The key is that **nodes don't expose public APIs directly** - they connect to an indexer that serves the frontend. This allows the simulator to act as the indexer in development and a dedicated indexer in production.
