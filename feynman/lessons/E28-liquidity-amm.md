# E28 - Liquidity, AMM, and vault system (from scratch, full walkthrough)

Focus file: `execution/src/layer/handlers/liquidity.rs` (2,484 LOC)

Goal: understand how the liquidity pool, automated market maker (AMM), collateralized debt positions (vaults), savings accounts, and oracle price feeds work together to create a DeFi-style economic layer on top of the casino. This is a deep dive into how players can provide liquidity, swap tokens, borrow stablecoins against collateral, earn rewards, and how the system maintains stability through dynamic fees, liquidations, and risk controls.

---

## Learning map

If you want the fastest practical understanding:

1) Read Sections 1 to 4 for the overall AMM architecture and constant product formula.
2) Read Sections 5 to 8 for liquidity operations (add/remove).
3) Read Sections 9 to 12 for swap mechanics and dynamic sell tax.
4) Read Sections 13 to 16 for vault operations (collateral, borrowing, repayment, liquidation).
5) Read Sections 17 to 20 for savings accounts and reward distribution.
6) Read Sections 21 to 24 for oracle integration and price deviation controls.
7) Read Sections 25 to 28 for daily flow limits and anti-manipulation safeguards.

If you only read one section, read Section 9 (swap mechanics) and Section 14 (vault borrowing with LTV checks). Those two are the heart of the economic system.

---

## 1) What the liquidity system does

This module implements a decentralized exchange (DEX) and collateralized lending system for two tokens:

- **RNG**: the native casino token (chips).
- **vUSDT**: a synthetic stablecoin minted by borrowing against RNG collateral.

The system provides:

- **AMM liquidity pool**: a constant-product market maker (x * y = k) where users can swap RNG ↔ vUSDT.
- **Vaults**: collateralized debt positions where users deposit RNG and borrow vUSDT.
- **Savings accounts**: interest-bearing deposits where users earn rewards from vault stability fees.
- **Oracle price feeds**: external price data to detect manipulation and enforce safe borrowing limits.
- **Dynamic fees and taxes**: sell taxes that adjust based on outflow to discourage dumping.
- **Daily flow limits**: per-player and pool-wide caps to prevent manipulation.
- **Liquidations**: automated vault liquidation when collateral ratio drops too low.

The key design principle is stability: the system must maintain a balanced economy where borrowing is safe, liquidity providers earn fair returns, and price manipulation is expensive.

---

## 2) Module constants and scaling factors

The top of the file defines critical constants:

```rust
const BASIS_POINTS_SCALE: u128 = 10_000;
const MAX_BASIS_POINTS: u16 = 10_000;
const SECONDS_PER_YEAR: u64 = 365 * 24 * 60 * 60;
const SAVINGS_REWARD_SCALE: u128 = nullspace_types::casino::STAKING_REWARD_SCALE;
const MAX_ORACLE_SOURCE_BYTES: usize = 64;
```

Conceptually:

- **BASIS_POINTS_SCALE**: 10,000 basis points = 100%. All percentages are stored as basis points (1% = 100 bps).
- **SECONDS_PER_YEAR**: used to calculate APR (annual percentage rate) for stability fees.
- **SAVINGS_REWARD_SCALE**: scaling factor (1e18) for precise reward-per-share accounting without floating point.
- **MAX_ORACLE_SOURCE_BYTES**: limits oracle source string to prevent bloat.

These constants are used throughout for fee calculations, interest accrual, and reward distribution.

---

## 3) Time and view-based timestamps

The system uses `current_time_sec` to convert the blockchain view number into timestamps:

```rust
fn current_time_sec(view: u64) -> u64 {
    view.saturating_mul(3)
}
```

This assumes 3 seconds per view (block time). All timestamps in the system are in seconds since genesis. This is used for:

- Accruing vault debt interest.
- Checking oracle staleness.
- Tracking daily flow periods.
- Account tier maturity.

---

## 4) AMM fundamentals: the constant product formula

The AMM is a constant-product market maker, the same model as Uniswap v2:

**x * y = k**

Where:
- `x = reserve_rng` (RNG in the pool)
- `y = reserve_vusdt` (vUSDT in the pool)
- `k` is constant (except when liquidity is added/removed)

When you swap, the pool adjusts reserves to maintain `k`. For example, swapping 100 RNG for vUSDT:

1) Add 100 RNG to `reserve_rng` → `x' = x + 100`
2) Calculate how much vUSDT to remove: `y' = k / x'`
3) Output amount = `y - y'`

The `constant_product_quote` function implements this with fees:

```rust
fn constant_product_quote(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_basis_points: u16,
) -> Option<SwapQuote>
```

