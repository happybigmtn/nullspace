use bytes::{Buf, BufMut};
use commonware_codec::{EncodeSize, Error, FixedSize, Read, ReadExt, ReadRangeExt, Write};
use commonware_cryptography::ed25519::PublicKey;

use super::{
    AMM_BOOTSTRAP_PRICE_RNG_DENOMINATOR, AMM_BOOTSTRAP_PRICE_VUSDT_NUMERATOR,
    AMM_DEFAULT_SELL_TAX_BASIS_POINTS, FREEROLL_CREDIT_EXPIRY_SECS,
    FREEROLL_CREDIT_IMMEDIATE_BPS, FREEROLL_CREDIT_VEST_SECS,
    THREE_CARD_PROGRESSIVE_BASE_JACKPOT, UTH_PROGRESSIVE_BASE_JACKPOT,
};

const MAX_ORACLE_SOURCE_BYTES: usize = 64;

/// House state for the "Central Bank" model
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HouseState {
    pub current_epoch: u64,
    pub epoch_start_ts: u64,
    pub net_pnl: i128, // Net Profit/Loss for current epoch (House Edge - Player Wins)
    pub total_staked_amount: u64,
    pub total_voting_power: u128,
    pub accumulated_fees: u64, // Fees from AMM or other sources
    pub total_burned: u64,     // Total RNG burned via Sell Tax
    pub total_issuance: u64,   // Total freeroll credits minted
    pub total_vusdt_debt: u64, // Outstanding vUSDT debt (principal + accrued)
    pub stability_fees_accrued: u64,
    pub recovery_pool_vusdt: u64,
    pub recovery_pool_retired: u64,
    pub three_card_progressive_jackpot: u64,
    pub uth_progressive_jackpot: u64,

    // Staking reward accounting.
    //
    // `staking_reward_per_voting_power_x18` is an accumulator scaled by
    // `casino::STAKING_REWARD_SCALE` (1e18), enabling O(1) reward claims without iterating
    // over all stakers.
    pub staking_reward_per_voting_power_x18: u128,
    pub staking_reward_pool: u64,
    pub staking_reward_carry: u64,
}

impl HouseState {
    pub fn new(start_ts: u64) -> Self {
        Self {
            current_epoch: 0,
            epoch_start_ts: start_ts,
            net_pnl: 0,
            total_staked_amount: 0,
            total_voting_power: 0,
            accumulated_fees: 0,
            total_burned: 0,
            total_issuance: 0,
            total_vusdt_debt: 0,
            stability_fees_accrued: 0,
            recovery_pool_vusdt: 0,
            recovery_pool_retired: 0,
            three_card_progressive_jackpot: THREE_CARD_PROGRESSIVE_BASE_JACKPOT,
            uth_progressive_jackpot: UTH_PROGRESSIVE_BASE_JACKPOT,
            staking_reward_per_voting_power_x18: 0,
            staking_reward_pool: 0,
            staking_reward_carry: 0,
        }
    }
}

impl Write for HouseState {
    fn write(&self, writer: &mut impl BufMut) {
        self.current_epoch.write(writer);
        self.epoch_start_ts.write(writer);
        self.net_pnl.write(writer);
        self.total_staked_amount.write(writer);
        self.total_voting_power.write(writer);
        self.accumulated_fees.write(writer);
        self.total_burned.write(writer);
        self.total_issuance.write(writer);
        self.total_vusdt_debt.write(writer);
        self.stability_fees_accrued.write(writer);
        self.recovery_pool_vusdt.write(writer);
        self.recovery_pool_retired.write(writer);
        self.three_card_progressive_jackpot.write(writer);
        self.uth_progressive_jackpot.write(writer);
        self.staking_reward_per_voting_power_x18.write(writer);
        self.staking_reward_pool.write(writer);
        self.staking_reward_carry.write(writer);
    }
}

