//! Consensus and execution-level types.
//!
//! Defines blocks, transactions, seeds, events/outputs, and canonical encoding rules used by the
//! node, simulator, and clients.

use bytes::{Buf, BufMut};
use commonware_codec::{
    varint::UInt, Encode, EncodeSize, Error, FixedSize, RangeCfg, Read, ReadExt, ReadRangeExt,
    Write,
};
use commonware_consensus::simplex::scheme::bls12381_threshold::{
    Seed as CSeed, Scheme as ThresholdScheme,
};
use commonware_consensus::simplex::types::{
    Activity as CActivity, Finalization as CFinalization, Notarization as CNotarization,
};
use commonware_consensus::types::View;
use commonware_cryptography::{
    bls12381::primitives::variant::{MinSig, Variant},
    ed25519::{self, Batch, PublicKey},
    sha256::{Digest, Sha256},
    BatchVerifier, Committable, Digestible, Hasher, Signer, Verifier,
};
use commonware_utils::{modulo, union};
use std::{fmt::Debug, hash::Hash};
use thiserror::Error as ThisError;

pub const NAMESPACE: &[u8] = b"_SUPERSOCIETY";
pub const TRANSACTION_SUFFIX: &[u8] = b"_TX";
pub const TRANSACTION_NAMESPACE: &[u8] = b"_NULLSPACE_TX";
// Phase 1 scaling: Increased from 100 to 500 for higher throughput
pub const MAX_BLOCK_TRANSACTIONS: usize = 500;

mod tags {
    pub mod instruction {
        // Casino instructions (10-17)
        pub const CASINO_REGISTER: u8 = 10;
        pub const CASINO_DEPOSIT: u8 = 11;
        pub const CASINO_START_GAME: u8 = 12;
        pub const CASINO_GAME_MOVE: u8 = 13;
        /// Consolidated player action (replaces individual toggle instructions)
        pub const CASINO_PLAYER_ACTION: u8 = 14;
        /// Admin instruction to set a player's daily tournament limit.
        pub const CASINO_SET_TOURNAMENT_LIMIT: u8 = 15;
        // Tag 30 is now free (previously TOGGLE_SUPER)
        pub const CASINO_JOIN_TOURNAMENT: u8 = 16;
        pub const CASINO_START_TOURNAMENT: u8 = 17;

        // Global table (60-66)
        pub const CASINO_GLOBAL_TABLE_INIT: u8 = 60;
        pub const CASINO_GLOBAL_TABLE_OPEN_ROUND: u8 = 61;
        pub const CASINO_GLOBAL_TABLE_SUBMIT_BETS: u8 = 62;
        pub const CASINO_GLOBAL_TABLE_LOCK: u8 = 63;
        pub const CASINO_GLOBAL_TABLE_REVEAL: u8 = 64;
        pub const CASINO_GLOBAL_TABLE_SETTLE: u8 = 65;
        pub const CASINO_GLOBAL_TABLE_FINALIZE: u8 = 66;

        // Staking (18-21)
        pub const STAKE: u8 = 18;
        pub const UNSTAKE: u8 = 19;
        pub const CLAIM_REWARDS: u8 = 20;
        pub const PROCESS_EPOCH: u8 = 21;

        // Vaults (22-25)
        pub const CREATE_VAULT: u8 = 22;
        pub const DEPOSIT_COLLATERAL: u8 = 23;
        pub const BORROW_USDT: u8 = 24;
        pub const REPAY_USDT: u8 = 25;

        // AMM (26-28)
        pub const SWAP: u8 = 26;
        pub const ADD_LIQUIDITY: u8 = 27;
        pub const REMOVE_LIQUIDITY: u8 = 28;

        // Tournaments (29)
        pub const CASINO_END_TOURNAMENT: u8 = 29;

        // Economy admin + risk controls (30-34)
        pub const LIQUIDATE_VAULT: u8 = 30;
        pub const SET_POLICY: u8 = 31;
        pub const SET_TREASURY: u8 = 32;
        pub const FUND_RECOVERY_POOL: u8 = 33;
        pub const RETIRE_VAULT_DEBT: u8 = 34;
        pub const RETIRE_WORST_VAULT_DEBT: u8 = 35;
        pub const DEPOSIT_SAVINGS: u8 = 36;
        pub const WITHDRAW_SAVINGS: u8 = 37;
        pub const CLAIM_SAVINGS_REWARDS: u8 = 38;
        pub const SEED_AMM: u8 = 39;
        pub const FINALIZE_AMM_BOOTSTRAP: u8 = 40;
        pub const SET_TREASURY_VESTING: u8 = 41;
        pub const RELEASE_TREASURY_ALLOCATION: u8 = 42;
        pub const BRIDGE_WITHDRAW: u8 = 43;
        pub const BRIDGE_DEPOSIT: u8 = 44;
        pub const FINALIZE_BRIDGE_WITHDRAWAL: u8 = 45;
        pub const UPDATE_ORACLE: u8 = 46;
    }

    pub mod key {
        pub const ACCOUNT: u8 = 0;

        // Casino keys (10-13)
        pub const CASINO_PLAYER: u8 = 10;
        pub const CASINO_SESSION: u8 = 11;
        pub const CASINO_LEADERBOARD: u8 = 12;
        pub const TOURNAMENT: u8 = 13;

        // Staking & house (14-15)
        pub const HOUSE: u8 = 14;
        pub const STAKER: u8 = 15;

        // Virtual liquidity (16-17)
        pub const VAULT: u8 = 16;
        pub const AMM_POOL: u8 = 17;

        // LP balance (18)
        pub const LP_BALANCE: u8 = 18;

        // Policy + Treasury (19-20)
        pub const POLICY: u8 = 19;
        pub const TREASURY: u8 = 20;
        pub const TREASURY_VESTING: u8 = 25;

        // Registry (21, 24)
        pub const VAULT_REGISTRY: u8 = 21;
        pub const PLAYER_REGISTRY: u8 = 24;
        // Savings (22-23)
        pub const SAVINGS_POOL: u8 = 22;
        pub const SAVINGS_BALANCE: u8 = 23;
        // Bridge (26-27)
        pub const BRIDGE_STATE: u8 = 26;
        pub const BRIDGE_WITHDRAWAL: u8 = 27;
        // Oracle (28)
        pub const ORACLE_STATE: u8 = 28;

        // Global table (29-31)
        pub const GLOBAL_TABLE_CONFIG: u8 = 29;
        pub const GLOBAL_TABLE_ROUND: u8 = 30;
        pub const GLOBAL_TABLE_PLAYER_SESSION: u8 = 31;

        // Ledger (32-33)
        pub const LEDGER_STATE: u8 = 32;
        pub const LEDGER_ENTRY: u8 = 33;
    }

    pub mod value {
        pub const ACCOUNT: u8 = 0;
        pub const COMMIT: u8 = 3;

        // Casino values (10-13)
        pub const CASINO_PLAYER: u8 = 10;
        pub const CASINO_SESSION: u8 = 11;
        pub const CASINO_LEADERBOARD: u8 = 12;
        pub const TOURNAMENT: u8 = 13;

        // Staking & house (14-15)
        pub const HOUSE: u8 = 14;
        pub const STAKER: u8 = 15;

        // Virtual liquidity (16-17)
        pub const VAULT: u8 = 16;
        pub const AMM_POOL: u8 = 17;

        // LP balance (18)
        pub const LP_BALANCE: u8 = 18;

        // Policy + Treasury (19-20)
        pub const POLICY: u8 = 19;
        pub const TREASURY: u8 = 20;
        pub const TREASURY_VESTING: u8 = 25;

        // Registry (21, 24)
        pub const VAULT_REGISTRY: u8 = 21;
        pub const PLAYER_REGISTRY: u8 = 24;
        // Savings (22-23)
        pub const SAVINGS_POOL: u8 = 22;
        pub const SAVINGS_BALANCE: u8 = 23;
        // Bridge (26-27)
        pub const BRIDGE_STATE: u8 = 26;
        pub const BRIDGE_WITHDRAWAL: u8 = 27;
        // Oracle (28)
        pub const ORACLE_STATE: u8 = 28;

        // Global table (29-31)
        pub const GLOBAL_TABLE_CONFIG: u8 = 29;
        pub const GLOBAL_TABLE_ROUND: u8 = 30;
        pub const GLOBAL_TABLE_PLAYER_SESSION: u8 = 31;

        // Ledger (32-33)
        pub const LEDGER_STATE: u8 = 32;
        pub const LEDGER_ENTRY: u8 = 33;
    }

    pub mod event {
        // Casino events (20-24), plus error (29), deposit (41), and modifier toggled (42)
        pub const CASINO_PLAYER_REGISTERED: u8 = 20;
        pub const CASINO_GAME_STARTED: u8 = 21;
        pub const CASINO_GAME_MOVED: u8 = 22;
        pub const CASINO_GAME_COMPLETED: u8 = 23;
        pub const CASINO_LEADERBOARD_UPDATED: u8 = 24;
        pub const CASINO_ERROR: u8 = 29;
        pub const CASINO_DEPOSITED: u8 = 41;
        pub const PLAYER_MODIFIER_TOGGLED: u8 = 42;

        // Tournament events (25-28)
        pub const TOURNAMENT_STARTED: u8 = 25;
        pub const PLAYER_JOINED: u8 = 26;
        pub const TOURNAMENT_PHASE_CHANGED: u8 = 27;
        pub const TOURNAMENT_ENDED: u8 = 28;

        // Vault & AMM events (30-36)
        pub const VAULT_CREATED: u8 = 30;
        pub const COLLATERAL_DEPOSITED: u8 = 31;
        pub const VUSDT_BORROWED: u8 = 32;
        pub const VUSDT_REPAID: u8 = 33;
        pub const AMM_SWAPPED: u8 = 34;
        pub const LIQUIDITY_ADDED: u8 = 35;
        pub const LIQUIDITY_REMOVED: u8 = 36;

        // Staking events (37-40)
        pub const STAKED: u8 = 37;
        pub const UNSTAKED: u8 = 38;
        pub const EPOCH_PROCESSED: u8 = 39;
        pub const REWARDS_CLAIMED: u8 = 40;

        // Economy admin events (43-47)
        pub const POLICY_UPDATED: u8 = 43;
        pub const VAULT_LIQUIDATED: u8 = 44;
        pub const RECOVERY_POOL_FUNDED: u8 = 45;
        pub const RECOVERY_POOL_RETIRED: u8 = 46;
        pub const TREASURY_UPDATED: u8 = 47;
        // Savings events (48-50)
        pub const SAVINGS_DEPOSITED: u8 = 48;
        pub const SAVINGS_WITHDRAWN: u8 = 49;
        pub const SAVINGS_REWARDS_CLAIMED: u8 = 50;
        // AMM bootstrap events (51-52)
        pub const AMM_BOOTSTRAPPED: u8 = 51;
        pub const AMM_BOOTSTRAP_FINALIZED: u8 = 52;
        // Treasury vesting events (53-54)
        pub const TREASURY_VESTING_UPDATED: u8 = 53;
        pub const TREASURY_ALLOCATION_RELEASED: u8 = 54;
        // Bridge events (55-57)
        pub const BRIDGE_WITHDRAWAL_REQUESTED: u8 = 55;
        pub const BRIDGE_WITHDRAWAL_FINALIZED: u8 = 56;
        pub const BRIDGE_DEPOSIT_CREDITED: u8 = 57;
        // Oracle events (58)
        pub const ORACLE_UPDATED: u8 = 58;

        // Global table events (60-66)
        pub const GLOBAL_TABLE_ROUND_OPENED: u8 = 60;
        pub const GLOBAL_TABLE_BET_ACCEPTED: u8 = 61;
        pub const GLOBAL_TABLE_BET_REJECTED: u8 = 62;
        pub const GLOBAL_TABLE_LOCKED: u8 = 63;
        pub const GLOBAL_TABLE_OUTCOME: u8 = 64;
        pub const GLOBAL_TABLE_PLAYER_SETTLED: u8 = 65;
        pub const GLOBAL_TABLE_FINALIZED: u8 = 66;

        // Ledger events (70-72)
        pub const LEDGER_ENTRY_CREATED: u8 = 70;
        pub const LEDGER_RECONCILED: u8 = 71;
        pub const LEDGER_RECONCILIATION_FAILED: u8 = 72;
    }
}

pub type Seed = CSeed<MinSig>;
type ConsensusScheme = ThresholdScheme<ed25519::PublicKey, MinSig>;
pub type Notarization = CNotarization<ConsensusScheme, Digest>;
pub type Finalization = CFinalization<ConsensusScheme, Digest>;
pub type Activity = CActivity<ConsensusScheme, Digest>;

pub type Identity = <MinSig as Variant>::Public;
pub type Evaluation = Identity;
pub type Signature = <MinSig as Variant>::Signature;

#[inline]
pub fn transaction_namespace(namespace: &[u8]) -> Vec<u8> {
    union(namespace, TRANSACTION_SUFFIX)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transaction {
    pub nonce: u64,
    pub instruction: Instruction,

    pub public: ed25519::PublicKey,
    pub signature: ed25519::Signature,
}

impl Transaction {
    fn write_payload(nonce: &u64, instruction: &Instruction, payload: &mut Vec<u8>) {
        payload.clear();
        payload.reserve(nonce.encode_size() + instruction.encode_size());
        nonce.write(payload);
        instruction.write(payload);
    }

    pub fn sign(private: &ed25519::PrivateKey, nonce: u64, instruction: Instruction) -> Self {
        let mut scratch = Vec::new();
        Self::sign_with_scratch(private, nonce, instruction, &mut scratch)
    }

    pub fn sign_with_scratch(
        private: &ed25519::PrivateKey,
        nonce: u64,
        instruction: Instruction,
        scratch: &mut Vec<u8>,
    ) -> Self {
        Self::write_payload(&nonce, &instruction, scratch);
        let signature = private.sign(TRANSACTION_NAMESPACE, scratch.as_slice());

        Self {
            nonce,
            instruction,
            public: private.public_key(),
            signature,
        }
    }

    pub fn verify(&self) -> bool {
        let mut scratch = Vec::new();
        self.verify_with_scratch(&mut scratch)
    }

    pub fn verify_with_scratch(&self, scratch: &mut Vec<u8>) -> bool {
        Self::write_payload(&self.nonce, &self.instruction, scratch);
        self.public
            .verify(TRANSACTION_NAMESPACE, scratch.as_slice(), &self.signature)
    }

    pub fn verify_batch(&self, batch: &mut Batch) {
        let mut scratch = Vec::new();
        self.verify_batch_with_scratch(batch, &mut scratch);
    }

    pub fn verify_batch_with_scratch(&self, batch: &mut Batch, scratch: &mut Vec<u8>) {
        Self::write_payload(&self.nonce, &self.instruction, scratch);
        batch.add(
            TRANSACTION_NAMESPACE,
            scratch.as_slice(),
            &self.public,
            &self.signature,
        );
    }
}

impl Write for Transaction {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
        self.instruction.write(writer);
        self.public.write(writer);
        self.signature.write(writer);
    }
}

impl Read for Transaction {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let nonce = u64::read(reader)?;
        let instruction = Instruction::read(reader)?;
        let public = ed25519::PublicKey::read(reader)?;
        let signature = ed25519::Signature::read(reader)?;