Lines 258-288:

```rust
if fee_basis_points > MAX_BASIS_POINTS {
    return None;
}
let fee_amount =
    (amount_in as u128).checked_mul(fee_basis_points as u128)? / BASIS_POINTS_SCALE;
let net_in = (amount_in as u128).checked_sub(fee_amount)?;

let amount_in_with_fee = net_in.checked_mul(BASIS_POINTS_SCALE)?;
let numerator = amount_in_with_fee.checked_mul(reserve_out as u128)?;
let denominator = (reserve_in as u128)
    .checked_mul(BASIS_POINTS_SCALE)?
    .checked_add(amount_in_with_fee)?;

if denominator == 0 {
    return None;
}

let amount_out = numerator / denominator;
let amount_out: u64 = amount_out.try_into().ok()?;

Some(SwapQuote {
    amount_out,
    fee_amount: fee_amount as u64,
})
```

Key details:

- Fees are deducted from `amount_in` first.
- The formula uses `u128` to prevent overflow.
- Division rounds down (benefits the pool).
- Returns `None` on overflow or invalid inputs.

This is the core pricing mechanism. All swaps use this formula.

---

## 5) Liquidity shares: the LP token model

When users add liquidity, they receive **LP shares** representing their portion of the pool. Shares are minted proportionally to reserves:

**Initial liquidity (first deposit):**

```rust
shares_minted = sqrt(rng_amount * vusdt_amount)
```

This is the geometric mean, which prevents manipulation by choosing extreme ratios.

**Subsequent deposits:**

```rust
share_a = (rng_amount * total_shares) / reserve_rng
share_b = (vusdt_amount * total_shares) / reserve_vusdt
shares_minted = min(share_a, share_b)
```

The pool accepts the minimum to maintain the current ratio. Any excess is implicitly donated.

### 5.1 Minimum liquidity lock

The first deposit locks `MINIMUM_LIQUIDITY` (1000) shares permanently. This prevents:

- Complete drainage of the pool (always some liquidity remains).
- Inflation attacks (initial depositor cannot manipulate share price).

Lines 1072-1086:

```rust
if amm.total_shares == 0 {
    if shares_minted <= MINIMUM_LIQUIDITY {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Initial liquidity too small",
        ));
    }
    amm.total_shares = MINIMUM_LIQUIDITY;
    let Some(shares) = shares_minted.checked_sub(MINIMUM_LIQUIDITY) else {
        return Ok(invalid_amm_state(public));
    };
    shares_minted = shares;
}
```

This is a standard DeFi pattern (from Uniswap v2) to protect against edge cases.

---

## 6) Adding liquidity

`handle_add_liquidity` allows users to deposit RNG and vUSDT to earn LP shares.

Lines 1015-1150:

The handler:

1) Validates the AMM state.
2) Checks player has sufficient RNG and vUSDT balances.
3) Calculates shares to mint (using sqrt for initial, proportional for subsequent).
4) Deducts tokens from player balances.
5) Adds tokens to reserves and mints shares.
6) Stores LP balance and emits `LiquidityAdded` event.

Important checks:

- **Zero amounts rejected**: prevents dust attacks.
- **Insufficient funds**: standard balance check.
- **Proportionality**: ensures depositors cannot manipulate pool ratio.

Example trace:

```
Pool state: reserve_rng=1000, reserve_vusdt=2000, total_shares=1414
User deposits: 100 RNG + 200 vUSDT
share_a = (100 * 1414) / 1000 = 141.4 → 141
share_b = (200 * 1414) / 2000 = 141.4 → 141
shares_minted = 141
New pool: reserve_rng=1100, reserve_vusdt=2200, total_shares=1555
```

---

## 7) Removing liquidity

`handle_remove_liquidity` allows users to burn LP shares and withdraw proportional reserves.

Lines 1152-1243:

The handler:

1) Checks user has sufficient LP shares.
2) Calculates proportional amounts: `(shares * reserve) / total_shares`.
3) Burns shares, removes reserves, credits player balances.
4) Emits `LiquidityRemoved` event.

Important: the pool cannot be fully drained due to the minimum liquidity lock.

Example trace:

```
Pool state: reserve_rng=1100, reserve_vusdt=2200, total_shares=1555
User burns: 155 shares
amount_rng = (155 * 1100) / 1555 = 109
amount_vusdt = (155 * 2200) / 1555 = 219
New pool: reserve_rng=991, reserve_vusdt=1981, total_shares=1400
```

---

## 8) Bootstrap and finalization

Admin can seed the initial pool using `handle_seed_amm`:

Lines 1245-1334:

