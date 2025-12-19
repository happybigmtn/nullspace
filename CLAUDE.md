# Claude Development Guide

## Architecture Overview

nullspace is a casino platform with BLS threshold-signed randomness. The architecture:

- **simulator**: Indexer/explorer that receives signed blocks from consensus nodes
- **node**: Consensus validator using commonware-consensus (threshold_simplex)
- **execution**: Game logic (baccarat, blackjack, roulette, etc.)
- **website**: React frontend with wallet integration
- **client**: TypeScript SDK for transaction construction

## Local Development

### Quick Start

```bash
# 1. Generate keys (4-node network with 3-of-4 threshold)
cargo run --release --bin generate-keys -- --nodes 4 --output configs/local --seed 0

# 2. Start network (simulator + 4 nodes)
./scripts/start-local-network.sh configs/local 4

# 3. Start frontend
cp configs/local/.env.local website/.env.local
cd website && pnpm install && pnpm dev
```

### Key Endpoints

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Simulator/Indexer | http://localhost:8080 |
| Block Explorer | http://localhost:8080/explorer |
| Mempool WebSocket | ws://localhost:8080/mempool |
| Node Metrics | http://localhost:9090-9093/metrics |

### Test Transactions

```bash
cargo run --release --bin test-transactions -- --url http://localhost:8080 --count 5
```

## Key Technical Details

### Cryptography
- **Ed25519**: P2P authentication between nodes
- **BLS12-381**: Threshold signatures for consensus (MinSig variant)
- **Threshold**: t-of-n where t = (2n+3)/3 (e.g., 3-of-4 for 4 nodes)

### Consensus Flow
1. Frontend submits transaction to simulator's `/submit` endpoint
2. Simulator broadcasts to nodes via mempool WebSocket
3. Nodes reach consensus on block contents
4. Leader aggregates BLS partial signatures
5. Signed block sent to simulator for indexing
6. Frontend receives confirmation via WebSocket subscription

### Important Files
- `node/src/bin/generate_keys.rs` - Key generation tool
- `scripts/start-local-network.sh` - Network startup script
- `configs/local/` - Generated node configs and keys
- `simulator/src/lib.rs` - Indexer/explorer implementation
- `execution/src/` - Game execution logic
