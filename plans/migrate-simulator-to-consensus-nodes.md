# feat: Migrate from Simulator to Real Consensus Nodes

**Date:** 2025-12-18
**Type:** Infrastructure / DevOps
**Verified:** All claims in this document are backed by code investigation with file paths and line numbers.

---

## Executive Summary

**Good news: The migration requires NO CODE CHANGES to simulator, node, client, or frontend.**

The simulator was designed from the ground up to act as an indexer. All the plumbing already exists:
- Nodes can submit summaries/seeds to simulator via `POST /submit`
- Nodes can subscribe to transactions via WebSocket `/mempool`
- Frontend continues talking to simulator unchanged
- Block explorer works automatically with consensus data

**What's actually needed:**
1. Create a key generation tool (Rust binary)
2. Create configuration files (YAML)
3. Create a startup script (shell)
4. Test end-to-end

---

## Verified Architecture

### Current Data Flow (Already Implemented)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRANSACTION SUBMISSION (Frontend → Nodes)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Frontend                                                                    │
│      │                                                                       │
│      │ POST /submit with Submission::Transactions                            │
│      ▼                                                                       │
│  Simulator (simulator/src/api/http.rs:186-188)                              │
│      │                                                                       │
│      │ simulator.submit_transactions(txs)                                    │
│      ▼                                                                       │
│  Broadcast Channel (simulator/src/state.rs:63-66)                           │
│      │                                                                       │
│      │ mempool_tx.send(Pending { transactions })                            │
│      ▼                                                                       │
│  WebSocket /mempool (simulator/src/api/ws.rs:208-269)                       │
│      │                                                                       │
│      │ Binary encoded Pending messages                                       │
│      ▼                                                                       │
│  Node Client (client/src/client.rs:354-365)                                 │
│      │                                                                       │
│      │ connect_mempool() → Stream<Pending>                                   │
│      ▼                                                                       │
│  ReconnectingStream (node/src/indexer.rs:148-284)                           │
│      │                                                                       │
│      │ Auto-reconnect + signature verification                               │
│      ▼                                                                       │
│  Application Actor Mempool (node/src/application/actor.rs:891-930)          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ BLOCK FINALIZATION (Nodes → Simulator)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Consensus Network                                                           │
│      │                                                                       │
│      │ BFT consensus finalizes block                                         │
│      ▼                                                                       │
│  Aggregator Actor (node/src/aggregator/actor.rs:724-757)                    │
│      │                                                                       │
│      │ Creates Summary with certificate + proofs                             │
│      │ Calls indexer.submit_summary(summary) with infinite retry             │
│      ▼                                                                       │
│  Client (client/src/client.rs:237-239)                                      │
│      │                                                                       │
│      │ POST /submit with Submission::Summary                                 │
│      ▼                                                                       │
│  Simulator (simulator/src/api/http.rs:194-215)                              │
│      │                                                                       │
│      │ Verifies certificate and proofs                                       │
│      │ Calls submit_events() and submit_state()                              │
│      ▼                                                                       │
│  Explorer Indexing (simulator/src/state.rs:114-141)                         │
│      │                                                                       │
│      │ index_block_from_summary() extracts blocks/txs/events                 │
│      ▼                                                                       │
│  Broadcast to Frontend (update_tx channel)                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Code Evidence

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Mempool broadcast | `simulator/src/state.rs` | 63-66 | ✅ Implemented |
| Mempool WebSocket | `simulator/src/api/ws.rs` | 208-269 | ✅ Implemented |
| Client connect_mempool | `client/src/client.rs` | 354-365 | ✅ Implemented |
| Indexer trait impl | `node/src/indexer.rs` | 130-146 | ✅ Implemented |
| ReconnectingStream | `node/src/indexer.rs` | 148-284 | ✅ Implemented |
| Summary submission | `node/src/aggregator/actor.rs` | 735-757 | ✅ Implemented |
| Seed submission | `node/src/seeder/actor.rs` | 415-437 | ✅ Implemented |
| Summary verification | `simulator/src/api/http.rs` | 194-215 | ✅ Implemented |
| Explorer indexing | `simulator/src/explorer.rs` | 354-427 | ✅ Implemented |
| Game log capture | `simulator/src/explorer.rs` | 160-255 | ✅ Implemented |