impl Read for HouseState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let current_epoch = u64::read(reader)?;
        let epoch_start_ts = u64::read(reader)?;
        let net_pnl = i128::read(reader)?;
        let total_staked_amount = u64::read(reader)?;
        let total_voting_power = u128::read(reader)?;
        let accumulated_fees = u64::read(reader)?;
        let total_burned = u64::read(reader)?;
        let total_issuance = u64::read(reader)?;
        let total_vusdt_debt = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };
        let stability_fees_accrued = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };
        let recovery_pool_vusdt = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };
        let recovery_pool_retired = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };

        // Optional extensions (backwards compatible with older stored HouseState values).
        let three_card_progressive_jackpot = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            THREE_CARD_PROGRESSIVE_BASE_JACKPOT
        };
        let uth_progressive_jackpot = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            UTH_PROGRESSIVE_BASE_JACKPOT
        };

        let staking_reward_per_voting_power_x18 = if reader.remaining() >= 16 {
            u128::read(reader)?
        } else {
            0
        };
        let staking_reward_pool = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };
        let staking_reward_carry = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };

        Ok(Self {
            current_epoch,
            epoch_start_ts,
            net_pnl,
            total_staked_amount,
            total_voting_power,
            accumulated_fees,
            total_burned,
            total_issuance,
            total_vusdt_debt,
            stability_fees_accrued,
            recovery_pool_vusdt,
            recovery_pool_retired,
            three_card_progressive_jackpot,
            uth_progressive_jackpot,
            staking_reward_per_voting_power_x18,
            staking_reward_pool,
            staking_reward_carry,
        })
    }
}

impl EncodeSize for HouseState {
    fn encode_size(&self) -> usize {
        self.current_epoch.encode_size()
            + self.epoch_start_ts.encode_size()
            + self.net_pnl.encode_size()
            + self.total_staked_amount.encode_size()
            + self.total_voting_power.encode_size()
            + self.accumulated_fees.encode_size()
            + self.total_burned.encode_size()
            + self.total_issuance.encode_size()
            + self.total_vusdt_debt.encode_size()
            + self.stability_fees_accrued.encode_size()
            + self.recovery_pool_vusdt.encode_size()
            + self.recovery_pool_retired.encode_size()
            + self.three_card_progressive_jackpot.encode_size()
            + self.uth_progressive_jackpot.encode_size()
            + self.staking_reward_per_voting_power_x18.encode_size()
            + self.staking_reward_pool.encode_size()
            + self.staking_reward_carry.encode_size()
    }
}

/// Staker state
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Staker {
    pub balance: u64,
    pub unlock_ts: u64,
    pub last_claim_epoch: u64,
    pub voting_power: u128,
    pub reward_debt_x18: u128,
    pub unclaimed_rewards: u64,
}

impl Write for Staker {
    fn write(&self, writer: &mut impl BufMut) {
        self.balance.write(writer);
        self.unlock_ts.write(writer);
        self.last_claim_epoch.write(writer);
        self.voting_power.write(writer);
        self.reward_debt_x18.write(writer);
        self.unclaimed_rewards.write(writer);
    }
}

impl Read for Staker {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let balance = u64::read(reader)?;
        let unlock_ts = u64::read(reader)?;
        let last_claim_epoch = u64::read(reader)?;
        let voting_power = u128::read(reader)?;

        let reward_debt_x18 = if reader.remaining() >= 16 {
            u128::read(reader)?
        } else {
            0
        };
        let unclaimed_rewards = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };

        Ok(Self {
            balance,
            unlock_ts,
            last_claim_epoch,
            voting_power,
            reward_debt_x18,
            unclaimed_rewards,
        })
    }
}

impl EncodeSize for Staker {
    fn encode_size(&self) -> usize {
        self.balance.encode_size()
            + self.unlock_ts.encode_size()
            + self.last_claim_epoch.encode_size()
            + self.voting_power.encode_size()
            + self.reward_debt_x18.encode_size()
            + self.unclaimed_rewards.encode_size()
    }
}

