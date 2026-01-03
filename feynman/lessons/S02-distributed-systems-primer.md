# S02 - Distributed systems primer (mempool, blocks, execution) (from scratch)

Focus: (concepts)

Goal: explain basic distributed systems concepts used by the node, simulator, and execution layers.

---

## Concepts from scratch (expanded)

### 1) Mempool
The mempool is a staging area for transactions waiting to be included in a block. It is not final state.

### 2) Blocks and consensus
Validators agree on a sequence of blocks. Consensus ensures all honest nodes reach the same history.

### 3) Deterministic execution
Every node runs the same transactions in the same order to produce the same outputs.

---

## Limits & management callouts (important)

1) **Mempool size must be bounded**
- If unbounded, attackers can fill memory and crash nodes.

2) **Consensus latency sets UX floor**
- Even if UI updates are fast, finality depends on consensus timing.

---

## Walkthrough with simple examples

### 1) Mempool lifecycle (simplified)
```rust
Client -> submit tx -> mempool -> block -> execute -> state update
```

Why this matters:
- This is the core path every transaction follows.

What this means:
- Mempool acceptance does not mean final confirmation.

---

### 2) Deterministic execution requirement
```rust
Same inputs + same seed + same order = same outputs on every node
```

Why this matters:
- If outputs diverge, nodes cannot reach consensus.

What this means:
- Randomness must be deterministic and derived from shared seeds.

---

## Key takeaways
- The mempool is a buffer, not final state.
- Consensus orders transactions and resolves conflicts.
- Deterministic execution is mandatory for blockchain correctness.

## Next primer
S03 - Cryptography primer: `feynman/lessons/S03-crypto-primer.md`
