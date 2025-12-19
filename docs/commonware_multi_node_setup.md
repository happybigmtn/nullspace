# Commonware Framework: Multi-Node Local Setup Guide

**Version**: commonware 0.0.62
**Project**: nullspace (BFT consensus blockchain)
**Last Updated**: 2025-12-18

## Table of Contents

1. [Overview](#overview)
2. [Network Architecture](#network-architecture)
3. [Configuration Components](#configuration-components)
4. [Local Multi-Node Setup](#local-multi-node-setup)
5. [Storage Initialization](#storage-initialization)
6. [Network Bootstrapping](#network-bootstrapping)
7. [CLI Tools and Scripts](#cli-tools-and-scripts)
8. [Testing and Simulation](#testing-and-simulation)
9. [References](#references)

---

## Overview

Commonware is an "anti-framework" providing composable primitives for building BFT consensus systems. Your nullspace project uses the following key components:

- **commonware-consensus**: `threshold_simplex` consensus protocol with aggregation
- **commonware-p2p**: Authenticated peer discovery and encrypted point-to-point messaging
- **commonware-runtime**: Tokio-based async runtime with deterministic testing support
- **commonware-storage**: Journal-based persistent storage with ADB (Append-Only Database)
- **commonware-deployer**: EC2 deployment automation (optional for production)

### Current Project Structure

```
nullspace/
├── node/           # Validator node binary
├── client/         # Client library for interacting with nodes
├── execution/      # State machine execution layer
├── simulator/      # Local simulator for testing
├── types/          # Shared type definitions
└── Cargo.toml      # Workspace configuration
```

---

## Network Architecture

### Consensus Parameters (Minimmit Protocol)

Your project uses the Minimmit consensus variant with these fault tolerance parameters:

```text
Byzantine replicas: ≤ f
Total replicas: n ≥ 5f + 1
Partial synchrony: every message arrives within Δ after GST

Quorums:
  L = n - 3f (2f + 1)  # Lightweight quorum
  Q = n - f (4f + 1)   # Strong quorum
```

**Example**: For `f=1` Byzantine fault tolerance:
- Minimum nodes: `n ≥ 5(1) + 1 = 6`
- Lightweight quorum: `L = 6 - 3 = 3`
- Strong quorum: `Q = 6 - 1 = 5`

### Network Channels

Your node implementation defines 8 communication channels (from `/home/r/Coding/nullsociety/node/src/main.rs`):

```rust
const PENDING_CHANNEL: u32 = 0;         // Pending transactions
const RECOVERED_CHANNEL: u32 = 1;       // Recovered state
const RESOLVER_CHANNEL: u32 = 2;        // Block resolution
const BROADCASTER_CHANNEL: u32 = 3;     // Block broadcasting
const BACKFILL_BY_DIGEST_CHANNEL: u32 = 4; // Historical sync
const SEEDER_CHANNEL: u32 = 5;          // State seeding
const AGGREGATOR_CHANNEL: u32 = 6;      // Signature aggregation requests
const AGGREGATION_CHANNEL: u32 = 7;     // Signature aggregation responses
```

Each channel has independent rate limiting via governor `Quota` configuration.

---

## Configuration Components

### 1. Node Configuration File

Your nodes require a YAML configuration file (referenced via `--config` flag):

**Required Fields**:
- `private_key`: Ed25519 private key (hex-encoded)
- `polynomial`: BLS12-381 polynomial for threshold signatures
- `share`: This node's BLS threshold share
- `port`: P2P listening port
- `metrics_port`: Prometheus metrics endpoint
- `directory`: Storage directory path
- `indexer`: Indexer service URL
- `bootstrappers`: List of bootstrap node public keys
- `log_level`: Tracing log level (e.g., "info", "debug")

**Optional Performance Tuning**:
- `worker_threads`: Tokio worker thread count
- `mailbox_size`: Channel buffer sizes
- `max_message_size`: Maximum P2P message size
- `buffer_pool_page_size`, `buffer_pool_capacity`: Memory pool configuration
- `execution_concurrency`: Parallel execution threads

**Example Minimal Config** (`node1.yaml`):
```yaml
private_key: "HEXENCODED_ED25519_PRIVATE_KEY"
polynomial: "HEXENCODED_BLS_POLYNOMIAL"
share: "HEXENCODED_BLS_SHARE"
port: 3001
metrics_port: 9091
directory: "/tmp/nullspace/node1"
indexer: "http://127.0.0.1:8080"
bootstrappers: []  # Empty for first node
log_level: "info"
worker_threads: 4
mailbox_size: 1000
max_message_size: 10485760  # 10MB
```

### 2. Peers Configuration

Two methods for defining the peer set:

#### Method A: Hosts File (for EC2 deployment)

```yaml
# hosts.yaml (commonware-deployer format)
hosts:
  - name: "peer-0-PUBKEY_HEX"
    ip: 10.0.1.10
  - name: "peer-1-PUBKEY_HEX"
    ip: 10.0.1.11
  - name: "peer-2-PUBKEY_HEX"
    ip: 10.0.1.12
```

Usage: `cargo run --bin nullspace-node -- --hosts hosts.yaml --config node.yaml`

#### Method B: Peers File (for local setup)

```yaml
# peers.yaml
addresses:
  "peer-0-PUBKEY_HEX": "127.0.0.1:3001"
  "peer-1-PUBKEY_HEX": "127.0.0.1:3002"
  "peer-2-PUBKEY_HEX": "127.0.0.1:3003"
```

Usage: `cargo run --bin nullspace-node -- --peers peers.yaml --config node.yaml`

**Public Key Format**: The parser extracts public keys from the name/key string using `parse_peer_public_key()`.

---

## Local Multi-Node Setup

### Step 1: Generate Identities and Keys

For threshold consensus, you need:
1. **Ed25519 keypairs** for P2P authentication (one per node)
2. **BLS12-381 threshold keys** for aggregated signatures

**Option A: Trusted Setup** (simpler, for testing)

Generate a shared polynomial and derive shares for all participants:

```rust
use commonware_cryptography::bls12381::{Polynomial, PrivateKey};
use commonware_cryptography::ed25519;

// Generate threshold polynomial (f=1 for 3+ nodes)
let threshold = 1;
let polynomial = Polynomial::new(threshold, &mut rng);

// Derive shares for each participant
let share_1 = polynomial.evaluate(1);
let share_2 = polynomial.evaluate(2);
let share_3 = polynomial.evaluate(3);
// ... continue for all nodes

// Generate Ed25519 keys per node
let ed25519_key_1 = ed25519::PrivateKey::from_seed(1);
let ed25519_key_2 = ed25519::PrivateKey::from_seed(2);
// ... etc.
```

**Option B: DKG (Distributed Key Generation)** (production-ready)

Use the commonware-reshare example as a template:

```bash
# From commonware monorepo examples
cargo run --bin commonware-reshare setup --with-dkg \
  --num-peers 5 \
  --datadir ./data \
  --base-port 3000
```

This generates per-validator configs and emits mprocs commands for running the DKG ceremony.

### Step 2: Create Configuration Files

For a 3-node local cluster (minimum viable):

**Node 1** (`configs/node1.yaml`):
```yaml
private_key: "<node1_ed25519_private_key_hex>"
polynomial: "<shared_polynomial_hex>"
share: "<node1_bls_share_hex>"
port: 3001
metrics_port: 9091
directory: "/tmp/nullspace/node1"
indexer: "http://127.0.0.1:8080"
bootstrappers: []  # First node is bootstrap
log_level: "info"
```

**Node 2** (`configs/node2.yaml`):
```yaml
private_key: "<node2_ed25519_private_key_hex>"
polynomial: "<shared_polynomial_hex>"
share: "<node2_bls_share_hex>"
port: 3002
metrics_port: 9092
directory: "/tmp/nullspace/node2"
indexer: "http://127.0.0.1:8080"
bootstrappers: ["<node1_pubkey_hex>"]  # Bootstrap from node1
log_level: "info"
```

**Node 3** (`configs/node3.yaml`):
```yaml
private_key: "<node3_ed25519_private_key_hex>"
polynomial: "<shared_polynomial_hex>"
share: "<node3_bls_share_hex>"
port: 3003
metrics_port: 9093
directory: "/tmp/nullspace/node3"
indexer: "http://127.0.0.1:8080"
bootstrappers: ["<node1_pubkey_hex>"]
log_level: "info"
```

**Peers File** (`configs/peers.yaml`):
```yaml
addresses:
  "peer-0-<node1_pubkey_hex>": "127.0.0.1:3001"
  "peer-1-<node2_pubkey_hex>": "127.0.0.1:3002"
  "peer-2-<node3_pubkey_hex>": "127.0.0.1:3003"
```

### Step 3: Initialize Storage

Storage is automatically initialized on first run via the commonware-runtime `Storage` trait:

```rust
// From node/src/main.rs initialization
let cfg = tokio::Config::default()
    .with_storage_directory(PathBuf::from(&config.directory));
let executor = tokio::Runner::new(cfg);
```

The storage system creates:
- **Partition-based blobs**: Each consensus/application component gets isolated partitions
- **Freezer tables**: Immutable historical data (blocks, finalized state)
- **Journals**: Append-only logs for consensus metadata

No manual initialization required - the runtime handles it.

### Step 4: Start Nodes

**Terminal 1** (Node 1 - Bootstrap):
```bash
cargo run --release --bin nullspace-node -- \
  --peers configs/peers.yaml \
  --config configs/node1.yaml
```

**Terminal 2** (Node 2):
```bash
cargo run --release --bin nullspace-node -- \
  --peers configs/peers.yaml \
  --config configs/node2.yaml
```

**Terminal 3** (Node 3):
```bash
cargo run --release --bin nullspace-node -- \
  --peers configs/peers.yaml \
  --config configs/node3.yaml
```

### Step 5: Verify Network Health

Check metrics endpoints:
```bash
# Node 1 metrics
curl http://127.0.0.1:9091/metrics | grep p2p_connections

# Node 2 metrics
curl http://127.0.0.1:9092/metrics | grep p2p_connections

# Node 3 metrics
curl http://127.0.0.1:9093/metrics | grep p2p_connections
```

Expected: `p2p_connections = 2` (each node connects to 2 peers)

---

## Storage Initialization

### Storage Architecture

Commonware uses a layered storage approach:

1. **Blobs**: Low-level key-value storage within partitions
2. **Journals**: Append-only logs with section-based organization
3. **Freezer**: Write-once historical data (for finalized blocks)

### Blob Operations

```rust
use commonware_runtime::Storage;

// Open a blob (creates if doesn't exist)
let (blob, size) = context
    .open("partition_name", &key_bytes)
    .await?;

// Write data
blob.write_at(data, offset).await?;

// Read data
let buffer = blob.read_at(vec![0u8; size], offset).await?;

// Ensure durability
blob.sync().await?;
```

### Journal Usage (for consensus metadata)

```rust
use commonware_storage::journal::{Journal, Config};

let cfg = Config {
    partition: "consensus_log".to_string(),
    items_per_section: 1000,  // Items before creating new section
};

let mut journal = Journal::init(context.with_label("journal"), cfg).await?;

// Append entries
for block_height in 0..100 {
    journal.append(block_data).await?;
}

// Read specific entry
let entry = journal.get(block_height).await?;

// Persist to disk
journal.sync().await?;
```

### Freezer Tables (for immutable history)

Configured in your node config:
```yaml
blocks_freezer_table_initial_size: 10000000   # 10MB initial
finalized_freezer_table_initial_size: 5000000 # 5MB initial
```

These grow automatically as historical data accumulates.

---

## Network Bootstrapping

### Peer Discovery Flow

1. **Static Peer Set**: All participants know the full peer list (from peers.yaml/hosts.yaml)
2. **Bootstrappers**: New nodes connect to designated bootstrap peers first
3. **Oracle Registration**: The blocker oracle authorizes the peer set

```rust
// From node/src/main.rs
let (mut network, mut oracle) =
    authenticated::Network::new(context.with_label("network"), p2p_cfg);

// Authorize all known peers
oracle.register(0, peers.clone()).await;
```

### Authenticated Discovery Process

```rust
use commonware_p2p::authenticated::discovery as authenticated;

let p2p_cfg = authenticated::Config::aggressive(
    signer,                           // Ed25519 private key
    &namespace,                        // Protocol namespace
    bind_addr,                         // 0.0.0.0:port
    advertise_addr,                    // public_ip:port
    bootstrappers,                     // Vec<(PublicKey, SocketAddr)>
    max_message_size,
);
```

**Bootstrapping Strategy**:
- **First node**: Empty bootstrappers list, acts as bootstrap for others
- **Subsequent nodes**: Include first node's (PublicKey, SocketAddr) in bootstrappers
- **Discovery**: Nodes exchange peer lists and establish full mesh connectivity

### Connection Verification

```rust
// Each node registers channels after network setup
let pending = network.register(PENDING_CHANNEL, quota, backlog);
let recovered = network.register(RECOVERED_CHANNEL, quota, backlog);
// ... etc.

// Start the network
let p2p_handle = network.start();
```

Monitor `p2p_connections` metric - should equal `peer_count - 1` when fully connected.

---

## CLI Tools and Scripts

### Dry-Run Validation

Validate configuration without starting the node:

```bash
cargo run --bin nullspace-node -- \
  --peers configs/peers.yaml \
  --config configs/node1.yaml \
  --dry-run
```

Output includes:
- Identity and public key
- Peer count and IP binding
- Port configuration
- Storage directory
- Buffer pool sizing
- Consensus timeouts
- Rate limits

### Commonware Deployer (for EC2)

Install deployer CLI:
```bash
cargo install commonware-deployer
```

**Create EC2 deployment**:
```bash
deployer ec2 create --config deployment.yaml
```

**Example deployment.yaml**:
```yaml
name: nullspace-testnet
regions:
  - us-west-2
  - eu-west-1
instances_per_region: 3
instance_type: t3.xlarge
ami: ami-0c55b159cbfafe1f0
key_name: nullspace-keypair
binary_path: ./target/release/nullspace-node
config_path: ./configs/node.yaml
```

**Update running instances**:
```bash
deployer ec2 update --config deployment.yaml --binary ./target/release/nullspace-node
```

**Authorize SSH access**:
```bash
deployer ec2 authorize --config deployment.yaml
```

**Destroy resources**:
```bash
deployer ec2 destroy --config deployment.yaml
```

---

## Testing and Simulation

### Deterministic Testing Runtime

For reproducible tests with simulated network conditions:

```rust
use commonware_runtime::deterministic;

#[test]
fn test_consensus() {
    let executor = deterministic::Runner::seeded(42);  // Deterministic seed
    executor.start(|context| async move {
        // Test logic with controlled time
        context.sleep(Duration::from_secs(1)).await;

        // Spawn labeled actors for debugging
        let handle = context.with_label("replica-1").spawn(|ctx| async move {
            // Actor logic
        });

        // Test with timeout
        tokio::select! {
            result = handle => { /* verify result */ },
            _ = context.sleep(Duration::from_secs(10)) => panic!("timeout"),
        }
    });
}
```

### Simulated Network Testing

```rust
use commonware_p2p::simulated::{Network, Link, Config};

let (network, mut oracle) = Network::new(
    context.with_label("network"),
    Config { max_size: 1024 * 1024 }
);

// Register channels per peer
let (sender, receiver) = oracle.register(peer_pubkey, channel_id).await?;

// Configure realistic network links
oracle.add_link(peer1_key, peer2_key, Link {
    latency: Duration::from_millis(50),   // Average latency
    jitter: Duration::from_millis(10),     // Variance
    success_rate: 0.98,                    // 98% delivery
}).await?;

// Start simulation
network.start();
```

### Local Simulator

Your project includes a simulator for local testing:

```bash
# Generate identity for simulator
cargo run --example get_identity --package nullspace-simulator

# Run simulator
cargo run --bin nullspace-simulator -- \
  --host 127.0.0.1 \
  --port 8080 \
  --identity <IDENTITY_HEX>
```

The simulator provides:
- HTTP/WebSocket API for transaction submission
- Local state machine execution
- Explorer index for querying blocks/transactions
- No network consensus (single-node simulation)

---

## Best Practices

### 1. Identity Management

- **Store private keys securely**: Use environment variables or secret management
- **Never commit keys to git**: Add config files with keys to `.gitignore`
- **Use DKG for production**: Avoid trusted setup for mainnet deployments

### 2. Storage Configuration

- **SSD recommended**: Consensus requires low-latency storage
- **Separate partitions**: Use different disks for storage vs. metrics/logs
- **Monitor disk usage**: Freezer tables grow unbounded without pruning

### 3. Network Tuning

- **Adjust rate limits**: Balance throughput vs. DoS protection
  ```yaml
  pending_rate_per_second: 10000
  recovered_rate_per_second: 1000
  broadcaster_rate_per_second: 100
  ```
- **Set realistic timeouts**: Based on actual network conditions
  ```yaml
  leader_timeout: "1s"
  notarization_timeout: "2s"
  fetch_timeout: "5s"
  ```

### 4. Monitoring

Essential metrics to track:
- `p2p_connections`: Should equal `peer_count - 1`
- `consensus_height`: Current block height
- `storage_synced_bytes`: Storage I/O health
- `mempool_size`: Transaction backlog
- `fetch_inflight`: Block synchronization status

### 5. Crash Recovery

The storage system automatically recovers on restart:

```rust
// Journal reopens and validates existing data
let journal = Journal::init(context, cfg).await?;
assert_eq!(journal.size(), expected_entries);  // Data persisted
```

Test recovery regularly:
```bash
# Kill node (Ctrl+C)
# Restart with same config
cargo run --release --bin nullspace-node -- --peers peers.yaml --config node.yaml
```

---

## Troubleshooting

### Issue: Nodes can't discover each other

**Check**:
1. Bootstrapper public keys match actual node identities
2. Firewall allows traffic on specified ports
3. Peer addresses are reachable (use `nc -zv <ip> <port>`)

**Solution**: Verify `p2p_cfg.bootstrappers` contains correct (PublicKey, SocketAddr) tuples

### Issue: Storage corruption

**Symptoms**: Node panics on startup with decode errors

**Solution**:
1. Check disk space and I/O errors
2. Delete storage directory and resync from peers
3. Enable `--dry-run` to validate config before full start

### Issue: Consensus stalls

**Check**:
1. Are `f+1` nodes online? (Minimum for progress)
2. Do all nodes have identical peer lists?
3. Are network timeouts too aggressive for actual latency?

**Solution**: Increase timeouts, verify quorum availability

---

## References

### Official Documentation

- [Commonware Monorepo](https://github.com/commonwarexyz/monorepo)
- [Commonware Website](https://commonware.xyz/)
- [API Documentation](https://docs.rs/commonware-consensus/latest/)

### Key Blog Posts

- [Introducing Commonware](https://commonware.xyz/blogs/introducing-commonware)
- [Commonware: The Anti-Framework](https://commonware.xyz/blogs/commonware-the-anti-framework)
- [Commonware Runtime Foundation](https://commonware.xyz/blogs/commonware-runtime)

### Example Projects

- **Alto**: Minimal blockchain ([monorepo/examples/alto](https://github.com/commonwarexyz/monorepo/tree/main/examples/alto))
- **Bridge**: Cross-chain certificates ([monorepo/examples/bridge](https://github.com/commonwarexyz/monorepo/tree/main/examples/bridge))
- **Chat**: Encrypted group messaging ([monorepo/examples/chat](https://github.com/commonwarexyz/monorepo/tree/main/examples/chat))
- **Reshare**: Threshold key reconfiguration ([monorepo/examples/reshare](https://github.com/commonwarexyz/monorepo/tree/main/examples/reshare))

### Source Code References

Project-specific implementation files:
- Node entry point: `/home/r/Coding/nullsociety/node/src/main.rs`
- Engine configuration: `/home/r/Coding/nullsociety/node/src/engine.rs`
- Network setup: Lines 290-307 in main.rs (P2P configuration)
- Storage initialization: Lines 237-241 in main.rs (Tokio runtime config)

---

## Quick Start Checklist

- [ ] Generate Ed25519 keypairs for all nodes
- [ ] Generate BLS threshold polynomial and shares (or run DKG)
- [ ] Create per-node YAML configs with unique ports/directories
- [ ] Create peers.yaml with all node addresses
- [ ] Validate configs with `--dry-run`
- [ ] Start bootstrap node first
- [ ] Start remaining nodes with bootstrap reference
- [ ] Verify `p2p_connections` metrics
- [ ] Submit test transactions via client or simulator
- [ ] Monitor consensus progress via metrics

---

**End of Documentation**
