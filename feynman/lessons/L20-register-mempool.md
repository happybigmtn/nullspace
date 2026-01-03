# L20 - Mempool broadcast (register + deposit) (from scratch)

Focus file: `simulator/src/state.rs`

Goal: explain how submitted register/deposit transactions are broadcast on the mempool channel. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Mempool is a broadcast stream
Once transactions are accepted, they are broadcast so validators can build blocks.

### 2) Register and deposit are just transactions
At this stage, there is no difference between register and deposit — they are all pending txs.

---

## Walkthrough with code excerpts

### 1) Broadcast pending transactions
```rust
pub fn submit_transactions(&self, transactions: Vec<Transaction>) {
    if let Err(e) = self.mempool_tx.send(Pending { transactions }) {
        tracing::warn!("Failed to broadcast transactions (no subscribers): {}", e);
    }
}
```

Why this matters:
- If this broadcast fails, validators never see new transactions.

What this code does:
- Wraps the transaction list in a `Pending` struct.
- Sends it on the mempool broadcast channel.

---

## Key takeaways
- The mempool broadcast is the bridge between submission and execution.
- Register/deposit use the same mempool path as any other transaction.

## Next lesson
E03 - Node entrypoint + network wiring: `feynman/lessons/E03-node-entrypoint.md`
