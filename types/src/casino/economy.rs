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
        match value {
            0 => Ok(Self::Auction),
            1 => Ok(Self::Liquidity),
            2 => Ok(Self::Bonus),
            3 => Ok(Self::Player),
            4 => Ok(Self::Treasury),
            5 => Ok(Self::Team),
            _ => Err(Error::InvalidEnum(value)),
        }
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

// ============================================================================
// Ledger Entry Types for AC-7.1: Deposit/Withdraw Reconciliation
// ============================================================================

/// Type of ledger entry for deposit/withdrawal tracking.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LedgerEntryType {
    /// Deposit from EVM chain to L2
    Deposit = 0,
    /// Withdrawal request from L2 to EVM chain
    WithdrawalRequest = 1,
    /// Withdrawal fulfilled (relayer executed on EVM)
    WithdrawalFulfilled = 2,
}

impl Write for LedgerEntryType {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for LedgerEntryType {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = u8::read(reader)?;
        match value {
            0 => Ok(Self::Deposit),
            1 => Ok(Self::WithdrawalRequest),
            2 => Ok(Self::WithdrawalFulfilled),
            _ => Err(Error::InvalidEnum(value)),
        }
    }
}

impl EncodeSize for LedgerEntryType {
    fn encode_size(&self) -> usize {
        u8::SIZE
    }
}

/// Reconciliation status for chain state verification.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ReconciliationStatus {
    /// Entry not yet reconciled against chain state
    #[default]
    Pending = 0,
    /// Entry verified against EVM chain state
    Verified = 1,
    /// Entry failed reconciliation (mismatch detected)
    Failed = 2,
}

impl Write for ReconciliationStatus {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for ReconciliationStatus {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = u8::read(reader)?;
        match value {
            0 => Ok(Self::Pending),
            1 => Ok(Self::Verified),
            2 => Ok(Self::Failed),
            _ => Err(Error::InvalidEnum(value)),
        }
    }
}

impl EncodeSize for ReconciliationStatus {
    fn encode_size(&self) -> usize {
        u8::SIZE
    }
}

/// Ledger entry for deposit/withdrawal audit trail.
/// Each entry tracks a single balance-affecting operation with chain state reconciliation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LedgerEntry {
    /// Unique sequential ID for this ledger entry
    pub id: u64,
    /// Type of ledger operation
    pub entry_type: LedgerEntryType,
    /// Player affected by this entry
    pub player: PublicKey,
    /// Amount of RNG tokens
    pub amount: u64,
    /// Timestamp when entry was created (L2 block time)
    pub created_ts: u64,
    /// EVM chain reference (tx hash or block hash, variable length)
    pub chain_ref: Vec<u8>,
    /// Reconciliation status against EVM chain state
    pub reconciliation_status: ReconciliationStatus,
    /// Timestamp of last reconciliation attempt
    pub reconciled_ts: u64,
    /// Running balance after this entry (for audit)
    pub balance_after: u64,
    /// Related withdrawal ID (for WithdrawalRequest/WithdrawalFulfilled types)
    pub withdrawal_id: Option<u64>,
}

impl Write for LedgerEntry {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.entry_type.write(writer);
        self.player.write(writer);
        self.amount.write(writer);
        self.created_ts.write(writer);
        self.chain_ref.write(writer);
        self.reconciliation_status.write(writer);
        self.reconciled_ts.write(writer);
        self.balance_after.write(writer);
        self.withdrawal_id.write(writer);
    }
}

impl Read for LedgerEntry {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u64::read(reader)?,
            entry_type: LedgerEntryType::read(reader)?,
            player: PublicKey::read(reader)?,
            amount: u64::read(reader)?,
            created_ts: u64::read(reader)?,
            chain_ref: Vec::<u8>::read_range(reader, 0..=64)?,
            reconciliation_status: ReconciliationStatus::read(reader)?,
            reconciled_ts: u64::read(reader)?,
            balance_after: u64::read(reader)?,
            withdrawal_id: Option::<u64>::read(reader)?,
        })
    }
}

impl EncodeSize for LedgerEntry {
    fn encode_size(&self) -> usize {
        self.id.encode_size()
            + self.entry_type.encode_size()
            + self.player.encode_size()
            + self.amount.encode_size()
            + self.created_ts.encode_size()
            + self.chain_ref.encode_size()
            + self.reconciliation_status.encode_size()
            + self.reconciled_ts.encode_size()
            + self.balance_after.encode_size()
            + self.withdrawal_id.encode_size()
    }
}

/// Aggregated ledger state for reconciliation tracking.
/// Tracks totals and unreconciled entries for efficient chain state verification.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct LedgerState {
    /// Next ledger entry ID (auto-increment)
    pub next_entry_id: u64,
    /// Total deposits credited to L2
    pub total_deposits: u64,
    /// Total withdrawal requests initiated
    pub total_withdrawal_requests: u64,
    /// Total withdrawals fulfilled on chain
    pub total_withdrawals_fulfilled: u64,
    /// Count of entries pending reconciliation
    pub pending_reconciliation_count: u64,
    /// Count of entries that failed reconciliation
    pub failed_reconciliation_count: u64,
    /// Last successfully reconciled entry ID
    pub last_reconciled_id: u64,
    /// Timestamp of last reconciliation run
    pub last_reconciliation_ts: u64,
}

