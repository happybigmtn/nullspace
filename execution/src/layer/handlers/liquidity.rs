use super::super::*;
use super::casino_error_vec;
use commonware_codec::ReadExt;
use commonware_utils::from_hex;
use std::sync::OnceLock;

const BASIS_POINTS_SCALE: u128 = 10_000;
const MAX_BASIS_POINTS: u16 = 10_000;
const SECONDS_PER_YEAR: u64 = 365 * 24 * 60 * 60;
const SAVINGS_REWARD_SCALE: u128 = nullspace_types::casino::STAKING_REWARD_SCALE;
const MAX_ORACLE_SOURCE_BYTES: usize = 64;

fn admin_public_key() -> Option<PublicKey> {
    static ADMIN_KEY: OnceLock<Option<PublicKey>> = OnceLock::new();
    ADMIN_KEY
        .get_or_init(|| {
            let raw = std::env::var("CASINO_ADMIN_PUBLIC_KEY_HEX").ok()?;
            let trimmed = raw.trim_start_matches("0x");
            let bytes = from_hex(trimmed)?;
            let mut buf = bytes.as_slice();
            let key = PublicKey::read(&mut buf).ok()?;
            if !buf.is_empty() {
                return None;
            }
            Some(key)
        })
        .clone()
}

fn current_time_sec(view: u64) -> u64 {
    view.saturating_mul(3)
}

fn reset_daily_flow_if_needed(player: &mut nullspace_types::casino::Player, current_day: u64) {
    if player.session.daily_flow_day != current_day {
        player.session.daily_flow_day = current_day;
        player.session.daily_net_sell = 0;
        player.session.daily_net_buy = 0;
    }
}

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

fn sync_savings_reward_debt(
    balance: &mut nullspace_types::casino::SavingsBalance,
    pool: &nullspace_types::casino::SavingsPool,
) -> Result<(), &'static str> {
    balance.reward_debt_x18 = (balance.deposit_balance as u128)
        .checked_mul(pool.reward_per_share_x18)
        .ok_or("savings reward debt overflow")?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SwapQuote {
    amount_out: u64,
    fee_amount: u64,
}

fn rng_price_ratio(
    reserve_rng: u64,
    reserve_vusdt: u64,
    bootstrap_price_vusdt_numerator: u64,
    bootstrap_price_rng_denominator: u64,
) -> (u128, u128) {
    if reserve_rng > 0 {
        (reserve_vusdt as u128, reserve_rng as u128)
    } else {
        (
            bootstrap_price_vusdt_numerator as u128,
            bootstrap_price_rng_denominator as u128,
        )
    }
}

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
    let diff = if amm_scaled > oracle_scaled {
        amm_scaled - oracle_scaled
    } else {
        oracle_scaled - amm_scaled
    };
    let deviation = diff
        .checked_mul(BASIS_POINTS_SCALE)?
        .checked_div(oracle_scaled)?;
    Some(deviation.min(u16::MAX as u128) as u16)
}

fn price_is_greater(a_num: u128, a_den: u128, b_num: u128, b_den: u128) -> bool {
    a_num.saturating_mul(b_den) > b_num.saturating_mul(a_den)
}

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

fn effective_price_ratio_for_liquidation(
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
        (amm_num, amm_den)
    } else {
        (oracle_num, oracle_den)
    }
}

fn constant_product_quote(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_basis_points: u16,
) -> Option<SwapQuote> {
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
}

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

fn validate_policy(policy: &nullspace_types::casino::PolicyState) -> Result<(), &'static str> {
    if policy.sell_tax_min_bps > policy.sell_tax_mid_bps
        || policy.sell_tax_mid_bps > policy.sell_tax_max_bps
        || policy.sell_tax_max_bps > MAX_BASIS_POINTS
    {
        return Err("invalid sell tax configuration");
    }
    if policy.sell_tax_outflow_low_bps > policy.sell_tax_outflow_mid_bps {
        return Err("invalid sell tax outflow thresholds");
    }
    if policy.max_daily_sell_bps_balance > MAX_BASIS_POINTS
        || policy.max_daily_sell_bps_pool > MAX_BASIS_POINTS
        || policy.max_daily_buy_bps_balance > MAX_BASIS_POINTS
        || policy.max_daily_buy_bps_pool > MAX_BASIS_POINTS
    {
        return Err("invalid daily flow caps");
    }
    if policy.max_ltv_bps_new > policy.max_ltv_bps_mature
        || policy.max_ltv_bps_mature > MAX_BASIS_POINTS
    {
        return Err("invalid LTV configuration");
    }
    if policy.liquidation_threshold_bps > MAX_BASIS_POINTS
        || policy.liquidation_target_bps > policy.liquidation_threshold_bps
    {
        return Err("invalid liquidation thresholds");
    }
    if policy.liquidation_penalty_bps > MAX_BASIS_POINTS {
        return Err("invalid liquidation penalty");
    }
    if policy
        .liquidation_reward_bps
        .saturating_add(policy.liquidation_stability_bps)
        != policy.liquidation_penalty_bps
    {
        return Err("liquidation split mismatch");
    }
    if policy.stability_fee_apr_bps > MAX_BASIS_POINTS {
        return Err("invalid stability fee");
    }
    if policy.debt_ceiling_bps > MAX_BASIS_POINTS {
        return Err("invalid debt ceiling");
    }
    if policy.credit_immediate_bps > MAX_BASIS_POINTS {
        return Err("invalid credit vesting");
    }
    if policy.oracle_max_deviation_bps > MAX_BASIS_POINTS {
        return Err("invalid oracle deviation");
    }
    if policy.bridge_max_withdraw > 0 && policy.bridge_min_withdraw > policy.bridge_max_withdraw {
        return Err("invalid bridge min/max");
    }
    if policy.bridge_daily_limit == 0 && policy.bridge_daily_limit_per_account > 0 {
        return Err("invalid bridge daily limits");
    }
    if policy.bridge_daily_limit > 0
        && policy.bridge_daily_limit_per_account > policy.bridge_daily_limit
    {
        return Err("bridge per-account limit exceeds daily limit");
    }

    Ok(())
}

fn validate_treasury(
    treasury: &nullspace_types::casino::TreasuryState,
) -> Result<(), &'static str> {
    let total = treasury
        .auction_allocation_rng
        .saturating_add(treasury.liquidity_reserve_rng)
        .saturating_add(treasury.bonus_pool_rng)
        .saturating_add(treasury.player_allocation_rng)
        .saturating_add(treasury.treasury_allocation_rng)
        .saturating_add(treasury.team_allocation_rng);
    if total > nullspace_types::casino::TOTAL_SUPPLY {
        return Err("treasury allocation exceeds total supply");
    }
    Ok(())
}

