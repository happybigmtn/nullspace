# L22 - Execution dispatch (register + deposit) (from scratch)

Focus file: `execution/src/layer/mod.rs`

Goal: explain how register/deposit transactions are validated and routed in the execution layer. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Prepare vs apply
- **Prepare** validates nonce and stages account updates.
- **Apply** runs the instruction handler to produce events.

### 2) Register/deposit are casino instructions
Both register and deposit are handled by the casino dispatch path.

---

## Walkthrough with code excerpts

### 1) Prepare step (nonce validation)
```rust
async fn prepare(&mut self, transaction: &Transaction) -> Result<(), PrepareError> {
    let mut account = load_account(self, &transaction.public)
        .await
        .map_err(PrepareError::State)?;
    validate_and_increment_nonce(&mut account, transaction.nonce)?;
    self.insert(
        Key::Account(transaction.public.clone()),
        Value::Account(account),
    );

    Ok(())
}
```

Why this matters:
- Register/deposit will be rejected if nonces are wrong.

What this code does:
- Loads the account from state.
- Validates and increments the nonce.
- Stages the updated account in the pending map.

---

### 2) Dispatch to casino handler
```rust
match instruction {
    Instruction::CasinoRegister { .. }
    | Instruction::CasinoDeposit { .. }
    | Instruction::CasinoStartGame { .. }
    | Instruction::CasinoGameMove { .. }
    // ... other casino instructions ...
    => {
        self.apply_casino(public, instruction).await
    }
    // ... staking/liquidity/bridge ...
}
```

Why this matters:
- This is how register/deposit reach their specific handler.

What this code does:
- Groups casino instructions together and delegates to `apply_casino`.

---

## Key takeaways
- Register/deposit are validated by `prepare` and routed via `apply_casino`.
- Nonce handling is the first gate for these transactions.

## Next lesson
L23 - Register handlers: `feynman/lessons/L23-register-handlers.md`