impl Write for LedgerState {
    fn write(&self, writer: &mut impl BufMut) {
        self.next_entry_id.write(writer);
        self.total_deposits.write(writer);
        self.total_withdrawal_requests.write(writer);
        self.total_withdrawals_fulfilled.write(writer);
        self.pending_reconciliation_count.write(writer);
        self.failed_reconciliation_count.write(writer);
        self.last_reconciled_id.write(writer);
        self.last_reconciliation_ts.write(writer);
    }
}

impl Read for LedgerState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            next_entry_id: u64::read(reader)?,
            total_deposits: u64::read(reader)?,
            total_withdrawal_requests: u64::read(reader)?,
            total_withdrawals_fulfilled: u64::read(reader)?,
            pending_reconciliation_count: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            failed_reconciliation_count: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            last_reconciled_id: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            last_reconciliation_ts: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for LedgerState {
    fn encode_size(&self) -> usize {
        self.next_entry_id.encode_size()
            + self.total_deposits.encode_size()
            + self.total_withdrawal_requests.encode_size()
            + self.total_withdrawals_fulfilled.encode_size()
            + self.pending_reconciliation_count.encode_size()
            + self.failed_reconciliation_count.encode_size()
            + self.last_reconciled_id.encode_size()
            + self.last_reconciliation_ts.encode_size()
    }
}

// ============================================================================
// House Bankroll Types for AC-7.2: Bankroll/Exposure Tracking and Limits
// ============================================================================

/// House bankroll state for exposure tracking and limit enforcement.
/// Tracks the house's available funds, current risk exposure, and configurable limits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HouseBankroll {
    /// Total bankroll available for payouts (in chips)
    pub bankroll: u64,
    /// Current exposure: sum of maximum potential payouts for all pending bets
    pub current_exposure: u64,
    /// Maximum allowed exposure as a percentage of bankroll (basis points, e.g., 5000 = 50%)
    pub max_exposure_bps: u16,
    /// Maximum single bet amount allowed
    pub max_single_bet: u64,
    /// Maximum exposure per player (to prevent single player from consuming all capacity)
    pub max_player_exposure: u64,
    /// Total bets placed (for metrics)
    pub total_bets_placed: u64,
    /// Total amount wagered (for metrics)
    pub total_amount_wagered: u64,
    /// Total payouts made (for metrics)
    pub total_payouts: u64,
    /// Last update timestamp
    pub last_updated_ts: u64,
}

impl Default for HouseBankroll {
    fn default() -> Self {
        Self {
            bankroll: 0,
            current_exposure: 0,
            max_exposure_bps: 5000,      // 50% of bankroll
            max_single_bet: 10_000,      // 10k chips max per bet
            max_player_exposure: 50_000, // 50k chips max exposure per player
            total_bets_placed: 0,
            total_amount_wagered: 0,
            total_payouts: 0,
            last_updated_ts: 0,
        }
    }
}

impl HouseBankroll {
    /// Create a new bankroll with initial funds
    pub fn new(initial_bankroll: u64) -> Self {
        Self {
            bankroll: initial_bankroll,
            ..Default::default()
        }
    }

    /// Calculate maximum allowed exposure based on bankroll and limit
    pub fn max_allowed_exposure(&self) -> u64 {
        (self.bankroll as u128)
            .saturating_mul(self.max_exposure_bps as u128)
            .saturating_div(10_000)
            .min(u64::MAX as u128) as u64
    }

    /// Check if a new bet would exceed exposure limits
    /// Returns Ok(()) if bet is allowed, Err with reason if rejected
    pub fn check_bet_exposure(
        &self,
        bet_amount: u64,
        max_payout_multiplier: u64,
        player_current_exposure: u64,
    ) -> Result<(), ExposureLimitError> {
        // Check single bet limit
        if bet_amount > self.max_single_bet {
            return Err(ExposureLimitError::SingleBetExceeded {
                bet_amount,
                max_allowed: self.max_single_bet,
            });
        }

        // Calculate new exposure from this bet
        let bet_exposure = bet_amount.saturating_mul(max_payout_multiplier);

        // Check player exposure limit
        let new_player_exposure = player_current_exposure.saturating_add(bet_exposure);
        if new_player_exposure > self.max_player_exposure {
            return Err(ExposureLimitError::PlayerExposureExceeded {
                current_exposure: player_current_exposure,
                new_exposure: new_player_exposure,
                max_allowed: self.max_player_exposure,
            });
        }

        // Check house exposure limit
        let new_total_exposure = self.current_exposure.saturating_add(bet_exposure);
        let max_exposure = self.max_allowed_exposure();
        if new_total_exposure > max_exposure {
            return Err(ExposureLimitError::HouseExposureExceeded {
                current_exposure: self.current_exposure,
                new_exposure: new_total_exposure,
                max_allowed: max_exposure,
            });
        }

        Ok(())
    }

    /// Add exposure for a new bet
    pub fn add_exposure(&mut self, bet_amount: u64, max_payout_multiplier: u64) {
        let bet_exposure = bet_amount.saturating_mul(max_payout_multiplier);
        self.current_exposure = self.current_exposure.saturating_add(bet_exposure);
        self.total_bets_placed = self.total_bets_placed.saturating_add(1);
        self.total_amount_wagered = self.total_amount_wagered.saturating_add(bet_amount);
    }

