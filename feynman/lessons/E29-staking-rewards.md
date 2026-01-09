# E29 - Staking rewards with 18-decimal precision accounting (from scratch)

Focus file: `execution/src/layer/handlers/staking.rs` (957 LOC)

Goal: explain how staking rewards are distributed using voting power, 18-decimal precision scaling, and epoch-based surplus allocation. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Learning objectives (what you should be able to explain after this lesson)

1) Why staking uses voting power instead of simple balance-based rewards.
2) How 18-decimal precision scaling enables O(1) reward claims without iterating stakers.
3) What reward debt accounting is and why it prevents double-claiming.
4) How stake lockup periods work and why they affect voting power.
5) How epoch processing distributes house surplus to stakers.
6) The mathematical formulas behind reward calculations.

---

## Concepts from scratch (expanded)

### 1) Voting power as a time-weighted commitment metric

Traditional staking often rewards simply based on staked amount: if you stake 100 tokens, you earn proportional to 100. This system uses **voting power** instead, which incorporates duration:

```
voting_power = amount × duration
```

If you stake 100 chips for 10 blocks, your voting power is 1,000. If someone stakes 50 chips for 20 blocks, they also get 1,000 voting power. This design rewards longer commitments, creating a time-weighted incentive structure.

**Why this matters**: longer lockups demonstrate stronger conviction and reduce circulating supply for longer periods. The protocol rewards this with proportionally higher rewards.

### 2) The lockup model (demo mode using blocks)

Staking has a lockup period defined by:
- `unlock_ts`: the block view when funds become unlockable
- When you stake with duration `d` at block `b`, your `unlock_ts = b + d`
- **Critical rule**: new stakes can extend lockup but never shorten it

Currently the system is in dev/demo mode where:
- Duration is measured in consensus views/blocks (not wall-clock seconds)
- Minimum duration is just 1 block for testing convenience
- In production this would use actual timestamps with realistic minimum durations

**Why this matters**: lockup creates opportunity cost. Players cannot use staked chips for gaming. The voting power formula compensates for this sacrifice.

### 3) The reward accumulator pattern (18-decimal precision)

The core innovation is a global accumulator that tracks rewards per unit of voting power:

```
staking_reward_per_voting_power_x18
```

This single value, stored in `HouseState`, represents the cumulative rewards distributed per voting power across all epochs. It's scaled by `STAKING_REWARD_SCALE = 10^18` to preserve precision when dividing rewards across potentially large voting power totals.

**Why 18 decimals**: when distributing rewards across total voting power, integer division causes truncation. By scaling up by 10^18, we preserve 18 decimal places of precision before the final division back to chip amounts.

### 4) Reward debt accounting (preventing double claims)

Each staker tracks a `reward_debt_x18` field. This represents the portion of the global accumulator they've already been credited for. The formula:

```
pending_rewards = (voting_power × reward_per_voting_power_x18) - reward_debt_x18
```

When a staker's voting power changes (stake/unstake), their debt is synchronized to the current accumulator value. This ensures they only claim rewards accrued since their last state change.

**Why this matters**: without reward debt, stakers could claim the same rewards multiple times or claim rewards that should have gone to others.

### 5) Epoch-based surplus distribution

The system runs in epochs (currently 100 blocks in dev mode). At the end of each epoch:
- If `house.net_pnl > 0`, the house has a surplus (house edge exceeded payouts)
- This surplus becomes the reward pool for that epoch
- It's distributed proportionally to all current voting power
- The global accumulator is incremented

This creates a profit-sharing model where stakers benefit from house profitability.

### 6) Unclaimed rewards accumulation

Between settlements, pending rewards accumulate in `staker.unclaimed_rewards`. This value represents chips the staker has earned but not yet withdrawn. When claiming:
- All pending rewards are settled
- Unclaimed rewards are transferred to player chips
- The reward pool decreases by the claimed amount
- Reward debt is synced to prevent re-claiming

---

## Limits & management callouts (important)

