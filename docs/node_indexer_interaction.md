# Node-Indexer Interaction Facts

This document provides factual evidence of how nodes connect to and interact with the indexer.

## 1. Node Startup and Indexer Client Creation

### Location: `/home/r/Coding/nullsociety/node/src/main.rs`

**Lines 228-229 (Dry Run):**
```rust
let _indexer = Client::new(&config.indexer, config.identity)
    .context("Failed to create indexer client")?;
```

**Lines 358-359 (Production):**
```rust
let indexer = Client::new(&config.indexer, identity)
    .context("Failed to create indexer client")?;
```

The indexer client is created with:
- `config.indexer`: The indexer URL (string)
- `identity`: The network Identity (derived from BLS polynomial)

## 2. Configuration Requirements

### Location: `/home/r/Coding/nullsociety/node/src/lib.rs`

### Config Struct (Lines 70-142)

**Required Fields:**
```rust
pub struct Config {
    pub private_key: HexBytes,           // Ed25519 private key
    pub share: HexBytes,                 // BLS share
    pub polynomial: HexBytes,            // BLS polynomial commitment

    pub port: u16,                       // P2P port
    pub metrics_port: u16,               // Metrics port
    pub directory: String,               // Storage directory
    pub worker_threads: usize,           // Runtime threads
    pub log_level: String,               // Log level

    pub allowed_peers: Vec<String>,      // Peer public keys
    pub bootstrappers: Vec<String>,      // Bootstrap node keys

    pub message_backlog: usize,
    pub mailbox_size: usize,
    pub deque_size: usize,
    pub mempool_max_backlog: usize,      // Default: 64
    pub mempool_max_transactions: usize, // Default: 100,000
    pub max_pending_seed_listeners: usize, // Default: 10,000

    pub indexer: String,                 // *** INDEXER URL (required, validated as http/https) ***
    pub execution_concurrency: usize,

    // ... plus ~20 tunable parameters with defaults
}
```

**Indexer URL Validation (Lines 537-538):**
```rust
validate_http_url("indexer", &self.indexer)?;
```

The validation function (lines 425-446) ensures:
- URL is properly formatted
- Scheme is `http` or `https`
- Host is present

**ValidatedConfig (Lines 167-215):**
After validation, the config becomes:
```rust
pub struct ValidatedConfig {
    pub signer: PrivateKey,              // Parsed Ed25519 private key
    pub public_key: PublicKey,           // Derived public key
    pub share: group::Share,             // Parsed BLS share
    pub polynomial: poly::Poly<Evaluation>, // Parsed polynomial
    pub identity: Identity,              // Derived from polynomial

    pub indexer: String,                 // Validated URL
    // ... other fields
}
```

## 3. Key Material Used

### Location: `/home/r/Coding/nullsociety/node/src/lib.rs`

**Ed25519 Keys:**
- Used for P2P network authentication
- Used to sign messages to peers
- Public key identifies the node

**BLS Keys:**
- `share`: Secret share for threshold signatures
- `polynomial`: Public polynomial commitment
- `identity`: Network identity = `public_key(polynomial)` (line 551)

The identity is computed at line 551:
```rust
let identity = *poly::public::<MinSig>(&polynomial);
```

## 4. Engine Configuration and Indexer Injection

### Location: `/home/r/Coding/nullsociety/node/src/main.rs`

**Lines 362-401 - Engine Configuration:**
```rust
let config = engine::Config {
    blocker: oracle,
    identity: engine::IdentityConfig {
        signer: config.signer,
        polynomial: config.polynomial,
        share: config.share,
        participants: peers,
    },
    storage: engine::StorageConfig { /* ... */ },
    consensus: engine::ConsensusConfig { /* ... */ },
    application: engine::ApplicationConfig {
        indexer,                         // *** Indexer passed to application ***
        execution_concurrency: config.execution_concurrency,
        max_uploads_outstanding: config.max_uploads_outstanding,
        mempool_max_backlog: config.mempool_max_backlog,
        mempool_max_transactions: config.mempool_max_transactions,
        max_pending_seed_listeners: config.max_pending_seed_listeners,
    },
};
```

**Lines 402-414 - Engine Start:**
```rust
let engine = engine::Engine::new(context.with_label("engine"), config).await;
let engine = engine.start(
    pending,
    recovered,
    resolver,
    broadcaster,
    backfill,
    seeder,
    aggregator,
    aggregation,
);
```

## 5. Application Actor and Mempool Stream

### Location: `/home/r/Coding/nullsociety/node/src/application/actor.rs`