/// Vault state for CDP (Collateralized Debt Position)
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Vault {
    pub collateral_rng: u64,
    pub debt_vusdt: u64,
    pub last_accrual_ts: u64,
}

impl Write for Vault {
    fn write(&self, writer: &mut impl BufMut) {
        self.collateral_rng.write(writer);
        self.debt_vusdt.write(writer);
        self.last_accrual_ts.write(writer);
    }
}

impl Read for Vault {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            collateral_rng: u64::read(reader)?,
            debt_vusdt: u64::read(reader)?,
            last_accrual_ts: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for Vault {
    fn encode_size(&self) -> usize {
        self.collateral_rng.encode_size() + self.debt_vusdt.encode_size()
            + self.last_accrual_ts.encode_size()
    }
}

/// vUSDT savings pool state (funded by stability fees).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct SavingsPool {
    pub total_deposits: u64,
    pub reward_per_share_x18: u128,
    pub pending_rewards: u64,
    pub total_rewards_accrued: u64,
    pub total_rewards_paid: u64,
}

impl Write for SavingsPool {
    fn write(&self, writer: &mut impl BufMut) {
        self.total_deposits.write(writer);
        self.reward_per_share_x18.write(writer);
        self.pending_rewards.write(writer);
        self.total_rewards_accrued.write(writer);
        self.total_rewards_paid.write(writer);
    }
}

impl Read for SavingsPool {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            total_deposits: u64::read(reader)?,
            reward_per_share_x18: if reader.remaining() >= 16 {
                u128::read(reader)?
            } else {
                0
            },
            pending_rewards: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            total_rewards_accrued: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            total_rewards_paid: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for SavingsPool {
    fn encode_size(&self) -> usize {
        self.total_deposits.encode_size()
            + self.reward_per_share_x18.encode_size()
            + self.pending_rewards.encode_size()
            + self.total_rewards_accrued.encode_size()
            + self.total_rewards_paid.encode_size()
    }
}

/// Per-player savings balance and reward tracking.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct SavingsBalance {
    pub deposit_balance: u64,
    pub reward_debt_x18: u128,
    pub unclaimed_rewards: u64,
}

impl Write for SavingsBalance {
    fn write(&self, writer: &mut impl BufMut) {
        self.deposit_balance.write(writer);
        self.reward_debt_x18.write(writer);
        self.unclaimed_rewards.write(writer);
    }
}

impl Read for SavingsBalance {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            deposit_balance: u64::read(reader)?,
            reward_debt_x18: if reader.remaining() >= 16 {
                u128::read(reader)?
            } else {
                0
            },
            unclaimed_rewards: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for SavingsBalance {
    fn encode_size(&self) -> usize {
        self.deposit_balance.encode_size()
            + self.reward_debt_x18.encode_size()
            + self.unclaimed_rewards.encode_size()
    }
}

/// Registry of vault owners for recovery pool ordering and audits.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct VaultRegistry {
    pub vaults: Vec<PublicKey>,
}

impl Write for VaultRegistry {
    fn write(&self, writer: &mut impl BufMut) {
        self.vaults.write(writer);
    }
}

impl Read for VaultRegistry {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let mut vaults = Vec::<PublicKey>::read_range(reader, 0..=100_000)?;
        vaults.sort_unstable();
        vaults.dedup();
        Ok(Self { vaults })
    }
}

impl EncodeSize for VaultRegistry {
    fn encode_size(&self) -> usize {
        self.vaults.encode_size()
    }
}

/// Registry of player public keys for Phase 2 snapshots.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerRegistry {
    pub players: Vec<PublicKey>,
}

impl Write for PlayerRegistry {
    fn write(&self, writer: &mut impl BufMut) {
        self.players.write(writer);
    }
}

impl Read for PlayerRegistry {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let mut players = Vec::<PublicKey>::read_range(reader, 0..=500_000)?;
        players.sort_unstable();
        players.dedup();
        Ok(Self { players })
    }
}

impl EncodeSize for PlayerRegistry {
    fn encode_size(&self) -> usize {
        self.players.encode_size()
    }
}