    /// Release exposure after bet settlement
    pub fn release_exposure(&mut self, exposure_amount: u64) {
        self.current_exposure = self.current_exposure.saturating_sub(exposure_amount);
    }

    /// Record a payout
    pub fn record_payout(&mut self, payout_amount: u64) {
        self.total_payouts = self.total_payouts.saturating_add(payout_amount);
        self.bankroll = self.bankroll.saturating_sub(payout_amount);
    }

    /// Add funds to bankroll
    pub fn add_funds(&mut self, amount: u64) {
        self.bankroll = self.bankroll.saturating_add(amount);
    }

    /// Calculate available capacity (max exposure - current exposure)
    pub fn available_capacity(&self) -> u64 {
        self.max_allowed_exposure().saturating_sub(self.current_exposure)
    }

    /// Calculate utilization rate (current exposure / max exposure) in basis points
    pub fn utilization_bps(&self) -> u16 {
        let max_exposure = self.max_allowed_exposure();
        if max_exposure == 0 {
            return 0;
        }
        ((self.current_exposure as u128)
            .saturating_mul(10_000)
            .saturating_div(max_exposure as u128)
            .min(10_000)) as u16
    }
}

/// Errors returned when bet validation fails due to exposure limits
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExposureLimitError {
    /// Single bet amount exceeds maximum allowed
    SingleBetExceeded { bet_amount: u64, max_allowed: u64 },
    /// Player's total exposure would exceed their limit
    PlayerExposureExceeded {
        current_exposure: u64,
        new_exposure: u64,
        max_allowed: u64,
    },
    /// House's total exposure would exceed capacity
    HouseExposureExceeded {
        current_exposure: u64,
        new_exposure: u64,
        max_allowed: u64,
    },
}

impl Write for HouseBankroll {
    fn write(&self, writer: &mut impl BufMut) {
        self.bankroll.write(writer);
        self.current_exposure.write(writer);
        self.max_exposure_bps.write(writer);
        self.max_single_bet.write(writer);
        self.max_player_exposure.write(writer);
        self.total_bets_placed.write(writer);
        self.total_amount_wagered.write(writer);
        self.total_payouts.write(writer);
        self.last_updated_ts.write(writer);
    }
}

impl Read for HouseBankroll {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            bankroll: u64::read(reader)?,
            current_exposure: u64::read(reader)?,
            max_exposure_bps: u16::read(reader)?,
            max_single_bet: u64::read(reader)?,
            max_player_exposure: u64::read(reader)?,
            total_bets_placed: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            total_amount_wagered: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            total_payouts: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            last_updated_ts: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for HouseBankroll {
    fn encode_size(&self) -> usize {
        self.bankroll.encode_size()
            + self.current_exposure.encode_size()
            + self.max_exposure_bps.encode_size()
            + self.max_single_bet.encode_size()
            + self.max_player_exposure.encode_size()
            + self.total_bets_placed.encode_size()
            + self.total_amount_wagered.encode_size()
            + self.total_payouts.encode_size()
            + self.last_updated_ts.encode_size()
    }
}

/// Per-player exposure tracking for limit enforcement.
/// Stored per player to track their individual exposure against limits.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerExposure {
    /// Current total exposure (sum of max potential payouts)
    pub current_exposure: u64,
    /// Number of pending bets
    pub pending_bet_count: u32,
    /// Last bet timestamp
    pub last_bet_ts: u64,
}

impl Write for PlayerExposure {
    fn write(&self, writer: &mut impl BufMut) {
        self.current_exposure.write(writer);
        self.pending_bet_count.write(writer);
        self.last_bet_ts.write(writer);
    }
}

impl Read for PlayerExposure {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            current_exposure: u64::read(reader)?,
            pending_bet_count: u32::read(reader)?,
            last_bet_ts: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for PlayerExposure {
    fn encode_size(&self) -> usize {
        self.current_exposure.encode_size()
            + self.pending_bet_count.encode_size()
            + self.last_bet_ts.encode_size()
    }
}

// ============================================================================
// Admin Audit Log Types for AC-7.3: Admin Operations with Audit Logging
// ============================================================================

/// Type of admin operation being audited.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum AdminActionType {
    /// Update house bankroll limits
    UpdateBankrollLimits = 0,
    /// Update game configuration
    UpdateGameConfig = 1,
    /// Update policy/economic parameters
    UpdatePolicy = 2,
    /// Update responsible gaming limits
    UpdateResponsibleGamingLimits = 3,
    /// Pause/unpause bridge
    ToggleBridge = 4,
    /// Pause/unpause oracle
    ToggleOracle = 5,
    /// Emergency action (e.g., pause all)
    EmergencyAction = 6,
}

impl Write for AdminActionType {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for AdminActionType {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let tag = u8::read(reader)?;
        match tag {
            0 => Ok(Self::UpdateBankrollLimits),
            1 => Ok(Self::UpdateGameConfig),
            2 => Ok(Self::UpdatePolicy),
            3 => Ok(Self::UpdateResponsibleGamingLimits),
            4 => Ok(Self::ToggleBridge),
            5 => Ok(Self::ToggleOracle),
            6 => Ok(Self::EmergencyAction),
            _ => Err(Error::InvalidEnum(tag)),
        }
    }
}

impl EncodeSize for AdminActionType {
    fn encode_size(&self) -> usize {
        u8::SIZE
    }
}