        Ok(Self {
            nonce,
            instruction,
            public,
            signature,
        })
    }
}

impl EncodeSize for Transaction {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
            + self.instruction.encode_size()
            + self.public.encode_size()
            + self.signature.encode_size()
    }
}

impl Digestible for Transaction {
    type Digest = Digest;

    fn digest(&self) -> Digest {
        let mut hasher = Sha256::new();
        hasher.update(self.nonce.to_be_bytes().as_ref());
        hasher.update(self.instruction.encode().as_ref());
        hasher.update(self.public.as_ref());
        // We don't include the signature as part of the digest (any valid
        // signature will be valid for the transaction)
        hasher.finalize()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum Instruction {
    // Casino instructions (tags 10-17)
    /// Register a new casino player with a name.
    /// Binary: [10] [nameLen:u32 BE] [nameBytes...]
    CasinoRegister { name: String },

    /// Deposit chips (for testing/faucet).
    /// Binary: [11] [amount:u64 BE]
    CasinoDeposit { amount: u64 },

    /// Start a new casino game session.
    /// Binary: [12] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
    CasinoStartGame {
        game_type: crate::casino::GameType,
        bet: u64,
        session_id: u64,
    },

    /// Make a move in an active casino game.
    /// Binary: [13] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
    CasinoGameMove { session_id: u64, payload: Vec<u8> },

    /// Player action to toggle modifiers (shield, double, super).
    /// Binary: [14] [action:u8]
    /// - Shield/Double: Tournament-only (validation enforced in handler)
    /// - Super: Both cash and tournament games
    CasinoPlayerAction { action: crate::casino::PlayerAction },

    /// Admin: Set a player's daily tournament limit.
    /// Binary: [15] [player:PublicKey] [dailyLimit:u8]
    CasinoSetTournamentLimit {
        player: PublicKey,
        daily_limit: u8,
    },

    /// Join a tournament.
    /// Binary: [16] [tournamentId:u64 BE]
    CasinoJoinTournament { tournament_id: u64 },

    /// Start a tournament (transitions from Registration to Active phase).
    /// Also resets all joined players' chips/shields/doubles to starting values.
    /// Binary: [17] [tournamentId:u64 BE] [startTimeMs:u64 BE] [endTimeMs:u64 BE]
    CasinoStartTournament {
        tournament_id: u64,
        start_time_ms: u64,
        end_time_ms: u64,
    },

    // Global table instructions (tags 60-66)
    /// Initialize or update global table config.
    /// Binary: [60] [config:GlobalTableConfig]
    GlobalTableInit {
        config: crate::casino::GlobalTableConfig,
    },

    /// Open a new global table round.
    /// Binary: [61] [gameType:u8]
    GlobalTableOpenRound {
        game_type: crate::casino::GameType,
    },

    /// Submit bets for the current round.
    /// Binary: [62] [gameType:u8] [roundId:u64 BE] [bets:Vec<GlobalTableBet>]
    GlobalTableSubmitBets {
        game_type: crate::casino::GameType,
        round_id: u64,
        bets: Vec<crate::casino::GlobalTableBet>,
    },

    /// Lock the current round (bets closed).
    /// Binary: [63] [gameType:u8] [roundId:u64 BE]
    GlobalTableLock {
        game_type: crate::casino::GameType,
        round_id: u64,
    },

    /// Reveal the round outcome (roll/spin).
    /// Binary: [64] [gameType:u8] [roundId:u64 BE]
    GlobalTableReveal {
        game_type: crate::casino::GameType,
        round_id: u64,
    },

    /// Settle a player's outcome for a round.
    /// Binary: [65] [gameType:u8] [roundId:u64 BE]
    GlobalTableSettle {
        game_type: crate::casino::GameType,
        round_id: u64,
    },

    /// Finalize a round and enter cooldown.
    /// Binary: [66] [gameType:u8] [roundId:u64 BE]
    GlobalTableFinalize {
        game_type: crate::casino::GameType,
        round_id: u64,
    },

    // Staking & House Instructions (tags 18-21)
    /// Stake chips for voting power and rewards.
    /// Binary: [18] [amount:u64 BE] [duration:u64 BE]
    Stake { amount: u64, duration: u64 },

    /// Unstake chips after lockup period.
    /// Binary: [19]
    Unstake,

    /// Claim staking rewards.
    /// Binary: [20]
    ClaimRewards,

    /// Trigger end-of-epoch processing (admin/keeper only).
    /// Binary: [21]
    ProcessEpoch,

    // Virtual Liquidity / Vault Instructions (tags 22-25)
    /// Create a new Vault (CDP).
    /// Binary: [22]
    CreateVault,

    /// Deposit RNG collateral into vault.
    /// Binary: [23] [amount:u64 BE]
    DepositCollateral { amount: u64 },

    /// Borrow vUSDT against collateral.
    /// Binary: [24] [amount:u64 BE]
    BorrowUSDT { amount: u64 },

    /// Repay vUSDT debt.
    /// Binary: [25] [amount:u64 BE]
    RepayUSDT { amount: u64 },

    // AMM Instructions (tags 26-28)
    /// Swap tokens on the AMM.
    /// Binary: [26] [amountIn:u64 BE] [minAmountOut:u64 BE] [isBuyingRng:u8]
    Swap {
        amount_in: u64,
        min_amount_out: u64,
        is_buying_rng: bool,
    },

    /// Add liquidity to AMM.
    /// Binary: [27] [rngAmount:u64 BE] [usdtAmount:u64 BE]
    AddLiquidity { rng_amount: u64, usdt_amount: u64 },

    /// Remove liquidity from AMM.
    /// Binary: [28] [shares:u64 BE]
    RemoveLiquidity { shares: u64 },

    /// End a tournament and distribute prizes.
    /// Binary: [29] [tournamentId:u64 BE]
    CasinoEndTournament { tournament_id: u64 },

    /// Liquidate an undercollateralized vault.
    /// Binary: [30] [target:PublicKey]
    LiquidateVault { target: PublicKey },

    /// Admin: update economy policy parameters.
    /// Binary: [31] [policy:PolicyState]
    SetPolicy { policy: crate::casino::PolicyState },

    /// Admin: set treasury allocation ledger.
    /// Binary: [32] [treasury:TreasuryState]
    SetTreasury { treasury: crate::casino::TreasuryState },

    /// Admin: fund recovery pool balance.
    /// Binary: [33] [amount:u64 BE]
    FundRecoveryPool { amount: u64 },

    /// Admin: retire vUSDT debt using recovery pool.
    /// Binary: [34] [target:PublicKey] [amount:u64 BE]
    RetireVaultDebt { target: PublicKey, amount: u64 },

    /// Admin: retire vUSDT debt using recovery pool, selecting highest-risk vault.
    /// Binary: [35] [amount:u64 BE]
    RetireWorstVaultDebt { amount: u64 },

    /// Deposit vUSDT into the savings pool.
    /// Binary: [36] [amount:u64 BE]
    DepositSavings { amount: u64 },

    /// Withdraw vUSDT from the savings pool.
    /// Binary: [37] [amount:u64 BE]
    WithdrawSavings { amount: u64 },

    /// Claim accrued savings rewards.
    /// Binary: [38]
    ClaimSavingsRewards,

    /// Admin: seed the AMM reserves and set a bootstrap price.
    /// Binary: [39] [rngAmount:u64 BE] [usdtAmount:u64 BE] [bootstrapPriceVusdtNumerator:u64 BE] [bootstrapPriceRngDenominator:u64 BE]
    SeedAmm {
        rng_amount: u64,
        usdt_amount: u64,
        bootstrap_price_vusdt_numerator: u64,
        bootstrap_price_rng_denominator: u64,
    },

    /// Admin: finalize a bootstrap price snapshot for the AMM.
    /// Binary: [40]
    FinalizeAmmBootstrap,

    /// Admin: set treasury vesting schedules.
    /// Binary: [41] [vesting:TreasuryVestingState]
    SetTreasuryVesting {
        vesting: crate::casino::TreasuryVestingState,
    },

    /// Admin: release vested treasury allocation.
    /// Binary: [42] [bucket:TreasuryBucket] [amount:u64 BE]
    ReleaseTreasuryAllocation {
        bucket: crate::casino::TreasuryBucket,
        amount: u64,
    },

    /// Bridge: request a withdrawal to EVM.
    /// Binary: [43] [amount:u64 BE] [destination:bytes]
    BridgeWithdraw {
        amount: u64,
        destination: Vec<u8>,
    },

    /// Bridge: credit a deposit from EVM (admin-only).
    /// Binary: [44] [recipient:PublicKey] [amount:u64 BE] [source:bytes]
    BridgeDeposit {
        recipient: ed25519::PublicKey,
        amount: u64,
        source: Vec<u8>,
    },

    /// Bridge: finalize a withdrawal after relayer execution (admin-only).
    /// Binary: [45] [withdrawalId:u64 BE] [source:bytes]
    FinalizeBridgeWithdrawal {
        withdrawal_id: u64,
        source: Vec<u8>,
    },

    /// Oracle: update price feed (admin-only).
    /// Binary: [46] [priceVusdtNumerator:u64 BE] [priceRngDenominator:u64 BE] [updatedTs:u64 BE] [source:bytes]
    UpdateOracle {
        price_vusdt_numerator: u64,
        price_rng_denominator: u64,
        updated_ts: u64,
        source: Vec<u8>,
    },
}

impl Write for Instruction {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Casino instructions (tags 10-17)
            Self::CasinoRegister { name } => {
                tags::instruction::CASINO_REGISTER.write(writer);
                (name.len() as u32).write(writer);
                writer.put_slice(name.as_bytes());
            }
            Self::CasinoDeposit { amount } => {
                tags::instruction::CASINO_DEPOSIT.write(writer);
                amount.write(writer);
            }
            Self::CasinoStartGame {
                game_type,
                bet,
                session_id,
            } => {
                tags::instruction::CASINO_START_GAME.write(writer);
                game_type.write(writer);
                bet.write(writer);
                session_id.write(writer);
            }
            Self::CasinoGameMove {
                session_id,
                payload,
            } => {
                tags::instruction::CASINO_GAME_MOVE.write(writer);
                session_id.write(writer);
                (payload.len() as u32).write(writer);
                writer.put_slice(payload);
            }
            Self::CasinoPlayerAction { action } => {
                tags::instruction::CASINO_PLAYER_ACTION.write(writer);
                action.write(writer);
            }
            Self::CasinoSetTournamentLimit {
                player,
                daily_limit,
            } => {
                tags::instruction::CASINO_SET_TOURNAMENT_LIMIT.write(writer);
                player.write(writer);
                daily_limit.write(writer);
            }
            Self::CasinoJoinTournament { tournament_id } => {
                tags::instruction::CASINO_JOIN_TOURNAMENT.write(writer);
                tournament_id.write(writer);
            }
            Self::CasinoStartTournament {
                tournament_id,
                start_time_ms,
                end_time_ms,
            } => {
                tags::instruction::CASINO_START_TOURNAMENT.write(writer);
                tournament_id.write(writer);
                start_time_ms.write(writer);
                end_time_ms.write(writer);
            }

            // Global table (60-66)
            Self::GlobalTableInit { config } => {
                tags::instruction::CASINO_GLOBAL_TABLE_INIT.write(writer);
                config.write(writer);
            }
            Self::GlobalTableOpenRound { game_type } => {
                tags::instruction::CASINO_GLOBAL_TABLE_OPEN_ROUND.write(writer);
                game_type.write(writer);
            }
            Self::GlobalTableSubmitBets {
                game_type,
                round_id,
                bets,
            } => {
                tags::instruction::CASINO_GLOBAL_TABLE_SUBMIT_BETS.write(writer);
                game_type.write(writer);
                round_id.write(writer);
                bets.write(writer);
            }
            Self::GlobalTableLock {
                game_type,
                round_id,
            } => {
                tags::instruction::CASINO_GLOBAL_TABLE_LOCK.write(writer);
                game_type.write(writer);
                round_id.write(writer);
            }
            Self::GlobalTableReveal {
                game_type,
                round_id,
            } => {
                tags::instruction::CASINO_GLOBAL_TABLE_REVEAL.write(writer);
                game_type.write(writer);
                round_id.write(writer);
            }
            Self::GlobalTableSettle {
                game_type,
                round_id,
            } => {
                tags::instruction::CASINO_GLOBAL_TABLE_SETTLE.write(writer);
                game_type.write(writer);
                round_id.write(writer);
            }
            Self::GlobalTableFinalize {
                game_type,
                round_id,
            } => {
                tags::instruction::CASINO_GLOBAL_TABLE_FINALIZE.write(writer);
                game_type.write(writer);
                round_id.write(writer);
            }

            // Staking (18-21)
            Self::Stake { amount, duration } => {
                tags::instruction::STAKE.write(writer);
                amount.write(writer);
                duration.write(writer);
            }
            Self::Unstake => tags::instruction::UNSTAKE.write(writer),
            Self::ClaimRewards => tags::instruction::CLAIM_REWARDS.write(writer),
            Self::ProcessEpoch => tags::instruction::PROCESS_EPOCH.write(writer),

            // Vaults (22-25)
            Self::CreateVault => tags::instruction::CREATE_VAULT.write(writer),
            Self::DepositCollateral { amount } => {
                tags::instruction::DEPOSIT_COLLATERAL.write(writer);
                amount.write(writer);
            }
            Self::BorrowUSDT { amount } => {
                tags::instruction::BORROW_USDT.write(writer);
                amount.write(writer);
            }
            Self::RepayUSDT { amount } => {
                tags::instruction::REPAY_USDT.write(writer);
                amount.write(writer);
            }

            // AMM (26-28)
            Self::Swap {
                amount_in,
                min_amount_out,
                is_buying_rng,
            } => {
                tags::instruction::SWAP.write(writer);
                amount_in.write(writer);
                min_amount_out.write(writer);
                is_buying_rng.write(writer);
            }
            Self::AddLiquidity {
                rng_amount,
                usdt_amount,
            } => {
                tags::instruction::ADD_LIQUIDITY.write(writer);
                rng_amount.write(writer);
                usdt_amount.write(writer);
            }
            Self::RemoveLiquidity { shares } => {
                tags::instruction::REMOVE_LIQUIDITY.write(writer);
                shares.write(writer);
            }
            Self::CasinoEndTournament { tournament_id } => {
                tags::instruction::CASINO_END_TOURNAMENT.write(writer);
                tournament_id.write(writer);
            }
            Self::LiquidateVault { target } => {
                tags::instruction::LIQUIDATE_VAULT.write(writer);
                target.write(writer);
            }
            Self::SetPolicy { policy } => {
                tags::instruction::SET_POLICY.write(writer);
                policy.write(writer);
            }
            Self::SetTreasury { treasury } => {
                tags::instruction::SET_TREASURY.write(writer);
                treasury.write(writer);
            }
            Self::FundRecoveryPool { amount } => {
                tags::instruction::FUND_RECOVERY_POOL.write(writer);
                amount.write(writer);
            }
            Self::RetireVaultDebt { target, amount } => {
                tags::instruction::RETIRE_VAULT_DEBT.write(writer);
                target.write(writer);
                amount.write(writer);
            }
            Self::RetireWorstVaultDebt { amount } => {
                tags::instruction::RETIRE_WORST_VAULT_DEBT.write(writer);
                amount.write(writer);
            }
            Self::DepositSavings { amount } => {
                tags::instruction::DEPOSIT_SAVINGS.write(writer);
                amount.write(writer);
            }
            Self::WithdrawSavings { amount } => {
                tags::instruction::WITHDRAW_SAVINGS.write(writer);
                amount.write(writer);
            }
            Self::ClaimSavingsRewards => {
                tags::instruction::CLAIM_SAVINGS_REWARDS.write(writer);
            }
            Self::SeedAmm {
                rng_amount,
                usdt_amount,
                bootstrap_price_vusdt_numerator,
                bootstrap_price_rng_denominator,
            } => {
                tags::instruction::SEED_AMM.write(writer);
                rng_amount.write(writer);
                usdt_amount.write(writer);
                bootstrap_price_vusdt_numerator.write(writer);
                bootstrap_price_rng_denominator.write(writer);
            }
            Self::FinalizeAmmBootstrap => {
                tags::instruction::FINALIZE_AMM_BOOTSTRAP.write(writer);
            }
            Self::SetTreasuryVesting { vesting } => {
                tags::instruction::SET_TREASURY_VESTING.write(writer);
                vesting.write(writer);
            }
            Self::ReleaseTreasuryAllocation { bucket, amount } => {
                tags::instruction::RELEASE_TREASURY_ALLOCATION.write(writer);
                bucket.write(writer);
                amount.write(writer);
            }
            Self::BridgeWithdraw {
                amount,
                destination,
            } => {
                tags::instruction::BRIDGE_WITHDRAW.write(writer);
                amount.write(writer);
                destination.write(writer);
            }
            Self::BridgeDeposit {
                recipient,
                amount,
                source,
            } => {
                tags::instruction::BRIDGE_DEPOSIT.write(writer);
                recipient.write(writer);
                amount.write(writer);
                source.write(writer);
            }
            Self::FinalizeBridgeWithdrawal {
                withdrawal_id,
                source,
            } => {
                tags::instruction::FINALIZE_BRIDGE_WITHDRAWAL.write(writer);
                withdrawal_id.write(writer);
                source.write(writer);
            }
            Self::UpdateOracle {
                price_vusdt_numerator,
                price_rng_denominator,
                updated_ts,
                source,
            } => {
                tags::instruction::UPDATE_ORACLE.write(writer);
                price_vusdt_numerator.write(writer);
                price_rng_denominator.write(writer);
                updated_ts.write(writer);
                source.write(writer);
            }
        }
    }
}