/// AMM Pool state (Constant Product Market Maker)
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AmmPool {
    pub reserve_rng: u64,
    pub reserve_vusdt: u64,
    pub total_shares: u64,
    pub fee_basis_points: u16,      // e.g., 30 = 0.3%
    pub sell_tax_basis_points: u16, // e.g., 500 = 5%
    pub bootstrap_price_vusdt_numerator: u64,
    pub bootstrap_price_rng_denominator: u64,
    pub bootstrap_finalized: bool,
    pub bootstrap_final_price_vusdt_numerator: u64,
    pub bootstrap_final_price_rng_denominator: u64,
    pub bootstrap_finalized_ts: u64,
}

/// Policy configuration for economy controls.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyState {
    pub sell_tax_min_bps: u16,
    pub sell_tax_mid_bps: u16,
    pub sell_tax_max_bps: u16,
    pub sell_tax_outflow_low_bps: u16,
    pub sell_tax_outflow_mid_bps: u16,
    pub max_daily_sell_bps_balance: u16,
    pub max_daily_sell_bps_pool: u16,
    pub max_daily_buy_bps_balance: u16,
    pub max_daily_buy_bps_pool: u16,
    pub max_ltv_bps_new: u16,
    pub max_ltv_bps_mature: u16,
    pub liquidation_threshold_bps: u16,
    pub liquidation_target_bps: u16,
    pub liquidation_penalty_bps: u16,
    pub liquidation_reward_bps: u16,
    pub liquidation_stability_bps: u16,
    pub stability_fee_apr_bps: u16,
    pub debt_ceiling_bps: u16,
    pub credit_immediate_bps: u16,
    pub credit_vest_secs: u64,
    pub credit_expiry_secs: u64,
    pub bridge_paused: bool,
    pub bridge_daily_limit: u64,
    pub bridge_daily_limit_per_account: u64,
    pub bridge_min_withdraw: u64,
    pub bridge_max_withdraw: u64,
    pub bridge_delay_secs: u64,
    pub oracle_enabled: bool,
    pub oracle_max_deviation_bps: u16,
    pub oracle_stale_secs: u64,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            sell_tax_min_bps: 300,
            sell_tax_mid_bps: 500,
            sell_tax_max_bps: 1000,
            sell_tax_outflow_low_bps: 100,
            sell_tax_outflow_mid_bps: 500,
            max_daily_sell_bps_balance: 300,
            max_daily_sell_bps_pool: 15,
            max_daily_buy_bps_balance: 600,
            max_daily_buy_bps_pool: 30,
            max_ltv_bps_new: 3000,
            max_ltv_bps_mature: 4500,
            liquidation_threshold_bps: 6000,
            liquidation_target_bps: 4500,
            liquidation_penalty_bps: 1000,
            liquidation_reward_bps: 400,
            liquidation_stability_bps: 600,
            stability_fee_apr_bps: 800,
            debt_ceiling_bps: 3000,
            credit_immediate_bps: FREEROLL_CREDIT_IMMEDIATE_BPS,
            credit_vest_secs: FREEROLL_CREDIT_VEST_SECS,
            credit_expiry_secs: FREEROLL_CREDIT_EXPIRY_SECS,
            bridge_paused: true,
            bridge_daily_limit: 0,
            bridge_daily_limit_per_account: 0,
            bridge_min_withdraw: 0,
            bridge_max_withdraw: 0,
            bridge_delay_secs: 0,
            oracle_enabled: false,
            oracle_max_deviation_bps: 500,
            oracle_stale_secs: 900,
        }
    }
}