/// Audit log entry for admin operations.
/// Each entry tracks a single admin action with before/after state and authorization.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuditLogEntry {
    /// Unique sequential ID for this audit entry
    pub id: u64,
    /// Type of admin action
    pub action_type: AdminActionType,
    /// Admin public key who performed the action
    pub admin: PublicKey,
    /// Timestamp when action was performed (L2 block time)
    pub timestamp: u64,
    /// IP address hash (SHA256 of IP, privacy-preserving)
    pub ip_hash: [u8; 32],
    /// Before state (serialized, variable length)
    pub before_state: Vec<u8>,
    /// After state (serialized, variable length)
    pub after_state: Vec<u8>,
    /// Human-readable reason/note as UTF-8 bytes (max 256 bytes)
    pub reason: Vec<u8>,
    /// Block height when this action was recorded
    pub block_height: u64,
    /// Request ID for correlation with logs
    pub request_id: u64,
}

impl AuditLogEntry {
    /// Get the reason as a string (best-effort UTF-8 decode).
    pub fn reason_str(&self) -> String {
        String::from_utf8_lossy(&self.reason).to_string()
    }
}

impl Write for AuditLogEntry {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.action_type.write(writer);
        self.admin.write(writer);
        self.timestamp.write(writer);
        self.ip_hash.write(writer);
        self.before_state.write(writer);
        self.after_state.write(writer);
        self.reason.write(writer);
        self.block_height.write(writer);
        self.request_id.write(writer);
    }
}

impl Read for AuditLogEntry {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u64::read(reader)?,
            action_type: AdminActionType::read(reader)?,
            admin: PublicKey::read(reader)?,
            timestamp: u64::read(reader)?,
            ip_hash: <[u8; 32]>::read(reader)?,
            before_state: Vec::<u8>::read_range(reader, 0..=65536)?,
            after_state: Vec::<u8>::read_range(reader, 0..=65536)?,
            reason: Vec::<u8>::read_range(reader, 0..=256)?,
            block_height: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            request_id: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for AuditLogEntry {
    fn encode_size(&self) -> usize {
        self.id.encode_size()
            + self.action_type.encode_size()
            + self.admin.encode_size()
            + self.timestamp.encode_size()
            + self.ip_hash.encode_size()
            + self.before_state.encode_size()
            + self.after_state.encode_size()
            + self.reason.encode_size()
            + self.block_height.encode_size()
            + self.request_id.encode_size()
    }
}

/// Aggregated audit log state for efficient querying.
/// Tracks totals and latest entries for quick retrieval.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AuditLogState {
    /// Next audit entry ID (auto-increment)
    pub next_entry_id: u64,
    /// Total entries logged
    pub total_entries: u64,
    /// Count of entries by action type (index matches AdminActionType)
    pub entries_by_type: [u64; 7],
    /// Last entry timestamp
    pub last_entry_ts: u64,
    /// ID of last entry (for quick retrieval)
    pub last_entry_id: u64,
}

impl Write for AuditLogState {
    fn write(&self, writer: &mut impl BufMut) {
        self.next_entry_id.write(writer);
        self.total_entries.write(writer);
        for count in &self.entries_by_type {
            count.write(writer);
        }
        self.last_entry_ts.write(writer);
        self.last_entry_id.write(writer);
    }
}

impl Read for AuditLogState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let next_entry_id = u64::read(reader)?;
        let total_entries = u64::read(reader)?;
        let mut entries_by_type = [0u64; 7];
        for count in entries_by_type.iter_mut() {
            *count = if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            };
        }
        let last_entry_ts = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };
        let last_entry_id = if reader.remaining() >= u64::SIZE {
            u64::read(reader)?
        } else {
            0
        };
        Ok(Self {
            next_entry_id,
            total_entries,
            entries_by_type,
            last_entry_ts,
            last_entry_id,
        })
    }
}

impl EncodeSize for AuditLogState {
    fn encode_size(&self) -> usize {
        self.next_entry_id.encode_size()
            + self.total_entries.encode_size()
            + (u64::SIZE * 7) // entries_by_type
            + self.last_entry_ts.encode_size()
            + self.last_entry_id.encode_size()
    }
}

// ============================================================================
// Responsible Gaming Types for AC-7.4: Daily/Weekly/Monthly Caps
// ============================================================================

/// Seconds per day (86400)
pub const SECS_PER_DAY: u64 = 24 * 60 * 60;
/// Seconds per week (604800)
pub const SECS_PER_WEEK: u64 = 7 * SECS_PER_DAY;
/// Seconds per month (30 days = 2592000)
pub const SECS_PER_MONTH: u64 = 30 * SECS_PER_DAY;

/// Default daily wagering cap (in chips)
pub const DEFAULT_DAILY_WAGER_CAP: u64 = 100_000;
/// Default weekly wagering cap (in chips)
pub const DEFAULT_WEEKLY_WAGER_CAP: u64 = 500_000;
/// Default monthly wagering cap (in chips)
pub const DEFAULT_MONTHLY_WAGER_CAP: u64 = 1_500_000;
/// Default daily loss cap (in chips)
pub const DEFAULT_DAILY_LOSS_CAP: u64 = 50_000;
/// Default weekly loss cap (in chips)
pub const DEFAULT_WEEKLY_LOSS_CAP: u64 = 200_000;
/// Default monthly loss cap (in chips)
pub const DEFAULT_MONTHLY_LOSS_CAP: u64 = 500_000;
/// Minimum cooldown period after self-exclusion ends (24 hours)
pub const MIN_COOLDOWN_SECS: u64 = SECS_PER_DAY;