**Lines 460-475 - Mempool Stream Initialization:**
```rust
// Use reconnecting indexer wrapper
let reconnecting_indexer = crate::indexer::ReconnectingIndexer::new(
    self.context.with_label("indexer"),
    self.indexer,
);

// This will never fail and handles reconnection internally
let mut next_prune = self.context.gen_range(1..=PRUNE_INTERVAL);
let tx_stream = match reconnecting_indexer.listen_mempool().await {
    Ok(tx_stream) => tx_stream,
    Err(err) => {
        error!(?err, "failed to start indexer mempool stream");
        return;
    }
};
let mut tx_stream = Box::pin(tx_stream);
```

**Lines 891-930 - Mempool Transaction Processing:**
```rust
pending = tx_stream.next() => {
    // The reconnecting wrapper handles all connection issues internally
    // We only get Some(Ok(tx)) for valid transactions
    let Some(Ok(pending)) = pending else {
        // This should only happen if there's a transaction-level error
        // The stream itself won't end due to the reconnecting wrapper
        continue;
    };

    // Process transactions (already verified in indexer client)
    for tx in pending.transactions {
        // Check if below next
        let next = match next_nonce_cache.get(&tx.public) {
            Some(next) => *next,
            None => match nonce(&state, &tx.public).await {
                Ok(next) => {
                    next_nonce_cache.insert(tx.public.clone(), next);
                    next
                }
                Err(err) => {
                    nonce_read_errors.inc();
                    warn!(
                        ?err,
                        public = ?tx.public,
                        "failed to read account nonce; dropping transaction"
                    );
                    continue;
                }
            },
        };
        if tx.nonce < next {
            // If below next, we drop the incoming transaction
            debug!(tx = tx.nonce, state = next, "dropping incoming transaction");
            continue;
        }

        // Add to mempool
        mempool.add(tx);
    }
}
```

## 6. Indexer Trait Definition

### Location: `/home/r/Coding/nullsociety/node/src/indexer.rs`

**Lines 40-59 - Trait Definition:**
```rust
pub trait Indexer: Clone + Send + Sync + 'static {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Upload a seed to the indexer.
    fn submit_seed(&self, seed: Seed) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Get a stream of transactions from the indexer.
    fn listen_mempool(
        &self,
    ) -> impl Future<
        Output = Result<impl Stream<Item = Result<Pending, Self::Error>> + Send, Self::Error>,
    > + Send;

    /// Upload result
    fn submit_summary(
        &self,
        summary: Summary,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
}
```

## 7. nullspace_client::Client Implementation

### Location: `/home/r/Coding/nullsociety/node/src/indexer.rs`

**Lines 130-146 - Implementation:**
```rust
impl Indexer for nullspace_client::Client {
    type Error = nullspace_client::Error;

    async fn submit_seed(&self, seed: Seed) -> Result<(), Self::Error> {
        self.submit_seed(seed).await
    }

    async fn listen_mempool(
        &self,
    ) -> Result<impl Stream<Item = Result<Pending, Self::Error>>, Self::Error> {
        self.connect_mempool().await
    }

    async fn submit_summary(&self, summary: Summary) -> Result<(), Self::Error> {
        self.submit_summary(summary).await
    }
}
```

## 8. Client HTTP Implementation

### Location: `/home/r/Coding/nullsociety/client/src/client.rs`

**Lines 73-107 - Client Creation:**
```rust
pub fn new(base_url: &str, identity: Identity) -> Result<Self> {
    let base_url = Url::parse(base_url)?;

    // Convert http(s) to ws(s) for WebSocket URL
    let ws_scheme = match base_url.scheme() {
        "http" => "ws",
        "https" => "wss",
        scheme => {
            return Err(Error::InvalidScheme(scheme.to_string()));
        }
    };

    let mut ws_url = base_url.clone();
    ws_url
        .set_scheme(ws_scheme)
        .map_err(|_| Error::InvalidScheme(ws_scheme.to_string()))?;

    let http_client = HttpClient::builder()
        .timeout(TIMEOUT)                             // 30 seconds
        .pool_max_idle_per_host(100)                  // Connection pooling
        .pool_idle_timeout(Duration::from_secs(60))   // Keep-alive
        .tcp_keepalive(Duration::from_secs(30))       // TCP keepalive
        .build()?;

    Ok(Self {
        base_url,
        ws_url,
        http_client,
        identity,
        retry_policy: RetryPolicy::default(),
    })
}
```

**Lines 242-253 - Seed Submission:**
```rust
pub async fn submit_seed(&self, seed: Seed) -> Result<()> {
    let submission = Submission::Seed(seed);
    self.submit(submission).await
}

async fn submit(&self, submission: Submission) -> Result<()> {
    let encoded = submission.encode().to_vec();
    let url = self.base_url.join("submit")?;
    debug!("Submitting to {}", url);

    self.post_bytes_with_retry(url, Bytes::from(encoded)).await
}
```