This handler:

- Only callable by admin (checked via `is_admin_public_key`).
- Sets initial reserves and bootstrap price.
- Mints initial shares.
- Marks the pool as not finalized.

The `handle_finalize_amm_bootstrap` locks in the final price after the bootstrap phase.

This two-phase bootstrap allows controlled initial liquidity before public trading.

---

## 9) Swap mechanics: buying and selling with fees

`handle_swap` implements token swaps with fees and taxes.

Lines 772-1013:

### 9.1 Buy flow (RNG ← vUSDT)

User pays vUSDT, receives RNG:

1) Deduct vUSDT from player balance.
2) Calculate output using `constant_product_quote`.
3) Credit RNG to player balance.
4) Update reserves: `reserve_vusdt += amount_in`, `reserve_rng -= amount_out`.
5) Accumulate fees in `house.accumulated_fees`.

### 9.2 Sell flow (RNG → vUSDT)

User pays RNG, receives vUSDT:

1) Apply **sell tax** first (burned amount).
2) Deduct RNG from player balance (including tax).
3) Calculate output using `constant_product_quote` on net amount.
4) Credit vUSDT to player balance.
5) Update reserves: `reserve_rng += net_amount_in`, `reserve_vusdt -= amount_out`.
6) Burn tax and accumulate fees.

Lines 872-884:

```rust
let mut burned_amount = 0;
if !is_buying_rng {
    burned_amount =
        (amount_in as u128 * sell_tax_bps as u128 / BASIS_POINTS_SCALE) as u64;
    if burned_amount > 0 {
        let Some(net_amount_in) = amount_in.checked_sub(burned_amount) else {
            return Ok(invalid_amm_state(public));
        };
        amount_in = net_amount_in;
    }
}
```

The sell tax is **burned** (permanently removed from supply), not added to reserves. This creates deflationary pressure on RNG.

---

## 10) Dynamic sell tax: outflow-based fee adjustment

The sell tax adjusts dynamically based on daily outflow to discourage mass selling.

Lines 38-58:

```rust
fn dynamic_sell_tax_bps(
    policy: &nullspace_types::casino::PolicyState,
    amm: &nullspace_types::casino::AmmPool,
    daily_sell_after: u64,
) -> u16 {
    if amm.reserve_rng == 0 {
        return policy.sell_tax_mid_bps;
    }
    let outflow_bps = (daily_sell_after as u128)
        .saturating_mul(BASIS_POINTS_SCALE)
        .checked_div(amm.reserve_rng as u128)
        .unwrap_or(0)
        .min(u16::MAX as u128) as u16;
    if outflow_bps < policy.sell_tax_outflow_low_bps {
        policy.sell_tax_min_bps
    } else if outflow_bps < policy.sell_tax_outflow_mid_bps {
        policy.sell_tax_mid_bps
    } else {
        policy.sell_tax_max_bps
    }
}
```

This calculates the player's cumulative daily sell as a percentage of pool reserves, then selects a tax tier:

- **Low outflow**: minimum tax (e.g., 1%).
- **Mid outflow**: mid tax (e.g., 3%).
- **High outflow**: max tax (e.g., 5%).

This is an **anti-dump mechanism**: heavy sellers pay progressively higher taxes, discouraging coordinated sell-offs.

---

## 11) Daily flow limits: preventing manipulation

The system tracks daily buy/sell flows per player and enforces caps.

Lines 14-20:

```rust
fn reset_daily_flow_if_needed(player: &mut nullspace_types::casino::Player, current_day: u64) {
    if player.session.daily_flow_day != current_day {
        player.session.daily_flow_day = current_day;
        player.session.daily_net_sell = 0;
        player.session.daily_net_buy = 0;
    }
}
```

Each day (86,400 seconds), flows reset to zero.

### 11.1 Sell limits

Lines 839-870:

```rust
let max_by_balance = (player.balances.chips as u128)
    .saturating_mul(policy.max_daily_sell_bps_balance as u128)
    .checked_div(BASIS_POINTS_SCALE)
    .unwrap_or(0) as u64;
let max_by_pool = (amm.reserve_rng as u128)
    .saturating_mul(policy.max_daily_sell_bps_pool as u128)
    .checked_div(BASIS_POINTS_SCALE)
    .unwrap_or(0) as u64;
let mut allowed = max_by_balance.min(max_by_pool);
```

Each player is limited by:

- A percentage of their RNG balance (e.g., 10% per day).
- A percentage of pool reserves (e.g., 5% per day).

The minimum of these two is enforced. This prevents:

- Whales dumping large positions instantly.
- Single players draining the pool.

### 11.2 Buy limits