fn validate_treasury_vesting(
    treasury: &nullspace_types::casino::TreasuryState,
    vesting: &nullspace_types::casino::TreasuryVestingState,
) -> Result<(), &'static str> {
    if vesting.auction.released > treasury.auction_allocation_rng {
        return Err("treasury auction release exceeds allocation");
    }
    if vesting.liquidity.released > treasury.liquidity_reserve_rng {
        return Err("treasury liquidity release exceeds allocation");
    }
    if vesting.bonus.released > treasury.bonus_pool_rng {
        return Err("treasury bonus release exceeds allocation");
    }
    if vesting.player.released > treasury.player_allocation_rng {
        return Err("treasury player release exceeds allocation");
    }
    if vesting.treasury.released > treasury.treasury_allocation_rng {
        return Err("treasury ops release exceeds allocation");
    }
    if vesting.team.released > treasury.team_allocation_rng {
        return Err("treasury team release exceeds allocation");
    }
    Ok(())
}

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

fn invalid_amm_state(public: &PublicKey) -> Vec<Event> {
    casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        "Invalid AMM state",
    )
}

impl<'a, S: State> Layer<'a, S> {
    // === Liquidity / Vault Handlers ===

    async fn allocate_savings_rewards(&mut self, amount: u64) -> anyhow::Result<()> {
        if amount == 0 {
            return Ok(());
        }
        let mut pool = self.get_or_init_savings_pool().await?;
        pool.total_rewards_accrued = pool.total_rewards_accrued.saturating_add(amount);
        pool.pending_rewards = pool.pending_rewards.saturating_add(amount);
        distribute_savings_rewards(&mut pool);
        self.insert(Key::SavingsPool, Value::SavingsPool(pool));
        Ok(())
    }

