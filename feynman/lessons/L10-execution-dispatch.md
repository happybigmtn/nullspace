# L10 - Execution layer dispatch (from scratch)

Focus file: `execution/src/layer/mod.rs`

Goal: explain how the execution layer validates transactions, routes instructions to the right handlers, and stages state updates. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) What is the execution layer?
This is the "application logic" of the chain. It takes signed transactions and:
- checks nonce correctness,
- runs the game/business logic,
- produces events,
- and stages state changes to commit later.

### 2) Two-phase execution: prepare + apply
Execution is split into:
- **prepare**: load account state and validate/increment nonce,
- **apply**: run the instruction handler and generate events.

This separation keeps validation consistent across all instruction types.

### 3) The Layer is a temporary state overlay
The `Layer` keeps a `pending` map of state changes. Reads first check `pending`, then fall back to the underlying state. When execution is done, `commit()` returns the staged changes to persist.

### 4) Determinism matters
Given the same inputs (seed + transactions), the execution must produce the same outputs. Determinism is critical for consensus and reproducibility.

### 5) Event outputs vs transaction outputs
Execution produces:
- `Output::Event` entries (what happened),
- and an `Output::Transaction` entry (the transaction itself).
These outputs are used later to build proofs and summaries.

### 6) Instruction dispatch
Instructions are grouped into domains (casino, staking, liquidity, bridge). This file dispatches to the correct handler module based on the instruction variant.

---

## Limits and management callouts (important)

1) **MINIMUM_LIQUIDITY = 1000**
- A permanent lock of LP tokens prevents the AMM from ever being fully drained.
- If you change this, you must update economic assumptions and tests.

2) **Nonce mismatch is skipped, not failed**
- In `execute`, a nonce mismatch causes the transaction to be skipped silently.
- This is a deliberate choice to keep blocks moving, but it can hide client bugs.

3) **No gas or complexity limits here**
- This layer assumes upstream limits (mempool, block size, rate limits) already exist.
- If those limits are loose, heavy instructions could become a DoS vector.

4) **Progressive state parsing depends on byte layout**
- The progressive helpers assume exact offsets into a state blob.
- Any schema changes must update these offsets or jackpot logic will break.

---

## Walkthrough with code excerpts

### 1) Minimum liquidity constant
```rust
// Keep a small amount of LP tokens permanently locked so the pool can never be fully drained.
// This mirrors the MINIMUM_LIQUIDITY pattern used by Raydium/Uniswap to avoid zero-price states.
const MINIMUM_LIQUIDITY: u64 = 1_000;
```

Why this matters:
- Prevents the AMM pool from reaching a zero-liquidity state, which would make prices undefined.

What this code does:
- Defines a fixed number of LP tokens that are effectively locked forever.
- Acts as a safety floor for the AMM math.

---

### 2) Helper to parse u64 from a byte slice
```rust
fn parse_u64_be_at(bytes: &[u8], offset: usize) -> Option<u64> {
    let slice = bytes.get(offset..offset + 8)?;
    let buf: [u8; 8] = slice.try_into().ok()?;
    Some(u64::from_be_bytes(buf))
}
```

Why this matters:
- Progressive jackpot logic needs to read numeric fields out of raw state blobs.

What this code does:
- Takes a byte slice and offset, safely slices 8 bytes, and converts them to a big-endian u64.
- Returns `None` if the slice is too short or conversion fails.

Syntax notes:
- The `?` operator early-returns `None` if any step fails.

---

### 3) Parse progressive state for Three Card
```rust
fn parse_three_card_progressive_state(state_blob: &[u8]) -> Option<(u64, [u8; 3])> {
    // v3:
    // [version:u8=3] [stage:u8] [player:3] [dealer:3] [pairplus:u64] [six_card:u64] [progressive:u64]
    if state_blob.len() < 5 {
        return None;
    }

    let version = state_blob[0];
    let player = [state_blob[2], state_blob[3], state_blob[4]];
    let progressive_bet = if version >= 3 {
        parse_u64_be_at(state_blob, 24)?
    } else {
        0
    };

    Some((progressive_bet, player))
}
```

Why this matters:
- The progressive jackpot payout depends on the player cards and bet size. If parsing is wrong, payouts are wrong.

What this code does:
- Interprets a raw state blob with a versioned layout.
- Extracts the player cards and (for v3+) the progressive bet amount.
- Returns `None` if the blob is too short.

---

### 4) Parse UTH progressive state + jackpot tier
```rust
fn parse_uth_progressive_state(state_blob: &[u8]) -> Option<(u64, [u8; 2], [u8; 3])> {
    // v3:
    // [version:u8=3] [stage:u8] [hole:2] [community:5] [dealer:2] [play_mult:u8] [bonus:4]
    // [trips:u64] [six_card:u64] [progressive:u64]
    if state_blob.len() < 7 {
        return None;
    }

    let version = state_blob[0];
    let hole = [state_blob[2], state_blob[3]];
    let flop = [state_blob[4], state_blob[5], state_blob[6]];
    let progressive_bet = if version >= 3 {
        parse_u64_be_at(state_blob, 32)?
    } else {
        0
    };

    Some((progressive_bet, hole, flop))
}
```