/// System-wide responsible gaming configuration (default limits).
/// These are the enforced limits unless a player has set their own stricter limits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResponsibleGamingConfig {
    /// Maximum amount a player can wager per day (0 = unlimited)
    pub default_daily_wager_cap: u64,
    /// Maximum amount a player can wager per week (0 = unlimited)
    pub default_weekly_wager_cap: u64,
    /// Maximum amount a player can wager per month (0 = unlimited)
    pub default_monthly_wager_cap: u64,
    /// Maximum net loss per day (0 = unlimited)
    pub default_daily_loss_cap: u64,
    /// Maximum net loss per week (0 = unlimited)
    pub default_weekly_loss_cap: u64,
    /// Maximum net loss per month (0 = unlimited)
    pub default_monthly_loss_cap: u64,
    /// Minimum self-exclusion period (seconds)
    pub min_self_exclusion_period: u64,
    /// Maximum self-exclusion period (seconds)
    pub max_self_exclusion_period: u64,
    /// Cooldown period after self-exclusion ends (seconds)
    pub cooldown_after_exclusion: u64,
    /// Whether limits are enforced (can be disabled for testing)
    pub limits_enabled: bool,
}

impl Default for ResponsibleGamingConfig {
    fn default() -> Self {
        Self {
            default_daily_wager_cap: DEFAULT_DAILY_WAGER_CAP,
            default_weekly_wager_cap: DEFAULT_WEEKLY_WAGER_CAP,
            default_monthly_wager_cap: DEFAULT_MONTHLY_WAGER_CAP,
            default_daily_loss_cap: DEFAULT_DAILY_LOSS_CAP,
            default_weekly_loss_cap: DEFAULT_WEEKLY_LOSS_CAP,
            default_monthly_loss_cap: DEFAULT_MONTHLY_LOSS_CAP,
            min_self_exclusion_period: SECS_PER_DAY,           // 1 day minimum
            max_self_exclusion_period: 365 * SECS_PER_DAY,     // 1 year maximum
            cooldown_after_exclusion: MIN_COOLDOWN_SECS,
            limits_enabled: true,
        }
    }
}

impl Write for ResponsibleGamingConfig {
    fn write(&self, writer: &mut impl BufMut) {
        self.default_daily_wager_cap.write(writer);
        self.default_weekly_wager_cap.write(writer);
        self.default_monthly_wager_cap.write(writer);
        self.default_daily_loss_cap.write(writer);
        self.default_weekly_loss_cap.write(writer);
        self.default_monthly_loss_cap.write(writer);
        self.min_self_exclusion_period.write(writer);
        self.max_self_exclusion_period.write(writer);
        self.cooldown_after_exclusion.write(writer);
        self.limits_enabled.write(writer);
    }
}

impl Read for ResponsibleGamingConfig {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            default_daily_wager_cap: u64::read(reader)?,
            default_weekly_wager_cap: u64::read(reader)?,
            default_monthly_wager_cap: u64::read(reader)?,
            default_daily_loss_cap: u64::read(reader)?,
            default_weekly_loss_cap: u64::read(reader)?,
            default_monthly_loss_cap: u64::read(reader)?,
            min_self_exclusion_period: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                SECS_PER_DAY
            },
            max_self_exclusion_period: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                365 * SECS_PER_DAY
            },
            cooldown_after_exclusion: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                MIN_COOLDOWN_SECS
            },
            limits_enabled: if reader.remaining() >= bool::SIZE {
                bool::read(reader)?
            } else {
                true
            },
        })
    }
}

impl EncodeSize for ResponsibleGamingConfig {
    fn encode_size(&self) -> usize {
        self.default_daily_wager_cap.encode_size()
            + self.default_weekly_wager_cap.encode_size()
            + self.default_monthly_wager_cap.encode_size()
            + self.default_daily_loss_cap.encode_size()
            + self.default_weekly_loss_cap.encode_size()
            + self.default_monthly_loss_cap.encode_size()
            + self.min_self_exclusion_period.encode_size()
            + self.max_self_exclusion_period.encode_size()
            + self.cooldown_after_exclusion.encode_size()
            + self.limits_enabled.encode_size()
    }
}