**Lines 237-240 - Summary Submission:**
```rust
pub async fn submit_summary(&self, summary: Summary) -> Result<()> {
    let submission = Submission::Summary(summary);
    self.submit(submission).await
}
```

**Lines 354-365 - Mempool Connection:**
```rust
pub async fn connect_mempool(&self) -> Result<Stream<Pending>> {
    let ws_url = self.ws_url.join("mempool")?;
    info!("Connecting to WebSocket at {}", ws_url);

    let (ws_stream, _) = timeout(TIMEOUT, connect_async(ws_url.as_str()))
        .await
        .map_err(|_| Error::DialTimeout)??;
    info!("WebSocket connected");

    Ok(Stream::new(ws_stream))
}
```

## 9. Reconnecting Stream Wrapper

### Location: `/home/r/Coding/nullsociety/node/src/indexer.rs`

**Lines 148-284 - ReconnectingStream Implementation:**

The `ReconnectingStream` wraps the indexer's `listen_mempool` with automatic reconnection:

**Lines 203-266 - Connection Loop:**
```rust
let handle = context.spawn({
    move |mut context| async move {
        let mut backoff = Duration::from_millis(200);
        loop {
            // Try to connect
            connect_attempts.inc();
            match indexer.listen_mempool().await {
                Ok(stream) => {
                    connect_success.inc();
                    info!("connected to mempool stream");
                    let mut stream = Box::pin(stream);
                    backoff = Duration::from_millis(200);

                    // Forward transactions until stream fails
                    while let Some(result) = stream.next().await {
                        match result {
                            Ok(pending) => {
                                // Batch verify transactions
                                let mut batcher = Batch::new();
                                let mut payload_scratch = Vec::new();
                                for tx in &pending.transactions {
                                    tx.verify_batch_with_scratch(
                                        &mut batcher,
                                        &mut payload_scratch,
                                    );
                                }
                                if !batcher.verify(&mut context) {
                                    warn!("received invalid transaction from indexer");
                                    invalid_batches.inc();
                                    continue;
                                }

                                // Pass to receiver
                                if tx.send(Ok(pending)).await.is_err() {
                                    warn!("receiver dropped");
                                    return;
                                }
                                forwarded_batches.inc();
                            }
                            Err(e) => {
                                stream_failures.inc();
                                error!(?e, "mempool stream error");
                                break;
                            }
                        }
                    }

                    warn!("mempool stream ended");
                }
                Err(e) => {
                    connect_failures.inc();
                    error!(?e, "failed to connect mempool stream");
                }
            }

            // Wait before reconnecting
            let delay = jittered_backoff(&mut context, backoff);
            context.sleep(delay).await;
            backoff = backoff.saturating_mul(2).min(TX_STREAM_RECONNECT_DELAY);
        }
    }
});
```

**Key Features:**
- Automatically reconnects on connection failure
- Verifies transaction signatures in batch
- Exponential backoff with jitter (200ms → 10s max)
- Never terminates (infinite retry loop)

## 10. Seeder: Seed Submission

### Location: `/home/r/Coding/nullsociety/node/src/seeder/actor.rs`

**Lines 415-437 - Seed Upload with Retry:**
```rust
let seed_upload_failures = seed_upload_failures.clone();
move |mut context| async move {
    let view = seed.view();
    let mut attempts = 0u64;
    let mut backoff = Duration::from_millis(200);
    loop {
        attempts = attempts.saturating_add(1);
        seed_upload_attempts.inc();
        match indexer.submit_seed(seed.clone()).await {
            Ok(()) => break,
            Err(e) => {
                seed_upload_failures.inc();
                warn!(?e, view, attempts, "failed to upload seed");
                let delay = jittered_backoff(&mut context, backoff);
                context.sleep(delay).await;
                backoff = backoff.saturating_mul(2).min(RETRY_DELAY);
            }
        }
    }
    debug!(view, attempts, "seed uploaded to indexer");
    let _ = channel.uploaded(view).await;
}
```

**Process:**
1. Seeder generates seeds after consensus finalization
2. Seeds are uploaded to indexer via `submit_seed()`
3. Infinite retry with exponential backoff on failure
4. Success confirmed via metrics

## 11. Aggregator: Summary Submission

### Location: `/home/r/Coding/nullsociety/node/src/aggregator/actor.rs`