/// Maximum name length for casino player registration
pub const CASINO_MAX_NAME_LENGTH: usize = crate::casino::MAX_NAME_LENGTH;

/// Maximum payload length for casino game moves
pub const CASINO_MAX_PAYLOAD_LENGTH: usize = crate::casino::MAX_PAYLOAD_LENGTH;

impl Read for Instruction {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        let instruction = match kind {
            // Casino instructions (tags 10-17)
            tags::instruction::CASINO_REGISTER => {
                let name_len = u32::read(reader)? as usize;
                if name_len > CASINO_MAX_NAME_LENGTH {
                    return Err(Error::Invalid("Instruction", "casino name too long"));
                }
                if reader.remaining() < name_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut name_bytes = vec![0u8; name_len];
                reader.copy_to_slice(&mut name_bytes);
                let name = String::from_utf8(name_bytes)
                    .map_err(|_| Error::Invalid("Instruction", "invalid UTF-8 in casino name"))?;
                Self::CasinoRegister { name }
            }
            tags::instruction::CASINO_DEPOSIT => Self::CasinoDeposit {
                amount: u64::read(reader)?,
            },
            tags::instruction::CASINO_START_GAME => Self::CasinoStartGame {
                game_type: crate::casino::GameType::read(reader)?,
                bet: u64::read(reader)?,
                session_id: u64::read(reader)?,
            },
            tags::instruction::CASINO_GAME_MOVE => {
                let session_id = u64::read(reader)?;
                let payload_len = u32::read(reader)? as usize;
                if payload_len > CASINO_MAX_PAYLOAD_LENGTH {
                    return Err(Error::Invalid("Instruction", "casino payload too long"));
                }
                if reader.remaining() < payload_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut payload = vec![0u8; payload_len];
                reader.copy_to_slice(&mut payload);
                Self::CasinoGameMove {
                    session_id,
                    payload,
                }
            }
            tags::instruction::CASINO_PLAYER_ACTION => Self::CasinoPlayerAction {
                action: crate::casino::PlayerAction::read(reader)?,
            },
            tags::instruction::CASINO_SET_TOURNAMENT_LIMIT => Self::CasinoSetTournamentLimit {
                player: PublicKey::read(reader)?,
                daily_limit: u8::read(reader)?,
            },
            tags::instruction::CASINO_JOIN_TOURNAMENT => Self::CasinoJoinTournament {
                tournament_id: u64::read(reader)?,
            },
            tags::instruction::CASINO_START_TOURNAMENT => Self::CasinoStartTournament {
                tournament_id: u64::read(reader)?,
                start_time_ms: u64::read(reader)?,
                end_time_ms: u64::read(reader)?,
            },

            tags::instruction::CASINO_GLOBAL_TABLE_INIT => Self::GlobalTableInit {
                config: crate::casino::GlobalTableConfig::read(reader)?,
            },
            tags::instruction::CASINO_GLOBAL_TABLE_OPEN_ROUND => Self::GlobalTableOpenRound {
                game_type: crate::casino::GameType::read(reader)?,
            },
            tags::instruction::CASINO_GLOBAL_TABLE_SUBMIT_BETS => {
                let game_type = crate::casino::GameType::read(reader)?;
                let round_id = u64::read(reader)?;
                let bets = Vec::<crate::casino::GlobalTableBet>::read_range(
                    reader,
                    crate::casino::global_table_bets_cfg(),
                )?;
                Self::GlobalTableSubmitBets {
                    game_type,
                    round_id,
                    bets,
                }
            }
            tags::instruction::CASINO_GLOBAL_TABLE_LOCK => Self::GlobalTableLock {
                game_type: crate::casino::GameType::read(reader)?,
                round_id: u64::read(reader)?,
            },
            tags::instruction::CASINO_GLOBAL_TABLE_REVEAL => Self::GlobalTableReveal {
                game_type: crate::casino::GameType::read(reader)?,
                round_id: u64::read(reader)?,
            },
            tags::instruction::CASINO_GLOBAL_TABLE_SETTLE => Self::GlobalTableSettle {
                game_type: crate::casino::GameType::read(reader)?,
                round_id: u64::read(reader)?,
            },
            tags::instruction::CASINO_GLOBAL_TABLE_FINALIZE => Self::GlobalTableFinalize {
                game_type: crate::casino::GameType::read(reader)?,
                round_id: u64::read(reader)?,
            },

            // Staking (18-21)
            tags::instruction::STAKE => Self::Stake {
                amount: u64::read(reader)?,
                duration: u64::read(reader)?,
            },
            tags::instruction::UNSTAKE => Self::Unstake,
            tags::instruction::CLAIM_REWARDS => Self::ClaimRewards,
            tags::instruction::PROCESS_EPOCH => Self::ProcessEpoch,

            // Vaults (22-25)
            tags::instruction::CREATE_VAULT => Self::CreateVault,
            tags::instruction::DEPOSIT_COLLATERAL => Self::DepositCollateral {
                amount: u64::read(reader)?,
            },
            tags::instruction::BORROW_USDT => Self::BorrowUSDT {
                amount: u64::read(reader)?,
            },
            tags::instruction::REPAY_USDT => Self::RepayUSDT {
                amount: u64::read(reader)?,
            },

            // AMM (26-28)
            tags::instruction::SWAP => Self::Swap {
                amount_in: u64::read(reader)?,
                min_amount_out: u64::read(reader)?,
                is_buying_rng: bool::read(reader)?,
            },
            tags::instruction::ADD_LIQUIDITY => Self::AddLiquidity {
                rng_amount: u64::read(reader)?,
                usdt_amount: u64::read(reader)?,
            },
            tags::instruction::REMOVE_LIQUIDITY => Self::RemoveLiquidity {
                shares: u64::read(reader)?,
            },
            tags::instruction::CASINO_END_TOURNAMENT => Self::CasinoEndTournament {
                tournament_id: u64::read(reader)?,
            },
            tags::instruction::LIQUIDATE_VAULT => Self::LiquidateVault {
                target: PublicKey::read(reader)?,
            },
            tags::instruction::SET_POLICY => Self::SetPolicy {
                policy: crate::casino::PolicyState::read(reader)?,
            },
            tags::instruction::SET_TREASURY => Self::SetTreasury {
                treasury: crate::casino::TreasuryState::read(reader)?,
            },
            tags::instruction::FUND_RECOVERY_POOL => Self::FundRecoveryPool {
                amount: u64::read(reader)?,
            },
            tags::instruction::RETIRE_VAULT_DEBT => Self::RetireVaultDebt {
                target: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
            },
            tags::instruction::RETIRE_WORST_VAULT_DEBT => Self::RetireWorstVaultDebt {
                amount: u64::read(reader)?,
            },
            tags::instruction::DEPOSIT_SAVINGS => Self::DepositSavings {
                amount: u64::read(reader)?,
            },
            tags::instruction::WITHDRAW_SAVINGS => Self::WithdrawSavings {
                amount: u64::read(reader)?,
            },
            tags::instruction::CLAIM_SAVINGS_REWARDS => Self::ClaimSavingsRewards,
            tags::instruction::SEED_AMM => Self::SeedAmm {
                rng_amount: u64::read(reader)?,
                usdt_amount: u64::read(reader)?,
                bootstrap_price_vusdt_numerator: u64::read(reader)?,
                bootstrap_price_rng_denominator: u64::read(reader)?,
            },
            tags::instruction::FINALIZE_AMM_BOOTSTRAP => Self::FinalizeAmmBootstrap,
            tags::instruction::SET_TREASURY_VESTING => Self::SetTreasuryVesting {
                vesting: crate::casino::TreasuryVestingState::read(reader)?,
            },
            tags::instruction::RELEASE_TREASURY_ALLOCATION => Self::ReleaseTreasuryAllocation {
                bucket: crate::casino::TreasuryBucket::read(reader)?,
                amount: u64::read(reader)?,
            },
            tags::instruction::BRIDGE_WITHDRAW => Self::BridgeWithdraw {
                amount: u64::read(reader)?,
                destination: Vec::<u8>::read_range(reader, 0..=64)?,
            },
            tags::instruction::BRIDGE_DEPOSIT => Self::BridgeDeposit {
                recipient: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                source: Vec::<u8>::read_range(reader, 0..=64)?,
            },
            tags::instruction::FINALIZE_BRIDGE_WITHDRAWAL => Self::FinalizeBridgeWithdrawal {
                withdrawal_id: u64::read(reader)?,
                source: Vec::<u8>::read_range(reader, 0..=64)?,
            },
            tags::instruction::UPDATE_ORACLE => Self::UpdateOracle {
                price_vusdt_numerator: u64::read(reader)?,
                price_rng_denominator: u64::read(reader)?,
                updated_ts: u64::read(reader)?,
                source: Vec::<u8>::read_range(reader, 0..=64)?,
            },

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(instruction)
    }
}

impl EncodeSize for Instruction {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Casino
                Self::CasinoRegister { name } => 4 + name.len(),
                Self::CasinoDeposit { .. } => 8,
                Self::CasinoStartGame { .. } => 1 + 8 + 8,
                Self::CasinoGameMove { payload, .. } => 8 + 4 + payload.len(),
                Self::CasinoPlayerAction { .. } => 1, // PlayerAction is 1 byte
                Self::CasinoSetTournamentLimit { player, daily_limit } => {
                    player.encode_size() + daily_limit.encode_size()
                }
                Self::CasinoJoinTournament { .. } => 8,
                Self::CasinoStartTournament { .. } => 8 + 8 + 8,
                Self::GlobalTableInit { config } => config.encode_size(),
                Self::GlobalTableOpenRound { game_type } => game_type.encode_size(),
                Self::GlobalTableSubmitBets {
                    game_type,
                    round_id,
                    bets,
                } => {
                    game_type.encode_size()
                        + round_id.encode_size()
                        + bets.encode_size()
                }
                Self::GlobalTableLock {
                    game_type,
                    round_id,
                }
                | Self::GlobalTableReveal {
                    game_type,
                    round_id,
                }
                | Self::GlobalTableSettle {
                    game_type,
                    round_id,
                }
                | Self::GlobalTableFinalize {
                    game_type,
                    round_id,
                } => game_type.encode_size() + round_id.encode_size(),

                // Staking
                Self::Stake { amount, duration } => amount.encode_size() + duration.encode_size(),
                Self::Unstake | Self::ClaimRewards | Self::ProcessEpoch => 0,

                // Vaults
                Self::CreateVault => 0,
                Self::DepositCollateral { amount }
                | Self::BorrowUSDT { amount }
                | Self::RepayUSDT { amount } => amount.encode_size(),

                // AMM
                Self::Swap {
                    amount_in,
                    min_amount_out,
                    is_buying_rng,
                } => {
                    amount_in.encode_size()
                        + min_amount_out.encode_size()
                        + is_buying_rng.encode_size()
                }
                Self::AddLiquidity {
                    rng_amount,
                    usdt_amount,
                } => rng_amount.encode_size() + usdt_amount.encode_size(),
                Self::RemoveLiquidity { shares } => shares.encode_size(),
                Self::CasinoEndTournament { tournament_id } => tournament_id.encode_size(),
                Self::LiquidateVault { target } => target.encode_size(),
                Self::SetPolicy { policy } => policy.encode_size(),
                Self::SetTreasury { treasury } => treasury.encode_size(),
                Self::FundRecoveryPool { amount } => amount.encode_size(),
                Self::RetireVaultDebt { target, amount } => {
                    target.encode_size() + amount.encode_size()
                }
                Self::RetireWorstVaultDebt { amount } => amount.encode_size(),
                Self::DepositSavings { amount } | Self::WithdrawSavings { amount } => {
                    amount.encode_size()
                }
                Self::ClaimSavingsRewards => 0,
                Self::SeedAmm {
                    rng_amount,
                    usdt_amount,
                    bootstrap_price_vusdt_numerator,
                    bootstrap_price_rng_denominator,
                } => {
                    rng_amount.encode_size()
                        + usdt_amount.encode_size()
                        + bootstrap_price_vusdt_numerator.encode_size()
                        + bootstrap_price_rng_denominator.encode_size()
                }
                Self::FinalizeAmmBootstrap => 0,
                Self::SetTreasuryVesting { vesting } => vesting.encode_size(),
                Self::ReleaseTreasuryAllocation { bucket, amount } => {
                    bucket.encode_size() + amount.encode_size()
                }
                Self::BridgeWithdraw {
                    amount,
                    destination,
                } => amount.encode_size() + destination.encode_size(),
                Self::BridgeDeposit {
                    recipient,
                    amount,
                    source,
                } => recipient.encode_size() + amount.encode_size() + source.encode_size(),
                Self::FinalizeBridgeWithdrawal {
                    withdrawal_id,
                    source,
                } => withdrawal_id.encode_size() + source.encode_size(),
                Self::UpdateOracle {
                    price_vusdt_numerator,
                    price_rng_denominator,
                    updated_ts,
                    source,
                } => {
                    price_vusdt_numerator.encode_size()
                        + price_rng_denominator.encode_size()
                        + updated_ts.encode_size()
                        + source.encode_size()
                }
            }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub parent: Digest,

    pub view: View,
    pub height: u64,

    pub transactions: Vec<Transaction>,

    digest: Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ThisError)]