1) **Dev/demo timing model**
- Duration and unlock_ts are in consensus views/blocks (not wall-clock time)
- Assumes `1 view ≈ 3 seconds` in epoch processing comments
- Minimum duration is 1 block for easy testing
- Production would use timestamps with meaningful minimum durations (e.g., 7 days)

2) **Epoch length is hardcoded**
- `DEV_EPOCH_LENGTH_BLOCKS = 100` in process_epoch handler
- This determines how frequently rewards are distributed
- Shorter epochs = more frequent distributions but more overhead
- Longer epochs = less overhead but delayed reward visibility

3) **Voting power uses u128 to avoid overflow**
- `voting_power = (amount as u128) × (duration as u128)`
- If you used u64, large amounts × long durations would overflow
- u128 provides room for essentially unlimited voting power accumulation

4) **Reward accumulator can never decrease**
- `staking_reward_per_voting_power_x18` only increases
- This is essential: if it decreased, reward debt accounting would break
- Rewards are additive across epochs

5) **Reward carry handles truncation**
- When distributing rewards, integer division may leave remainder
- `staking_reward_carry` preserves this remainder for the next epoch
- This ensures no rewards are lost to rounding

6) **No rewards when total_voting_power = 0**
- If nobody is staking, epoch processing skips reward distribution
- Surplus is neither distributed nor lost; net_pnl just resets
- This prevents division by zero and undefined behavior

7) **Overflow protection everywhere**
- All arithmetic uses checked operations (checked_mul, checked_add, etc.)
- Failures return error events rather than panicking
- This is critical for consensus safety: all validators must agree on overflow handling

---

## Walkthrough with code excerpts

### 1) The reward scale constant

```rust
const STAKING_REWARD_SCALE: u128 = nullspace_types::casino::STAKING_REWARD_SCALE;
```
(line 4)

Why this matters:
- This constant (10^18 or 1,000,000,000,000,000,000) is used throughout reward calculations.

What this code does:
- Imports the scale from the types crate where it's defined as `pub const STAKING_REWARD_SCALE: u128 = 1_000_000_000_000_000_000;`
- This scale factor enables precise reward distribution without floating point arithmetic.

---

### 2) Settling staker rewards (core accounting function)

```rust
fn settle_staker_rewards(
    staker: &mut nullspace_types::casino::Staker,
    reward_per_voting_power_x18: u128,
) -> Result<(), &'static str> {
    if staker.voting_power == 0 {
        staker.reward_debt_x18 = 0;
        return Ok(());
    }

    let current_debt = staker
        .voting_power
        .checked_mul(reward_per_voting_power_x18)
        .ok_or("reward debt overflow")?;
    let pending_x18 = current_debt
        .checked_sub(staker.reward_debt_x18)
        .ok_or("reward debt underflow")?;
    let pending = pending_x18 / STAKING_REWARD_SCALE;
    let pending: u64 = pending.try_into().map_err(|_| "pending reward overflow")?;

    staker.unclaimed_rewards = staker
        .unclaimed_rewards
        .checked_add(pending)
        .ok_or("unclaimed reward overflow")?;
    staker.reward_debt_x18 = current_debt;
    Ok(())
}
```
(lines 6-31)

Why this matters:
- This is the heart of the reward accounting system. It calculates pending rewards without iterating over all stakers.

What this code does:
- If voting power is zero, clears debt and returns (no rewards to settle).
- Calculates `current_debt = voting_power × reward_per_voting_power_x18` (what the staker should have been credited up to now).
- Computes `pending_x18 = current_debt - reward_debt_x18` (new rewards since last settlement).
- Scales down by dividing by `STAKING_REWARD_SCALE` to convert from 18-decimal precision back to chip amounts.
- Adds pending rewards to unclaimed balance.
- Updates reward debt to current level, preventing double-claiming.

The mathematical formula:
```
current_debt_x18 = voting_power × accumulator_x18
pending_x18 = current_debt_x18 - old_debt_x18
pending_chips = pending_x18 / 10^18
```

---

### 3) Syncing reward debt (used after voting power changes)