---

## What Actually Needs to Be Done

### Phase 1: Key Generation Tool

**Why:** Each node needs Ed25519 keys (for P2P) and BLS12-381 threshold shares (for consensus signatures). No production tooling exists.

**Create:** `scripts/generate_keys.rs`

```rust
//! Key generation for local consensus network
//!
//! Usage: cargo run --bin generate-keys -- --nodes 3 --output configs/local

use commonware_codec::Encode;
use commonware_cryptography::{
    bls12381::{dkg::ops, primitives::{poly::public, variant::MinSig}},
    ed25519::PrivateKey,
    Signer,
};
use commonware_utils::{hex, quorum};
use rand::SeedableRng;
use rand_chacha::ChaCha20Rng;
use std::fs;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(3);
    let output_dir = args.get(2).unwrap_or(&"configs/local".to_string()).clone();

    let threshold = quorum(n);

    println!("Generating keys for {n}-node network (threshold: {threshold})");

    // Use deterministic RNG for reproducibility (change seed for production!)
    let mut rng = ChaCha20Rng::seed_from_u64(42);

    // Generate BLS threshold polynomial and shares
    let (polynomial, shares) = ops::generate_shares::<_, MinSig>(&mut rng, None, n, threshold);
    let identity = *public::<MinSig>(&polynomial);

    let polynomial_hex = hex(&polynomial.encode());
    let identity_hex = hex(&identity.encode());

    // Create output directory
    fs::create_dir_all(&output_dir).expect("Failed to create output directory");

    // Generate Ed25519 keys and create configs
    let mut peers = String::from("addresses:\n");

    for i in 0..n {
        let ed25519_key = PrivateKey::from_seed(i as u64);
        let ed25519_pub = ed25519_key.public_key();
        let share = &shares[i as usize];

        let config = format!(r#"# Node {i} Configuration
# Generated by generate-keys

private_key: "{}"
share: "{}"
polynomial: "{}"

port: {}
metrics_port: {}
directory: "./data/node{i}"

worker_threads: 4
log_level: "info"

indexer: "http://localhost:8080"

# P2P settings
allowed_peers: []
bootstrappers: []
message_backlog: 128
mailbox_size: 1024

# Execution settings
execution_concurrency: 4
mempool_max_backlog: 1000
mempool_max_transactions: 10000
"#,
            hex(&ed25519_key.encode()),
            hex(&share.encode()),
            polynomial_hex,
            9000 + i,
            9090 + i,
        );

        let config_path = format!("{}/node{}.yaml", output_dir, i);
        fs::write(&config_path, config).expect("Failed to write config");
        println!("Created: {}", config_path);

        // Add to peers file
        peers.push_str(&format!("  \"{}\": \"127.0.0.1:{}\"\n",
            hex(&ed25519_pub.encode()),
            9000 + i
        ));
    }

    // Write peers file
    let peers_path = format!("{}/peers.yaml", output_dir);
    fs::write(&peers_path, peers).expect("Failed to write peers file");
    println!("Created: {}", peers_path);

    // Write identity for frontend
    let env_content = format!("VITE_IDENTITY={}\nVITE_URL=http://localhost:8080\n", identity_hex);
    let env_path = format!("{}/.env.local", output_dir);
    fs::write(&env_path, &env_content).expect("Failed to write .env");
    println!("Created: {}", env_path);

    println!("\n=== Network Identity ===");
    println!("VITE_IDENTITY={}", identity_hex);
    println!("\nCopy this to website/.env.local");
}
```

**Add to Cargo.toml:**

```toml
[[bin]]
name = "generate-keys"
path = "scripts/generate_keys.rs"
```

**Success Criteria:**
- [ ] `cargo run --bin generate-keys` generates valid configs
- [ ] Generated shares combine to produce valid threshold signatures
- [ ] Output includes: node configs, peers.yaml, .env.local