pub enum BlockBuildError {
    #[error("too many transactions: {got} (max {max})")]
    TooManyTransactions { max: usize, got: usize },
}

impl Block {
    fn compute_digest(
        parent: &Digest,
        view: View,
        height: u64,
        transactions: &[Transaction],
    ) -> Digest {
        let mut hasher = Sha256::new();
        hasher.update(parent);
        hasher.update(&view.get().to_be_bytes());
        hasher.update(&height.to_be_bytes());
        for transaction in transactions {
            hasher.update(&transaction.digest());
        }
        hasher.finalize()
    }

    pub fn new(parent: Digest, view: View, height: u64, transactions: Vec<Transaction>) -> Self {
        let mut transactions = transactions;
        if transactions.len() > MAX_BLOCK_TRANSACTIONS {
            transactions.truncate(MAX_BLOCK_TRANSACTIONS);
        }
        let digest = Self::compute_digest(&parent, view, height, &transactions);
        Self {
            parent,
            view,
            height,
            transactions,
            digest,
        }
    }

    pub fn try_new(
        parent: Digest,
        view: View,
        height: u64,
        transactions: Vec<Transaction>,
    ) -> Result<Self, BlockBuildError> {
        if transactions.len() > MAX_BLOCK_TRANSACTIONS {
            return Err(BlockBuildError::TooManyTransactions {
                max: MAX_BLOCK_TRANSACTIONS,
                got: transactions.len(),
            });
        }
        let digest = Self::compute_digest(&parent, view, height, &transactions);
        Ok(Self {
            parent,
            view,
            height,
            transactions,
            digest,
        })
    }
}

/// The canonical genesis block used by the node.
pub fn genesis_block() -> Block {
    // Use a deterministic, stable parent digest so the genesis commitment is constant.
    // (Digest does not implement Default.)
    let parent = Sha256::hash(b"NULLSPACE_GENESIS");
    Block::new(parent, View::zero(), 0, Vec::new())
}

/// The digest/commitment of the canonical genesis block.
pub fn genesis_digest() -> Digest {
    genesis_block().digest()
}

impl Write for Block {
    fn write(&self, writer: &mut impl BufMut) {
        self.parent.write(writer);
        UInt(self.view.get()).write(writer);
        UInt(self.height).write(writer);
        self.transactions.write(writer);
    }
}

impl Read for Block {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let parent = Digest::read(reader)?;
        let view = View::new(UInt::read(reader)?.into());
        let height = UInt::read(reader)?.into();
        let transactions = Vec::<Transaction>::read_cfg(
            reader,
            &(RangeCfg::from(0..=MAX_BLOCK_TRANSACTIONS), ()),
        )?;

        // Pre-compute the digest
        let digest = Self::compute_digest(&parent, view, height, &transactions);
        Ok(Self {
            parent,
            view,
            height,
            transactions,
            digest,
        })
    }
}

impl EncodeSize for Block {
    fn encode_size(&self) -> usize {
        self.parent.encode_size()
            + UInt(self.view.get()).encode_size()
            + UInt(self.height).encode_size()
            + self.transactions.encode_size()
    }
}

impl Digestible for Block {
    type Digest = Digest;

    fn digest(&self) -> Digest {
        self.digest
    }
}

impl Committable for Block {
    type Commitment = Digest;

    fn commitment(&self) -> Digest {
        self.digest
    }
}

impl commonware_consensus::Block for Block {
    fn parent(&self) -> Digest {
        self.parent
    }

    fn height(&self) -> u64 {
        self.height
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notarized {
    pub proof: Notarization,
    pub block: Block,
}

impl Notarized {
    pub fn new(proof: Notarization, block: Block) -> Self {
        Self { proof, block }
    }

    pub fn verify(&self, namespace: &[u8], identity: &<MinSig as Variant>::Public) -> bool {
        let scheme = ThresholdScheme::certificate_verifier(*identity);
        let mut rng = rand::thread_rng();
        self.proof.verify(&mut rng, &scheme, namespace)
    }
}

impl Write for Notarized {
    fn write(&self, buf: &mut impl BufMut) {
        self.proof.write(buf);
        self.block.write(buf);
    }
}

impl Read for Notarized {
    type Cfg = ();

    fn read_cfg(buf: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let proof = Notarization::read(buf)?;
        let block = Block::read(buf)?;

        // Ensure the proof is for the block
        if proof.proposal.payload != block.digest() {
            return Err(Error::Invalid(
                "types::Notarized",
                "Proof payload does not match block digest",
            ));
        }
        Ok(Self { proof, block })
    }
}

impl EncodeSize for Notarized {
    fn encode_size(&self) -> usize {
        self.proof.encode_size() + self.block.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finalized {
    pub proof: Finalization,
    pub block: Block,
}

impl Finalized {
    pub fn new(proof: Finalization, block: Block) -> Self {
        Self { proof, block }
    }

    pub fn verify(&self, namespace: &[u8], identity: &<MinSig as Variant>::Public) -> bool {
        let scheme = ThresholdScheme::certificate_verifier(*identity);
        let mut rng = rand::thread_rng();
        self.proof.verify(&mut rng, &scheme, namespace)
    }
}

impl Write for Finalized {
    fn write(&self, buf: &mut impl BufMut) {
        self.proof.write(buf);
        self.block.write(buf);
    }
}

impl Read for Finalized {
    type Cfg = ();

    fn read_cfg(buf: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let proof = Finalization::read(buf)?;
        let block = Block::read(buf)?;

        // Ensure the proof is for the block
        if proof.proposal.payload != block.digest() {
            return Err(Error::Invalid(
                "types::Finalized",
                "Proof payload does not match block digest",
            ));
        }
        Ok(Self { proof, block })
    }
}

impl EncodeSize for Finalized {
    fn encode_size(&self) -> usize {
        self.proof.encode_size() + self.block.encode_size()
    }
}

/// The leader for a given seed is determined by the modulo of the seed with the number of participants.
pub fn leader_index(seed: &[u8], participants: usize) -> usize {
    modulo(seed, participants as u64) as usize
}

/// Minimal account structure for transaction nonce tracking.
/// Used for replay protection across all transaction types.
#[derive(Clone, Default, Eq, PartialEq, Debug)]
pub struct Account {
    pub nonce: u64,
}

impl Write for Account {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
    }
}

impl Read for Account {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            nonce: u64::read(reader)?,
        })
    }
}

impl EncodeSize for Account {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
    }
}

#[derive(Hash, Eq, PartialEq, Ord, PartialOrd, Clone)]
pub enum Key {
    /// Account for nonce tracking (tag 0)
    Account(PublicKey),

    // Casino keys (tags 10-13)
    CasinoPlayer(PublicKey),
    CasinoSession(u64),
    CasinoLeaderboard,
    Tournament(u64),

    // Staking & House keys (tags 14-15)
    House,
    Staker(PublicKey),

    // Virtual Liquidity keys (tags 16-17)
    Vault(PublicKey),
    AmmPool,

    // LP Balance (Tag 18)
    LpBalance(PublicKey),

    // Policy + Treasury (Tags 19-20)
    Policy,
    Treasury,
    TreasuryVesting,

    // Registry (Tags 21, 24)
    VaultRegistry,
    PlayerRegistry,

    // Savings (Tags 22-23)
    SavingsPool,
    SavingsBalance(PublicKey),

    // Bridge (Tags 26-27)
    BridgeState,
    BridgeWithdrawal(u64),
    // Oracle (Tag 28)
    OracleState,

    // Global table (Tags 29-31)
    GlobalTableConfig(crate::casino::GameType),
    GlobalTableRound(crate::casino::GameType),
    GlobalTablePlayerSession(crate::casino::GameType, PublicKey),

    // Ledger (Tags 32-33)
    LedgerState,
    LedgerEntry(u64),
}

impl Write for Key {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Account key (tag 0)
            Self::Account(pk) => {
                tags::key::ACCOUNT.write(writer);
                pk.write(writer);
            }

            // Casino keys (tags 10-13)
            Self::CasinoPlayer(pk) => {
                tags::key::CASINO_PLAYER.write(writer);
                pk.write(writer);
            }
            Self::CasinoSession(id) => {
                tags::key::CASINO_SESSION.write(writer);
                id.write(writer);
            }
            Self::CasinoLeaderboard => tags::key::CASINO_LEADERBOARD.write(writer),
            Self::Tournament(id) => {
                tags::key::TOURNAMENT.write(writer);
                id.write(writer);
            }

            // Staking & House
            Self::House => tags::key::HOUSE.write(writer),
            Self::Staker(pk) => {
                tags::key::STAKER.write(writer);
                pk.write(writer);
            }

            // Virtual Liquidity
            Self::Vault(pk) => {
                tags::key::VAULT.write(writer);
                pk.write(writer);
            }
            Self::AmmPool => tags::key::AMM_POOL.write(writer),
            Self::LpBalance(pk) => {
                tags::key::LP_BALANCE.write(writer);
                pk.write(writer);
            }
            Self::Policy => tags::key::POLICY.write(writer),
            Self::Treasury => tags::key::TREASURY.write(writer),
            Self::TreasuryVesting => tags::key::TREASURY_VESTING.write(writer),
            Self::VaultRegistry => tags::key::VAULT_REGISTRY.write(writer),
            Self::PlayerRegistry => tags::key::PLAYER_REGISTRY.write(writer),
            Self::SavingsPool => tags::key::SAVINGS_POOL.write(writer),
            Self::SavingsBalance(pk) => {
                tags::key::SAVINGS_BALANCE.write(writer);
                pk.write(writer);
            }
            Self::BridgeState => tags::key::BRIDGE_STATE.write(writer),
            Self::BridgeWithdrawal(id) => {
                tags::key::BRIDGE_WITHDRAWAL.write(writer);
                id.write(writer);
            }
            Self::OracleState => tags::key::ORACLE_STATE.write(writer),
            Self::GlobalTableConfig(game_type) => {
                tags::key::GLOBAL_TABLE_CONFIG.write(writer);
                game_type.write(writer);
            }
            Self::GlobalTableRound(game_type) => {
                tags::key::GLOBAL_TABLE_ROUND.write(writer);
                game_type.write(writer);
            }
            Self::GlobalTablePlayerSession(game_type, pk) => {
                tags::key::GLOBAL_TABLE_PLAYER_SESSION.write(writer);
                game_type.write(writer);
                pk.write(writer);
            }

            // Ledger
            Self::LedgerState => tags::key::LEDGER_STATE.write(writer),
            Self::LedgerEntry(id) => {
                tags::key::LEDGER_ENTRY.write(writer);
                id.write(writer);
            }
        }
    }
}

impl Read for Key {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        let key = match kind {
            // Account key (tag 0)
            tags::key::ACCOUNT => Self::Account(PublicKey::read(reader)?),

            // Casino keys (tags 10-13)
            tags::key::CASINO_PLAYER => Self::CasinoPlayer(PublicKey::read(reader)?),
            tags::key::CASINO_SESSION => Self::CasinoSession(u64::read(reader)?),
            tags::key::CASINO_LEADERBOARD => Self::CasinoLeaderboard,
            tags::key::TOURNAMENT => Self::Tournament(u64::read(reader)?),

            // Staking & House
            tags::key::HOUSE => Self::House,
            tags::key::STAKER => Self::Staker(PublicKey::read(reader)?),

            // Virtual Liquidity
            tags::key::VAULT => Self::Vault(PublicKey::read(reader)?),
            tags::key::AMM_POOL => Self::AmmPool,
            tags::key::LP_BALANCE => Self::LpBalance(PublicKey::read(reader)?),
            tags::key::POLICY => Self::Policy,
            tags::key::TREASURY => Self::Treasury,
            tags::key::TREASURY_VESTING => Self::TreasuryVesting,
            tags::key::VAULT_REGISTRY => Self::VaultRegistry,
            tags::key::PLAYER_REGISTRY => Self::PlayerRegistry,
            tags::key::SAVINGS_POOL => Self::SavingsPool,
            tags::key::SAVINGS_BALANCE => Self::SavingsBalance(PublicKey::read(reader)?),
            tags::key::BRIDGE_STATE => Self::BridgeState,
            tags::key::BRIDGE_WITHDRAWAL => Self::BridgeWithdrawal(u64::read(reader)?),
            tags::key::ORACLE_STATE => Self::OracleState,
            tags::key::GLOBAL_TABLE_CONFIG => {
                Self::GlobalTableConfig(crate::casino::GameType::read(reader)?)
            }
            tags::key::GLOBAL_TABLE_ROUND => {
                Self::GlobalTableRound(crate::casino::GameType::read(reader)?)
            }
            tags::key::GLOBAL_TABLE_PLAYER_SESSION => {
                let game_type = crate::casino::GameType::read(reader)?;
                let player = PublicKey::read(reader)?;
                Self::GlobalTablePlayerSession(game_type, player)
            }

            // Ledger
            tags::key::LEDGER_STATE => Self::LedgerState,
            tags::key::LEDGER_ENTRY => Self::LedgerEntry(u64::read(reader)?),

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(key)
    }
}

impl EncodeSize for Key {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Account key
                Self::Account(_) => PublicKey::SIZE,

                // Casino keys
                Self::CasinoPlayer(_) => PublicKey::SIZE,
                Self::CasinoSession(_) => u64::SIZE,
                Self::CasinoLeaderboard => 0,
                Self::Tournament(_) => u64::SIZE,

                // Staking & House
                Self::House => 0,
                Self::Staker(_) => PublicKey::SIZE,

                // Virtual Liquidity
                Self::Vault(_) => PublicKey::SIZE,
                Self::AmmPool => 0,
                Self::LpBalance(_) => PublicKey::SIZE,
                Self::Policy => 0,
                Self::Treasury => 0,
                Self::TreasuryVesting => 0,
                Self::VaultRegistry => 0,
                Self::PlayerRegistry => 0,
                Self::SavingsPool => 0,
                Self::SavingsBalance(_) => PublicKey::SIZE,
                Self::BridgeState => 0,
                Self::BridgeWithdrawal(_) => u64::SIZE,
                Self::OracleState => 0,
                Self::GlobalTableConfig(_) => u8::SIZE,
                Self::GlobalTableRound(_) => u8::SIZE,
                Self::GlobalTablePlayerSession(_, _) => u8::SIZE + PublicKey::SIZE,

                // Ledger
                Self::LedgerState => 0,
                Self::LedgerEntry(_) => u64::SIZE,
        }
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
#[allow(clippy::large_enum_variant)]
pub enum Value {
    /// Account for nonce tracking (tag 0)
    Account(Account),

    // System values
    Commit {
        height: u64,
        start: u64,
    },

    // Casino values (tags 10-13)
    CasinoPlayer(crate::casino::Player),
    CasinoSession(crate::casino::GameSession),
    CasinoLeaderboard(crate::casino::CasinoLeaderboard),
    Tournament(crate::casino::Tournament),

    // Staking & House values (tags 14-15)
    House(crate::casino::HouseState),
    Staker(crate::casino::Staker),

    // Virtual Liquidity values (tags 16-17)
    Vault(crate::casino::Vault),
    AmmPool(crate::casino::AmmPool),