```rust
fn sync_staker_reward_debt(
    staker: &mut nullspace_types::casino::Staker,
    reward_per_voting_power_x18: u128,
) -> Result<(), &'static str> {
    staker.reward_debt_x18 = staker
        .voting_power
        .checked_mul(reward_per_voting_power_x18)
        .ok_or("reward debt overflow")?;
    Ok(())
}
```
(lines 33-42)

Why this matters:
- After staking or unstaking changes voting power, debt must be synchronized to the current accumulator level.

What this code does:
- Calculates new debt = current voting power × current accumulator.
- This "fast-forwards" the debt to account for the new voting power level.
- Without this, adding voting power would claim historical rewards it shouldn't receive.

**Example scenario**:
- Alice has 1000 VP with debt of 500_x18, accumulator is 600_x18
- She stakes more, increasing VP to 2000
- If we didn't sync debt, her pending would be (2000 × 600) - 500 = 1,199,500_x18
- By syncing debt to 2000 × 600 = 1,200,000_x18, her pending resets to 0
- Future rewards accumulate correctly from this point forward

---

### 4) Staking chips (entry point)

```rust
pub(in crate::layer) async fn handle_stake(
    &mut self,
    public: &PublicKey,
    amount: u64,
    duration: u64,
) -> anyhow::Result<Vec<Event>> {
    let mut player = match self.get(Key::CasinoPlayer(public.clone())).await? {
        Some(Value::CasinoPlayer(p)) => p,
        _ => return Ok(vec![]), // Error handled by checking balance
    };

    if player.balances.chips < amount {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
            "Insufficient chips to stake",
        ));
    }

    // NOTE: Staking is currently in dev/demo mode: `duration` and `unlock_ts` are expressed in
    // consensus views/blocks (not wall-clock time), and the minimum duration is intentionally
    // small to make local testing easier.
    const DEV_MIN_DURATION_BLOCKS: u64 = 1;
    if duration < DEV_MIN_DURATION_BLOCKS {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_BET, // Reuse code
            "Duration too short",
        ));
    }

    // Deduct chips
    player.balances.chips -= amount;
    let player_balances =
        nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
    self.insert(
        Key::CasinoPlayer(public.clone()),
        Value::CasinoPlayer(player),
    );
```
(lines 47-87)

Why this matters:
- Staking converts liquid chips into locked staking position, creating voting power.

What this code does:
- Loads player state and validates sufficient chip balance.
- Enforces minimum duration (currently 1 block for dev/testing).
- Deducts chips from player's liquid balance.
- The chips move from `player.balances.chips` to the staker record's `balance`.

Note the inline comment about dev/demo mode. In production, you'd expect durations measured in days/weeks and minimum durations enforcing meaningful lockup periods.

---

### 5) Creating or updating the staker record

```rust
    // Create/Update Staker
    let mut staker = match self.get(Key::Staker(public.clone())).await? {
        Some(Value::Staker(s)) => s,
        _ => nullspace_types::casino::Staker::default(),
    };

    let mut house = self.get_or_init_house().await?;
    if let Err(err) =
        settle_staker_rewards(&mut staker, house.staking_reward_per_voting_power_x18)
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            err,
        ));
    }
```
(lines 89-105)

Why this matters:
- Before modifying voting power, we must settle any pending rewards.

What this code does:
- Loads existing staker record or creates default (zero balance, zero VP).
- Calls `settle_staker_rewards` to credit any pending rewards to unclaimed balance.
- This ensures the staker gets credit for rewards earned up to this point before their voting power changes.

---

### 6) Voting power accumulation and lockup extension

```rust
    // Voting power is accumulated per stake: sum(amount_i * duration_i).
    // Lockup is the max of all stake unlocks (new stake can extend, never shorten).
    let current_block = self.seed_view;
    let new_unlock = current_block + duration;

    staker.balance = staker.balance.saturating_add(amount);
    staker.unlock_ts = staker.unlock_ts.max(new_unlock);
    let added_voting_power = (amount as u128) * (duration as u128);
    staker.voting_power = staker.voting_power.saturating_add(added_voting_power);
```
(lines 107-115)