/// Per-player responsible gaming limits and tracking state.
/// Tracks wagering/loss totals and enforces player-specific caps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerGamingLimits {
    // Player-specific caps (0 = use system default, player can only set LOWER than default)
    /// Player's daily wager cap (0 = use system default)
    pub daily_wager_cap: u64,
    /// Player's weekly wager cap (0 = use system default)
    pub weekly_wager_cap: u64,
    /// Player's monthly wager cap (0 = use system default)
    pub monthly_wager_cap: u64,
    /// Player's daily loss cap (0 = use system default)
    pub daily_loss_cap: u64,
    /// Player's weekly loss cap (0 = use system default)
    pub weekly_loss_cap: u64,
    /// Player's monthly loss cap (0 = use system default)
    pub monthly_loss_cap: u64,

    // Rolling period tracking
    /// Current day start timestamp (UTC midnight)
    pub day_start_ts: u64,
    /// Current week start timestamp (UTC Monday midnight)
    pub week_start_ts: u64,
    /// Current month start timestamp (UTC 1st midnight)
    pub month_start_ts: u64,

    // Wagering totals for current periods
    /// Total wagered in current day
    pub daily_wagered: u64,
    /// Total wagered in current week
    pub weekly_wagered: u64,
    /// Total wagered in current month
    pub monthly_wagered: u64,

    // Net loss totals for current periods (positive = loss, negative = profit)
    /// Net loss in current day
    pub daily_net_loss: i64,
    /// Net loss in current week
    pub weekly_net_loss: i64,
    /// Net loss in current month
    pub monthly_net_loss: i64,

    // Self-exclusion
    /// Self-exclusion end timestamp (0 = not excluded)
    pub self_exclusion_until: u64,
    /// Cooldown end timestamp after exclusion (0 = no cooldown)
    pub cooldown_until: u64,

    /// Last activity timestamp
    pub last_activity_ts: u64,
}

impl Default for PlayerGamingLimits {
    fn default() -> Self {
        Self {
            daily_wager_cap: 0,
            weekly_wager_cap: 0,
            monthly_wager_cap: 0,
            daily_loss_cap: 0,
            weekly_loss_cap: 0,
            monthly_loss_cap: 0,
            day_start_ts: 0,
            week_start_ts: 0,
            month_start_ts: 0,
            daily_wagered: 0,
            weekly_wagered: 0,
            monthly_wagered: 0,
            daily_net_loss: 0,
            weekly_net_loss: 0,
            monthly_net_loss: 0,
            self_exclusion_until: 0,
            cooldown_until: 0,
            last_activity_ts: 0,
        }
    }
}

impl PlayerGamingLimits {
    /// Get the effective daily wager cap (player's cap or system default, whichever is lower)
    pub fn effective_daily_wager_cap(&self, config: &ResponsibleGamingConfig) -> u64 {
        if self.daily_wager_cap == 0 {
            config.default_daily_wager_cap
        } else if config.default_daily_wager_cap == 0 {
            self.daily_wager_cap
        } else {
            self.daily_wager_cap.min(config.default_daily_wager_cap)
        }
    }

    /// Get the effective weekly wager cap
    pub fn effective_weekly_wager_cap(&self, config: &ResponsibleGamingConfig) -> u64 {
        if self.weekly_wager_cap == 0 {
            config.default_weekly_wager_cap
        } else if config.default_weekly_wager_cap == 0 {
            self.weekly_wager_cap
        } else {
            self.weekly_wager_cap.min(config.default_weekly_wager_cap)
        }
    }

    /// Get the effective monthly wager cap
    pub fn effective_monthly_wager_cap(&self, config: &ResponsibleGamingConfig) -> u64 {
        if self.monthly_wager_cap == 0 {
            config.default_monthly_wager_cap
        } else if config.default_monthly_wager_cap == 0 {
            self.monthly_wager_cap
        } else {
            self.monthly_wager_cap.min(config.default_monthly_wager_cap)
        }
    }

    /// Get the effective daily loss cap
    pub fn effective_daily_loss_cap(&self, config: &ResponsibleGamingConfig) -> u64 {
        if self.daily_loss_cap == 0 {
            config.default_daily_loss_cap
        } else if config.default_daily_loss_cap == 0 {
            self.daily_loss_cap
        } else {
            self.daily_loss_cap.min(config.default_daily_loss_cap)
        }
    }

    /// Get the effective weekly loss cap
    pub fn effective_weekly_loss_cap(&self, config: &ResponsibleGamingConfig) -> u64 {
        if self.weekly_loss_cap == 0 {
            config.default_weekly_loss_cap
        } else if config.default_weekly_loss_cap == 0 {
            self.weekly_loss_cap
        } else {
            self.weekly_loss_cap.min(config.default_weekly_loss_cap)
        }
    }

    /// Get the effective monthly loss cap
    pub fn effective_monthly_loss_cap(&self, config: &ResponsibleGamingConfig) -> u64 {
        if self.monthly_loss_cap == 0 {
            config.default_monthly_loss_cap
        } else if config.default_monthly_loss_cap == 0 {
            self.monthly_loss_cap
        } else {
            self.monthly_loss_cap.min(config.default_monthly_loss_cap)
        }
    }

    /// Reset period totals if the period has rolled over.
    /// Call this before checking limits.
    pub fn maybe_reset_periods(&mut self, now_ts: u64) {
        // Reset daily totals if a new day started
        let day_boundary = self.day_start_ts.saturating_add(SECS_PER_DAY);
        if now_ts >= day_boundary {
            self.daily_wagered = 0;
            self.daily_net_loss = 0;
            // Align to midnight (floor to day boundary)
            self.day_start_ts = (now_ts / SECS_PER_DAY) * SECS_PER_DAY;
        }

        // Reset weekly totals if a new week started
        let week_boundary = self.week_start_ts.saturating_add(SECS_PER_WEEK);
        if now_ts >= week_boundary {
            self.weekly_wagered = 0;
            self.weekly_net_loss = 0;
            // Align to week boundary
            self.week_start_ts = (now_ts / SECS_PER_WEEK) * SECS_PER_WEEK;
        }

        // Reset monthly totals if a new month started
        let month_boundary = self.month_start_ts.saturating_add(SECS_PER_MONTH);
        if now_ts >= month_boundary {
            self.monthly_wagered = 0;
            self.monthly_net_loss = 0;
            // Align to month boundary (30-day periods)
            self.month_start_ts = (now_ts / SECS_PER_MONTH) * SECS_PER_MONTH;
        }
    }