    // LP Balance (Tag 18)
    LpBalance(u64),

    // Policy + Treasury (Tags 19-20)
    Policy(crate::casino::PolicyState),
    Treasury(crate::casino::TreasuryState),
    TreasuryVesting(crate::casino::TreasuryVestingState),

    // Registry (Tags 21, 24)
    VaultRegistry(crate::casino::VaultRegistry),
    PlayerRegistry(crate::casino::PlayerRegistry),

    // Savings (Tags 22-23)
    SavingsPool(crate::casino::SavingsPool),
    SavingsBalance(crate::casino::SavingsBalance),

    // Bridge (Tags 26-27)
    BridgeState(crate::casino::BridgeState),
    BridgeWithdrawal(crate::casino::BridgeWithdrawal),
    // Oracle (Tag 28)
    OracleState(crate::casino::OracleState),

    // Global table (Tags 29-31)
    GlobalTableConfig(crate::casino::GlobalTableConfig),
    GlobalTableRound(crate::casino::GlobalTableRound),
    GlobalTablePlayerSession(crate::casino::GlobalTablePlayerSession),

    // Ledger (Tags 32-33)
    LedgerState(crate::casino::LedgerState),
    LedgerEntry(crate::casino::LedgerEntry),
}

impl Write for Value {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Account value (tag 0)
            Self::Account(account) => {
                tags::value::ACCOUNT.write(writer);
                account.write(writer);
            }

            // System values
            Self::Commit { height, start } => {
                tags::value::COMMIT.write(writer);
                height.write(writer);
                start.write(writer);
            }

            // Casino values (tags 10-13)
            Self::CasinoPlayer(player) => {
                tags::value::CASINO_PLAYER.write(writer);
                player.write(writer);
            }
            Self::CasinoSession(session) => {
                tags::value::CASINO_SESSION.write(writer);
                session.write(writer);
            }
            Self::CasinoLeaderboard(leaderboard) => {
                tags::value::CASINO_LEADERBOARD.write(writer);
                leaderboard.write(writer);
            }
            Self::Tournament(tournament) => {
                tags::value::TOURNAMENT.write(writer);
                tournament.write(writer);
            }

            // Staking & House
            Self::House(house) => {
                tags::value::HOUSE.write(writer);
                house.write(writer);
            }
            Self::Staker(staker) => {
                tags::value::STAKER.write(writer);
                staker.write(writer);
            }

            // Virtual Liquidity
            Self::Vault(vault) => {
                tags::value::VAULT.write(writer);
                vault.write(writer);
            }
            Self::AmmPool(pool) => {
                tags::value::AMM_POOL.write(writer);
                pool.write(writer);
            }
            Self::LpBalance(bal) => {
                tags::value::LP_BALANCE.write(writer);
                bal.write(writer);
            }
            Self::Policy(policy) => {
                tags::value::POLICY.write(writer);
                policy.write(writer);
            }
            Self::Treasury(treasury) => {
                tags::value::TREASURY.write(writer);
                treasury.write(writer);
            }
            Self::TreasuryVesting(vesting) => {
                tags::value::TREASURY_VESTING.write(writer);
                vesting.write(writer);
            }
            Self::VaultRegistry(registry) => {
                tags::value::VAULT_REGISTRY.write(writer);
                registry.write(writer);
            }
            Self::PlayerRegistry(registry) => {
                tags::value::PLAYER_REGISTRY.write(writer);
                registry.write(writer);
            }
            Self::SavingsPool(pool) => {
                tags::value::SAVINGS_POOL.write(writer);
                pool.write(writer);
            }
            Self::SavingsBalance(balance) => {
                tags::value::SAVINGS_BALANCE.write(writer);
                balance.write(writer);
            }
            Self::BridgeState(state) => {
                tags::value::BRIDGE_STATE.write(writer);
                state.write(writer);
            }
            Self::BridgeWithdrawal(withdrawal) => {
                tags::value::BRIDGE_WITHDRAWAL.write(writer);
                withdrawal.write(writer);
            }
            Self::OracleState(state) => {
                tags::value::ORACLE_STATE.write(writer);
                state.write(writer);
            }
            Self::GlobalTableConfig(config) => {
                tags::value::GLOBAL_TABLE_CONFIG.write(writer);
                config.write(writer);
            }
            Self::GlobalTableRound(round) => {
                tags::value::GLOBAL_TABLE_ROUND.write(writer);
                round.write(writer);
            }
            Self::GlobalTablePlayerSession(session) => {
                tags::value::GLOBAL_TABLE_PLAYER_SESSION.write(writer);
                session.write(writer);
            }

            // Ledger
            Self::LedgerState(state) => {
                tags::value::LEDGER_STATE.write(writer);
                state.write(writer);
            }
            Self::LedgerEntry(entry) => {
                tags::value::LEDGER_ENTRY.write(writer);
                entry.write(writer);
            }
        }
    }
}

impl Read for Value {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        let value = match kind {
            // Account value (tag 0)
            tags::value::ACCOUNT => Self::Account(Account::read(reader)?),

            // System values
            tags::value::COMMIT => Self::Commit {
                height: u64::read(reader)?,
                start: u64::read(reader)?,
            },

            // Casino values (tags 10-13)
            tags::value::CASINO_PLAYER => Self::CasinoPlayer(crate::casino::Player::read(reader)?),
            tags::value::CASINO_SESSION => {
                Self::CasinoSession(crate::casino::GameSession::read(reader)?)
            }
            tags::value::CASINO_LEADERBOARD => {
                Self::CasinoLeaderboard(crate::casino::CasinoLeaderboard::read(reader)?)
            }
            tags::value::TOURNAMENT => Self::Tournament(crate::casino::Tournament::read(reader)?),

            // Staking & House
            tags::value::HOUSE => Self::House(crate::casino::HouseState::read(reader)?),
            tags::value::STAKER => Self::Staker(crate::casino::Staker::read(reader)?),

            // Virtual Liquidity
            tags::value::VAULT => Self::Vault(crate::casino::Vault::read(reader)?),
            tags::value::AMM_POOL => Self::AmmPool(crate::casino::AmmPool::read(reader)?),
            tags::value::LP_BALANCE => Self::LpBalance(u64::read(reader)?),
            tags::value::POLICY => Self::Policy(crate::casino::PolicyState::read(reader)?),
            tags::value::TREASURY => Self::Treasury(crate::casino::TreasuryState::read(reader)?),
            tags::value::TREASURY_VESTING => {
                Self::TreasuryVesting(crate::casino::TreasuryVestingState::read(reader)?)
            }
            tags::value::VAULT_REGISTRY => {
                Self::VaultRegistry(crate::casino::VaultRegistry::read(reader)?)
            }
            tags::value::PLAYER_REGISTRY => {
                Self::PlayerRegistry(crate::casino::PlayerRegistry::read(reader)?)
            }
            tags::value::SAVINGS_POOL => {
                Self::SavingsPool(crate::casino::SavingsPool::read(reader)?)
            }
            tags::value::SAVINGS_BALANCE => {
                Self::SavingsBalance(crate::casino::SavingsBalance::read(reader)?)
            }
            tags::value::BRIDGE_STATE => {
                Self::BridgeState(crate::casino::BridgeState::read(reader)?)
            }
            tags::value::BRIDGE_WITHDRAWAL => {
                Self::BridgeWithdrawal(crate::casino::BridgeWithdrawal::read(reader)?)
            }
            tags::value::ORACLE_STATE => {
                Self::OracleState(crate::casino::OracleState::read(reader)?)
            }
            tags::value::GLOBAL_TABLE_CONFIG => {
                Self::GlobalTableConfig(crate::casino::GlobalTableConfig::read(reader)?)
            }
            tags::value::GLOBAL_TABLE_ROUND => {
                Self::GlobalTableRound(crate::casino::GlobalTableRound::read(reader)?)
            }
            tags::value::GLOBAL_TABLE_PLAYER_SESSION => Self::GlobalTablePlayerSession(
                crate::casino::GlobalTablePlayerSession::read(reader)?,
            ),

            // Ledger
            tags::value::LEDGER_STATE => {
                Self::LedgerState(crate::casino::LedgerState::read(reader)?)
            }
            tags::value::LEDGER_ENTRY => {
                Self::LedgerEntry(crate::casino::LedgerEntry::read(reader)?)
            }

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(value)
    }
}

impl EncodeSize for Value {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Account value
                Self::Account(account) => account.encode_size(),

                // System values
                Self::Commit { height, start } => height.encode_size() + start.encode_size(),

                // Casino values
                Self::CasinoPlayer(player) => player.encode_size(),
                Self::CasinoSession(session) => session.encode_size(),
                Self::CasinoLeaderboard(leaderboard) => leaderboard.encode_size(),
                Self::Tournament(tournament) => tournament.encode_size(),

                // Staking & House
                Self::House(house) => house.encode_size(),
                Self::Staker(staker) => staker.encode_size(),

                // Virtual Liquidity
                Self::Vault(vault) => vault.encode_size(),
                Self::AmmPool(pool) => pool.encode_size(),
                Self::LpBalance(bal) => bal.encode_size(),
                Self::Policy(policy) => policy.encode_size(),
                Self::Treasury(treasury) => treasury.encode_size(),
                Self::TreasuryVesting(vesting) => vesting.encode_size(),
                Self::VaultRegistry(registry) => registry.encode_size(),
                Self::PlayerRegistry(registry) => registry.encode_size(),
                Self::SavingsPool(pool) => pool.encode_size(),
                Self::SavingsBalance(balance) => balance.encode_size(),
                Self::BridgeState(state) => state.encode_size(),
                Self::BridgeWithdrawal(withdrawal) => withdrawal.encode_size(),
                Self::OracleState(state) => state.encode_size(),
                Self::GlobalTableConfig(config) => config.encode_size(),
                Self::GlobalTableRound(round) => round.encode_size(),
                Self::GlobalTablePlayerSession(session) => session.encode_size(),