Why this matters:
- This implements the core voting power formula and lockup extension rule.

What this code does:
- Calculates new unlock time as current block + duration.
- Adds amount to staker balance (total staked chips).
- **Critical**: uses `max()` for unlock_ts, meaning lockup can only extend, never shorten.
- Computes added voting power = amount × duration (cast to u128 to prevent overflow).
- Adds to cumulative voting power (stakers can stake multiple times, VP accumulates).

**Example accumulation**:
- First stake: 100 chips for 10 blocks → VP = 1,000
- Second stake: 50 chips for 20 blocks → VP = 1,000 + 1,000 = 2,000
- Balance = 150, voting power = 2,000

**Lockup extension example**:
- First stake at block 5 for duration 10 → unlock_ts = 15
- Second stake at block 7 for duration 20 → unlock_ts = max(15, 27) = 27
- The lockup extends because the second stake has a later unlock time

---

### 7) Syncing debt after voting power change

```rust
    if let Err(err) =
        sync_staker_reward_debt(&mut staker, house.staking_reward_per_voting_power_x18)
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            err,
        ));
    }

    self.insert(Key::Staker(public.clone()), Value::Staker(staker.clone()));

    // Update House Total VP
    house.total_staked_amount = house.total_staked_amount.saturating_add(amount);
    house.total_voting_power = house.total_voting_power.saturating_add(added_voting_power);
    let house_snapshot = house.clone();
    self.insert(Key::House, Value::House(house));
```
(lines 117-134)

Why this matters:
- After voting power increases, debt must sync to prevent claiming past rewards with new voting power.

What this code does:
- Calls `sync_staker_reward_debt` to update debt = new_VP × current_accumulator.
- Saves updated staker record.
- Updates house totals: adds staked amount and voting power to global counters.
- These global counters are used in epoch processing to calculate reward distribution.

---

### 8) Unstaking (lockup validation and VP clearing)

```rust
pub(in crate::layer) async fn handle_unstake(
    &mut self,
    public: &PublicKey,
) -> anyhow::Result<Vec<Event>> {
    let mut staker = match self.get(Key::Staker(public.clone())).await? {
        Some(Value::Staker(s)) => s,
        _ => return Ok(vec![]),
    };

    if self.seed_view < staker.unlock_ts {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Stake still locked",
        ));
    }

    if staker.balance == 0 {
        // Allow claiming rewards even after full unstake; `Unstake` itself is a no-op.
        return Ok(vec![]);
    }

    let unstake_amount = staker.balance;

    let mut house = self.get_or_init_house().await?;
    if let Err(err) =
        settle_staker_rewards(&mut staker, house.staking_reward_per_voting_power_x18)
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            err,
        ));
    }
```
(lines 149-184)

Why this matters:
- Unstaking enforces the lockup period and settles final rewards before returning funds.

What this code does:
- Validates current block >= unlock_ts (enforces lockup commitment).
- Returns early if balance is already zero (idempotent).
- Saves the balance to return to player.
- Settles any pending rewards before unstaking.

The lockup check is critical: if you could unstake early, the voting power formula would be meaningless. Players must commit to the duration they chose.

---

### 9) Returning staked chips and clearing voting power

```rust
    // Return chips
    let mut player_balances = None;
    if let Some(Value::CasinoPlayer(mut player)) =
        self.get(Key::CasinoPlayer(public.clone())).await?
    {
        player.balances.chips += staker.balance;
        player_balances =
            Some(nullspace_types::casino::PlayerBalanceSnapshot::from_player(
                &player,
            ));
        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
    }

    // Update House
    house.total_staked_amount = house.total_staked_amount.saturating_sub(staker.balance);
    house.total_voting_power = house.total_voting_power.saturating_sub(staker.voting_power);
    let house_snapshot = house.clone();
    self.insert(Key::House, Value::House(house));

    // Clear Staker
    staker.balance = 0;
    staker.voting_power = 0;
    staker.reward_debt_x18 = 0;
    let staker_snapshot = staker.clone();
    self.insert(Key::Staker(public.clone()), Value::Staker(staker));
```
(lines 186-213)