---

### Phase 2: Startup Script

**Create:** `scripts/start-local-network.sh`

```bash
#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONFIG_DIR="${1:-configs/local}"
NODES="${2:-3}"

echo -e "${GREEN}Starting local consensus network${NC}"
echo "Config directory: $CONFIG_DIR"
echo "Number of nodes: $NODES"

# Check if configs exist
if [ ! -f "$CONFIG_DIR/node0.yaml" ]; then
    echo -e "${RED}Error: Config files not found in $CONFIG_DIR${NC}"
    echo "Run: cargo run --bin generate-keys -- $NODES $CONFIG_DIR"
    exit 1
fi

# Get identity from first node config
IDENTITY=$(grep "polynomial:" "$CONFIG_DIR/node0.yaml" | head -1 | awk '{print $2}' | tr -d '"')
if [ -z "$IDENTITY" ]; then
    echo -e "${RED}Error: Could not extract identity from config${NC}"
    exit 1
fi

# Array to store PIDs
declare -a PIDS=()

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait
    echo -e "${GREEN}All processes stopped${NC}"
}

trap cleanup EXIT INT TERM

# Start simulator/indexer
echo -e "${GREEN}Starting simulator (indexer mode)...${NC}"
cargo run --release -p nullspace-simulator -- \
    --host 0.0.0.0 \
    --port 8080 \
    --identity "$IDENTITY" &
PIDS+=($!)

# Wait for simulator to be ready
echo "Waiting for simulator..."
for i in {1..30}; do
    if curl -sf http://localhost:8080/healthz > /dev/null 2>&1; then
        echo -e "${GREEN}Simulator ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Simulator failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Start nodes
for i in $(seq 0 $((NODES - 1))); do
    echo -e "${GREEN}Starting node $i...${NC}"
    cargo run --release -p nullspace-node -- \
        --config "$CONFIG_DIR/node$i.yaml" \
        --peers "$CONFIG_DIR/peers.yaml" &
    PIDS+=($!)
    sleep 2  # Stagger startup
done

echo -e "\n${GREEN}=== Local Network Running ===${NC}"
echo "Simulator: http://localhost:8080"
echo "Nodes: ${NODES} nodes on ports 9000-$((9000 + NODES - 1))"
echo ""
echo "Frontend: Set VITE_URL=http://localhost:8080 and copy identity to .env.local"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"

# Wait for any process to exit
wait -n || true
echo -e "${RED}A process exited unexpectedly${NC}"
```

**Success Criteria:**
- [ ] `./scripts/start-local-network.sh` starts simulator + 3 nodes
- [ ] Simulator passes health check before nodes start
- [ ] Ctrl+C cleanly shuts down all processes
- [ ] Nodes connect to each other (check logs for "connected to peer")

---

### Phase 3: End-to-End Test

**Manual Test Procedure:**

1. **Generate keys:**
   ```bash
   cargo run --bin generate-keys -- 3 configs/local
   ```

2. **Copy identity to frontend:**
   ```bash
   cp configs/local/.env.local website/.env.local
   ```

3. **Start network:**
   ```bash
   ./scripts/start-local-network.sh configs/local 3
   ```

4. **Start frontend:**
   ```bash
   cd website && npm run dev
   ```

5. **Test transaction flow:**
   - Open http://localhost:5173
   - Register a casino player
   - Deposit chips
   - Play a game
   - Verify block appears in explorer

**Success Criteria:**
- [ ] Transaction submitted via frontend
- [ ] Transaction appears in node logs (mempool received)
- [ ] Block finalized (check aggregator logs)
- [ ] Block appears in explorer
- [ ] Game events show in frontend

---

## Configuration Reference

### Node Configuration (node.yaml)