Similar logic applies to buying RNG with vUSDT, preventing pump attacks.

---

## 12) Slippage protection

Swaps include a `min_amount_out` parameter. If the actual output is less, the transaction fails:

Lines 901-908:

```rust
if amount_out < min_amount_out {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        "Slippage limit exceeded",
    ));
}
```

This protects users from front-running and price movement during transaction submission.

---

## 13) Vaults: collateralized debt positions

Vaults allow users to deposit RNG as collateral and borrow vUSDT. The system tracks:

- `collateral_rng`: amount of RNG locked in the vault.
- `debt_vusdt`: amount of vUSDT borrowed.
- `last_accrual_ts`: timestamp of last interest calculation.

### 13.1 Creating a vault

`handle_create_vault` initializes a vault for a player:

Lines 466-494:

```rust
if self.get(Key::Vault(public.clone())).await?.is_some() {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        "Vault already exists",
    ));
}

let vault = nullspace_types::casino::Vault::default();
self.insert(Key::Vault(public.clone()), Value::Vault(vault.clone()));
```

Each player can have one vault. It starts with zero collateral and debt.

---

## 14) Depositing collateral and borrowing vUSDT

### 14.1 Depositing collateral

`handle_deposit_collateral` moves RNG from player balance to vault:

Lines 496-559:

```rust
if player.balances.chips < amount {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
        "Insufficient chips",
    ));
}

player.balances.chips -= amount;
vault.collateral_rng = new_collateral;
```

### 14.2 Borrowing vUSDT

`handle_borrow_usdt` mints vUSDT against collateral, enforcing LTV (loan-to-value) limits:

Lines 561-710:

The handler:

1) Accrues interest on existing debt.
2) Calculates collateral value using AMM price (or oracle if deviation is high).
3) Checks the new debt does not exceed max LTV.
4) Checks global debt ceiling.
5) Mints vUSDT to player balance.
6) Updates vault debt and global debt counter.

### 14.3 LTV calculation

Lines 620-645:

```rust
let lhs = (new_debt as u128)
    .saturating_mul(price_denominator)
    .saturating_mul(BASIS_POINTS_SCALE);
let rhs = (vault.collateral_rng as u128)
    .saturating_mul(price_numerator)
    .saturating_mul(max_ltv_bps as u128);

if lhs > rhs {
    let message = format!("Insufficient collateral (Max {}% LTV)", max_ltv_bps / 100);
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        &message,
    ));
}
```

This checks:

**debt / collateral_value ≤ max_ltv**

Where:

- `collateral_value = collateral_rng * price_ratio`
- `max_ltv_bps` is typically 30-70% depending on account tier.

This ensures vaults are overcollateralized, protecting the system from bad debt.

---

## 15) Account tier system: tier2 benefits

The system has two account tiers:

- **Tier 1 (new)**: lower max LTV (e.g., 30%).
- **Tier 2 (mature)**: higher max LTV (e.g., 70%).

Lines 22-36:

```rust
fn is_tier2(
    player: &nullspace_types::casino::Player,
    now: u64,
    staker: Option<&nullspace_types::casino::Staker>,
) -> bool {
    let created_ts = player.profile.created_ts;
    if created_ts == 0 {
        return false;
    }
    if now.saturating_sub(created_ts) < nullspace_types::casino::ACCOUNT_TIER_MATURE_SECS {
        return false;
    }
    let staked = staker.map(|s| s.balance).unwrap_or(0);
    staked >= nullspace_types::casino::ACCOUNT_TIER2_STAKE_MIN
}
```

To reach tier2, players must:

- Have an account older than `ACCOUNT_TIER_MATURE_SECS` (e.g., 30 days).
- Stake at least `ACCOUNT_TIER2_STAKE_MIN` RNG.

This rewards long-term users with better borrowing capacity.

---

## 16) Repaying debt and vault liquidation

### 16.1 Repaying debt

`handle_repay_usdt` burns vUSDT to reduce vault debt:

Lines 712-770:

```rust
let actual_repay = amount.min(vault.debt_vusdt);

player.balances.vusdt_balance -= actual_repay;
vault.debt_vusdt -= actual_repay;
house.total_vusdt_debt = house.total_vusdt_debt.saturating_sub(actual_repay);
```

Players can partially or fully repay. The vUSDT is burned (removed from circulation).

### 16.2 Liquidation

`handle_liquidate_vault` allows anyone to liquidate undercollateralized vaults:

Lines 1397-1605:

The handler:

1) Accrues interest to update debt.
2) Calculates collateral value using liquidation price (worst of AMM/oracle).
3) Checks if LTV exceeds `liquidation_threshold_bps` (e.g., 85%).
4) Calculates repay amount to bring LTV back to `liquidation_target_bps` (e.g., 70%).
5) Liquidator pays vUSDT, receives collateral + penalty bonus.
6) Penalty is split: part to liquidator, part to recovery pool.

Lines 1494-1517:

```rust
let ltv_bps = (vault.debt_vusdt as u128)
    .saturating_mul(BASIS_POINTS_SCALE)
    .checked_div(collateral_value)
    .unwrap_or(u128::MAX);
if ltv_bps <= policy.liquidation_threshold_bps as u128 {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        "Vault not eligible for liquidation",
    ));
}

let target_debt = collateral_value
    .saturating_mul(policy.liquidation_target_bps as u128)
    .checked_div(BASIS_POINTS_SCALE)
    .unwrap_or(0);
let mut repay_amount = (vault.debt_vusdt as u128)
    .saturating_sub(target_debt)
    .min(vault.debt_vusdt as u128) as u64;
```

Liquidation is profitable for liquidators (they receive bonus collateral), incentivizing them to keep the system healthy.

---

## 17) Vault debt accrual: stability fees

Vaults accrue interest over time via `accrue_vault_debt`:

Lines 60-91:

```rust
fn accrue_vault_debt(
    vault: &mut nullspace_types::casino::Vault,
    house: &mut nullspace_types::casino::HouseState,
    now: u64,
    policy: &nullspace_types::casino::PolicyState,
) -> u64 {
    if vault.debt_vusdt == 0 {
        vault.last_accrual_ts = now;
        return 0;
    }
    let last_ts = if vault.last_accrual_ts == 0 {
        now
    } else {
        vault.last_accrual_ts
    };
    let elapsed = now.saturating_sub(last_ts);
    if elapsed == 0 {
        return 0;
    }
    let interest = (vault.debt_vusdt as u128)
        .saturating_mul(policy.stability_fee_apr_bps as u128)
        .saturating_mul(elapsed as u128)
        .checked_div(BASIS_POINTS_SCALE.saturating_mul(SECONDS_PER_YEAR as u128))
        .unwrap_or(0) as u64;
    if interest > 0 {
        vault.debt_vusdt = vault.debt_vusdt.saturating_add(interest);
        house.total_vusdt_debt = house.total_vusdt_debt.saturating_add(interest);
        house.stability_fees_accrued = house.stability_fees_accrued.saturating_add(interest);
    }
    vault.last_accrual_ts = now;
    interest
}
```

This calculates:

**interest = debt * APR * (elapsed / seconds_per_year)**

The interest is:

- Added to vault debt.
- Added to global debt counter.
- Tracked in `house.stability_fees_accrued`.
- **Allocated to savings pool as rewards.**

This is how the system incentivizes borrowing while rewarding savers.

---

## 18) Savings accounts: earning rewards from stability fees

Savings accounts allow users to deposit vUSDT and earn interest from vault stability fees.

### 18.1 Reward distribution mechanism

The system uses **reward-per-share** accounting (similar to MasterChef):

Lines 93-110:

```rust
fn distribute_savings_rewards(pool: &mut nullspace_types::casino::SavingsPool) {
    if pool.total_deposits == 0 || pool.pending_rewards == 0 {
        return;
    }
    let delta = (pool.pending_rewards as u128)
        .saturating_mul(SAVINGS_REWARD_SCALE)
        .checked_div(pool.total_deposits as u128)
        .unwrap_or(0);
    if delta == 0 {
        return;
    }
    let distributed = delta
        .saturating_mul(pool.total_deposits as u128)
        .checked_div(SAVINGS_REWARD_SCALE)
        .unwrap_or(0) as u64;
    pool.reward_per_share_x18 = pool.reward_per_share_x18.saturating_add(delta);
    pool.pending_rewards = pool.pending_rewards.saturating_sub(distributed);
}
```

Each deposit/withdrawal:

1) Distributes pending rewards (updates `reward_per_share_x18`).
2) Settles user's pending rewards.
3) Syncs user's reward debt.

### 18.2 Settling user rewards

Lines 112-134:

```rust
fn settle_savings_rewards(
    balance: &mut nullspace_types::casino::SavingsBalance,
    pool: &nullspace_types::casino::SavingsPool,
) -> Result<(), &'static str> {
    if balance.deposit_balance == 0 {
        balance.reward_debt_x18 = 0;
        return Ok(());
    }
    let current_debt = (balance.deposit_balance as u128)
        .checked_mul(pool.reward_per_share_x18)
        .ok_or("savings reward debt overflow")?;
    let pending_x18 = current_debt
        .checked_sub(balance.reward_debt_x18)
        .ok_or("savings reward debt underflow")?;
    let pending = pending_x18 / SAVINGS_REWARD_SCALE;
    let pending: u64 = pending.try_into().map_err(|_| "savings reward overflow")?;
    balance.unclaimed_rewards = balance
        .unclaimed_rewards
        .checked_add(pending)
        .ok_or("savings reward overflow")?;
    balance.reward_debt_x18 = current_debt;
    Ok(())
}
```

This calculates:

**pending_rewards = (deposit_balance * reward_per_share) - reward_debt**

The debt tracks "already credited" rewards, preventing double-counting.

### 18.3 Depositing and withdrawing

`handle_savings_deposit` and `handle_savings_withdraw` manage deposits:

Lines 2015-2161:

Both handlers:

1) Distribute pending rewards to the pool.
2) Settle user's pending rewards.
3) Update balances and pool totals.
4) Sync reward debt.

Users can claim rewards separately using `handle_savings_claim`.

---

## 19) Oracle integration: external price feeds

The system integrates external price oracles to detect AMM manipulation.

### 19.1 Oracle state

Lines 168-187:

```rust
fn oracle_price_ratio(
    policy: &nullspace_types::casino::PolicyState,
    oracle: &nullspace_types::casino::OracleState,
    now: u64,
) -> Option<(u128, u128)> {
    if !policy.oracle_enabled {
        return None;
    }
    if oracle.price_vusdt_numerator == 0 || oracle.price_rng_denominator == 0 {
        return None;
    }
    if policy.oracle_stale_secs > 0 && now.saturating_sub(oracle.updated_ts) > policy.oracle_stale_secs
    {
        return None;
    }
    Some((
        oracle.price_vusdt_numerator as u128,
        oracle.price_rng_denominator as u128,
    ))
}
```

The oracle provides a price ratio (numerator/denominator). It is ignored if:

- Oracle is disabled.
- Price is zero.
- Data is stale (older than `oracle_stale_secs`).

### 19.2 Price deviation checks

Lines 189-208:

```rust
fn price_deviation_bps(
    amm_num: u128,
    amm_den: u128,
    oracle_num: u128,
    oracle_den: u128,
) -> Option<u16> {
    if amm_den == 0 || oracle_den == 0 {
        return None;
    }
    let amm_scaled = amm_num.checked_mul(oracle_den)?;
    let oracle_scaled = oracle_num.checked_mul(amm_den)?;
    if oracle_scaled == 0 {
        return None;
    }
    let diff = amm_scaled.abs_diff(oracle_scaled);
    let deviation = diff
        .checked_mul(BASIS_POINTS_SCALE)?
        .checked_div(oracle_scaled)?;
    Some(deviation.min(u16::MAX as u128) as u16)
}
```

This calculates the percentage difference between AMM and oracle prices.

### 19.3 Effective price for borrowing

Lines 214-234:

```rust
fn effective_price_ratio_for_borrow(
    policy: &nullspace_types::casino::PolicyState,
    oracle: &nullspace_types::casino::OracleState,
    now: u64,
    amm_num: u128,
    amm_den: u128,
) -> (u128, u128) {
    let Some((oracle_num, oracle_den)) = oracle_price_ratio(policy, oracle, now) else {
        return (amm_num, amm_den);
    };
    let deviation =
        price_deviation_bps(amm_num, amm_den, oracle_num, oracle_den).unwrap_or(u16::MAX);
    if deviation <= policy.oracle_max_deviation_bps {
        return (amm_num, amm_den);
    }
    if price_is_greater(amm_num, amm_den, oracle_num, oracle_den) {
        (oracle_num, oracle_den)
    } else {
        (amm_num, amm_den)
    }
}
```

When borrowing, the system uses:

- AMM price if deviation is small (within `oracle_max_deviation_bps`).
- **Worse of AMM/oracle** if deviation is large (prevents manipulation).

This prevents attackers from manipulating the AMM price to over-borrow.

### 19.4 Effective price for liquidation

Lines 236-256:

Similar logic, but uses the **worse of AMM/oracle** in the opposite direction, making liquidation safer.

---

## 20) Updating the oracle (admin only)

`handle_update_oracle` allows admins to push external price data:

Lines 1636-1684:

```rust
if !super::is_admin_public_key(public) {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_UNAUTHORIZED,
        "Unauthorized admin instruction",
    ));
}

let oracle = nullspace_types::casino::OracleState {
    price_vusdt_numerator,
    price_rng_denominator,
    updated_ts: if updated_ts == 0 { now } else { updated_ts },
    source: source.to_vec(),
};

self.insert(Key::OracleState, Value::OracleState(oracle.clone()));
```