Why this matters:
- This completes the unstaking flow by moving chips back to liquid balance and clearing voting power.

What this code does:
- Returns staked balance to player's chip balance.
- Decreases house global counters (total staked amount and voting power).
- **Critical clearing**: sets balance, voting_power, and reward_debt to zero.
- The staker record remains but is zeroed out (allows future restaking).

Note that unclaimed_rewards is NOT cleared. The staker can still claim pending rewards even after unstaking. This is by design: rewards earned should always be claimable.

---

### 10) Claiming rewards (settlement and withdrawal)

```rust
pub(in crate::layer) async fn handle_claim_rewards(
    &mut self,
    public: &PublicKey,
) -> anyhow::Result<Vec<Event>> {
    let mut staker = match self.get(Key::Staker(public.clone())).await? {
        Some(Value::Staker(s)) => s,
        _ => return Ok(vec![]),
    };

    let mut house = self.get_or_init_house().await?;
    let reward_per_voting_power_x18 = house.staking_reward_per_voting_power_x18;

    let pending = if staker.voting_power == 0 {
        0
    } else {
        let current_debt = staker
            .voting_power
            .checked_mul(reward_per_voting_power_x18)
            .ok_or_else(|| anyhow::anyhow!("reward debt overflow"))?;
        let pending_x18 = current_debt
            .checked_sub(staker.reward_debt_x18)
            .ok_or_else(|| anyhow::anyhow!("reward debt underflow"))?;
        let pending = pending_x18 / STAKING_REWARD_SCALE;
        u64::try_from(pending).map_err(|_| anyhow::anyhow!("pending reward overflow"))?
    };
    let amount = staker
        .unclaimed_rewards
        .checked_add(pending)
        .ok_or_else(|| anyhow::anyhow!("reward overflow"))?;
    if amount == 0 {
        return Ok(vec![]);
    }
```
(lines 224-254)

Why this matters:
- This is where stakers actually withdraw their earned rewards as spendable chips.

What this code does:
- Loads staker record.
- Computes pending rewards using the same formula as `settle_staker_rewards` but inline.
- Adds unclaimed balance to pending for total claimable amount.
- Returns early if nothing to claim (avoids empty events).

The inline calculation is redundant with `settle_staker_rewards` but allows checking the amount before modifying state. This is a common pattern: compute first, validate, then commit.

---

### 11) Transferring rewards from pool to player

```rust
    let mut player = match self.get(Key::CasinoPlayer(public.clone())).await? {
        Some(Value::CasinoPlayer(p)) => p,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
                "Player not found",
            ))
        }
    };

    if house.staking_reward_pool < amount {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Insufficient reward pool",
        ));
    }
    house.staking_reward_pool = house.staking_reward_pool.saturating_sub(amount);

    player.balances.chips = player
        .balances
        .chips
        .checked_add(amount)
        .ok_or_else(|| anyhow::anyhow!("chip overflow"))?;

    staker.unclaimed_rewards = 0;
    staker.last_claim_epoch = house.current_epoch;
    if let Err(err) = sync_staker_reward_debt(&mut staker, reward_per_voting_power_x18) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            err,
        ));
    }
```
(lines 257-294)

Why this matters:
- Rewards must come from the reward pool, which is funded by epoch processing.