```yaml
# Required - Cryptographic material
private_key: "hex_encoded_ed25519_private_key"
share: "hex_encoded_bls_share"
polynomial: "hex_encoded_bls_polynomial_commitment"

# Required - Network
port: 9000                              # P2P port
metrics_port: 9090                      # Prometheus metrics
indexer: "http://localhost:8080"        # Simulator URL

# Required - Storage
directory: "./data/node0"               # Data directory

# Optional - Tuning (defaults shown)
worker_threads: 4
log_level: "info"                       # trace, debug, info, warn, error
execution_concurrency: 4
mempool_max_backlog: 1000
mempool_max_transactions: 10000
message_backlog: 128
mailbox_size: 1024
```

### Peers Configuration (peers.yaml)

```yaml
addresses:
  "hex_encoded_ed25519_public_key_node0": "127.0.0.1:9000"
  "hex_encoded_ed25519_public_key_node1": "127.0.0.1:9001"
  "hex_encoded_ed25519_public_key_node2": "127.0.0.1:9002"
```

### Frontend Environment (.env.local)

```bash
VITE_IDENTITY=hex_encoded_bls_public_key_96_bytes
VITE_URL=http://localhost:8080
```

---

## Threshold Cryptography Notes

**For a 3-node network:**
- `n = 3` participants
- `f = max_faults(3) = (3-1)/3 = 0` (no Byzantine fault tolerance)
- `threshold = quorum(3) = 3` (all signatures required)

**For a 4-node network:**
- `n = 4` participants
- `f = max_faults(4) = (4-1)/3 = 1` (tolerates 1 Byzantine node)
- `threshold = quorum(4) = 3` (3-of-4 signatures required)

**Recommendation:** Use 4 nodes for meaningful fault tolerance in testing.

---

## What Does NOT Need to Change

Based on verified code investigation:

| Component | Change Needed | Evidence |
|-----------|--------------|----------|
| Simulator | NO | Already implements full Indexer API |
| Node | NO | Already uses Indexer trait correctly |
| Client SDK | NO | connect_mempool() and submit_* all work |
| Frontend | NO | Talks to simulator via same API |
| Block Explorer | NO | Indexes from Summary automatically |
| Game Logs | NO | CasinoGameCompleted events include logs |

---

## Troubleshooting

### Nodes can't connect to each other
- Check that all nodes are in peers.yaml
- Verify ports are not blocked
- Check log for "failed to connect" messages

### Transactions not appearing in blocks
- Verify simulator shows "mempool WebSocket connected" in logs
- Check node logs for "received transaction from indexer"
- Verify signature verification passes

### Blocks not finalizing
- All nodes must be running (threshold = n for 3 nodes)
- Check for consensus timeout messages
- Verify polynomial is identical across all nodes

### Explorer not showing blocks
- Check simulator logs for "Summary verification failed"
- Verify identity matches between nodes and simulator
- Check that submit_events is being called

---

## File Checklist

**To Create:**
- [ ] `scripts/generate_keys.rs` - Key generation binary
- [ ] `scripts/start-local-network.sh` - Startup script
- [ ] `configs/local/` - Generated configuration directory

**Already Exists (No Changes):**
- `simulator/src/` - Full indexer implementation
- `node/src/` - Full consensus node
- `client/src/` - SDK with all methods
- `website/src/` - Frontend (just needs .env.local)

---

## References

### Internal Code Paths

- Node configuration parsing: `node/src/lib.rs:69-142`
- Indexer trait definition: `node/src/indexer.rs:41-59`
- Client Indexer impl: `node/src/indexer.rs:130-146`
- Mempool subscription: `node/src/application/actor.rs:468-475`
- Summary submission: `node/src/aggregator/actor.rs:724-757`
- Seed submission: `node/src/seeder/actor.rs:410-437`
- Simulator submit handler: `simulator/src/api/http.rs:35-215`
- Explorer indexing: `simulator/src/explorer.rs:354-427`
- Mempool broadcast: `simulator/src/state.rs:63-66`
- Mempool WebSocket: `simulator/src/api/ws.rs:208-269`

### Research Documents

- `docs/node_indexer_interaction.md`
- `docs/key_generation_research.md`
- `docs/commonware_multi_node_setup.md`