impl Write for PolicyState {
    fn write(&self, writer: &mut impl BufMut) {
        self.sell_tax_min_bps.write(writer);
        self.sell_tax_mid_bps.write(writer);
        self.sell_tax_max_bps.write(writer);
        self.sell_tax_outflow_low_bps.write(writer);
        self.sell_tax_outflow_mid_bps.write(writer);
        self.max_daily_sell_bps_balance.write(writer);
        self.max_daily_sell_bps_pool.write(writer);
        self.max_daily_buy_bps_balance.write(writer);
        self.max_daily_buy_bps_pool.write(writer);
        self.max_ltv_bps_new.write(writer);
        self.max_ltv_bps_mature.write(writer);
        self.liquidation_threshold_bps.write(writer);
        self.liquidation_target_bps.write(writer);
        self.liquidation_penalty_bps.write(writer);
        self.liquidation_reward_bps.write(writer);
        self.liquidation_stability_bps.write(writer);
        self.stability_fee_apr_bps.write(writer);
        self.debt_ceiling_bps.write(writer);
        self.credit_immediate_bps.write(writer);
        self.credit_vest_secs.write(writer);
        self.credit_expiry_secs.write(writer);
        self.bridge_paused.write(writer);
        self.bridge_daily_limit.write(writer);
        self.bridge_daily_limit_per_account.write(writer);
        self.bridge_min_withdraw.write(writer);
        self.bridge_max_withdraw.write(writer);
        self.bridge_delay_secs.write(writer);
        self.oracle_enabled.write(writer);
        self.oracle_max_deviation_bps.write(writer);
        self.oracle_stale_secs.write(writer);
    }
}

impl Read for PolicyState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            sell_tax_min_bps: u16::read(reader)?,
            sell_tax_mid_bps: u16::read(reader)?,
            sell_tax_max_bps: u16::read(reader)?,
            sell_tax_outflow_low_bps: u16::read(reader)?,
            sell_tax_outflow_mid_bps: u16::read(reader)?,
            max_daily_sell_bps_balance: u16::read(reader)?,
            max_daily_sell_bps_pool: u16::read(reader)?,
            max_daily_buy_bps_balance: u16::read(reader)?,
            max_daily_buy_bps_pool: u16::read(reader)?,
            max_ltv_bps_new: u16::read(reader)?,
            max_ltv_bps_mature: u16::read(reader)?,
            liquidation_threshold_bps: u16::read(reader)?,
            liquidation_target_bps: u16::read(reader)?,
            liquidation_penalty_bps: u16::read(reader)?,
            liquidation_reward_bps: u16::read(reader)?,
            liquidation_stability_bps: u16::read(reader)?,
            stability_fee_apr_bps: u16::read(reader)?,
            debt_ceiling_bps: u16::read(reader)?,
            credit_immediate_bps: u16::read(reader)?,
            credit_vest_secs: u64::read(reader)?,
            credit_expiry_secs: u64::read(reader)?,
            bridge_paused: if reader.remaining() >= bool::SIZE {
                bool::read(reader)?
            } else {
                true
            },
            bridge_daily_limit: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            bridge_daily_limit_per_account: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            bridge_min_withdraw: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            bridge_max_withdraw: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            bridge_delay_secs: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            oracle_enabled: if reader.remaining() >= bool::SIZE {
                bool::read(reader)?
            } else {
                false
            },
            oracle_max_deviation_bps: if reader.remaining() >= u16::SIZE {
                u16::read(reader)?
            } else {
                0
            },
            oracle_stale_secs: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for PolicyState {
    fn encode_size(&self) -> usize {
        self.sell_tax_min_bps.encode_size()
            + self.sell_tax_mid_bps.encode_size()
            + self.sell_tax_max_bps.encode_size()
            + self.sell_tax_outflow_low_bps.encode_size()
            + self.sell_tax_outflow_mid_bps.encode_size()
            + self.max_daily_sell_bps_balance.encode_size()
            + self.max_daily_sell_bps_pool.encode_size()
            + self.max_daily_buy_bps_balance.encode_size()
            + self.max_daily_buy_bps_pool.encode_size()
            + self.max_ltv_bps_new.encode_size()
            + self.max_ltv_bps_mature.encode_size()
            + self.liquidation_threshold_bps.encode_size()
            + self.liquidation_target_bps.encode_size()
            + self.liquidation_penalty_bps.encode_size()
            + self.liquidation_reward_bps.encode_size()
            + self.liquidation_stability_bps.encode_size()
            + self.stability_fee_apr_bps.encode_size()
            + self.debt_ceiling_bps.encode_size()
            + self.credit_immediate_bps.encode_size()
            + self.credit_vest_secs.encode_size()
            + self.credit_expiry_secs.encode_size()
            + self.bridge_paused.encode_size()
            + self.bridge_daily_limit.encode_size()
            + self.bridge_daily_limit_per_account.encode_size()
            + self.bridge_min_withdraw.encode_size()
            + self.bridge_max_withdraw.encode_size()
            + self.bridge_delay_secs.encode_size()
            + self.oracle_enabled.encode_size()
            + self.oracle_max_deviation_bps.encode_size()
            + self.oracle_stale_secs.encode_size()
    }
}