What this code does:
- Validates player exists.
- **Critical check**: ensures reward pool has enough funds (prevents over-claiming).
- Deducts claimed amount from house reward pool.
- Adds claimed amount to player's chip balance.
- Clears unclaimed rewards (they've now been paid out).
- Records the epoch of last claim.
- Syncs reward debt to prevent re-claiming.

This is a conservation-of-value operation: chips move from `house.staking_reward_pool` to `player.balances.chips`. The total supply doesn't change, just ownership.

---

### 12) Epoch processing (reward distribution trigger)

```rust
pub(in crate::layer) async fn handle_process_epoch(
    &mut self,
    _public: &PublicKey,
) -> anyhow::Result<Vec<Event>> {
    let mut house = self.get_or_init_house().await?;

    // NOTE: Dev/demo epoch length in consensus views/blocks (short to keep tests fast).
    const DEV_EPOCH_LENGTH_BLOCKS: u64 = 100;

    if self.seed_view >= house.epoch_start_ts + DEV_EPOCH_LENGTH_BLOCKS {
        // End Epoch

        // If Net PnL > 0, Surplus!
        let epoch_surplus: u64 = if house.net_pnl > 0 && house.total_voting_power > 0 {
            u64::try_from(house.net_pnl).unwrap_or(u64::MAX)
        } else {
            0
        };
```
(lines 316-333)

Why this matters:
- Epochs are the heartbeat of reward distribution. This is where house profits become staker rewards.

What this code does:
- Checks if enough blocks have elapsed (100 blocks in dev mode).
- If net PnL is positive and there's voting power, converts it to reward pool.
- If net PnL is negative or zero, no rewards distributed (house lost money or broke even).

The surplus model is elegant: stakers share in house profitability. When games go well for the house (edge > payouts), stakers benefit proportionally to their voting power.

---

### 13) Reward distribution formula (the accumulator update)

```rust
        if house.total_voting_power > 0 {
            let Some(reward_total) = epoch_surplus.checked_add(house.staking_reward_carry)
            else {
                return Ok(casino_error_vec(
                    _public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Reward overflow",
                ));
            };

            if reward_total > 0 {
                let reward_total_x18 = (reward_total as u128)
                    .checked_mul(STAKING_REWARD_SCALE)
                    .ok_or_else(|| anyhow::anyhow!("reward overflow"))?;
                let increment_x18 = reward_total_x18
                    .checked_div(house.total_voting_power)
                    .ok_or_else(|| anyhow::anyhow!("reward division by zero"))?;

                let distributed_x18 = increment_x18
                    .checked_mul(house.total_voting_power)
                    .ok_or_else(|| anyhow::anyhow!("reward overflow"))?;
                let distributed = distributed_x18 / STAKING_REWARD_SCALE;
                let distributed: u64 = distributed
                    .try_into()
                    .map_err(|_| anyhow::anyhow!("distributed reward overflow"))?;

                house.staking_reward_per_voting_power_x18 = house
                    .staking_reward_per_voting_power_x18
                    .checked_add(increment_x18)
                    .ok_or_else(|| anyhow::anyhow!("reward accumulator overflow"))?;
                house.staking_reward_pool = house
                    .staking_reward_pool
                    .checked_add(distributed)
                    .ok_or_else(|| anyhow::anyhow!("reward pool overflow"))?;
                house.staking_reward_carry = reward_total.saturating_sub(distributed);
            }
        }
```
(lines 335-372)

Why this matters:
- This is the mathematical core of the reward distribution system.

What this code does step-by-step:

1. **Add carry to surplus**: `reward_total = epoch_surplus + carry` (carry is remainder from previous epoch)

2. **Scale up for precision**: `reward_total_x18 = reward_total × 10^18`

3. **Compute per-voting-power increment**: `increment_x18 = reward_total_x18 / total_voting_power`
   - This is the key formula: how much reward per unit of voting power

4. **Reverse multiply to find distributed amount**: `distributed_x18 = increment_x18 × total_voting_power`
   - This might be less than reward_total_x18 due to truncation

5. **Scale back down**: `distributed = distributed_x18 / 10^18`

6. **Update accumulator**: Add increment to global accumulator (this is what makes future settlements work)

7. **Update reward pool**: Add distributed amount (this is what claim withdraws from)

8. **Save remainder as carry**: `carry = reward_total - distributed` (ensures no chips lost to rounding)

**Mathematical example**:
- Epoch surplus: 1000 chips
- Total voting power: 3000
- Carry from last epoch: 0

Calculation:
```
reward_total = 1000
reward_total_x18 = 1000 × 10^18 = 1,000,000,000,000,000,000,000
increment_x18 = 1,000,000,000,000,000,000,000 / 3000 = 333,333,333,333,333,333
distributed_x18 = 333,333,333,333,333,333 × 3000 = 999,999,999,999,999,999,000
distributed = 999,999,999,999,999,999,000 / 10^18 = 999
carry = 1000 - 999 = 1
```

The accumulator increments by 333,333,333,333,333,333, pool gets 999 chips, 1 chip carries to next epoch.

---

### 14) Epoch finalization

```rust
        house.current_epoch += 1;
        house.epoch_start_ts = self.seed_view;
        house.net_pnl = 0; // Reset for next week

        let epoch = house.current_epoch;
        let house_snapshot = house.clone();
        self.insert(Key::House, Value::House(house));

        return Ok(vec![Event::EpochProcessed {
            epoch,
            house: house_snapshot,
        }]);
    }

    Ok(vec![])
}
```
(lines 374-389)

Why this matters:
- Epoch boundaries are when rewards become available and net PnL resets.

What this code does:
- Increments epoch counter.
- Resets epoch start time to current view.
- **Critical**: resets net_pnl to 0 (starts fresh accounting for next epoch).
- Emits EpochProcessed event (clients can update UI).
- Returns empty vec if epoch hasn't completed (no-op until 100 blocks elapse).

The net_pnl reset is important: each epoch is independent. A profitable epoch distributes rewards, then the slate is wiped clean. Next epoch's rewards depend on next epoch's house performance.

---

## Extended deep dive: reward accounting mathematics

### 15) Why the accumulator pattern works

Traditional staking systems might iterate over all stakers each epoch to distribute rewards. With N stakers, this is O(N) per epoch. The accumulator pattern achieves O(1) epoch processing.

**The key insight**: instead of crediting each staker directly, we update a single global counter. Each staker's reward is implicit:

```
staker_reward = voting_power × (current_accumulator - accumulator_at_last_settlement)
```

This defers the actual calculation until the staker stakes/unstakes/claims, spreading the work across user actions instead of concentrating it in epoch processing.

### 16) Reward debt prevents gaming

Consider what happens without reward debt:

1. Alice stakes 100 for 10 blocks → VP = 1000
2. Epoch processes, accumulator increments by X
3. Alice stakes 1 more for 1 block → VP = 1001
4. If Alice could now claim rewards = 1001 × X, she'd claim rewards for VP she didn't have during the epoch

Reward debt fixes this:
1. After first stake, debt = 1000 × accumulator
2. Epoch increments accumulator by X
3. Before second stake, settle: pending = (1000 × (accumulator + X)) - (1000 × accumulator) = 1000X ✓
4. After second stake, sync debt: new_debt = 1001 × (accumulator + X)
5. Future pending = (1001 × (accumulator + X + Y)) - (1001 × (accumulator + X)) = 1001Y ✓

The debt "remembers" what portion of the accumulator the staker has already been credited for.

### 17) Precision loss and the carry mechanism

When distributing 1000 chips across 3000 VP, the per-VP increment is 0.333... chips. With integer arithmetic, we lose precision. The 18-decimal scale preserves 18 digits:

```
increment_x18 = (1000 × 10^18) / 3000 = 333,333,333,333,333,333
```

This represents 0.333333333333333333 chips per VP. When we multiply back:

```
distributed_x18 = 333,333,333,333,333,333 × 3000 = 999,999,999,999,999,999,000
distributed = 999,999,999,999,999,999,000 / 10^18 = 999
```

We only distribute 999 chips, not 1000. The missing 1 chip is saved in carry. Next epoch, if we have another 1000 chip surplus:

```
reward_total = 1000 + 1 (carry) = 1001
increment_x18 = (1001 × 10^18) / 3000 = 333,666,666,666,666,666
```

Now the increment is slightly higher, and eventually the carried chip gets distributed. Over many epochs, carry ensures no value is lost permanently to rounding.

### 18) Voting power decay over time

Voting power is calculated at staking time: `amount × duration`. It does NOT decay as blocks pass. If you stake 100 chips for 100 blocks, you get 10,000 VP for the entire lockup period, not declining VP as you approach unlock.

This is intentional: it rewards the commitment upfront. Alternative designs might use time-weighted average or decaying formulas, but this system uses simple product for clarity.

### 19) Proportional share calculations

If total voting power is 10,000 and you have 1,000 VP, you have 10% of voting power. When an epoch distributes 500 chips:

```
increment_x18 = (500 × 10^18) / 10,000 = 50,000,000,000,000,000
your_pending_x18 = 1,000 × 50,000,000,000,000,000 = 50,000,000,000,000,000,000
your_pending = 50,000,000,000,000,000,000 / 10^18 = 50 chips
```

You receive 10% of 500 = 50 chips. The precision scaling ensures this is exact (no rounding error for round percentages).

### 20) Edge case: staking during an epoch

Suppose you stake mid-epoch. The accumulator hasn't incremented yet for this epoch's surplus. Your reward debt is set to:

```
debt = voting_power × current_accumulator
```

When the epoch ends and accumulator increments, your pending becomes:

```
pending = voting_power × (accumulator + increment) - debt
        = voting_power × increment
```

You receive your proportional share of the epoch's rewards, even though you only staked partway through. This is slightly generous (you didn't contribute voting power for the full epoch) but keeps the system simple. Production systems might pro-rate based on time-in-epoch, but that adds complexity.