    /// Check if the player is currently self-excluded
    pub fn is_self_excluded(&self, now_ts: u64) -> bool {
        self.self_exclusion_until > 0 && now_ts < self.self_exclusion_until
    }

    /// Check if the player is in cooldown after self-exclusion
    pub fn is_in_cooldown(&self, now_ts: u64) -> bool {
        self.cooldown_until > 0 && now_ts < self.cooldown_until
    }

    /// Check responsible gaming limits for a proposed bet.
    /// Returns Ok(()) if allowed, Err with specific error if rejected.
    pub fn check_limits(
        &self,
        config: &ResponsibleGamingConfig,
        bet_amount: u64,
        now_ts: u64,
    ) -> Result<(), ResponsibleGamingError> {
        // Check if limits are enabled
        if !config.limits_enabled {
            return Ok(());
        }

        // Check self-exclusion
        if self.is_self_excluded(now_ts) {
            return Err(ResponsibleGamingError::SelfExcluded {
                until_ts: self.self_exclusion_until,
            });
        }

        // Check cooldown
        if self.is_in_cooldown(now_ts) {
            return Err(ResponsibleGamingError::InCooldown {
                until_ts: self.cooldown_until,
            });
        }

        // Check daily wager cap
        let daily_cap = self.effective_daily_wager_cap(config);
        if daily_cap > 0 {
            let new_daily = self.daily_wagered.saturating_add(bet_amount);
            if new_daily > daily_cap {
                return Err(ResponsibleGamingError::DailyWagerCapExceeded {
                    current: self.daily_wagered,
                    cap: daily_cap,
                    bet_amount,
                });
            }
        }

        // Check weekly wager cap
        let weekly_cap = self.effective_weekly_wager_cap(config);
        if weekly_cap > 0 {
            let new_weekly = self.weekly_wagered.saturating_add(bet_amount);
            if new_weekly > weekly_cap {
                return Err(ResponsibleGamingError::WeeklyWagerCapExceeded {
                    current: self.weekly_wagered,
                    cap: weekly_cap,
                    bet_amount,
                });
            }
        }

        // Check monthly wager cap
        let monthly_cap = self.effective_monthly_wager_cap(config);
        if monthly_cap > 0 {
            let new_monthly = self.monthly_wagered.saturating_add(bet_amount);
            if new_monthly > monthly_cap {
                return Err(ResponsibleGamingError::MonthlyWagerCapExceeded {
                    current: self.monthly_wagered,
                    cap: monthly_cap,
                    bet_amount,
                });
            }
        }

        // Note: Loss caps are checked at settlement time, not bet time,
        // since we don't know the outcome yet. However, if the player is
        // already over their loss cap, we reject new bets.
        let daily_loss_cap = self.effective_daily_loss_cap(config);
        if daily_loss_cap > 0 && self.daily_net_loss > 0 {
            if self.daily_net_loss as u64 >= daily_loss_cap {
                return Err(ResponsibleGamingError::DailyLossCapReached {
                    current_loss: self.daily_net_loss,
                    cap: daily_loss_cap,
                });
            }
        }

        let weekly_loss_cap = self.effective_weekly_loss_cap(config);
        if weekly_loss_cap > 0 && self.weekly_net_loss > 0 {
            if self.weekly_net_loss as u64 >= weekly_loss_cap {
                return Err(ResponsibleGamingError::WeeklyLossCapReached {
                    current_loss: self.weekly_net_loss,
                    cap: weekly_loss_cap,
                });
            }
        }

        let monthly_loss_cap = self.effective_monthly_loss_cap(config);
        if monthly_loss_cap > 0 && self.monthly_net_loss > 0 {
            if self.monthly_net_loss as u64 >= monthly_loss_cap {
                return Err(ResponsibleGamingError::MonthlyLossCapReached {
                    current_loss: self.monthly_net_loss,
                    cap: monthly_loss_cap,
                });
            }
        }

        Ok(())
    }

    /// Record a bet being placed (wager tracking)
    pub fn record_wager(&mut self, amount: u64, now_ts: u64) {
        self.maybe_reset_periods(now_ts);
        self.daily_wagered = self.daily_wagered.saturating_add(amount);
        self.weekly_wagered = self.weekly_wagered.saturating_add(amount);
        self.monthly_wagered = self.monthly_wagered.saturating_add(amount);
        self.last_activity_ts = now_ts;
    }

    /// Record bet settlement result (loss tracking).
    /// `net_result` is positive for player win, negative for player loss.
    pub fn record_settlement(&mut self, net_result: i64, now_ts: u64) {
        self.maybe_reset_periods(now_ts);
        // net_loss is positive when player loses, so we subtract net_result
        self.daily_net_loss = self.daily_net_loss.saturating_sub(net_result);
        self.weekly_net_loss = self.weekly_net_loss.saturating_sub(net_result);
        self.monthly_net_loss = self.monthly_net_loss.saturating_sub(net_result);
        self.last_activity_ts = now_ts;
    }