/// Treasury allocation ledger (RNG buckets).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TreasuryState {
    pub auction_allocation_rng: u64,
    pub liquidity_reserve_rng: u64,
    pub bonus_pool_rng: u64,
    pub player_allocation_rng: u64,
    pub treasury_allocation_rng: u64,
    pub team_allocation_rng: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TreasuryBucket {
    Auction = 0,
    Liquidity = 1,
    Bonus = 2,
    Player = 3,
    Treasury = 4,
    Team = 5,
}

impl Write for TreasuryBucket {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for TreasuryBucket {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = u8::read(reader)?;
        let bucket = match value {
            0 => Self::Auction,
            1 => Self::Liquidity,
            2 => Self::Bonus,
            3 => Self::Player,
            4 => Self::Treasury,
            5 => Self::Team,
            _ => return Err(Error::InvalidEnum(value)),
        };
        Ok(bucket)
    }
}

impl EncodeSize for TreasuryBucket {
    fn encode_size(&self) -> usize {
        u8::SIZE
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct VestingSchedule {
    pub start_ts: u64,
    pub duration_secs: u64,
    pub released: u64,
}

impl Write for VestingSchedule {
    fn write(&self, writer: &mut impl BufMut) {
        self.start_ts.write(writer);
        self.duration_secs.write(writer);
        self.released.write(writer);
    }
}

impl Read for VestingSchedule {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            start_ts: u64::read(reader)?,
            duration_secs: u64::read(reader)?,
            released: u64::read(reader)?,
        })
    }
}

impl EncodeSize for VestingSchedule {
    fn encode_size(&self) -> usize {
        self.start_ts.encode_size() + self.duration_secs.encode_size() + self.released.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TreasuryVestingState {
    pub auction: VestingSchedule,
    pub liquidity: VestingSchedule,
    pub bonus: VestingSchedule,
    pub player: VestingSchedule,
    pub treasury: VestingSchedule,
    pub team: VestingSchedule,
}

impl Write for TreasuryVestingState {
    fn write(&self, writer: &mut impl BufMut) {
        self.auction.write(writer);
        self.liquidity.write(writer);
        self.bonus.write(writer);
        self.player.write(writer);
        self.treasury.write(writer);
        self.team.write(writer);
    }
}

impl Read for TreasuryVestingState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            auction: VestingSchedule::read(reader)?,
            liquidity: VestingSchedule::read(reader)?,
            bonus: VestingSchedule::read(reader)?,
            player: VestingSchedule::read(reader)?,
            treasury: VestingSchedule::read(reader)?,
            team: VestingSchedule::read(reader)?,
        })
    }
}