---

## Key takeaways

- Voting power = amount × duration, rewarding longer lockups proportionally.
- 18-decimal precision scaling enables O(1) reward distribution via a global accumulator.
- Reward debt prevents double-claiming by tracking what portion of the accumulator each staker has been credited for.
- Lockup periods can extend but never shorten; new stakes max() the unlock timestamp.
- Epochs process house surplus into reward pool, incrementing the accumulator proportionally to voting power.
- Carry mechanism preserves fractional chips lost to integer division across epochs.
- Unclaimed rewards accumulate between settlements and can be claimed even after unstaking.

---

## Feynman recap: explain it simply

Imagine a pizza shop (the house) that shares profits with investors (stakers). Each investor gets "voting power" based on how much they invest and how long they lock up their money. If you invest $100 for 10 months, you get 1000 points. If someone invests $50 for 20 months, they also get 1000 points (same commitment).

Every month (epoch), the shop calculates profit. If they made $500 profit and there are 5000 total points, each point earns $0.10. The shop writes down "$0.10 per point" in a ledger.

When you want to collect, you calculate: your points × current ledger value - what you already collected = new earnings. This way the shop doesn't have to track each investor individually every month.

The lockup rule is simple: once you commit to a time period, new investments can make you wait longer but can never let you exit early.

