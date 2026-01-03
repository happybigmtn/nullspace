# L19 - Submission -> mempool (register + deposit) (from scratch)

Focus file: `simulator/src/submission.rs`

Goal: explain how register/deposit submissions flow into the simulator’s transaction pipeline. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Transactions submission path
Register and deposit are both `Submission::Transactions`. The simulator does not care which instruction is inside — it routes all transactions the same way.

### 2) Mempool broadcast
When transactions are submitted, they are broadcast on the mempool channel so execution can process them.

---

## Walkthrough with code excerpts

### 1) Transactions submission branch
```rust
Submission::Transactions(txs) => {
    if log_admin {
        log_admin_transactions(&txs);
    }
    simulator.submit_transactions(txs);
    Ok(())
}
```

Why this matters:
- This is the exact path that register/deposit transactions take after decode.

What this code does:
- Optionally logs admin transactions for audit.
- Sends the transaction batch to the simulator’s mempool broadcaster.

---

## Key takeaways
- Register and deposit are handled as plain transactions.
- They enter the mempool via `submit_transactions` and are picked up by validators.

## Next lesson
L20 - Register mempool listener: `feynman/lessons/L20-register-mempool.md`