                // Ledger
                Self::LedgerState(state) => state.encode_size(),
                Self::LedgerEntry(entry) => entry.encode_size(),
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum Event {
    // Casino events (tags 20-24)
    CasinoPlayerRegistered {
        player: PublicKey,
        name: String,
    },
    CasinoDeposited {
        player: PublicKey,
        amount: u64,
        new_chips: u64,
    },
    CasinoGameStarted {
        session_id: u64,
        player: PublicKey,
        game_type: crate::casino::GameType,
        bet: u64,
        initial_state: Vec<u8>,
    },
    CasinoGameMoved {
        session_id: u64,
        move_number: u32,
        new_state: Vec<u8>,
        logs: Vec<String>,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    CasinoGameCompleted {
        session_id: u64,
        player: PublicKey,
        game_type: crate::casino::GameType,
        payout: i64,
        final_chips: u64,
        was_shielded: bool,
        was_doubled: bool,
        logs: Vec<String>,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    CasinoLeaderboardUpdated {
        leaderboard: crate::casino::CasinoLeaderboard,
    },

    // Error event (tag 29)
    CasinoError {
        player: PublicKey,
        session_id: Option<u64>,
        error_code: u8,
        message: String,
    },

    // Player modifier toggled event (tag 42)
    PlayerModifierToggled {
        player: PublicKey,
        action: crate::casino::PlayerAction,
        active_shield: bool,
        active_double: bool,
        active_super: bool,
    },

    // Tournament events (tags 25-28)
    TournamentStarted {
        id: u64,
        start_block: u64,
    },
    PlayerJoined {
        tournament_id: u64,
        player: PublicKey,
    },
    TournamentPhaseChanged {
        id: u64,
        phase: crate::casino::TournamentPhase,
    },
    TournamentEnded {
        id: u64,
        rankings: Vec<(PublicKey, u64)>,
    },

    // Vault & AMM events (tags 30-36)
    VaultCreated {
        player: PublicKey,
        vault: crate::casino::Vault,
    },
    CollateralDeposited {
        player: PublicKey,
        amount: u64,
        new_collateral: u64,
        vault: crate::casino::Vault,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    VusdtBorrowed {
        player: PublicKey,
        amount: u64,
        new_debt: u64,
        vault: crate::casino::Vault,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    VusdtRepaid {
        player: PublicKey,
        amount: u64,
        new_debt: u64,
        vault: crate::casino::Vault,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    AmmSwapped {
        player: PublicKey,
        is_buying_rng: bool,
        amount_in: u64,
        amount_out: u64,
        fee_amount: u64,
        burned_amount: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
        amm: crate::casino::AmmPool,
        player_balances: crate::casino::PlayerBalanceSnapshot,
        house: crate::casino::HouseState,
    },
    LiquidityAdded {
        player: PublicKey,
        rng_amount: u64,
        vusdt_amount: u64,
        shares_minted: u64,
        total_shares: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
        lp_balance: u64,
        amm: crate::casino::AmmPool,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    LiquidityRemoved {
        player: PublicKey,
        rng_amount: u64,
        vusdt_amount: u64,
        shares_burned: u64,
        total_shares: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
        lp_balance: u64,
        amm: crate::casino::AmmPool,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    AmmBootstrapped {
        admin: PublicKey,
        rng_amount: u64,
        vusdt_amount: u64,
        shares_minted: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
        bootstrap_price_vusdt_numerator: u64,
        bootstrap_price_rng_denominator: u64,
        amm: crate::casino::AmmPool,
        house: crate::casino::HouseState,
    },
    AmmBootstrapFinalized {
        admin: PublicKey,
        price_vusdt_numerator: u64,
        price_rng_denominator: u64,
        finalized_ts: u64,
        amm: crate::casino::AmmPool,
    },

    // Economy admin events (tags 43-47)
    PolicyUpdated {
        policy: crate::casino::PolicyState,
    },
    OracleUpdated {
        admin: PublicKey,
        oracle: crate::casino::OracleState,
    },
    TreasuryUpdated {
        treasury: crate::casino::TreasuryState,
    },
    TreasuryVestingUpdated {
        vesting: crate::casino::TreasuryVestingState,
    },
    TreasuryAllocationReleased {
        admin: PublicKey,
        bucket: crate::casino::TreasuryBucket,
        amount: u64,
        total_released: u64,
        total_vested: u64,
        total_allocation: u64,
    },
    BridgeWithdrawalRequested {
        id: u64,
        player: PublicKey,
        amount: u64,
        destination: Vec<u8>,
        requested_ts: u64,
        available_ts: u64,
        player_balances: crate::casino::PlayerBalanceSnapshot,
        bridge: crate::casino::BridgeState,
    },
    BridgeWithdrawalFinalized {
        id: u64,
        admin: PublicKey,
        amount: u64,
        source: Vec<u8>,
        fulfilled_ts: u64,
        bridge: crate::casino::BridgeState,
    },
    BridgeDepositCredited {
        admin: PublicKey,
        recipient: PublicKey,
        amount: u64,
        source: Vec<u8>,
        player_balances: crate::casino::PlayerBalanceSnapshot,
        bridge: crate::casino::BridgeState,
    },
    VaultLiquidated {
        liquidator: PublicKey,
        target: PublicKey,
        repay_amount: u64,
        collateral_seized: u64,
        remaining_debt: u64,
        remaining_collateral: u64,
        penalty_to_house: u64,
    },
    RecoveryPoolFunded {
        amount: u64,
        new_balance: u64,
    },
    RecoveryPoolRetired {
        target: PublicKey,
        amount: u64,
        new_debt: u64,
        pool_balance: u64,
    },

    // Global table events (tags 60-66)
    GlobalTableRoundOpened {
        round: crate::casino::GlobalTableRound,
    },
    GlobalTableBetAccepted {
        player: PublicKey,
        round_id: u64,
        bets: Vec<crate::casino::GlobalTableBet>,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    GlobalTableBetRejected {
        player: PublicKey,
        round_id: u64,
        error_code: u8,
        message: String,
    },
    GlobalTableLocked {
        game_type: crate::casino::GameType,
        round_id: u64,
        phase_ends_at_ms: u64,
    },
    GlobalTableOutcome {
        round: crate::casino::GlobalTableRound,
    },
    GlobalTablePlayerSettled {
        player: PublicKey,
        round_id: u64,
        payout: i64,
        player_balances: crate::casino::PlayerBalanceSnapshot,
        my_bets: Vec<crate::casino::GlobalTableBet>,
    },
    GlobalTableFinalized {
        game_type: crate::casino::GameType,
        round_id: u64,
    },

    // Savings events (tags 48-50)
    SavingsDeposited {
        player: PublicKey,
        amount: u64,
        new_balance: u64,
        savings_balance: crate::casino::SavingsBalance,
        pool: crate::casino::SavingsPool,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    SavingsWithdrawn {
        player: PublicKey,
        amount: u64,
        new_balance: u64,
        savings_balance: crate::casino::SavingsBalance,
        pool: crate::casino::SavingsPool,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    SavingsRewardsClaimed {
        player: PublicKey,
        amount: u64,
        savings_balance: crate::casino::SavingsBalance,
        pool: crate::casino::SavingsPool,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },

    // Staking events (tags 37-40)
    Staked {
        player: PublicKey,
        amount: u64,
        duration: u64,
        new_balance: u64,
        unlock_ts: u64,
        voting_power: u128,
        staker: crate::casino::Staker,
        house: crate::casino::HouseState,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    Unstaked {
        player: PublicKey,
        amount: u64,
        staker: crate::casino::Staker,
        house: crate::casino::HouseState,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
    EpochProcessed {
        epoch: u64,
        house: crate::casino::HouseState,
    },
    RewardsClaimed {
        player: PublicKey,
        amount: u64,
        staker: crate::casino::Staker,
        house: crate::casino::HouseState,
        player_balances: crate::casino::PlayerBalanceSnapshot,
    },
}

impl Write for Event {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Casino events (tags 20-24)
            Self::CasinoPlayerRegistered { player, name } => {
                tags::event::CASINO_PLAYER_REGISTERED.write(writer);
                player.write(writer);
                (name.len() as u32).write(writer);
                writer.put_slice(name.as_bytes());
            }
            Self::CasinoDeposited {
                player,
                amount,
                new_chips,
            } => {
                tags::event::CASINO_DEPOSITED.write(writer);
                player.write(writer);
                amount.write(writer);
                new_chips.write(writer);
            }
            Self::CasinoGameStarted {
                session_id,
                player,
                game_type,
                bet,
                initial_state,
            } => {
                tags::event::CASINO_GAME_STARTED.write(writer);
                session_id.write(writer);
                player.write(writer);
                game_type.write(writer);
                bet.write(writer);
                initial_state.write(writer);
            }
            Self::CasinoGameMoved {
                session_id,
                move_number,
                new_state,
                logs,
                player_balances,
            } => {
                tags::event::CASINO_GAME_MOVED.write(writer);
                session_id.write(writer);
                move_number.write(writer);
                new_state.write(writer);
                (logs.len() as u32).write(writer);
                for log in logs {
                    (log.len() as u32).write(writer);
                    writer.put_slice(log.as_bytes());
                }
                player_balances.write(writer);
            }
            Self::CasinoGameCompleted {
                session_id,
                player,
                game_type,
                payout,
                final_chips,
                was_shielded,
                was_doubled,
                logs,
                player_balances,
            } => {
                tags::event::CASINO_GAME_COMPLETED.write(writer);
                session_id.write(writer);
                player.write(writer);
                game_type.write(writer);
                payout.write(writer);
                final_chips.write(writer);
                was_shielded.write(writer);
                was_doubled.write(writer);
                (logs.len() as u32).write(writer);
                for log in logs {
                    (log.len() as u32).write(writer);
                    writer.put_slice(log.as_bytes());
                }
                player_balances.write(writer);
            }
            Self::CasinoLeaderboardUpdated { leaderboard } => {
                tags::event::CASINO_LEADERBOARD_UPDATED.write(writer);
                leaderboard.write(writer);
            }
            Self::CasinoError {
                player,
                session_id,
                error_code,
                message,
            } => {
                tags::event::CASINO_ERROR.write(writer);
                player.write(writer);
                session_id.write(writer);
                error_code.write(writer);
                (message.len() as u32).write(writer);
                writer.put_slice(message.as_bytes());
            }
            Self::PlayerModifierToggled {
                player,
                action,
                active_shield,
                active_double,
                active_super,
            } => {
                tags::event::PLAYER_MODIFIER_TOGGLED.write(writer);
                player.write(writer);
                action.write(writer);
                active_shield.write(writer);
                active_double.write(writer);
                active_super.write(writer);
            }

            // Tournament events (tags 25-28)
            Self::TournamentStarted { id, start_block } => {
                tags::event::TOURNAMENT_STARTED.write(writer);
                id.write(writer);
                start_block.write(writer);
            }
            Self::PlayerJoined {
                tournament_id,
                player,
            } => {
                tags::event::PLAYER_JOINED.write(writer);
                tournament_id.write(writer);
                player.write(writer);
            }
            Self::TournamentPhaseChanged { id, phase } => {
                tags::event::TOURNAMENT_PHASE_CHANGED.write(writer);
                id.write(writer);
                phase.write(writer);
            }
            Self::TournamentEnded { id, rankings } => {
                tags::event::TOURNAMENT_ENDED.write(writer);
                id.write(writer);
                rankings.write(writer);
            }

            // Vault & AMM events (tags 30-36)
            Self::VaultCreated { player, vault } => {
                tags::event::VAULT_CREATED.write(writer);
                player.write(writer);
                vault.write(writer);
            }
            Self::CollateralDeposited {
                player,
                amount,
                new_collateral,
                vault,
                player_balances,
            } => {
                tags::event::COLLATERAL_DEPOSITED.write(writer);
                player.write(writer);
                amount.write(writer);
                new_collateral.write(writer);
                vault.write(writer);
                player_balances.write(writer);
            }
            Self::VusdtBorrowed {
                player,
                amount,
                new_debt,
                vault,
                player_balances,
            } => {
                tags::event::VUSDT_BORROWED.write(writer);
                player.write(writer);
                amount.write(writer);
                new_debt.write(writer);
                vault.write(writer);
                player_balances.write(writer);
            }
            Self::VusdtRepaid {
                player,
                amount,
                new_debt,
                vault,
                player_balances,
            } => {
                tags::event::VUSDT_REPAID.write(writer);
                player.write(writer);
                amount.write(writer);
                new_debt.write(writer);
                vault.write(writer);
                player_balances.write(writer);
            }
            Self::AmmSwapped {
                player,
                is_buying_rng,
                amount_in,
                amount_out,
                fee_amount,
                burned_amount,
                reserve_rng,
                reserve_vusdt,
                amm,
                player_balances,
                house,
            } => {
                tags::event::AMM_SWAPPED.write(writer);
                player.write(writer);
                is_buying_rng.write(writer);
                amount_in.write(writer);
                amount_out.write(writer);
                fee_amount.write(writer);
                burned_amount.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
                amm.write(writer);
                player_balances.write(writer);
                house.write(writer);
            }
            Self::LiquidityAdded {
                player,
                rng_amount,
                vusdt_amount,
                shares_minted,
                total_shares,
                reserve_rng,
                reserve_vusdt,
                lp_balance,
                amm,
                player_balances,
            } => {
                tags::event::LIQUIDITY_ADDED.write(writer);
                player.write(writer);
                rng_amount.write(writer);
                vusdt_amount.write(writer);
                shares_minted.write(writer);
                total_shares.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
                lp_balance.write(writer);
                amm.write(writer);
                player_balances.write(writer);
            }
            Self::LiquidityRemoved {
                player,
                rng_amount,
                vusdt_amount,
                shares_burned,
                total_shares,
                reserve_rng,
                reserve_vusdt,
                lp_balance,
                amm,
                player_balances,
            } => {
                tags::event::LIQUIDITY_REMOVED.write(writer);
                player.write(writer);
                rng_amount.write(writer);
                vusdt_amount.write(writer);
                shares_burned.write(writer);
                total_shares.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
                lp_balance.write(writer);
                amm.write(writer);
                player_balances.write(writer);
            }
            Self::AmmBootstrapped {
                admin,
                rng_amount,
                vusdt_amount,
                shares_minted,
                reserve_rng,
                reserve_vusdt,
                bootstrap_price_vusdt_numerator,
                bootstrap_price_rng_denominator,
                amm,
                house,
            } => {
                tags::event::AMM_BOOTSTRAPPED.write(writer);
                admin.write(writer);
                rng_amount.write(writer);
                vusdt_amount.write(writer);
                shares_minted.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
                bootstrap_price_vusdt_numerator.write(writer);
                bootstrap_price_rng_denominator.write(writer);
                amm.write(writer);
                house.write(writer);
            }
            Self::AmmBootstrapFinalized {
                admin,
                price_vusdt_numerator,
                price_rng_denominator,
                finalized_ts,
                amm,
            } => {
                tags::event::AMM_BOOTSTRAP_FINALIZED.write(writer);
                admin.write(writer);
                price_vusdt_numerator.write(writer);
                price_rng_denominator.write(writer);
                finalized_ts.write(writer);
                amm.write(writer);
            }

            // Economy admin events (tags 43-47)
            Self::PolicyUpdated { policy } => {
                tags::event::POLICY_UPDATED.write(writer);
                policy.write(writer);
            }
            Self::OracleUpdated { admin, oracle } => {
                tags::event::ORACLE_UPDATED.write(writer);
                admin.write(writer);
                oracle.write(writer);
            }
            Self::TreasuryUpdated { treasury } => {
                tags::event::TREASURY_UPDATED.write(writer);
                treasury.write(writer);
            }
            Self::TreasuryVestingUpdated { vesting } => {
                tags::event::TREASURY_VESTING_UPDATED.write(writer);
                vesting.write(writer);
            }
            Self::TreasuryAllocationReleased {
                admin,
                bucket,
                amount,
                total_released,
                total_vested,
                total_allocation,
            } => {
                tags::event::TREASURY_ALLOCATION_RELEASED.write(writer);
                admin.write(writer);
                bucket.write(writer);
                amount.write(writer);
                total_released.write(writer);
                total_vested.write(writer);
                total_allocation.write(writer);
            }
            Self::BridgeWithdrawalRequested {
                id,
                player,
                amount,
                destination,
                requested_ts,
                available_ts,
                player_balances,
                bridge,
            } => {
                tags::event::BRIDGE_WITHDRAWAL_REQUESTED.write(writer);
                id.write(writer);
                player.write(writer);
                amount.write(writer);
                destination.write(writer);
                requested_ts.write(writer);
                available_ts.write(writer);
                player_balances.write(writer);
                bridge.write(writer);
            }
            Self::BridgeWithdrawalFinalized {
                id,
                admin,
                amount,
                source,
                fulfilled_ts,
                bridge,
            } => {
                tags::event::BRIDGE_WITHDRAWAL_FINALIZED.write(writer);
                id.write(writer);
                admin.write(writer);
                amount.write(writer);
                source.write(writer);
                fulfilled_ts.write(writer);
                bridge.write(writer);
            }
            Self::BridgeDepositCredited {
                admin,
                recipient,
                amount,
                source,
                player_balances,
                bridge,
            } => {
                tags::event::BRIDGE_DEPOSIT_CREDITED.write(writer);
                admin.write(writer);
                recipient.write(writer);
                amount.write(writer);
                source.write(writer);
                player_balances.write(writer);
                bridge.write(writer);
            }
            Self::VaultLiquidated {
                liquidator,
                target,
                repay_amount,
                collateral_seized,
                remaining_debt,
                remaining_collateral,
                penalty_to_house,
            } => {
                tags::event::VAULT_LIQUIDATED.write(writer);
                liquidator.write(writer);
                target.write(writer);
                repay_amount.write(writer);
                collateral_seized.write(writer);
                remaining_debt.write(writer);
                remaining_collateral.write(writer);
                penalty_to_house.write(writer);
            }
            Self::RecoveryPoolFunded { amount, new_balance } => {
                tags::event::RECOVERY_POOL_FUNDED.write(writer);
                amount.write(writer);
                new_balance.write(writer);
            }
            Self::RecoveryPoolRetired {
                target,
                amount,
                new_debt,
                pool_balance,
            } => {
                tags::event::RECOVERY_POOL_RETIRED.write(writer);
                target.write(writer);
                amount.write(writer);
                new_debt.write(writer);
                pool_balance.write(writer);
            }
            Self::GlobalTableRoundOpened { round } => {
                tags::event::GLOBAL_TABLE_ROUND_OPENED.write(writer);
                round.write(writer);
            }
            Self::GlobalTableBetAccepted {
                player,
                round_id,
                bets,
                player_balances,
            } => {
                tags::event::GLOBAL_TABLE_BET_ACCEPTED.write(writer);
                player.write(writer);
                round_id.write(writer);
                bets.write(writer);
                player_balances.write(writer);
            }
            Self::GlobalTableBetRejected {
                player,
                round_id,
                error_code,
                message,
            } => {
                tags::event::GLOBAL_TABLE_BET_REJECTED.write(writer);
                player.write(writer);
                round_id.write(writer);
                error_code.write(writer);
                (message.len() as u32).write(writer);
                writer.put_slice(message.as_bytes());
            }
            Self::GlobalTableLocked {
                game_type,
                round_id,
                phase_ends_at_ms,
            } => {
                tags::event::GLOBAL_TABLE_LOCKED.write(writer);
                game_type.write(writer);
                round_id.write(writer);
                phase_ends_at_ms.write(writer);
            }
            Self::GlobalTableOutcome { round } => {
                tags::event::GLOBAL_TABLE_OUTCOME.write(writer);
                round.write(writer);
            }
            Self::GlobalTablePlayerSettled {
                player,
                round_id,
                payout,
                player_balances,
                my_bets,
            } => {
                tags::event::GLOBAL_TABLE_PLAYER_SETTLED.write(writer);
                player.write(writer);
                round_id.write(writer);
                payout.write(writer);
                player_balances.write(writer);
                my_bets.write(writer);
            }
            Self::GlobalTableFinalized { game_type, round_id } => {
                tags::event::GLOBAL_TABLE_FINALIZED.write(writer);
                game_type.write(writer);
                round_id.write(writer);
            }
            Self::SavingsDeposited {
                player,
                amount,
                new_balance,
                savings_balance,
                pool,
                player_balances,
            } => {
                tags::event::SAVINGS_DEPOSITED.write(writer);
                player.write(writer);
                amount.write(writer);
                new_balance.write(writer);
                savings_balance.write(writer);
                pool.write(writer);
                player_balances.write(writer);
            }
            Self::SavingsWithdrawn {
                player,
                amount,
                new_balance,
                savings_balance,
                pool,
                player_balances,
            } => {
                tags::event::SAVINGS_WITHDRAWN.write(writer);
                player.write(writer);
                amount.write(writer);
                new_balance.write(writer);
                savings_balance.write(writer);
                pool.write(writer);
                player_balances.write(writer);
            }
            Self::SavingsRewardsClaimed {
                player,
                amount,
                savings_balance,
                pool,
                player_balances,
            } => {
                tags::event::SAVINGS_REWARDS_CLAIMED.write(writer);
                player.write(writer);
                amount.write(writer);
                savings_balance.write(writer);
                pool.write(writer);
                player_balances.write(writer);
            }

            // Staking events (tags 37-40)
            Self::Staked {
                player,
                amount,
                duration,
                new_balance,
                unlock_ts,
                voting_power,
                staker,
                house,
                player_balances,
            } => {
                tags::event::STAKED.write(writer);
                player.write(writer);
                amount.write(writer);
                duration.write(writer);
                new_balance.write(writer);
                unlock_ts.write(writer);
                voting_power.write(writer);
                staker.write(writer);
                house.write(writer);
                player_balances.write(writer);
            }
            Self::Unstaked {
                player,
                amount,
                staker,
                house,
                player_balances,
            } => {
                tags::event::UNSTAKED.write(writer);
                player.write(writer);
                amount.write(writer);
                staker.write(writer);
                house.write(writer);
                player_balances.write(writer);
            }
            Self::EpochProcessed { epoch, house } => {
                tags::event::EPOCH_PROCESSED.write(writer);
                epoch.write(writer);
                house.write(writer);
            }
            Self::RewardsClaimed {
                player,
                amount,
                staker,
                house,
                player_balances,
            } => {
                tags::event::REWARDS_CLAIMED.write(writer);
                player.write(writer);
                amount.write(writer);
                staker.write(writer);
                house.write(writer);
                player_balances.write(writer);
            }
        }
    }
}

impl Read for Event {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        let event = match kind {
            // Casino events (tags 20-24)
            tags::event::CASINO_PLAYER_REGISTERED => {
                let player = PublicKey::read(reader)?;
                let name_len = u32::read(reader)? as usize;
                if name_len > CASINO_MAX_NAME_LENGTH {
                    return Err(Error::Invalid("Event", "casino name too long"));
                }
                if reader.remaining() < name_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut name_bytes = vec![0u8; name_len];
                reader.copy_to_slice(&mut name_bytes);
                let name = String::from_utf8(name_bytes)
                    .map_err(|_| Error::Invalid("Event", "invalid UTF-8 in casino name"))?;
                Self::CasinoPlayerRegistered { player, name }
            }
            tags::event::CASINO_DEPOSITED => Self::CasinoDeposited {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_chips: u64::read(reader)?,
            },
            tags::event::CASINO_GAME_STARTED => Self::CasinoGameStarted {
                session_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                game_type: crate::casino::GameType::read(reader)?,
                bet: u64::read(reader)?,
                initial_state: Vec::<u8>::read_range(reader, 0..=1024)?,
            },
            tags::event::CASINO_GAME_MOVED => Self::CasinoGameMoved {
                session_id: u64::read(reader)?,
                move_number: u32::read(reader)?,
                new_state: Vec::<u8>::read_range(reader, 0..=1024)?,
                logs: {
                    let count = u32::read(reader)? as usize;
                    let mut logs = Vec::with_capacity(count);
                    for _ in 0..count {
                        let len = u32::read(reader)? as usize;
                        if reader.remaining() < len {
                            return Err(Error::EndOfBuffer);
                        }
                        let mut bytes = vec![0u8; len];
                        reader.copy_to_slice(&mut bytes);
                        logs.push(
                            String::from_utf8(bytes)
                                .map_err(|_| Error::Invalid("Event", "invalid UTF-8 log"))?,
                        );
                    }
                    logs
                },
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::CASINO_GAME_COMPLETED => Self::CasinoGameCompleted {
                session_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                game_type: crate::casino::GameType::read(reader)?,
                payout: i64::read(reader)?,
                final_chips: u64::read(reader)?,
                was_shielded: bool::read(reader)?,
                was_doubled: bool::read(reader)?,
                logs: {
                    let count = u32::read(reader)? as usize;
                    let mut logs = Vec::with_capacity(count);
                    for _ in 0..count {
                        let len = u32::read(reader)? as usize;
                        if reader.remaining() < len {
                            return Err(Error::EndOfBuffer);
                        }
                        let mut bytes = vec![0u8; len];
                        reader.copy_to_slice(&mut bytes);
                        logs.push(
                            String::from_utf8(bytes)
                                .map_err(|_| Error::Invalid("Event", "invalid UTF-8 log"))?,
                        );
                    }
                    logs
                },
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::CASINO_LEADERBOARD_UPDATED => Self::CasinoLeaderboardUpdated {
                leaderboard: crate::casino::CasinoLeaderboard::read(reader)?,
            },
            tags::event::CASINO_ERROR => {
                let player = PublicKey::read(reader)?;
                let session_id = Option::<u64>::read(reader)?;
                let error_code = u8::read(reader)?;
                let message_len = u32::read(reader)? as usize;
                const MAX_ERROR_MESSAGE_LENGTH: usize = 256;
                if message_len > MAX_ERROR_MESSAGE_LENGTH {
                    return Err(Error::Invalid("Event", "error message too long"));
                }
                if reader.remaining() < message_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut message_bytes = vec![0u8; message_len];
                reader.copy_to_slice(&mut message_bytes);
                let message = String::from_utf8(message_bytes)
                    .map_err(|_| Error::Invalid("Event", "invalid UTF-8 in error message"))?;
                Self::CasinoError {
                    player,
                    session_id,
                    error_code,
                    message,
                }
            }
            tags::event::PLAYER_MODIFIER_TOGGLED => Self::PlayerModifierToggled {
                player: PublicKey::read(reader)?,
                action: crate::casino::PlayerAction::read(reader)?,
                active_shield: bool::read(reader)?,
                active_double: bool::read(reader)?,
                active_super: bool::read(reader)?,
            },

            // Tournament events (tags 25-28)
            tags::event::TOURNAMENT_STARTED => Self::TournamentStarted {
                id: u64::read(reader)?,
                start_block: u64::read(reader)?,
            },
            tags::event::PLAYER_JOINED => Self::PlayerJoined {
                tournament_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
            },
            tags::event::TOURNAMENT_PHASE_CHANGED => Self::TournamentPhaseChanged {
                id: u64::read(reader)?,
                phase: crate::casino::TournamentPhase::read(reader)?,
            },
            tags::event::TOURNAMENT_ENDED => Self::TournamentEnded {
                id: u64::read(reader)?,
                rankings: Vec::<(PublicKey, u64)>::read_range(reader, 0..=1000)?,
            },

            // Vault & AMM events (tags 30-36)
            tags::event::VAULT_CREATED => Self::VaultCreated {
                player: PublicKey::read(reader)?,
                vault: crate::casino::Vault::read(reader)?,
            },
            tags::event::COLLATERAL_DEPOSITED => Self::CollateralDeposited {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_collateral: u64::read(reader)?,
                vault: crate::casino::Vault::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::VUSDT_BORROWED => Self::VusdtBorrowed {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_debt: u64::read(reader)?,
                vault: crate::casino::Vault::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::VUSDT_REPAID => Self::VusdtRepaid {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_debt: u64::read(reader)?,
                vault: crate::casino::Vault::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::AMM_SWAPPED => Self::AmmSwapped {
                player: PublicKey::read(reader)?,
                is_buying_rng: bool::read(reader)?,
                amount_in: u64::read(reader)?,
                amount_out: u64::read(reader)?,
                fee_amount: u64::read(reader)?,
                burned_amount: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
                amm: crate::casino::AmmPool::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
                house: crate::casino::HouseState::read(reader)?,
            },
            tags::event::LIQUIDITY_ADDED => Self::LiquidityAdded {
                player: PublicKey::read(reader)?,
                rng_amount: u64::read(reader)?,
                vusdt_amount: u64::read(reader)?,
                shares_minted: u64::read(reader)?,
                total_shares: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
                lp_balance: u64::read(reader)?,
                amm: crate::casino::AmmPool::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::LIQUIDITY_REMOVED => Self::LiquidityRemoved {
                player: PublicKey::read(reader)?,
                rng_amount: u64::read(reader)?,
                vusdt_amount: u64::read(reader)?,
                shares_burned: u64::read(reader)?,
                total_shares: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
                lp_balance: u64::read(reader)?,
                amm: crate::casino::AmmPool::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::AMM_BOOTSTRAPPED => Self::AmmBootstrapped {
                admin: PublicKey::read(reader)?,
                rng_amount: u64::read(reader)?,
                vusdt_amount: u64::read(reader)?,
                shares_minted: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
                bootstrap_price_vusdt_numerator: u64::read(reader)?,
                bootstrap_price_rng_denominator: u64::read(reader)?,
                amm: crate::casino::AmmPool::read(reader)?,
                house: crate::casino::HouseState::read(reader)?,
            },
            tags::event::AMM_BOOTSTRAP_FINALIZED => Self::AmmBootstrapFinalized {
                admin: PublicKey::read(reader)?,
                price_vusdt_numerator: u64::read(reader)?,
                price_rng_denominator: u64::read(reader)?,
                finalized_ts: u64::read(reader)?,
                amm: crate::casino::AmmPool::read(reader)?,
            },
            tags::event::POLICY_UPDATED => Self::PolicyUpdated {
                policy: crate::casino::PolicyState::read(reader)?,
            },
            tags::event::ORACLE_UPDATED => Self::OracleUpdated {
                admin: PublicKey::read(reader)?,
                oracle: crate::casino::OracleState::read(reader)?,
            },
            tags::event::TREASURY_UPDATED => Self::TreasuryUpdated {
                treasury: crate::casino::TreasuryState::read(reader)?,
            },
            tags::event::TREASURY_VESTING_UPDATED => Self::TreasuryVestingUpdated {
                vesting: crate::casino::TreasuryVestingState::read(reader)?,
            },
            tags::event::TREASURY_ALLOCATION_RELEASED => Self::TreasuryAllocationReleased {
                admin: PublicKey::read(reader)?,
                bucket: crate::casino::TreasuryBucket::read(reader)?,
                amount: u64::read(reader)?,
                total_released: u64::read(reader)?,
                total_vested: u64::read(reader)?,
                total_allocation: u64::read(reader)?,
            },
            tags::event::BRIDGE_WITHDRAWAL_REQUESTED => Self::BridgeWithdrawalRequested {
                id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                destination: Vec::<u8>::read_range(reader, 0..=64)?,
                requested_ts: u64::read(reader)?,
                available_ts: u64::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
                bridge: crate::casino::BridgeState::read(reader)?,
            },
            tags::event::BRIDGE_WITHDRAWAL_FINALIZED => Self::BridgeWithdrawalFinalized {
                id: u64::read(reader)?,
                admin: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                source: Vec::<u8>::read_range(reader, 0..=64)?,
                fulfilled_ts: u64::read(reader)?,
                bridge: crate::casino::BridgeState::read(reader)?,
            },
            tags::event::BRIDGE_DEPOSIT_CREDITED => Self::BridgeDepositCredited {
                admin: PublicKey::read(reader)?,
                recipient: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                source: Vec::<u8>::read_range(reader, 0..=64)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
                bridge: crate::casino::BridgeState::read(reader)?,
            },
            tags::event::VAULT_LIQUIDATED => Self::VaultLiquidated {
                liquidator: PublicKey::read(reader)?,
                target: PublicKey::read(reader)?,
                repay_amount: u64::read(reader)?,
                collateral_seized: u64::read(reader)?,
                remaining_debt: u64::read(reader)?,
                remaining_collateral: u64::read(reader)?,
                penalty_to_house: u64::read(reader)?,
            },
            tags::event::RECOVERY_POOL_FUNDED => Self::RecoveryPoolFunded {
                amount: u64::read(reader)?,
                new_balance: u64::read(reader)?,
            },
            tags::event::RECOVERY_POOL_RETIRED => Self::RecoveryPoolRetired {
                target: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_debt: u64::read(reader)?,
                pool_balance: u64::read(reader)?,
            },
            tags::event::GLOBAL_TABLE_ROUND_OPENED => Self::GlobalTableRoundOpened {
                round: crate::casino::GlobalTableRound::read(reader)?,
            },
            tags::event::GLOBAL_TABLE_BET_ACCEPTED => Self::GlobalTableBetAccepted {
                player: PublicKey::read(reader)?,
                round_id: u64::read(reader)?,
                bets: Vec::<crate::casino::GlobalTableBet>::read_range(
                    reader,
                    crate::casino::global_table_bets_cfg(),
                )?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::GLOBAL_TABLE_BET_REJECTED => {
                let player = PublicKey::read(reader)?;
                let round_id = u64::read(reader)?;
                let error_code = u8::read(reader)?;
                let message_len = u32::read(reader)? as usize;
                if reader.remaining() < message_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut msg_bytes = vec![0u8; message_len];
                reader.copy_to_slice(&mut msg_bytes);
                let message = String::from_utf8(msg_bytes)
                    .map_err(|_| Error::Invalid("Event", "invalid UTF-8 in global table error"))?;
                Self::GlobalTableBetRejected {
                    player,
                    round_id,
                    error_code,
                    message,
                }
            }
            tags::event::GLOBAL_TABLE_LOCKED => Self::GlobalTableLocked {
                game_type: crate::casino::GameType::read(reader)?,
                round_id: u64::read(reader)?,
                phase_ends_at_ms: u64::read(reader)?,
            },
            tags::event::GLOBAL_TABLE_OUTCOME => Self::GlobalTableOutcome {
                round: crate::casino::GlobalTableRound::read(reader)?,
            },
            tags::event::GLOBAL_TABLE_PLAYER_SETTLED => Self::GlobalTablePlayerSettled {
                player: PublicKey::read(reader)?,
                round_id: u64::read(reader)?,
                payout: i64::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
                my_bets: Vec::<crate::casino::GlobalTableBet>::read_range(
                    reader,
                    crate::casino::global_table_bets_cfg(),
                )?,
            },
            tags::event::GLOBAL_TABLE_FINALIZED => Self::GlobalTableFinalized {
                game_type: crate::casino::GameType::read(reader)?,
                round_id: u64::read(reader)?,
            },
            tags::event::SAVINGS_DEPOSITED => Self::SavingsDeposited {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_balance: u64::read(reader)?,
                savings_balance: crate::casino::SavingsBalance::read(reader)?,
                pool: crate::casino::SavingsPool::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::SAVINGS_WITHDRAWN => Self::SavingsWithdrawn {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_balance: u64::read(reader)?,
                savings_balance: crate::casino::SavingsBalance::read(reader)?,
                pool: crate::casino::SavingsPool::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::SAVINGS_REWARDS_CLAIMED => Self::SavingsRewardsClaimed {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                savings_balance: crate::casino::SavingsBalance::read(reader)?,
                pool: crate::casino::SavingsPool::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::STAKED => Self::Staked {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                duration: u64::read(reader)?,
                new_balance: u64::read(reader)?,
                unlock_ts: u64::read(reader)?,
                voting_power: u128::read(reader)?,
                staker: crate::casino::Staker::read(reader)?,
                house: crate::casino::HouseState::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::UNSTAKED => Self::Unstaked {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                staker: crate::casino::Staker::read(reader)?,
                house: crate::casino::HouseState::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },
            tags::event::EPOCH_PROCESSED => Self::EpochProcessed {
                epoch: u64::read(reader)?,
                house: crate::casino::HouseState::read(reader)?,
            },
            tags::event::REWARDS_CLAIMED => Self::RewardsClaimed {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                staker: crate::casino::Staker::read(reader)?,
                house: crate::casino::HouseState::read(reader)?,
                player_balances: crate::casino::PlayerBalanceSnapshot::read(reader)?,
            },

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(event)
    }
}

impl EncodeSize for Event {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Casino events (tags 20-24)
                Self::CasinoPlayerRegistered { player, name } => {
                    player.encode_size() + 4 + name.len()
                }
                Self::CasinoDeposited {
                    player,
                    amount,
                    new_chips,
                } => player.encode_size() + amount.encode_size() + new_chips.encode_size(),
                Self::CasinoGameStarted {
                    session_id,
                    player,
                    game_type,
                    bet,
                    initial_state,
                } => {
                    session_id.encode_size()
                        + player.encode_size()
                        + game_type.encode_size()
                        + bet.encode_size()
                        + initial_state.encode_size()
                }
                Self::CasinoGameMoved {
                    session_id,
                    move_number,
                    new_state,
                    logs,
                    player_balances,
                } => {
                    session_id.encode_size()
                        + move_number.encode_size()
                        + new_state.encode_size()
                        + 4
                        + logs.iter().map(|s| 4 + s.len()).sum::<usize>()
                        + player_balances.encode_size()
                }
                Self::CasinoGameCompleted {
                    session_id,
                    player,
                    game_type,
                    payout,
                    final_chips,
                    was_shielded,
                    was_doubled,
                    logs,
                    player_balances,
                } => {
                    session_id.encode_size()
                        + player.encode_size()
                        + game_type.encode_size()
                        + payout.encode_size()
                        + final_chips.encode_size()
                        + was_shielded.encode_size()
                        + was_doubled.encode_size()
                        + 4
                        + logs.iter().map(|s| 4 + s.len()).sum::<usize>()
                        + player_balances.encode_size()
                }
                Self::CasinoLeaderboardUpdated { leaderboard } => leaderboard.encode_size(),
                Self::CasinoError {
                    player,
                    session_id,
                    error_code,
                    message,
                } => {
                    player.encode_size()
                        + session_id.encode_size()
                        + error_code.encode_size()
                        + 4
                        + message.len()
                }
                Self::PlayerModifierToggled {
                    player,
                    action,
                    active_shield,
                    active_double,
                    active_super,
                } => {
                    player.encode_size()
                        + action.encode_size()
                        + active_shield.encode_size()
                        + active_double.encode_size()
                        + active_super.encode_size()
                }

                // Tournament events (tags 25-28)
                Self::TournamentStarted { id, start_block } => {
                    id.encode_size() + start_block.encode_size()
                }
                Self::PlayerJoined {
                    tournament_id,
                    player,
                } => tournament_id.encode_size() + player.encode_size(),
                Self::TournamentPhaseChanged { id, phase } => {
                    id.encode_size() + phase.encode_size()
                }
                Self::TournamentEnded { id, rankings } => id.encode_size() + rankings.encode_size(),

                // Vault & AMM events (tags 30-36)
                Self::VaultCreated { player, vault } => {
                    player.encode_size() + vault.encode_size()
                }
                Self::CollateralDeposited {
                    player,
                    amount,
                    new_collateral,
                    vault,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + new_collateral.encode_size()
                        + vault.encode_size()
                        + player_balances.encode_size()
                }
                Self::VusdtBorrowed {
                    player,
                    amount,
                    new_debt,
                    vault,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + new_debt.encode_size()
                        + vault.encode_size()
                        + player_balances.encode_size()
                }
                Self::VusdtRepaid {
                    player,
                    amount,
                    new_debt,
                    vault,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + new_debt.encode_size()
                        + vault.encode_size()
                        + player_balances.encode_size()
                }
                Self::AmmSwapped {
                    player,
                    is_buying_rng,
                    amount_in,
                    amount_out,
                    fee_amount,
                    burned_amount,
                    reserve_rng,
                    reserve_vusdt,
                    amm,
                    player_balances,
                    house,
                } => {
                    player.encode_size()
                        + is_buying_rng.encode_size()
                        + amount_in.encode_size()
                        + amount_out.encode_size()
                        + fee_amount.encode_size()
                        + burned_amount.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                        + amm.encode_size()
                        + player_balances.encode_size()
                        + house.encode_size()
                }
                Self::LiquidityAdded {
                    player,
                    rng_amount,
                    vusdt_amount,
                    shares_minted,
                    total_shares,
                    reserve_rng,
                    reserve_vusdt,
                    lp_balance,
                    amm,
                    player_balances,
                } => {
                    player.encode_size()
                        + rng_amount.encode_size()
                        + vusdt_amount.encode_size()
                        + shares_minted.encode_size()
                        + total_shares.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                        + lp_balance.encode_size()
                        + amm.encode_size()
                        + player_balances.encode_size()
                }
                Self::LiquidityRemoved {
                    player,
                    rng_amount,
                    vusdt_amount,
                    shares_burned,
                    total_shares,
                    reserve_rng,
                    reserve_vusdt,
                    lp_balance,
                    amm,
                    player_balances,
                } => {
                    player.encode_size()
                        + rng_amount.encode_size()
                        + vusdt_amount.encode_size()
                        + shares_burned.encode_size()
                        + total_shares.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                        + lp_balance.encode_size()
                        + amm.encode_size()
                        + player_balances.encode_size()
                }
                Self::AmmBootstrapped {
                    admin,
                    rng_amount,
                    vusdt_amount,
                    shares_minted,
                    reserve_rng,
                    reserve_vusdt,
                    bootstrap_price_vusdt_numerator,
                    bootstrap_price_rng_denominator,
                    amm,
                    house,
                } => {
                    admin.encode_size()
                        + rng_amount.encode_size()
                        + vusdt_amount.encode_size()
                        + shares_minted.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                        + bootstrap_price_vusdt_numerator.encode_size()
                        + bootstrap_price_rng_denominator.encode_size()
                        + amm.encode_size()
                        + house.encode_size()
                }
                Self::AmmBootstrapFinalized {
                    admin,
                    price_vusdt_numerator,
                    price_rng_denominator,
                    finalized_ts,
                    amm,
                } => {
                    admin.encode_size()
                        + price_vusdt_numerator.encode_size()
                        + price_rng_denominator.encode_size()
                        + finalized_ts.encode_size()
                        + amm.encode_size()
                }
                Self::PolicyUpdated { policy } => policy.encode_size(),
                Self::OracleUpdated { admin, oracle } => admin.encode_size() + oracle.encode_size(),
                Self::TreasuryUpdated { treasury } => treasury.encode_size(),
                Self::TreasuryVestingUpdated { vesting } => vesting.encode_size(),
                Self::TreasuryAllocationReleased {
                    admin,
                    bucket,
                    amount,
                    total_released,
                    total_vested,
                    total_allocation,
                } => {
                    admin.encode_size()
                        + bucket.encode_size()
                        + amount.encode_size()
                        + total_released.encode_size()
                        + total_vested.encode_size()
                        + total_allocation.encode_size()
                }
                Self::BridgeWithdrawalRequested {
                    id,
                    player,
                    amount,
                    destination,
                    requested_ts,
                    available_ts,
                    player_balances,
                    bridge,
                } => {
                    id.encode_size()
                        + player.encode_size()
                        + amount.encode_size()
                        + destination.encode_size()
                        + requested_ts.encode_size()
                        + available_ts.encode_size()
                        + player_balances.encode_size()
                        + bridge.encode_size()
                }
                Self::BridgeWithdrawalFinalized {
                    id,
                    admin,
                    amount,
                    source,
                    fulfilled_ts,
                    bridge,
                } => {
                    id.encode_size()
                        + admin.encode_size()
                        + amount.encode_size()
                        + source.encode_size()
                        + fulfilled_ts.encode_size()
                        + bridge.encode_size()
                }
                Self::BridgeDepositCredited {
                    admin,
                    recipient,
                    amount,
                    source,
                    player_balances,
                    bridge,
                } => {
                    admin.encode_size()
                        + recipient.encode_size()
                        + amount.encode_size()
                        + source.encode_size()
                        + player_balances.encode_size()
                        + bridge.encode_size()
                }
                Self::VaultLiquidated {
                    liquidator,
                    target,
                    repay_amount,
                    collateral_seized,
                    remaining_debt,
                    remaining_collateral,
                    penalty_to_house,
                } => {
                    liquidator.encode_size()
                        + target.encode_size()
                        + repay_amount.encode_size()
                        + collateral_seized.encode_size()
                        + remaining_debt.encode_size()
                        + remaining_collateral.encode_size()
                        + penalty_to_house.encode_size()
                }
                Self::RecoveryPoolFunded { amount, new_balance } => {
                    amount.encode_size() + new_balance.encode_size()
                }
                Self::RecoveryPoolRetired {
                    target,
                    amount,
                    new_debt,
                    pool_balance,
                } => {
                    target.encode_size()
                        + amount.encode_size()
                        + new_debt.encode_size()
                        + pool_balance.encode_size()
                }
                Self::GlobalTableRoundOpened { round } => round.encode_size(),
                Self::GlobalTableBetAccepted {
                    player,
                    round_id,
                    bets,
                    player_balances,
                } => {
                    player.encode_size()
                        + round_id.encode_size()
                        + bets.encode_size()
                        + player_balances.encode_size()
                }
                Self::GlobalTableBetRejected {
                    player,
                    round_id,
                    error_code,
                    message,
                } => {
                    player.encode_size()
                        + round_id.encode_size()
                        + error_code.encode_size()
                        + 4
                        + message.len()
                }
                Self::GlobalTableLocked {
                    game_type,
                    round_id,
                    phase_ends_at_ms,
                } => {
                    game_type.encode_size()
                        + round_id.encode_size()
                        + phase_ends_at_ms.encode_size()
                }
                Self::GlobalTableOutcome { round } => round.encode_size(),
                Self::GlobalTablePlayerSettled {
                    player,
                    round_id,
                    payout,
                    player_balances,
                    my_bets,
                } => {
                    player.encode_size()
                        + round_id.encode_size()
                        + payout.encode_size()
                        + player_balances.encode_size()
                        + my_bets.encode_size()
                }
                Self::GlobalTableFinalized { game_type, round_id } => {
                    game_type.encode_size() + round_id.encode_size()
                }
                Self::SavingsDeposited {
                    player,
                    amount,
                    new_balance,
                    savings_balance,
                    pool,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + new_balance.encode_size()
                        + savings_balance.encode_size()
                        + pool.encode_size()
                        + player_balances.encode_size()
                }
                Self::SavingsWithdrawn {
                    player,
                    amount,
                    new_balance,
                    savings_balance,
                    pool,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + new_balance.encode_size()
                        + savings_balance.encode_size()
                        + pool.encode_size()
                        + player_balances.encode_size()
                }
                Self::SavingsRewardsClaimed {
                    player,
                    amount,
                    savings_balance,
                    pool,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + savings_balance.encode_size()
                        + pool.encode_size()
                        + player_balances.encode_size()
                }
                Self::Staked {
                    player,
                    amount,
                    duration,
                    new_balance,
                    unlock_ts,
                    voting_power,
                    staker,
                    house,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + duration.encode_size()
                        + new_balance.encode_size()
                        + unlock_ts.encode_size()
                        + voting_power.encode_size()
                        + staker.encode_size()
                        + house.encode_size()
                        + player_balances.encode_size()
                }
                Self::Unstaked {
                    player,
                    amount,
                    staker,
                    house,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + staker.encode_size()
                        + house.encode_size()
                        + player_balances.encode_size()
                }
                Self::EpochProcessed { epoch, house } => epoch.encode_size() + house.encode_size(),
                Self::RewardsClaimed {
                    player,
                    amount,
                    staker,
                    house,
                    player_balances,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + staker.encode_size()
                        + house.encode_size()
                        + player_balances.encode_size()
                }
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Output {
    Event(Event),
    Transaction(Transaction),
    Commit { height: u64, start: u64 },
}

impl Write for Output {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Self::Event(event) => {
                0u8.write(writer);
                event.write(writer);
            }
            Self::Transaction(transaction) => {
                1u8.write(writer);
                transaction.write(writer);
            }
            Self::Commit { height, start } => {
                2u8.write(writer);
                height.write(writer);
                start.write(writer);
            }
        }
    }
}

impl Read for Output {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        match kind {
            0 => Ok(Self::Event(Event::read(reader)?)),
            1 => Ok(Self::Transaction(Transaction::read(reader)?)),
            2 => Ok(Self::Commit {
                height: u64::read(reader)?,
                start: u64::read(reader)?,
            }),
            _ => Err(Error::InvalidEnum(kind)),
        }
    }
}

impl EncodeSize for Output {
    fn encode_size(&self) -> usize {
        1 + match self {
            Self::Event(event) => event.encode_size(),
            Self::Transaction(transaction) => transaction.encode_size(),
            Self::Commit { height, start } => height.encode_size() + start.encode_size(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub view: View,
    pub height: u64,
    pub block_digest: Digest,
    pub state_root: Digest,
    pub state_start_op: u64,
    pub state_end_op: u64,
    pub events_root: Digest,
    pub events_start_op: u64,
    pub events_end_op: u64,
}

impl Progress {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        view: View,
        height: u64,
        block_digest: Digest,
        state_root: Digest,
        state_start_op: u64,
        state_end_op: u64,
        events_root: Digest,
        events_start_op: u64,
        events_end_op: u64,
    ) -> Self {
        Self {
            view,
            height,
            block_digest,
            state_root,
            state_start_op,
            state_end_op,
            events_root,
            events_start_op,
            events_end_op,
        }
    }
}

impl Write for Progress {
    fn write(&self, writer: &mut impl BufMut) {
        self.view.get().write(writer);
        self.height.write(writer);
        self.block_digest.write(writer);
        self.state_root.write(writer);
        self.state_start_op.write(writer);
        self.state_end_op.write(writer);
        self.events_root.write(writer);
        self.events_start_op.write(writer);
        self.events_end_op.write(writer);
    }
}

impl Read for Progress {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let view = View::new(u64::read(reader)?);
        Ok(Self {
            view,
            height: u64::read(reader)?,
            block_digest: Digest::read(reader)?,
            state_root: Digest::read(reader)?,
            state_start_op: u64::read(reader)?,
            state_end_op: u64::read(reader)?,
            events_root: Digest::read(reader)?,
            events_start_op: u64::read(reader)?,
            events_end_op: u64::read(reader)?,
        })
    }
}

impl FixedSize for Progress {
    const SIZE: usize = u64::SIZE
        + u64::SIZE
        + Digest::SIZE
        + Digest::SIZE
        + u64::SIZE
        + u64::SIZE
        + Digest::SIZE
        + u64::SIZE
        + u64::SIZE;
}

impl Digestible for Progress {
    type Digest = Digest;

    fn digest(&self) -> Digest {
        Sha256::hash(&self.encode())
    }
}