The 18-decimal precision is like using very fine measurements (like measuring pizza slices in microns instead of inches) so that when you divide profit among investors, you don't lose value to rounding errors.

---

## Exercises

1) **Voting power calculation**: Alice stakes 200 chips for 15 blocks, then stakes 100 more chips for 30 blocks. What is her total voting power? What is her unlock_ts if the first stake was at block 50?

2) **Reward settlement**: Bob has 5000 voting power. The accumulator is currently 400_x18 and his reward_debt_x18 is 1,800,000_x18. How many chips are pending for Bob?

3) **Epoch distribution**: An epoch ends with net_pnl of 2000 chips and total_voting_power of 8000. Calculate the increment_x18, distributed amount, and carry. (Assume carry starts at 0)

4) **Lockup extension**: Carol stakes 50 chips for 20 blocks at block 10. At block 15 she stakes 30 more chips for 10 blocks. What is her unlock_ts after each stake? What if the second stake was for 30 blocks instead?

5) **Precision importance**: Without 18-decimal scaling, if we distributed 1000 chips across 7000 voting power using integer division, how much would each unit of VP get? How many total chips would be distributed? How many would be lost?

If you can answer these exercises, you understand staking reward mechanics deeply.

---

## Next lesson

E30 - AMM and liquidity mechanics (if it exists), or return to the lesson index.