The `source` field stores a string identifying the data source (e.g., "chainlink-rng-usd").

---

## 21) Policy validation and configuration

The `validate_policy` function enforces invariants on policy parameters:

Lines 317-379:

Key checks:

- Sell tax tiers are ordered: `min ≤ mid ≤ max ≤ 100%`.
- Daily flow caps are valid: `≤ 100%`.
- LTV limits: `new ≤ mature ≤ 100%`.
- Liquidation thresholds: `target ≤ threshold ≤ 100%`.
- Liquidation penalty split: `reward + stability = penalty`.
- Debt ceiling: `≤ 100%` of reserves.
- Oracle deviation: `≤ 100%`.

This prevents invalid configurations from being deployed.

---

## 22) Treasury and vesting schedules

The system includes treasury allocations with linear vesting:

Lines 422-440:

```rust
fn vested_amount(total: u64, schedule: &nullspace_types::casino::VestingSchedule, now: u64) -> u64 {
    if total == 0 {
        return 0;
    }
    if schedule.duration_secs == 0 {
        return total;
    }
    if now <= schedule.start_ts {
        return 0;
    }
    let elapsed = now.saturating_sub(schedule.start_ts);
    if elapsed >= schedule.duration_secs {
        return total;
    }
    (total as u128)
        .saturating_mul(elapsed as u128)
        .checked_div(schedule.duration_secs as u128)
        .unwrap_or(0) as u64
}
```

This calculates:

**vested = total * (elapsed / duration)**

Linear vesting ensures gradual release of treasury funds.

---

## 23) Recovery pool: bad debt management

The recovery pool collects:

- Liquidation penalties (stability portion).
- Admin funding (`handle_fund_recovery_pool`).

It is used to retire vault debt via:

- `handle_retire_vault_debt`: pays off a specific vault.
- `handle_retire_worst_vault_debt`: pays off the vault with highest LTV.

Lines 1916-2013:

This allows the system to absorb bad debt (e.g., from under-liquidated vaults due to extreme price crashes).

---

## 24) Limits and management callouts

### 24.1 Daily flow limits

- **max_daily_sell_bps_balance**: e.g., 10% of user balance per day.
- **max_daily_sell_bps_pool**: e.g., 5% of pool reserves per day.
- **max_daily_buy_bps_balance**: e.g., 20% of user balance per day.
- **max_daily_buy_bps_pool**: e.g., 10% of pool reserves per day.

These prevent:

- Whale manipulation (single large holder dumping).
- Pool drainage (multiple users coordinating).
- Pump attacks (flash loans buying all liquidity).

### 24.2 Debt ceiling

The `debt_ceiling_bps` limits total vUSDT debt as a percentage of pool reserves:

Lines 655-671:

```rust
let max_total_debt = if amm.total_shares == 0 {
    u64::MAX
} else {
    (amm.reserve_vusdt as u128)
        .saturating_mul(policy.debt_ceiling_bps as u128)
        .checked_div(BASIS_POINTS_SCALE)
        .unwrap_or(0) as u64
};
let new_total_debt = house.total_vusdt_debt.saturating_add(amount);
if max_total_debt != u64::MAX && new_total_debt > max_total_debt {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        "Debt ceiling reached",
    ));
}
```

This prevents over-issuance of vUSDT, maintaining stability.

### 24.3 Liquidation incentives

- **liquidation_reward_bps**: bonus for liquidator (e.g., 5%).
- **liquidation_stability_bps**: contribution to recovery pool (e.g., 5%).
- **liquidation_penalty_bps**: total penalty (e.g., 10% = reward + stability).

This ensures liquidations are:

- Profitable (incentivizes liquidators).
- Safe (recovery pool absorbs risk).

---

## 25) Integer overflow protection

Every arithmetic operation uses:

- `checked_add`, `checked_sub`, `checked_mul`, `checked_div`.
- `saturating_add`, `saturating_sub`, `saturating_mul`.
- Explicit overflow checks returning `None` or errors.

This is critical for financial contracts: overflow bugs can drain funds or lock users out.

---

## 26) State validation: the invariant guards

`validate_amm_state` enforces pool invariants:

Lines 290-315:

```rust
fn validate_amm_state(amm: &nullspace_types::casino::AmmPool) -> Result<(), &'static str> {
    if amm.fee_basis_points > MAX_BASIS_POINTS || amm.sell_tax_basis_points > MAX_BASIS_POINTS {
        return Err("invalid basis points");
    }
    if amm.bootstrap_price_rng_denominator == 0 {
        return Err("invalid bootstrap price");
    }

    match amm.total_shares {
        0 => {
            if amm.reserve_rng != 0 || amm.reserve_vusdt != 0 {
                return Err("non-zero reserves with zero shares");
            }
        }
        _ => {
            if amm.total_shares < MINIMUM_LIQUIDITY {
                return Err("total_shares below MINIMUM_LIQUIDITY");
            }
            if amm.reserve_rng == 0 || amm.reserve_vusdt == 0 {
                return Err("zero reserves with non-zero shares");
            }
        }
    }

    Ok(())
}
```

This catches:

- Invalid fee values.
- Bootstrap price errors.
- Inconsistent share/reserve states.

Every handler calls this before mutating the AMM.

---

## 27) Testing: proof of correctness

The test suite includes:

### 27.1 RNG price ratio tests

Lines 2235-2246:

```rust
#[test]
fn rng_price_ratio_bootstrap_when_no_rng_reserve() {
    assert_eq!(rng_price_ratio(0, 0, 1, 1), (1, 1));
    assert_eq!(rng_price_ratio(0, 1_000, 1, 1), (1, 1));
    assert_eq!(rng_price_ratio(0, 0, 2, 3), (2, 3));
    assert_eq!(rng_price_ratio(0, 1_000, 2, 3), (2, 3));
}

#[test]
fn rng_price_ratio_tracks_reserve_ratio_when_nonzero_rng_reserve() {
    assert_eq!(rng_price_ratio(2, 10, 1, 1), (10, 2));
    assert_eq!(rng_price_ratio(5, 0, 1, 1), (0, 5));
}
```

### 27.2 Borrowing with bootstrap price

Lines 2249-2303:

Tests that borrowing uses bootstrap price when reserves are zero.

### 27.3 Constant product quote tests

Lines 2306-2347:

Tests fee application, rounding, overflow handling.

### 27.4 Swap failure isolation

Lines 2380-2483:

Tests that failed swaps do not mutate house state (no burn/fee leakage).

These tests provide confidence in edge case handling.

---

## 28) Feynman recap: explain it like I am five

- The AMM is a robot market maker that trades RNG ↔ vUSDT using a math formula.
- Liquidity providers add tokens to the pool and earn fees.
- Swaps charge fees and taxes; sell taxes adjust based on how much people are selling.
- Vaults let you lock RNG and borrow vUSDT, but you must keep enough collateral or get liquidated.
- Savings accounts earn interest from vault borrowers.
- Oracles check if the AMM price is being manipulated.
- Daily limits prevent whales from dumping or pumping too fast.
- All math uses integers and overflow checks to prevent bugs.

---

## 29) Key takeaways

1) **Constant product formula** (`x * y = k`) is the core pricing mechanism.
2) **LP shares** represent proportional ownership; minimum liquidity lock prevents edge cases.
3) **Dynamic sell tax** discourages mass selling by increasing fees for large outflows.
4) **Daily flow limits** (per-player and pool-wide) prevent manipulation.
5) **Vaults** allow overcollateralized borrowing; LTV limits enforce safety.
6) **Account tiers** reward long-term stakers with better borrowing terms.
7) **Liquidations** keep vaults healthy by incentivizing third parties to repay bad debt.
8) **Savings accounts** distribute vault interest to depositors using reward-per-share accounting.
9) **Oracle integration** detects AMM manipulation and enforces safer pricing for critical operations.
10) **Integer overflow protection** and **state validation** are used everywhere for safety.

---

## 30) Exercises (to build mastery)

1) Trace a full swap: user sells 100 RNG for vUSDT with 3% fee and 2% sell tax. Calculate reserves before/after, output amount, burned amount, and accumulated fees.

2) Calculate LP shares minted for a deposit of 50 RNG + 100 vUSDT into a pool with `reserve_rng=1000`, `reserve_vusdt=2000`, `total_shares=1414`. Why is the minimum of the two ratios used?

3) Explain how the `dynamic_sell_tax_bps` function prevents coordinated sell-offs. What happens if daily outflow exceeds 10% of reserves?

4) A vault has 1000 RNG collateral and 500 vUSDT debt. If the RNG price drops from 1.0 to 0.6 vUSDT, calculate the LTV before and after. Is the vault liquidatable if the threshold is 85%?

5) Trace the reward-per-share update when 100 vUSDT of stability fees are allocated to a savings pool with 1000 vUSDT deposited. If a user has 100 vUSDT deposited, how much do they earn?

---

## Next lesson

E29 - Bridge and withdrawal system: `feynman/lessons/E29-bridge-withdrawals.md`