Why this matters:
- UTH progressive jackpots depend on hole cards + flop. The engine needs these to compute the correct payout tier.

What this code does:
- Reads a versioned state blob and extracts hole cards, flop cards, and progressive bet.
- Returns `None` if the blob is too short.

---

### 5) Jackpot tier logic (Royal vs Straight Flush)
```rust
fn uth_progressive_jackpot_tier(hole: &[u8; 2], flop: &[u8; 3]) -> UthJackpotTier {
    let cards = [hole[0], hole[1], flop[0], flop[1], flop[2]];
    if !cards.iter().all(|&c| card_utils::is_valid_card(c)) {
        return UthJackpotTier::None;
    }
    // ... suit + rank checks ...
    if is_flush && is_royal {
        UthJackpotTier::RoyalFlush
    } else if is_flush && is_straight {
        UthJackpotTier::StraightFlush
    } else {
        UthJackpotTier::None
    }
}
```

Why this matters:
- The jackpot payout amount depends on the tier. Misclassification means incorrect payouts.

What this code does:
- Combines hole + flop cards into a 5-card hand.
- Validates card encoding, checks for flush/straight/royal, and returns the tier.

---

### 6) Layer struct and constructor
```rust
pub struct Layer<'a, S: State> {
    state: &'a S,
    pending: BTreeMap<Key, Status>,

    seed: Seed,
    seed_view: u64,
}

pub fn new(
    state: &'a S,
    _master: <MinSig as Variant>::Public,
    _namespace: &[u8],
    seed: Seed,
) -> Self {
    let seed_view = seed.view().get();
    Self {
        state,
        pending: BTreeMap::new(),
        seed,
        seed_view,
    }
}
```

Why this matters:
- The Layer is the core execution context. It holds the current seed and stages all changes.

What this code does:
- Stores the base state reference, an empty pending map, and the seed for this block.
- Extracts `seed_view` so it can be used without repeated decoding.

Syntax notes:
- Lifetime `'a` ties the layer to the underlying state reference.

---

### 7) Prepare step (nonce validation)
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
- Nonce validation prevents replay and ensures transaction ordering.

What this code does:
- Loads the account state through the Layer (so pending updates are considered).
- Validates and increments the nonce.
- Writes the updated account into the pending map.

---

### 8) Domain-specific dispatch (casino example)
```rust
async fn apply_casino(
    &mut self,
    public: &PublicKey,
    instruction: &Instruction,
) -> Result<Vec<Event>> {
    match instruction {
        Instruction::CasinoRegister { name } => self.handle_casino_register(public, name).await,
        Instruction::CasinoDeposit { amount } => {
            self.handle_casino_deposit(public, *amount).await
        }
        Instruction::CasinoStartGame { game_type, bet, session_id } => {
            self.handle_casino_start_game(public, *game_type, *bet, *session_id).await
        }
        // ... many more casino instructions ...
        _ => anyhow::bail!("internal error: apply_casino called with non-casino instruction"),
    }
}
```

Why this matters:
- This is how the system routes each casino instruction to its correct handler.

What this code does:
- Matches on the specific casino instruction variant.
- Calls the matching handler method and returns the events it produces.
- Errors if a non-casino instruction somehow reaches this function.

---

### 9) Top-level apply dispatcher
```rust
async fn apply(&mut self, transaction: &Transaction) -> Result<Vec<Event>> {
    let instruction = &transaction.instruction;
    let public = &transaction.public;

    match instruction {
        Instruction::CasinoRegister { .. }
        | Instruction::CasinoDeposit { .. }
        | Instruction::CasinoStartGame { .. }
        | Instruction::CasinoGameMove { .. }
        | Instruction::CasinoPlayerAction { .. }
        | Instruction::CasinoJoinTournament { .. }
        | Instruction::CasinoSetTournamentLimit { .. }
        | Instruction::CasinoStartTournament { .. }
        | Instruction::CasinoEndTournament { .. }
        | Instruction::GlobalTableInit { .. }
        | Instruction::GlobalTableOpenRound { .. }
        | Instruction::GlobalTableSubmitBets { .. }
        | Instruction::GlobalTableLock { .. }
        | Instruction::GlobalTableReveal { .. }
        | Instruction::GlobalTableSettle { .. }
        | Instruction::GlobalTableFinalize { .. } => {
            self.apply_casino(public, instruction).await
        }
        Instruction::Stake { .. }
        | Instruction::Unstake
        | Instruction::ClaimRewards
        | Instruction::ProcessEpoch => self.apply_staking(public, instruction).await,
        Instruction::CreateVault
        | Instruction::DepositCollateral { .. }
        | Instruction::BorrowUSDT { .. }
        | Instruction::RepayUSDT { .. }
        | Instruction::Swap { .. }
        | Instruction::AddLiquidity { .. }
        | Instruction::RemoveLiquidity { .. }
        | Instruction::LiquidateVault { .. }
        | Instruction::SetPolicy { .. }
        | Instruction::SetTreasury { .. }
        | Instruction::FundRecoveryPool { .. }
        | Instruction::RetireVaultDebt { .. }
        | Instruction::RetireWorstVaultDebt { .. }
        | Instruction::DepositSavings { .. }
        | Instruction::WithdrawSavings { .. }
        | Instruction::ClaimSavingsRewards
        | Instruction::SeedAmm { .. }
        | Instruction::FinalizeAmmBootstrap
        | Instruction::SetTreasuryVesting { .. }
        | Instruction::ReleaseTreasuryAllocation { .. }
        | Instruction::UpdateOracle { .. } => {
            self.apply_liquidity(public, instruction).await
        }
        Instruction::BridgeWithdraw { .. }
        | Instruction::BridgeDeposit { .. }
        | Instruction::FinalizeBridgeWithdrawal { .. } => {
            self.apply_bridge(public, instruction).await
        }
    }
}
```