    pub(in crate::layer) async fn handle_create_vault(
        &mut self,
        public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        if self.get(&Key::Vault(public.clone())).await?.is_some() {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE, // Reuse
                "Vault already exists",
            ));
        }

        let vault = nullspace_types::casino::Vault::default();
        self.insert(Key::Vault(public.clone()), Value::Vault(vault.clone()));

        let mut registry = self.get_or_init_vault_registry().await?;
        if !registry.vaults.contains(public) {
            registry.vaults.push(public.clone());
            registry.vaults.sort_unstable();
            registry.vaults.dedup();
            self.insert(Key::VaultRegistry, Value::VaultRegistry(registry));
        }

        Ok(vec![Event::VaultCreated {
            player: public.clone(),
            vault,
        }])
    }

    pub(in crate::layer) async fn handle_deposit_collateral(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if player.profile.created_ts == 0 {
            player.profile.created_ts = current_time_sec(self.seed.view);
        }

        if player.balances.chips < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient chips",
            ));
        }

        let mut vault = match self.get(&Key::Vault(public.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Vault not found",
                ))
            }
        };

        let Some(new_collateral) = vault.collateral_rng.checked_add(amount) else {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Collateral amount overflow",
            ));
        };

        player.balances.chips -= amount;
        vault.collateral_rng = new_collateral;

        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let vault_snapshot = vault.clone();
        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::Vault(public.clone()), Value::Vault(vault));

        Ok(vec![Event::CollateralDeposited {
            player: public.clone(),
            amount,
            new_collateral,
            vault: vault_snapshot,
            player_balances,
        }])
    }

    pub(in crate::layer) async fn handle_borrow_usdt(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if amount == 0 {
            return Ok(vec![]);
        }

        let mut vault = match self.get(&Key::Vault(public.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => return Ok(vec![]),
        };

        let mut house = self.get_or_init_house().await?;
        let policy = self.get_or_init_policy().await?;
        let oracle = self.get_or_init_oracle_state().await?;
        let now = current_time_sec(self.seed.view);
        let interest = accrue_vault_debt(&mut vault, &mut house, now, &policy);
        self.allocate_savings_rewards(interest).await?;

        let amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        let (price_numerator, price_denominator) = rng_price_ratio(
            amm.reserve_rng,
            amm.reserve_vusdt,
            amm.bootstrap_price_vusdt_numerator,
            amm.bootstrap_price_rng_denominator,
        );
        let (price_numerator, price_denominator) = effective_price_ratio_for_borrow(
            &policy,
            &oracle,
            now,
            price_numerator,
            price_denominator,
        );

        let mut updated_player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(player)) => Some(player),
            _ => None,
        };
        if let Some(player) = updated_player.as_mut() {
            if player.profile.created_ts == 0 {
                player.profile.created_ts = now;
            }
        }
        let staker = match self.get(&Key::Staker(public.clone())).await? {
            Some(Value::Staker(s)) => Some(s),
            _ => None,
        };
        let max_ltv_bps = match updated_player.as_ref() {
            Some(player) if is_tier2(player, now, staker.as_ref()) => {
                policy.max_ltv_bps_mature
            }
            _ => policy.max_ltv_bps_new,
        };

        // LTV Calculation: Max Debt = (Collateral * Price) * max_ltv_bps
        let Some(new_debt) = vault.debt_vusdt.checked_add(amount) else {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Debt amount overflow",
            ));
        };

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

        if policy.debt_ceiling_bps == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Debt ceiling reached",
            ));
        }
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

        // Update Vault
        vault.debt_vusdt = new_debt;
        house.total_vusdt_debt = new_total_debt;

        // Mint vUSDT to Player (if the player exists).
        if let Some(player) = updated_player.as_mut() {
            let Some(new_balance) = player.balances.vusdt_balance.checked_add(amount) else {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "vUSDT balance overflow",
                ));
            };
            player.balances.vusdt_balance = new_balance;
        }

        let player_balances = updated_player
            .as_ref()
            .map(nullspace_types::casino::PlayerBalanceSnapshot::from_player)
            .unwrap_or_default();
        let vault_snapshot = vault.clone();
        self.insert(Key::Vault(public.clone()), Value::Vault(vault));
        self.insert(Key::House, Value::House(house));
        if let Some(player) = updated_player {
            self.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );
        }
        Ok(vec![Event::VusdtBorrowed {
            player: public.clone(),
            amount,
            new_debt,
            vault: vault_snapshot,
            player_balances,
        }])
    }

    pub(in crate::layer) async fn handle_repay_usdt(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if amount == 0 {
            return Ok(vec![]);
        }

        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        let mut vault = match self.get(&Key::Vault(public.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => return Ok(vec![]),
        };

        let mut house = self.get_or_init_house().await?;
        let policy = self.get_or_init_policy().await?;
        let now = current_time_sec(self.seed.view);
        let interest = accrue_vault_debt(&mut vault, &mut house, now, &policy);
        self.allocate_savings_rewards(interest).await?;

        if player.balances.vusdt_balance < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient vUSDT",
            ));
        }

        let actual_repay = amount.min(vault.debt_vusdt);

        player.balances.vusdt_balance -= actual_repay;
        vault.debt_vusdt -= actual_repay;
        let new_debt = vault.debt_vusdt;
        house.total_vusdt_debt = house.total_vusdt_debt.saturating_sub(actual_repay);

        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let vault_snapshot = vault.clone();
        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::Vault(public.clone()), Value::Vault(vault));
        self.insert(Key::House, Value::House(house));

        Ok(vec![Event::VusdtRepaid {
            player: public.clone(),
            amount: actual_repay,
            new_debt,
            vault: vault_snapshot,
            player_balances,
        }])
    }

    pub(in crate::layer) async fn handle_swap(
        &mut self,
        public: &PublicKey,
        mut amount_in: u64,
        min_amount_out: u64,
        is_buying_rng: bool,
    ) -> anyhow::Result<Vec<Event>> {
        let original_amount_in = amount_in;
        let mut amm = self.get_or_init_amm().await?;
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if amount_in == 0 {
            return Ok(vec![]);
        }

        let policy = self.get_or_init_policy().await?;
        let now = current_time_sec(self.seed.view);
        let current_day = now / 86_400;
        reset_daily_flow_if_needed(&mut player, current_day);

        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }

        if amm.reserve_rng == 0 || amm.reserve_vusdt == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "AMM has zero liquidity",
            ));
        }

        let mut daily_sell_after = player.session.daily_net_sell;
        let mut daily_buy_after = player.session.daily_net_buy;
        let mut sell_tax_bps = amm.sell_tax_basis_points;

        if is_buying_rng {
            let max_by_balance = (player.balances.vusdt_balance as u128)
                .saturating_mul(policy.max_daily_buy_bps_balance as u128)
                .checked_div(BASIS_POINTS_SCALE)
                .unwrap_or(0) as u64;
            let max_by_pool = (amm.reserve_vusdt as u128)
                .saturating_mul(policy.max_daily_buy_bps_pool as u128)
                .checked_div(BASIS_POINTS_SCALE)
                .unwrap_or(0) as u64;
            let mut allowed = max_by_balance.min(max_by_pool);
            if allowed == 0
                && policy.max_daily_buy_bps_balance > 0
                && policy.max_daily_buy_bps_pool > 0
                && player.balances.vusdt_balance > 0
                && amm.reserve_vusdt > 0
            {
                allowed = 1;
            }
            daily_buy_after = player.session.daily_net_buy.saturating_add(amount_in);
            if allowed > 0 && daily_buy_after > allowed {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Daily buy limit exceeded",
                ));
            }
        } else {
            let max_by_balance = (player.balances.chips as u128)
                .saturating_mul(policy.max_daily_sell_bps_balance as u128)
                .checked_div(BASIS_POINTS_SCALE)
                .unwrap_or(0) as u64;
            let max_by_pool = (amm.reserve_rng as u128)
                .saturating_mul(policy.max_daily_sell_bps_pool as u128)
                .checked_div(BASIS_POINTS_SCALE)
                .unwrap_or(0) as u64;
            let mut allowed = max_by_balance.min(max_by_pool);
            if allowed == 0
                && policy.max_daily_sell_bps_balance > 0
                && policy.max_daily_sell_bps_pool > 0
                && player.balances.chips > 0
                && amm.reserve_rng > 0
            {
                allowed = 1;
            }
            daily_sell_after = player
                .session
                .daily_net_sell
                .saturating_add(original_amount_in);
            if allowed > 0 && daily_sell_after > allowed {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Daily sell limit exceeded",
                ));
            }
            sell_tax_bps = dynamic_sell_tax_bps(&policy, &amm, daily_sell_after);
        }

        // Apply Sell Tax (if Selling RNG)
        let mut burned_amount = 0;
        if !is_buying_rng {
            burned_amount =
                (amount_in as u128 * sell_tax_bps as u128 / BASIS_POINTS_SCALE) as u64;
            if burned_amount > 0 {
                // Deduct tax from input amount
                let Some(net_amount_in) = amount_in.checked_sub(burned_amount) else {
                    return Ok(invalid_amm_state(public));
                };
                amount_in = net_amount_in;
            }
        }

        // Reserves (u128 for safety)
        let (reserve_in, reserve_out) = if is_buying_rng {
            (amm.reserve_vusdt, amm.reserve_rng)
        } else {
            (amm.reserve_rng, amm.reserve_vusdt)
        };

        let Some(SwapQuote {
            amount_out,
            fee_amount,
        }) = constant_product_quote(amount_in, reserve_in, reserve_out, amm.fee_basis_points)
        else {
            return Ok(invalid_amm_state(public));
        };

        if amount_out < min_amount_out {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE, // Slippage
                "Slippage limit exceeded",
            ));
        }

        // Execute Swap
        if is_buying_rng {
            // Player gives vUSDT, gets RNG
            if player.balances.vusdt_balance < amount_in {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                    "Insufficient vUSDT",
                ));
            }
            let Some(vusdt_balance) = player.balances.vusdt_balance.checked_sub(amount_in) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.vusdt_balance = vusdt_balance;
            let Some(chips) = player.balances.chips.checked_add(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.chips = chips;
            player.session.daily_net_buy = daily_buy_after;

            let Some(reserve_vusdt) = amm.reserve_vusdt.checked_add(amount_in) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_vusdt = reserve_vusdt;
            let Some(reserve_rng) = amm.reserve_rng.checked_sub(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_rng = reserve_rng;
        } else {
            // Player gives RNG, gets vUSDT
            // Note: We deduct the FULL amount (incl tax) from player
            let total_deduction = original_amount_in;
            if player.balances.chips < total_deduction {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                    "Insufficient RNG",
                ));
            }

            let Some(chips) = player.balances.chips.checked_sub(total_deduction) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.chips = chips;
            let Some(vusdt_balance) = player.balances.vusdt_balance.checked_add(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.vusdt_balance = vusdt_balance;
            player.session.daily_net_sell = daily_sell_after;

            let Some(reserve_rng) = amm.reserve_rng.checked_add(amount_in) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_rng = reserve_rng; // Add net amount (after tax) to reserves
            let Some(reserve_vusdt) = amm.reserve_vusdt.checked_sub(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_vusdt = reserve_vusdt;

        }

        let mut house = self.get_or_init_house().await?;
        if burned_amount > 0 {
            let Some(total_burned) = house.total_burned.checked_add(burned_amount) else {
                return Ok(invalid_amm_state(public));
            };
            house.total_burned = total_burned;
        }
        if fee_amount > 0 {
            let Some(accumulated_fees) = house.accumulated_fees.checked_add(fee_amount) else {
                return Ok(invalid_amm_state(public));
            };
            house.accumulated_fees = accumulated_fees;
        }
        let house_snapshot = house.clone();
        self.insert(Key::House, Value::House(house));

        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let amm_snapshot = amm.clone();
        let event = Event::AmmSwapped {
            player: public.clone(),
            is_buying_rng,
            amount_in: original_amount_in,
            amount_out,
            fee_amount,
            burned_amount,
            reserve_rng: amm.reserve_rng,
            reserve_vusdt: amm.reserve_vusdt,
            amm: amm_snapshot,
            player_balances,
            house: house_snapshot,
        };

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::AmmPool, Value::AmmPool(amm));

        Ok(vec![event])
    }

    pub(in crate::layer) async fn handle_add_liquidity(
        &mut self,
        public: &PublicKey,
        rng_amount: u64,
        usdt_amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if rng_amount == 0 || usdt_amount == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Zero liquidity not allowed",
            ));
        }

        if player.balances.chips < rng_amount || player.balances.vusdt_balance < usdt_amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient funds",
            ));
        }

        let lp_balance = self.get_lp_balance(public).await?;

        // Initial liquidity?
        let mut shares_minted = if amm.total_shares == 0 {
            // Sqrt(x*y)
            let val = (rng_amount as u128) * (usdt_amount as u128);
            Self::integer_sqrt(val)
        } else {
            // Proportional to current reserves
            if amm.reserve_rng == 0 || amm.reserve_vusdt == 0 {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "AMM has zero liquidity",
                ));
            }
            let share_a = (rng_amount as u128 * amm.total_shares as u128) / amm.reserve_rng as u128;
            let share_b =
                (usdt_amount as u128 * amm.total_shares as u128) / amm.reserve_vusdt as u128;
            share_a.min(share_b) as u64
        };

        // Lock a minimum amount of LP shares on first deposit so reserves can never be fully drained.
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

        if shares_minted == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Deposit too small",
            ));
        }

        let Some(chips) = player.balances.chips.checked_sub(rng_amount) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.chips = chips;
        let Some(vusdt_balance) = player.balances.vusdt_balance.checked_sub(usdt_amount) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.vusdt_balance = vusdt_balance;

        let Some(reserve_rng) = amm.reserve_rng.checked_add(rng_amount) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_rng = reserve_rng;
        let Some(reserve_vusdt) = amm.reserve_vusdt.checked_add(usdt_amount) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_vusdt = reserve_vusdt;
        let Some(total_shares) = amm.total_shares.checked_add(shares_minted) else {
            return Ok(invalid_amm_state(public));
        };
        amm.total_shares = total_shares;

        let Some(new_lp_balance) = lp_balance.checked_add(shares_minted) else {
            return Ok(invalid_amm_state(public));
        };

        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let amm_snapshot = amm.clone();
        let event = Event::LiquidityAdded {
            player: public.clone(),
            rng_amount,
            vusdt_amount: usdt_amount,
            shares_minted,
            total_shares: amm.total_shares,
            reserve_rng: amm.reserve_rng,
            reserve_vusdt: amm.reserve_vusdt,
            lp_balance: new_lp_balance,
            amm: amm_snapshot,
            player_balances,
        };

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::AmmPool, Value::AmmPool(amm));
        self.insert(
            Key::LpBalance(public.clone()),
            Value::LpBalance(new_lp_balance),
        );

        Ok(vec![event])
    }

    pub(in crate::layer) async fn handle_remove_liquidity(
        &mut self,
        public: &PublicKey,
        shares: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if shares == 0 {
            return Ok(vec![]);
        }

        let mut amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        if amm.total_shares == 0 || shares > amm.total_shares {
            return Ok(vec![]);
        }

        let lp_balance = self.get_lp_balance(public).await?;
        if shares > lp_balance {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Not enough LP shares",
            ));
        }

        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        // Calculate amounts out proportionally
        let amount_rng =
            ((shares as u128 * amm.reserve_rng as u128) / amm.total_shares as u128) as u64;
        let amount_vusd =
            ((shares as u128 * amm.reserve_vusdt as u128) / amm.total_shares as u128) as u64;

        let Some(reserve_rng) = amm.reserve_rng.checked_sub(amount_rng) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_rng = reserve_rng;
        let Some(reserve_vusdt) = amm.reserve_vusdt.checked_sub(amount_vusd) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_vusdt = reserve_vusdt;
        let Some(total_shares) = amm.total_shares.checked_sub(shares) else {
            return Ok(invalid_amm_state(public));
        };
        amm.total_shares = total_shares;

        let Some(chips) = player.balances.chips.checked_add(amount_rng) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.chips = chips;
        let Some(vusdt_balance) = player.balances.vusdt_balance.checked_add(amount_vusd) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.vusdt_balance = vusdt_balance;

        let Some(new_lp_balance) = lp_balance.checked_sub(shares) else {
            return Ok(invalid_amm_state(public));
        };

        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let amm_snapshot = amm.clone();
        let event = Event::LiquidityRemoved {
            player: public.clone(),
            rng_amount: amount_rng,
            vusdt_amount: amount_vusd,
            shares_burned: shares,
            total_shares: amm.total_shares,
            reserve_rng: amm.reserve_rng,
            reserve_vusdt: amm.reserve_vusdt,
            lp_balance: new_lp_balance,
            amm: amm_snapshot,
            player_balances,
        };

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::AmmPool, Value::AmmPool(amm));
        self.insert(
            Key::LpBalance(public.clone()),
            Value::LpBalance(new_lp_balance),
        );

        Ok(vec![event])
    }

    pub(in crate::layer) async fn handle_seed_amm(
        &mut self,
        public: &PublicKey,
        rng_amount: u64,
        usdt_amount: u64,
        bootstrap_price_vusdt_numerator: u64,
        bootstrap_price_rng_denominator: u64,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if rng_amount == 0 || usdt_amount == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Zero bootstrap liquidity not allowed",
            ));
        }
        if bootstrap_price_rng_denominator == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Invalid bootstrap price",
            ));
        }

        let mut amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        if amm.total_shares != 0 || amm.reserve_rng != 0 || amm.reserve_vusdt != 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "AMM already seeded",
            ));
        }

        let shares_minted = Self::integer_sqrt((rng_amount as u128) * (usdt_amount as u128));
        if shares_minted <= MINIMUM_LIQUIDITY {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Initial liquidity too small",
            ));
        }

        amm.reserve_rng = rng_amount;
        amm.reserve_vusdt = usdt_amount;
        amm.total_shares = shares_minted;
        amm.bootstrap_price_vusdt_numerator = bootstrap_price_vusdt_numerator;
        amm.bootstrap_price_rng_denominator = bootstrap_price_rng_denominator;
        amm.bootstrap_finalized = false;
        amm.bootstrap_final_price_vusdt_numerator = 0;
        amm.bootstrap_final_price_rng_denominator = 0;
        amm.bootstrap_finalized_ts = 0;

        let mut house = self.get_or_init_house().await?;
        if usdt_amount > 0 {
            house.total_vusdt_debt = house.total_vusdt_debt.saturating_add(usdt_amount);
        }

        let amm_snapshot = amm.clone();
        let house_snapshot = house.clone();
        self.insert(Key::AmmPool, Value::AmmPool(amm));
        self.insert(Key::House, Value::House(house));

        Ok(vec![Event::AmmBootstrapped {
            admin: public.clone(),
            rng_amount,
            vusdt_amount: usdt_amount,
            shares_minted,
            reserve_rng: amm_snapshot.reserve_rng,
            reserve_vusdt: amm_snapshot.reserve_vusdt,
            bootstrap_price_vusdt_numerator: amm_snapshot.bootstrap_price_vusdt_numerator,
            bootstrap_price_rng_denominator: amm_snapshot.bootstrap_price_rng_denominator,
            amm: amm_snapshot,
            house: house_snapshot,
        }])
    }

    pub(in crate::layer) async fn handle_finalize_amm_bootstrap(
        &mut self,
        public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        let mut amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        if amm.bootstrap_finalized {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "AMM bootstrap already finalized",
            ));
        }

        let (price_vusdt_numerator, price_rng_denominator) = if amm.reserve_rng > 0 {
            (amm.reserve_vusdt, amm.reserve_rng)
        } else {
            (
                amm.bootstrap_price_vusdt_numerator,
                amm.bootstrap_price_rng_denominator,
            )
        };
        if price_rng_denominator == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Invalid bootstrap price",
            ));
        }

        let finalized_ts = current_time_sec(self.seed.view);
        amm.bootstrap_finalized = true;
        amm.bootstrap_final_price_vusdt_numerator = price_vusdt_numerator;
        amm.bootstrap_final_price_rng_denominator = price_rng_denominator;
        amm.bootstrap_finalized_ts = finalized_ts;

        let amm_snapshot = amm.clone();
        self.insert(Key::AmmPool, Value::AmmPool(amm));

        Ok(vec![Event::AmmBootstrapFinalized {
            admin: public.clone(),
            price_vusdt_numerator,
            price_rng_denominator,
            finalized_ts,
            amm: amm_snapshot,
        }])
    }

    pub(in crate::layer) async fn handle_liquidate_vault(
        &mut self,
        public: &PublicKey,
        target: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        let mut liquidator = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(player)) => player,
            _ => return Ok(vec![]),
        };

        let mut vault = match self.get(&Key::Vault(target.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Vault not found",
                ))
            }
        };

        let mut house = self.get_or_init_house().await?;
        let policy = self.get_or_init_policy().await?;
        let oracle = self.get_or_init_oracle_state().await?;
        let now = current_time_sec(self.seed.view);
        let interest = accrue_vault_debt(&mut vault, &mut house, now, &policy);
        self.allocate_savings_rewards(interest).await?;

        if vault.debt_vusdt == 0 || vault.collateral_rng == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Nothing to liquidate",
            ));
        }

        let amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        let (price_numerator, price_denominator) = rng_price_ratio(
            amm.reserve_rng,
            amm.reserve_vusdt,
            amm.bootstrap_price_vusdt_numerator,
            amm.bootstrap_price_rng_denominator,
        );
        let (price_numerator, price_denominator) = effective_price_ratio_for_liquidation(
            &policy,
            &oracle,
            now,
            price_numerator,
            price_denominator,
        );
        let (price_numerator, price_denominator) = effective_price_ratio_for_liquidation(
            &policy,
            &oracle,
            now,
            price_numerator,
            price_denominator,
        );
        if price_numerator == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Invalid price for liquidation",
            ));
        }

        let collateral_value = (vault.collateral_rng as u128)
            .saturating_mul(price_numerator)
            .checked_div(price_denominator)
            .unwrap_or(0);
        if collateral_value == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Collateral has zero value",
            ));
        }

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
        if repay_amount == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Nothing to liquidate",
            ));
        }

        let penalty_bps = policy.liquidation_penalty_bps as u128;
        let max_repay = collateral_value
            .saturating_mul(BASIS_POINTS_SCALE)
            .checked_div(BASIS_POINTS_SCALE.saturating_add(penalty_bps))
            .unwrap_or(0);
        if (repay_amount as u128) > max_repay {
            repay_amount = max_repay as u64;
        }
        if repay_amount == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Nothing to liquidate",
            ));
        }

        if liquidator.balances.vusdt_balance < repay_amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient vUSDT",
            ));
        }

        let seize_value = (repay_amount as u128)
            .saturating_mul(BASIS_POINTS_SCALE.saturating_add(penalty_bps))
            .checked_div(BASIS_POINTS_SCALE)
            .unwrap_or(0);
        let mut collateral_seized = seize_value
            .saturating_mul(price_denominator)
            .checked_div(price_numerator)
            .unwrap_or(0) as u64;
        if collateral_seized > vault.collateral_rng {
            collateral_seized = vault.collateral_rng;
        }

        let reward_value = (repay_amount as u128)
            .saturating_mul(
                BASIS_POINTS_SCALE.saturating_add(policy.liquidation_reward_bps as u128),
            )
            .checked_div(BASIS_POINTS_SCALE)
            .unwrap_or(0);
        let mut collateral_to_liquidator = reward_value
            .saturating_mul(price_denominator)
            .checked_div(price_numerator)
            .unwrap_or(0) as u64;
        if collateral_to_liquidator > collateral_seized {
            collateral_to_liquidator = collateral_seized;
        }

        let penalty_to_house = (repay_amount as u128)
            .saturating_mul(policy.liquidation_stability_bps as u128)
            .checked_div(BASIS_POINTS_SCALE)
            .unwrap_or(0) as u64;

        liquidator.balances.vusdt_balance = liquidator
            .balances
            .vusdt_balance
            .saturating_sub(repay_amount);
        liquidator.balances.chips = liquidator
            .balances
            .chips
            .saturating_add(collateral_to_liquidator);

        vault.debt_vusdt = vault.debt_vusdt.saturating_sub(repay_amount);
        vault.collateral_rng = vault.collateral_rng.saturating_sub(collateral_seized);

        house.total_vusdt_debt = house.total_vusdt_debt.saturating_sub(repay_amount);
        if penalty_to_house > 0 {
            house.recovery_pool_vusdt = house
                .recovery_pool_vusdt
                .saturating_add(penalty_to_house);
        }

        let remaining_debt = vault.debt_vusdt;
        let remaining_collateral = vault.collateral_rng;

        self.insert(Key::House, Value::House(house));
        self.insert(Key::Vault(target.clone()), Value::Vault(vault));
        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(liquidator),
        );

        Ok(vec![Event::VaultLiquidated {
            liquidator: public.clone(),
            target: target.clone(),
            repay_amount,
            collateral_seized,
            remaining_debt,
            remaining_collateral,
            penalty_to_house,
        }])
    }

    pub(in crate::layer) async fn handle_set_policy(
        &mut self,
        public: &PublicKey,
        policy: &nullspace_types::casino::PolicyState,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if let Err(message) = validate_policy(policy) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                message,
            ));
        }

        self.insert(Key::Policy, Value::Policy(policy.clone()));
        Ok(vec![Event::PolicyUpdated {
            policy: policy.clone(),
        }])
    }

    pub(in crate::layer) async fn handle_update_oracle(
        &mut self,
        public: &PublicKey,
        price_vusdt_numerator: u64,
        price_rng_denominator: u64,
        updated_ts: u64,
        source: &[u8],
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if source.len() > MAX_ORACLE_SOURCE_BYTES {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Oracle source too long",
            ));
        }
        let clearing = price_vusdt_numerator == 0 && price_rng_denominator == 0;
        if !clearing && (price_vusdt_numerator == 0 || price_rng_denominator == 0) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Oracle price must be non-zero",
            ));
        }

        let now = current_time_sec(self.seed.view);
        let oracle = nullspace_types::casino::OracleState {
            price_vusdt_numerator,
            price_rng_denominator,
            updated_ts: if updated_ts == 0 { now } else { updated_ts },
            source: source.to_vec(),
        };

        self.insert(Key::OracleState, Value::OracleState(oracle.clone()));
        Ok(vec![Event::OracleUpdated {
            admin: public.clone(),
            oracle,
        }])
    }

    pub(in crate::layer) async fn handle_set_treasury(
        &mut self,
        public: &PublicKey,
        treasury: &nullspace_types::casino::TreasuryState,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if let Err(message) = validate_treasury(treasury) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                message,
            ));
        }

        self.insert(Key::Treasury, Value::Treasury(treasury.clone()));
        Ok(vec![Event::TreasuryUpdated {
            treasury: treasury.clone(),
        }])
    }

    pub(in crate::layer) async fn handle_set_treasury_vesting(
        &mut self,
        public: &PublicKey,
        vesting: &nullspace_types::casino::TreasuryVestingState,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        let treasury = self.get_or_init_treasury().await?;
        if let Err(message) = validate_treasury_vesting(&treasury, vesting) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                message,
            ));
        }

        self.insert(
            Key::TreasuryVesting,
            Value::TreasuryVesting(vesting.clone()),
        );
        Ok(vec![Event::TreasuryVestingUpdated {
            vesting: vesting.clone(),
        }])
    }

    pub(in crate::layer) async fn handle_release_treasury_allocation(
        &mut self,
        public: &PublicKey,
        bucket: &nullspace_types::casino::TreasuryBucket,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if amount == 0 {
            return Ok(vec![]);
        }

        let treasury = self.get_or_init_treasury().await?;
        let mut vesting = self.get_or_init_treasury_vesting().await?;
        let now = current_time_sec(self.seed.view);

        let (schedule, total_allocation) = match bucket {
            nullspace_types::casino::TreasuryBucket::Auction => {
                (&mut vesting.auction, treasury.auction_allocation_rng)
            }
            nullspace_types::casino::TreasuryBucket::Liquidity => {
                (&mut vesting.liquidity, treasury.liquidity_reserve_rng)
            }
            nullspace_types::casino::TreasuryBucket::Bonus => {
                (&mut vesting.bonus, treasury.bonus_pool_rng)
            }
            nullspace_types::casino::TreasuryBucket::Player => {
                (&mut vesting.player, treasury.player_allocation_rng)
            }
            nullspace_types::casino::TreasuryBucket::Treasury => {
                (&mut vesting.treasury, treasury.treasury_allocation_rng)
            }
            nullspace_types::casino::TreasuryBucket::Team => {
                (&mut vesting.team, treasury.team_allocation_rng)
            }
        };

        let vested_total = vested_amount(total_allocation, schedule, now);
        let available = vested_total.saturating_sub(schedule.released);
        if amount > available {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Treasury allocation not vested",
            ));
        }

        schedule.released = schedule.released.saturating_add(amount);
        let total_released = schedule.released;
        self.insert(
            Key::TreasuryVesting,
            Value::TreasuryVesting(vesting),
        );

        Ok(vec![Event::TreasuryAllocationReleased {
            admin: public.clone(),
            bucket: *bucket,
            amount,
            total_released,
            total_vested: vested_total,
            total_allocation,
        }])
    }

    pub(in crate::layer) async fn handle_fund_recovery_pool(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if amount == 0 {
            return Ok(vec![]);
        }

        let mut house = self.get_or_init_house().await?;
        house.recovery_pool_vusdt = house.recovery_pool_vusdt.saturating_add(amount);
        let new_balance = house.recovery_pool_vusdt;
        self.insert(Key::House, Value::House(house));

        Ok(vec![Event::RecoveryPoolFunded {
            amount,
            new_balance,
        }])
    }

    pub(in crate::layer) async fn handle_retire_vault_debt(
        &mut self,
        public: &PublicKey,
        target: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if amount == 0 {
            return Ok(vec![]);
        }

        let mut vault = match self.get(&Key::Vault(target.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Vault not found",
                ))
            }
        };

        let mut house = self.get_or_init_house().await?;
        let policy = self.get_or_init_policy().await?;
        let now = current_time_sec(self.seed.view);
        let interest = accrue_vault_debt(&mut vault, &mut house, now, &policy);
        self.allocate_savings_rewards(interest).await?;

        let available = house.recovery_pool_vusdt.min(vault.debt_vusdt);
        let retire_amount = amount.min(available);
        if retire_amount == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "No debt to retire",
            ));
        }

        vault.debt_vusdt = vault.debt_vusdt.saturating_sub(retire_amount);
        house.total_vusdt_debt = house.total_vusdt_debt.saturating_sub(retire_amount);
        house.recovery_pool_vusdt = house.recovery_pool_vusdt.saturating_sub(retire_amount);
        house.recovery_pool_retired = house.recovery_pool_retired.saturating_add(retire_amount);

        let new_debt = vault.debt_vusdt;
        let pool_balance = house.recovery_pool_vusdt;

        self.insert(Key::Vault(target.clone()), Value::Vault(vault));
        self.insert(Key::House, Value::House(house));

        Ok(vec![Event::RecoveryPoolRetired {
            target: target.clone(),
            amount: retire_amount,
            new_debt,
            pool_balance,
        }])
    }

    pub(in crate::layer) async fn handle_retire_worst_vault_debt(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        match admin_public_key() {
            Some(admin_key) if *public == admin_key => {}
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_UNAUTHORIZED,
                    "Unauthorized admin instruction",
                ))
            }
        }

        if amount == 0 {
            return Ok(vec![]);
        }

        let registry = self.get_or_init_vault_registry().await?;
        if registry.vaults.is_empty() {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "No vaults registered",
            ));
        }

        let policy = self.get_or_init_policy().await?;
        let oracle = self.get_or_init_oracle_state().await?;
        let now = current_time_sec(self.seed.view);
        let amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        let (price_numerator, price_denominator) = rng_price_ratio(
            amm.reserve_rng,
            amm.reserve_vusdt,
            amm.bootstrap_price_vusdt_numerator,
            amm.bootstrap_price_rng_denominator,
        );
        let (price_numerator, price_denominator) = effective_price_ratio_for_liquidation(
            &policy,
            &oracle,
            now,
            price_numerator,
            price_denominator,
        );

        let mut selected: Option<(PublicKey, u128, u64)> = None;
        for pk in &registry.vaults {
            let vault = match self.get(&Key::Vault(pk.clone())).await? {
                Some(Value::Vault(v)) => v,
                _ => continue,
            };
            if vault.debt_vusdt == 0 {
                continue;
            }

            let collateral_value = if price_denominator == 0 {
                0
            } else {
                (vault.collateral_rng as u128)
                    .saturating_mul(price_numerator)
                    .checked_div(price_denominator)
                    .unwrap_or(0)
            };
            let ltv_bps = if collateral_value == 0 {
                u128::MAX
            } else {
                (vault.debt_vusdt as u128)
                    .saturating_mul(BASIS_POINTS_SCALE)
                    .checked_div(collateral_value)
                    .unwrap_or(u128::MAX)
            };
            let last_ts = vault.last_accrual_ts;

            match selected.as_ref() {
                None => selected = Some((pk.clone(), ltv_bps, last_ts)),
                Some((_, best_ltv, best_ts)) => {
                    if ltv_bps > *best_ltv || (ltv_bps == *best_ltv && last_ts < *best_ts) {
                        selected = Some((pk.clone(), ltv_bps, last_ts));
                    }
                }
            }
        }

        let Some((target, _, _)) = selected else {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "No vault debt to retire",
            ));
        };

        self.handle_retire_vault_debt(public, &target, amount).await
    }

    pub(in crate::layer) async fn handle_savings_deposit(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if amount == 0 {
            return Ok(vec![]);
        }

        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if player.balances.vusdt_balance < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient vUSDT",
            ));
        }

        let mut pool = self.get_or_init_savings_pool().await?;
        let mut balance = self.get_or_init_savings_balance(public).await?;
        distribute_savings_rewards(&mut pool);
        if let Err(err) = settle_savings_rewards(&mut balance, &pool) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                err,
            ));
        }

        player.balances.vusdt_balance -= amount;
        balance.deposit_balance = balance.deposit_balance.saturating_add(amount);
        pool.total_deposits = pool.total_deposits.saturating_add(amount);
        if let Err(err) = sync_savings_reward_debt(&mut balance, &pool) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                err,
            ));
        }

        let new_balance = balance.deposit_balance;
        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let balance_snapshot = balance.clone();
        let pool_snapshot = pool.clone();

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(
            Key::SavingsBalance(public.clone()),
            Value::SavingsBalance(balance),
        );
        self.insert(Key::SavingsPool, Value::SavingsPool(pool));

        Ok(vec![Event::SavingsDeposited {
            player: public.clone(),
            amount,
            new_balance,
            savings_balance: balance_snapshot,
            pool: pool_snapshot,
            player_balances,
        }])
    }

    pub(in crate::layer) async fn handle_savings_withdraw(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if amount == 0 {
            return Ok(vec![]);
        }

        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        let mut pool = self.get_or_init_savings_pool().await?;
        let mut balance = self.get_or_init_savings_balance(public).await?;

        if balance.deposit_balance < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient savings balance",
            ));
        }

        distribute_savings_rewards(&mut pool);
        if let Err(err) = settle_savings_rewards(&mut balance, &pool) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                err,
            ));
        }

        balance.deposit_balance = balance.deposit_balance.saturating_sub(amount);
        pool.total_deposits = pool.total_deposits.saturating_sub(amount);
        if let Err(err) = sync_savings_reward_debt(&mut balance, &pool) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                err,
            ));
        }

        player.balances.vusdt_balance = player.balances.vusdt_balance.saturating_add(amount);

        let new_balance = balance.deposit_balance;
        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let balance_snapshot = balance.clone();
        let pool_snapshot = pool.clone();

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(
            Key::SavingsBalance(public.clone()),
            Value::SavingsBalance(balance),
        );
        self.insert(Key::SavingsPool, Value::SavingsPool(pool));

        Ok(vec![Event::SavingsWithdrawn {
            player: public.clone(),
            amount,
            new_balance,
            savings_balance: balance_snapshot,
            pool: pool_snapshot,
            player_balances,
        }])
    }

    pub(in crate::layer) async fn handle_savings_claim(
        &mut self,
        public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        let mut pool = self.get_or_init_savings_pool().await?;
        let mut balance = self.get_or_init_savings_balance(public).await?;

        distribute_savings_rewards(&mut pool);
        if let Err(err) = settle_savings_rewards(&mut balance, &pool) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                err,
            ));
        }

        let available = pool
            .total_rewards_accrued
            .saturating_sub(pool.total_rewards_paid);
        let payout = balance.unclaimed_rewards.min(available);
        if payout == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "No savings rewards available",
            ));
        }

        balance.unclaimed_rewards = balance.unclaimed_rewards.saturating_sub(payout);
        pool.total_rewards_paid = pool.total_rewards_paid.saturating_add(payout);
        player.balances.vusdt_balance = player.balances.vusdt_balance.saturating_add(payout);

        let player_balances =
            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        let balance_snapshot = balance.clone();
        let pool_snapshot = pool.clone();

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(
            Key::SavingsBalance(public.clone()),
            Value::SavingsBalance(balance),
        );
        self.insert(Key::SavingsPool, Value::SavingsPool(pool));

        Ok(vec![Event::SavingsRewardsClaimed {
            player: public.clone(),
            amount: payout,
            savings_balance: balance_snapshot,
            pool: pool_snapshot,
            player_balances,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use commonware_runtime::deterministic::Runner;
    use commonware_runtime::Runner as _;

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

    #[test]
    fn borrow_usdt_uses_bootstrap_price_when_no_reserves() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (private, public) = create_account_keypair(1);

            let mut state = MockState::new();
            state.data.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(nullspace_types::casino::Player::new("Alice".to_string())),
            );
            state.data.insert(
                Key::Vault(public.clone()),
                Value::Vault(nullspace_types::casino::Vault {
                    collateral_rng: 10,
                    debt_vusdt: 0,
                    last_accrual_ts: 0,
                }),
            );

            let mut amm = nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            );
            amm.bootstrap_price_vusdt_numerator = 2;
            amm.bootstrap_price_rng_denominator = 1;
            state.data.insert(Key::AmmPool, Value::AmmPool(amm));

            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            // With a bootstrap price of 2 vUSDT per 1 RNG and 30% LTV, max debt is 6 vUSDT.
            let tx = Transaction::sign(&private, 0, Instruction::BorrowUSDT { amount: 6 });
            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");
            assert!(matches!(
                events.as_slice(),
                [Event::VusdtBorrowed {
                    player,
                    amount: 6,
                    new_debt: 6,
                    ..
                }] if player == &public
            ));

            // Borrowing any more must fail the LTV check.
            let tx = Transaction::sign(&private, 1, Instruction::BorrowUSDT { amount: 1 });
            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");
            assert!(matches!(
                events.as_slice(),
                [Event::CasinoError { message, .. }] if message == "Insufficient collateral (Max 30% LTV)"
            ));
        });
    }

    #[test]
    fn constant_product_quote_basic_no_fee_rounding() {
        let quote = constant_product_quote(100, 1_000, 1_000, 30).expect("quote");
        assert_eq!(
            quote,
            SwapQuote {
                amount_out: 90,
                fee_amount: 0
            }
        );
    }

    #[test]
    fn constant_product_quote_fee_applies_and_rounds_down() {
        let quote = constant_product_quote(10_000, 1_000_000, 1_000_000, 30).expect("quote");
        assert_eq!(quote.fee_amount, 30);
        assert_eq!(quote.amount_out, 9_871);
    }

    #[test]
    fn constant_product_quote_all_fee_yields_zero_out() {
        let quote = constant_product_quote(1_000, 1_000, 1_000, 10_000).expect("quote");
        assert_eq!(quote.fee_amount, 1_000);
        assert_eq!(quote.amount_out, 0);
    }

    #[test]
    fn constant_product_quote_denominator_zero_returns_none() {
        assert_eq!(constant_product_quote(0, 0, 0, 0), None);
    }

    #[test]
    fn constant_product_quote_rejects_fee_bps_over_10000() {
        assert_eq!(constant_product_quote(1, 1, 1, 10_001), None);
    }

    #[test]
    fn constant_product_quote_overflow_returns_none() {
        assert_eq!(
            constant_product_quote(u64::MAX, u64::MAX, u64::MAX, 0),
            None
        );
    }

    const TEST_NAMESPACE: &[u8] = b"test-namespace";

    struct MockState {
        data: std::collections::HashMap<Key, Value>,
    }

    impl MockState {
        fn new() -> Self {
            Self {
                data: std::collections::HashMap::new(),
            }
        }
    }

    impl State for MockState {
        async fn get(&self, key: &Key) -> Result<Option<Value>> {
            Ok(self.data.get(key).cloned())
        }

        async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
            self.data.insert(key, value);
            Ok(())
        }

        async fn delete(&mut self, key: &Key) -> Result<()> {
            self.data.remove(key);
            Ok(())
        }
    }

    #[test]
    fn sell_swap_insufficient_funds_does_not_increment_house_burn() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (private, public) = create_account_keypair(1);

            let mut state = MockState::new();

            let mut player = nullspace_types::casino::Player::new("Alice".to_string());
            player.balances.chips = 0;
            state.data.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );

            let mut amm = nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            );
            amm.reserve_rng = 1_000;
            amm.reserve_vusdt = 1_000;
            amm.total_shares = MINIMUM_LIQUIDITY.saturating_add(1_000);
            state.data.insert(Key::AmmPool, Value::AmmPool(amm));

            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let tx = Transaction::sign(
                &private,
                0,
                Instruction::Swap {
                    amount_in: 20,
                    min_amount_out: 0,
                    is_buying_rng: false,
                },
            );

            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");

            assert!(matches!(
                events.as_slice(),
                [Event::CasinoError { message, .. }] if message == "Insufficient RNG"
            ));

            assert!(
                layer.get(&Key::House).await.expect("get house").is_none(),
                "house state must not be created/mutated on failed swap"
            );
        });
    }

    #[test]
    fn sell_swap_slippage_does_not_increment_house_burn() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (private, public) = create_account_keypair(1);

            let mut state = MockState::new();

            let mut player = nullspace_types::casino::Player::new("Alice".to_string());
            player.balances.chips = 100;
            state.data.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );

            let mut amm = nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            );
            amm.reserve_rng = 1_000;
            amm.reserve_vusdt = 1_000;
            amm.total_shares = MINIMUM_LIQUIDITY.saturating_add(1_000);
            state.data.insert(Key::AmmPool, Value::AmmPool(amm));

            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let tx = Transaction::sign(
                &private,
                0,
                Instruction::Swap {
                    amount_in: 20,
                    min_amount_out: u64::MAX,
                    is_buying_rng: false,
                },
            );

            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");

            assert!(matches!(
                events.as_slice(),
                [Event::CasinoError { message, .. }] if message == "Slippage limit exceeded"
            ));

            assert!(
                layer.get(&Key::House).await.expect("get house").is_none(),
                "house state must not be created/mutated on failed swap"
            );
        });
    }
}