impl EncodeSize for TreasuryVestingState {
    fn encode_size(&self) -> usize {
        self.auction.encode_size()
            + self.liquidity.encode_size()
            + self.bonus.encode_size()
            + self.player.encode_size()
            + self.treasury.encode_size()
            + self.team.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct BridgeState {
    pub daily_day: u64,
    pub daily_withdrawn: u64,
    pub total_withdrawn: u64,
    pub total_deposited: u64,
    pub next_withdrawal_id: u64,
}

impl Write for BridgeState {
    fn write(&self, writer: &mut impl BufMut) {
        self.daily_day.write(writer);
        self.daily_withdrawn.write(writer);
        self.total_withdrawn.write(writer);
        self.total_deposited.write(writer);
        self.next_withdrawal_id.write(writer);
    }
}

impl Read for BridgeState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            daily_day: u64::read(reader)?,
            daily_withdrawn: u64::read(reader)?,
            total_withdrawn: u64::read(reader)?,
            total_deposited: u64::read(reader)?,
            next_withdrawal_id: u64::read(reader)?,
        })
    }
}

impl EncodeSize for BridgeState {
    fn encode_size(&self) -> usize {
        self.daily_day.encode_size()
            + self.daily_withdrawn.encode_size()
            + self.total_withdrawn.encode_size()
            + self.total_deposited.encode_size()
            + self.next_withdrawal_id.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct OracleState {
    pub price_vusdt_numerator: u64,
    pub price_rng_denominator: u64,
    pub updated_ts: u64,
    pub source: Vec<u8>,
}

impl Write for OracleState {
    fn write(&self, writer: &mut impl BufMut) {
        self.price_vusdt_numerator.write(writer);
        self.price_rng_denominator.write(writer);
        self.updated_ts.write(writer);
        self.source.write(writer);
    }
}

impl Read for OracleState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            price_vusdt_numerator: u64::read(reader)?,
            price_rng_denominator: u64::read(reader)?,
            updated_ts: u64::read(reader)?,
            source: Vec::<u8>::read_range(reader, 0..=MAX_ORACLE_SOURCE_BYTES)?,
        })
    }
}

impl EncodeSize for OracleState {
    fn encode_size(&self) -> usize {
        self.price_vusdt_numerator.encode_size()
            + self.price_rng_denominator.encode_size()
            + self.updated_ts.encode_size()
            + self.source.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeWithdrawal {
    pub id: u64,
    pub player: PublicKey,
    pub amount: u64,
    pub destination: Vec<u8>,
    pub requested_ts: u64,
    pub available_ts: u64,
    pub fulfilled: bool,
}

impl Write for BridgeWithdrawal {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.player.write(writer);
        self.amount.write(writer);
        self.destination.write(writer);
        self.requested_ts.write(writer);
        self.available_ts.write(writer);
        self.fulfilled.write(writer);
    }
}

impl Read for BridgeWithdrawal {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u64::read(reader)?,
            player: PublicKey::read(reader)?,
            amount: u64::read(reader)?,
            destination: Vec::<u8>::read_range(reader, 0..=64)?,
            requested_ts: u64::read(reader)?,
            available_ts: u64::read(reader)?,
            fulfilled: bool::read(reader)?,
        })
    }
}

impl EncodeSize for BridgeWithdrawal {
    fn encode_size(&self) -> usize {
        self.id.encode_size()
            + self.player.encode_size()
            + self.amount.encode_size()
            + self.destination.encode_size()
            + self.requested_ts.encode_size()
            + self.available_ts.encode_size()
            + self.fulfilled.encode_size()
    }
}

impl Write for TreasuryState {
    fn write(&self, writer: &mut impl BufMut) {
        self.auction_allocation_rng.write(writer);
        self.liquidity_reserve_rng.write(writer);
        self.bonus_pool_rng.write(writer);
        self.player_allocation_rng.write(writer);
        self.treasury_allocation_rng.write(writer);
        self.team_allocation_rng.write(writer);
    }
}

impl Read for TreasuryState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            auction_allocation_rng: u64::read(reader)?,
            liquidity_reserve_rng: u64::read(reader)?,
            bonus_pool_rng: u64::read(reader)?,
            player_allocation_rng: u64::read(reader)?,
            treasury_allocation_rng: u64::read(reader)?,
            team_allocation_rng: u64::read(reader)?,
        })
    }
}