Why this matters:
- This is the main routing table for all instruction types. If it is wrong, entire subsystems break.

What this code does:
- Groups instruction variants by domain.
- Delegates to the matching apply_* function for that domain.
- Ensures every instruction variant is handled.

---

### 10) "Get or init" helpers
```rust
async fn get_or_init_house(&mut self) -> Result<nullspace_types::casino::HouseState> {
    Ok(match self.get(Key::House).await? {
        Some(Value::House(h)) => h,
        _ => nullspace_types::casino::HouseState::new(self.seed_view),
    })
}
```

Why this matters:
- Many handlers require a core state object. This guarantees it exists before use.

What this code does:
- Reads a typed value from state.
- If missing, constructs a default state object using the current seed view.

---

### 11) Execute a batch of transactions
```rust
pub async fn execute(
    &mut self,
    #[cfg(feature = "parallel")] _pool: ThreadPool,
    transactions: Vec<Transaction>,
) -> Result<(Vec<Output>, BTreeMap<PublicKey, u64>)> {
    let mut processed_nonces = BTreeMap::new();
    let mut outputs = Vec::new();

    for tx in transactions {
        match self.prepare(&tx).await {
            Ok(()) => {}
            Err(PrepareError::NonceMismatch { .. }) => continue,
            Err(PrepareError::State(err)) => {
                return Err(err).context("state error during prepare");
            }
        }
        processed_nonces.insert(tx.public.clone(), tx.nonce.saturating_add(1));
        outputs.extend(self.apply(&tx).await?.into_iter().map(Output::Event));
        outputs.push(Output::Transaction(tx));
    }

    Ok((outputs, processed_nonces))
}
```

Why this matters:
- This is the core execution loop for a block.

What this code does:
- Iterates transactions one by one.
- Runs `prepare` to validate nonce and stage account updates.
- Skips transactions with nonce mismatch (does not abort the block).
- Applies the instruction, collects events, and appends the transaction output.
- Returns both outputs and the next nonce per account.

Syntax notes:
- `saturating_add` prevents overflow if a nonce is near `u64::MAX`.

---

### 12) Commit staged changes
```rust
pub fn commit(self) -> Vec<(Key, Status)> {
    self.pending.into_iter().collect()
}
```

Why this matters:
- Execution is not persisted until commit. This function exposes the staged changes to the caller.

What this code does:
- Converts the pending map into a vector of key/status pairs for persistence.

---

### 13) State overlay behavior
```rust
impl<'a, S: State> State for Layer<'a, S> {
    async fn get(&self, key: Key) -> Result<Option<Value>> {
        Ok(match self.pending.get(&key) {
            Some(Status::Update(value)) => Some(value.clone()),
            Some(Status::Delete) => None,
            None => self.state.get(key).await?,
        })
    }
    // insert/delete write to pending...
}
```

Why this matters:
- This ensures reads see the most recent staged changes, not stale base state.

What this code does:
- Reads pending updates first.
- Falls back to the underlying state only if the key is not staged.

---

### 14) Determinism test (excerpt)
```rust
#[test]
fn test_layer_execute_is_deterministic_for_identical_inputs() {
    // ... build two states, same seed, same txs ...
    let (outputs1, nonces1) = layer1.execute(txs.clone()).await.unwrap();
    let (outputs2, nonces2) = layer2.execute(txs).await.unwrap();

    assert_eq!(outputs1, outputs2);
    assert_eq!(nonces1, nonces2);
    assert!(layer1.commit() == layer2.commit());
}
```

Why this matters:
- If two identical inputs produce different outputs, consensus breaks.

What this code does:
- Executes the same transactions against two separate states.
- Asserts that outputs, nonces, and committed changes are identical.

---

## Key takeaways
- The Layer is a staging overlay that validates nonces, applies instructions, and collects events.
- Instruction dispatch is centralized and grouped by domain.
- Execution is deterministic and tested for it.

## Next lesson
L11 - Casino handlers: `feynman/lessons/L11-casino-handlers.md`
