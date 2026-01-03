# E07 - RNG + fairness model (from scratch)

Focus file: `execution/src/casino/mod.rs`

Goal: explain how deterministic randomness is generated and why it is fair across nodes. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Determinism across validators
The same seed and inputs must produce the same random outcomes on every node. Otherwise consensus would break.

### 2) Hash-chain RNG
The RNG uses SHA256 hashing to produce a stream of bytes. This is reproducible and cryptographically strong enough for deterministic simulation.

### 3) Rejection sampling
When you need a random number in a smaller range, you must avoid bias. Rejection sampling ensures uniform distribution.

---

## Limits & management callouts (important)

1) **RNG is deterministic, not private**
- This RNG is for consensus determinism, not secrecy.
- If you need hidden randomness, use commit-reveal or VRF.

2) **Bias prevention only for bounded draws**
- `next_bounded` uses rejection sampling.
- If you bypass it, you can introduce bias.

---

## Walkthrough with code excerpts

### 1) Seeding the RNG
```rust
pub fn new(seed: &Seed, session_id: u64, move_number: u32) -> Self {
    let mut hasher = Sha256::new();
    hasher.update(seed.encode().as_ref());
    hasher.update(&session_id.to_be_bytes());
    hasher.update(&move_number.to_be_bytes());
    Self {
        state: hasher.finalize().0,
        index: 0,
    }
}
```

Why this matters:
- Every node must derive the exact same RNG state for the same move.

What this code does:
- Hashes the consensus seed, session ID, and move number.
- Uses that hash as the initial RNG state.

---

### 2) Generating unbiased bounded values
```rust
pub fn next_bounded(&mut self, max: u8) -> u8 {
    if max == 0 {
        return 0;
    }
    let limit = u8::MAX - (u8::MAX % max);
    loop {
        let value = self.next_u8();
        if value < limit {
            return value % max;
        }
    }
}
```

Why this matters:
- Uniform randomness is required for fair outcomes.

What this code does:
- Uses rejection sampling to avoid modulo bias.
- Returns a uniform value in `[0, max)`.

---

### 3) Shuffling a deck
```rust
pub fn shuffle<T>(&mut self, slice: &mut [T]) {
    if slice.len() <= u8::MAX as usize {
        for i in (1..slice.len()).rev() {
            let j = self.next_bounded((i + 1) as u8) as usize;
            slice.swap(i, j);
        }
        return;
    }
    for i in (1..slice.len()).rev() {
        let j = self.next_bounded_usize(i + 1);
        slice.swap(i, j);
    }
}
```

Why this matters:
- Card games depend on unbiased shuffles for fairness.

What this code does:
- Implements Fisher-Yates shuffle using the deterministic RNG.
- Supports both small and large decks without bias.

---

### 4) Determinism tests
```rust
#[test]
fn test_game_rng_deterministic() {
    let seed = create_test_seed();

    let mut rng1 = GameRng::new(&seed, 1, 0);
    let mut rng2 = GameRng::new(&seed, 1, 0);

    for _ in 0..100 {
        assert_eq!(rng1.next_u8(), rng2.next_u8());
    }
}
```

Why this matters:
- Tests ensure that determinism assumptions hold over time.

What this code does:
- Verifies that two RNGs with the same seed generate identical sequences.

---

## Key takeaways
- RNG is deterministic and seeded from consensus inputs.
- Rejection sampling prevents bias in bounded ranges.
- Shuffle and draw operations are deterministic and fair.

## Next lesson
E08 - Protocol packages + schemas: `feynman/lessons/E08-protocol-packages.md`