impl EncodeSize for TreasuryState {
    fn encode_size(&self) -> usize {
        self.auction_allocation_rng.encode_size()
            + self.liquidity_reserve_rng.encode_size()
            + self.bonus_pool_rng.encode_size()
            + self.player_allocation_rng.encode_size()
            + self.treasury_allocation_rng.encode_size()
            + self.team_allocation_rng.encode_size()
    }
}

impl AmmPool {
    pub fn new(fee_bps: u16) -> Self {
        Self {
            reserve_rng: 0,
            reserve_vusdt: 0,
            total_shares: 0,
            fee_basis_points: fee_bps,
            sell_tax_basis_points: AMM_DEFAULT_SELL_TAX_BASIS_POINTS,
            bootstrap_price_vusdt_numerator: AMM_BOOTSTRAP_PRICE_VUSDT_NUMERATOR,
            bootstrap_price_rng_denominator: AMM_BOOTSTRAP_PRICE_RNG_DENOMINATOR,
            bootstrap_finalized: false,
            bootstrap_final_price_vusdt_numerator: 0,
            bootstrap_final_price_rng_denominator: 0,
            bootstrap_finalized_ts: 0,
        }
    }
}

impl Write for AmmPool {
    fn write(&self, writer: &mut impl BufMut) {
        self.reserve_rng.write(writer);
        self.reserve_vusdt.write(writer);
        self.total_shares.write(writer);
        self.fee_basis_points.write(writer);
        self.sell_tax_basis_points.write(writer);
        self.bootstrap_price_vusdt_numerator.write(writer);
        self.bootstrap_price_rng_denominator.write(writer);
        self.bootstrap_finalized.write(writer);
        self.bootstrap_final_price_vusdt_numerator.write(writer);
        self.bootstrap_final_price_rng_denominator.write(writer);
        self.bootstrap_finalized_ts.write(writer);
    }
}

impl Read for AmmPool {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let reserve_rng = u64::read(reader)?;
        let reserve_vusdt = u64::read(reader)?;
        let total_shares = u64::read(reader)?;
        let fee_basis_points = u16::read(reader)?;
        let sell_tax_basis_points = u16::read(reader)?;

        let bootstrap_price_vusdt_numerator = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            AMM_BOOTSTRAP_PRICE_VUSDT_NUMERATOR
        };
        let bootstrap_price_rng_denominator = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            AMM_BOOTSTRAP_PRICE_RNG_DENOMINATOR
        };

        let (bootstrap_finalized, bootstrap_final_price_vusdt_numerator, bootstrap_final_price_rng_denominator, bootstrap_finalized_ts) =
            if reader.remaining() >= bool::SIZE + (u64::SIZE * 3) {
                (
                    bool::read(reader)?,
                    u64::read(reader)?,
                    u64::read(reader)?,
                    u64::read(reader)?,
                )
            } else {
                (false, 0, 0, 0)
            };

        Ok(Self {
            reserve_rng,
            reserve_vusdt,
            total_shares,
            fee_basis_points,
            sell_tax_basis_points,
            bootstrap_price_vusdt_numerator,
            bootstrap_price_rng_denominator,
            bootstrap_finalized,
            bootstrap_final_price_vusdt_numerator,
            bootstrap_final_price_rng_denominator,
            bootstrap_finalized_ts,
        })
    }
}

impl EncodeSize for AmmPool {
    fn encode_size(&self) -> usize {
        self.reserve_rng.encode_size()
            + self.reserve_vusdt.encode_size()
            + self.total_shares.encode_size()
            + self.fee_basis_points.encode_size()
            + self.sell_tax_basis_points.encode_size()
            + self.bootstrap_price_vusdt_numerator.encode_size()
            + self.bootstrap_price_rng_denominator.encode_size()
            + self.bootstrap_finalized.encode_size()
            + self.bootstrap_final_price_vusdt_numerator.encode_size()
            + self.bootstrap_final_price_rng_denominator.encode_size()
            + self.bootstrap_finalized_ts.encode_size()
    }
}