    /// Set self-exclusion period
    pub fn set_self_exclusion(&mut self, duration_secs: u64, now_ts: u64, config: &ResponsibleGamingConfig) {
        let clamped = duration_secs
            .max(config.min_self_exclusion_period)
            .min(config.max_self_exclusion_period);
        self.self_exclusion_until = now_ts.saturating_add(clamped);
        self.cooldown_until = self.self_exclusion_until.saturating_add(config.cooldown_after_exclusion);
    }

    /// Calculate remaining daily wager allowance
    pub fn remaining_daily_wager(&self, config: &ResponsibleGamingConfig) -> u64 {
        let cap = self.effective_daily_wager_cap(config);
        if cap == 0 {
            u64::MAX
        } else {
            cap.saturating_sub(self.daily_wagered)
        }
    }

    /// Calculate remaining weekly wager allowance
    pub fn remaining_weekly_wager(&self, config: &ResponsibleGamingConfig) -> u64 {
        let cap = self.effective_weekly_wager_cap(config);
        if cap == 0 {
            u64::MAX
        } else {
            cap.saturating_sub(self.weekly_wagered)
        }
    }

    /// Calculate remaining monthly wager allowance
    pub fn remaining_monthly_wager(&self, config: &ResponsibleGamingConfig) -> u64 {
        let cap = self.effective_monthly_wager_cap(config);
        if cap == 0 {
            u64::MAX
        } else {
            cap.saturating_sub(self.monthly_wagered)
        }
    }
}

/// Errors returned when responsible gaming limit checks fail
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResponsibleGamingError {
    /// Player is self-excluded
    SelfExcluded { until_ts: u64 },
    /// Player is in cooldown after self-exclusion ended
    InCooldown { until_ts: u64 },
    /// Daily wager cap would be exceeded
    DailyWagerCapExceeded { current: u64, cap: u64, bet_amount: u64 },
    /// Weekly wager cap would be exceeded
    WeeklyWagerCapExceeded { current: u64, cap: u64, bet_amount: u64 },
    /// Monthly wager cap would be exceeded
    MonthlyWagerCapExceeded { current: u64, cap: u64, bet_amount: u64 },
    /// Daily loss cap has been reached
    DailyLossCapReached { current_loss: i64, cap: u64 },
    /// Weekly loss cap has been reached
    WeeklyLossCapReached { current_loss: i64, cap: u64 },
    /// Monthly loss cap has been reached
    MonthlyLossCapReached { current_loss: i64, cap: u64 },
}

impl Write for PlayerGamingLimits {
    fn write(&self, writer: &mut impl BufMut) {
        self.daily_wager_cap.write(writer);
        self.weekly_wager_cap.write(writer);
        self.monthly_wager_cap.write(writer);
        self.daily_loss_cap.write(writer);
        self.weekly_loss_cap.write(writer);
        self.monthly_loss_cap.write(writer);
        self.day_start_ts.write(writer);
        self.week_start_ts.write(writer);
        self.month_start_ts.write(writer);
        self.daily_wagered.write(writer);
        self.weekly_wagered.write(writer);
        self.monthly_wagered.write(writer);
        self.daily_net_loss.write(writer);
        self.weekly_net_loss.write(writer);
        self.monthly_net_loss.write(writer);
        self.self_exclusion_until.write(writer);
        self.cooldown_until.write(writer);
        self.last_activity_ts.write(writer);
    }
}

impl Read for PlayerGamingLimits {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            daily_wager_cap: u64::read(reader)?,
            weekly_wager_cap: u64::read(reader)?,
            monthly_wager_cap: u64::read(reader)?,
            daily_loss_cap: u64::read(reader)?,
            weekly_loss_cap: u64::read(reader)?,
            monthly_loss_cap: u64::read(reader)?,
            day_start_ts: u64::read(reader)?,
            week_start_ts: u64::read(reader)?,
            month_start_ts: u64::read(reader)?,
            daily_wagered: u64::read(reader)?,
            weekly_wagered: u64::read(reader)?,
            monthly_wagered: u64::read(reader)?,
            daily_net_loss: i64::read(reader)?,
            weekly_net_loss: i64::read(reader)?,
            monthly_net_loss: i64::read(reader)?,
            self_exclusion_until: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            cooldown_until: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
            last_activity_ts: if reader.remaining() >= u64::SIZE {
                u64::read(reader)?
            } else {
                0
            },
        })
    }
}

impl EncodeSize for PlayerGamingLimits {
    fn encode_size(&self) -> usize {
        self.daily_wager_cap.encode_size()
            + self.weekly_wager_cap.encode_size()
            + self.monthly_wager_cap.encode_size()
            + self.daily_loss_cap.encode_size()
            + self.weekly_loss_cap.encode_size()
            + self.monthly_loss_cap.encode_size()
            + self.day_start_ts.encode_size()
            + self.week_start_ts.encode_size()
            + self.month_start_ts.encode_size()
            + self.daily_wagered.encode_size()
            + self.weekly_wagered.encode_size()
            + self.monthly_wagered.encode_size()
            + self.daily_net_loss.encode_size()
            + self.weekly_net_loss.encode_size()
            + self.monthly_net_loss.encode_size()
            + self.self_exclusion_until.encode_size()
            + self.cooldown_until.encode_size()
            + self.last_activity_ts.encode_size()
    }
}
