# S03 - Cryptography primer (ed25519, signatures, nonces) (from scratch)

Focus: (concepts)

Goal: explain the cryptography basics used throughout the system, including keys, signatures, and nonces.

---

## Concepts from scratch (expanded)

### 1) Public/private keys
A private key is secret and used to sign messages. A public key is shared and used to verify signatures.

### 2) Signatures
A signature proves that the holder of the private key approved a message. Anyone with the public key can verify it.

### 3) Nonces
A nonce is a transaction counter. It prevents replay attacks and enforces ordering.

---

## Limits & management callouts (important)

1) **Private keys must never be logged**
- Even a single leak compromises all funds controlled by that key.

2) **Nonce mismatches cause rejection**
- If the nonce is too low or too high, the transaction fails.

---

## Walkthrough with simple examples

### 1) Signing and verification
```rust
message = "pay 10"
signature = sign(private_key, message)
verify(public_key, message, signature) == true
```

Why this matters:
- This is the foundation of transaction authorization.

What this means:
- Only the private key holder can produce a valid signature.

---

### 2) Nonce sequence
```rust
nonce 7 -> accepted
nonce 7 again -> rejected (replay)
nonce 9 -> rejected (gap)
nonce 8 -> accepted
```

Why this matters:
- Nonces enforce ordering and prevent duplicates.

What this means:
- Clients must track their latest nonce correctly.

---

## Key takeaways
- ed25519 keys are used to sign and verify transactions.
- Signatures prove authorization.
- Nonces prevent replay and enforce ordering.

## Next primer
S04 - WASM pipeline: `feynman/lessons/S04-wasm-primer.md`