**Lines 735-757 - Summary Upload with Retry:**
```rust
let summary_upload_attempts = summary_upload_attempts.clone();
let summary_upload_failures = summary_upload_failures.clone();
move |mut context| async move {
    let mut attempts = 0u64;
    let mut backoff = Duration::from_millis(200);
    loop {
        attempts = attempts.saturating_add(1);
        summary_upload_attempts.inc();
        match indexer.submit_summary(summary.clone()).await {
            Ok(()) => break,
            Err(e) => {
                summary_upload_failures.inc();
                warn!(?e, cursor, attempts, "failed to upload summary");
                let delay = jittered_backoff(&mut context, backoff);
                context.sleep(delay).await;
                backoff = backoff.saturating_mul(2).min(RETRY_DELAY);
            }
        }
    }
    debug!(cursor, attempts, "summary uploaded to indexer");
    channel.uploaded(cursor).await;
}
```

**Process:**
1. Aggregator collects execution results from application
2. Summaries are uploaded to indexer via `submit_summary()`
3. Infinite retry with exponential backoff on failure
4. Success confirmed via metrics

## 12. Data Flow Summary

### Incoming (Indexer → Node):

```
Indexer WebSocket (ws://host/mempool)
    ↓
Client.connect_mempool()
    ↓
ReconnectingStream (with batch signature verification)
    ↓
Application Actor (lines 891-930 in actor.rs)
    ↓
Mempool (filtered by nonce)
    ↓
Block Proposal (used during consensus)
```

### Outgoing (Node → Indexer):

**Seeds:**
```
Consensus Finalization
    ↓
Seeder Actor
    ↓
indexer.submit_seed() → POST /submit (with infinite retry)
    ↓
Indexer
```

**Summaries:**
```
Application Execution
    ↓
Aggregator Actor
    ↓
indexer.submit_summary() → POST /submit (with infinite retry)
    ↓
Indexer
```

## 13. Connection Lifecycle

1. **Node Startup:**
   - Load config (includes indexer URL)
   - Validate indexer URL
   - Create Client with URL and network identity
   - Pass client to engine

2. **Engine Initialization:**
   - Create application actor with indexer
   - Create seeder actor with indexer
   - Create aggregator actor with indexer

3. **Application Start:**
   - Wrap indexer in ReconnectingIndexer
   - Call `listen_mempool()` to establish WebSocket
   - Start consuming transaction stream

4. **Seeder Start:**
   - Wait for consensus finalization
   - Generate seeds
   - Upload via `submit_seed()`

5. **Aggregator Start:**
   - Wait for execution results
   - Aggregate proofs
   - Upload via `submit_summary()`

## 14. Error Handling and Resilience

**Mempool Stream:**
- Automatic reconnection on disconnect (ReconnectingStream)
- Exponential backoff: 200ms → 10s
- Invalid transactions dropped (batch signature verification)
- Metrics: connect_attempts, connect_failures, stream_failures, invalid_batches

**Seed Uploads:**
- Infinite retry loop
- Exponential backoff: 200ms → max (RETRY_DELAY)
- Metrics: seed_upload_attempts, seed_upload_failures

**Summary Uploads:**
- Infinite retry loop
- Exponential backoff: 200ms → max (RETRY_DELAY)
- Metrics: summary_upload_attempts, summary_upload_failures

**HTTP Client:**
- 30-second timeout per request
- Connection pooling (100 connections/host)
- TCP keepalive (30s)
- Retry policy for GET requests (configurable)

## 15. Indexer Endpoints Used

**WebSocket:**
- `ws(s)://host/mempool` - Transaction stream

**HTTP POST:**
- `/submit` - All submissions (transactions, seeds, summaries)
  - Content-Type: application/octet-stream (codec-encoded)

**HTTP GET:**
- `/state/{key_hash}` - Query state by key
- Used by clients, not directly by nodes

## 16. Configuration Example

```yaml
# Required for indexer connection
indexer: "http://indexer.example.com:8080"

# Required for node identity
private_key: "0x..."  # Ed25519 private key
share: "0x..."        # BLS secret share
polynomial: "0x..."   # BLS polynomial commitment

# Required for P2P
port: 9000
metrics_port: 9001
directory: "/path/to/storage"
worker_threads: 8
log_level: "info"

# Peer configuration
allowed_peers: ["0x...", "0x..."]
bootstrappers: ["0x..."]

# Mempool tuning (optional, have defaults)
mempool_max_backlog: 64
mempool_max_transactions: 100000
max_pending_seed_listeners: 10000

# Message passing (required)
message_backlog: 1024
mailbox_size: 1024
deque_size: 1024

# Execution (required)
execution_concurrency: 4
```
