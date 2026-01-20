use anyhow::{Context as _, Result};
use commonware_consensus::types::View;
use commonware_consensus::Viewable;
use commonware_cryptography::{
    bls12381::primitives::variant::{MinSig, Variant},
    ed25519::PublicKey,
};
#[cfg(feature = "parallel")]
use commonware_runtime::ThreadPool;
use nullspace_types::{
    execution::{Event, Instruction, Key, Output, Transaction, Value},
    Seed,
};
use std::collections::BTreeMap;
use tracing::debug;

use crate::casino::cards as card_utils;
use crate::state::{load_account, validate_and_increment_nonce, PrepareError, State, Status};

mod handlers;

// Keep a small amount of LP tokens permanently locked so the pool can never be fully drained.
// This mirrors the MINIMUM_LIQUIDITY pattern used by Raydium/Uniswap to avoid zero-price states.
const MINIMUM_LIQUIDITY: u64 = 1_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UthJackpotTier {
    None,
    StraightFlush,
    RoyalFlush,
}

fn parse_u64_be_at(bytes: &[u8], offset: usize) -> Option<u64> {
    let slice = bytes.get(offset..offset + 8)?;
    let buf: [u8; 8] = slice.try_into().ok()?;
    Some(u64::from_be_bytes(buf))
}

fn parse_three_card_progressive_state(state_blob: &[u8]) -> Option<(u64, [u8; 3])> {
    // v3:
    // [version:u8=3] [stage:u8] [player:3] [dealer:3] [pairplus:u64] [six_card:u64] [progressive:u64]
    //
    // v1/v2 have the same leading bytes for player cards but no progressive bet field.
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

fn is_three_card_mini_royal_spades(cards: &[u8; 3]) -> bool {
    if !cards.iter().all(|&c| card_utils::is_valid_card(c)) {
        return false;
    }
    if !cards.iter().all(|&c| card_utils::card_suit(c) == 0) {
        return false;
    }

    let mut ranks = [
        card_utils::card_rank_ace_high(cards[0]),
        card_utils::card_rank_ace_high(cards[1]),
        card_utils::card_rank_ace_high(cards[2]),
    ];
    ranks.sort_unstable_by(|a, b| b.cmp(a));

    ranks == [14, 13, 12]
}

fn parse_uth_progressive_state(state_blob: &[u8]) -> Option<(u64, [u8; 2], [u8; 3])> {
    // v3:
    // [version:u8=3] [stage:u8] [hole:2] [community:5] [dealer:2] [play_mult:u8] [bonus:4]
    // [trips:u64] [six_card:u64] [progressive:u64]
    //
    // v1/v2 have the same leading bytes for hole+community but no progressive bet field.
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

fn uth_progressive_jackpot_tier(hole: &[u8; 2], flop: &[u8; 3]) -> UthJackpotTier {
    let cards = [hole[0], hole[1], flop[0], flop[1], flop[2]];
    if !cards.iter().all(|&c| card_utils::is_valid_card(c)) {
        return UthJackpotTier::None;
    }

    let suits = [
        card_utils::card_suit(cards[0]),
        card_utils::card_suit(cards[1]),
        card_utils::card_suit(cards[2]),
        card_utils::card_suit(cards[3]),
        card_utils::card_suit(cards[4]),
    ];
    let is_flush = suits[0] == suits[1]
        && suits[1] == suits[2]
        && suits[2] == suits[3]
        && suits[3] == suits[4];

    let mut ranks = [
        card_utils::card_rank_ace_high(cards[0]),
        card_utils::card_rank_ace_high(cards[1]),
        card_utils::card_rank_ace_high(cards[2]),
        card_utils::card_rank_ace_high(cards[3]),
        card_utils::card_rank_ace_high(cards[4]),
    ];
    ranks.sort_unstable();

    let has_duplicates = ranks[0] == ranks[1]
        || ranks[1] == ranks[2]
        || ranks[2] == ranks[3]
        || ranks[3] == ranks[4];

    let is_straight = if has_duplicates {
        false
    } else if ranks[4].saturating_sub(ranks[0]) == 4 {
        true
    } else {
        // Wheel: A-2-3-4-5
        ranks == [2, 3, 4, 5, 14]
    };

    let is_royal = ranks == [10, 11, 12, 13, 14];

    if is_flush && is_royal {
        UthJackpotTier::RoyalFlush
    } else if is_flush && is_straight {
        UthJackpotTier::StraightFlush
    } else {
        UthJackpotTier::None
    }
}

pub struct Layer<'a, S: State> {
    state: &'a S,
    pending: BTreeMap<Key, Status>,

    seed: Seed,
    seed_view: u64,
}

impl<'a, S: State> Layer<'a, S> {
    fn integer_sqrt(value: u128) -> u64 {
        if value == 0 {
            return 0;
        }
        let mut x = value;
        let mut y = (x + 1) >> 1;
        while y < x {
            x = y;
            y = (x + value / x) >> 1;
        }
        x as u64
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

    fn insert(&mut self, key: Key, value: Value) {
        self.pending.insert(key, Status::Update(value));
    }

    pub fn view(&self) -> View {
        View::new(self.seed_view)
    }

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
            Instruction::CasinoStartGame {
                game_type,
                bet,
                session_id,
            } => {
                self.handle_casino_start_game(public, *game_type, *bet, *session_id)
                    .await
            }
            Instruction::CasinoGameMove {
                session_id,
                payload,
            } => {
                self.handle_casino_game_move(public, *session_id, payload)
                    .await
            }
            Instruction::CasinoPlayerAction { action } => {
                self.handle_casino_player_action(public, *action).await
            }
            Instruction::CasinoJoinTournament { tournament_id } => {
                self.handle_casino_join_tournament(public, *tournament_id)
                    .await
            }
            Instruction::CasinoSetTournamentLimit {
                player,
                daily_limit,
            } => {
                self.handle_casino_set_tournament_limit(public, player, *daily_limit)
                    .await
            }
            Instruction::CasinoStartTournament {
                tournament_id,
                start_time_ms,
                end_time_ms,
            } => {
                self.handle_casino_start_tournament(
                    public,
                    *tournament_id,
                    *start_time_ms,
                    *end_time_ms,
                )
                .await
            }
            Instruction::GlobalTableInit { config } => {
                self.handle_global_table_init(public, config).await
            }
            Instruction::GlobalTableOpenRound { game_type } => {
                self.handle_global_table_open_round(public, *game_type).await
            }
            Instruction::GlobalTableSubmitBets {
                game_type,
                round_id,
                bets,
            } => {
                self.handle_global_table_submit_bets(public, *game_type, *round_id, bets)
                    .await
            }
            Instruction::GlobalTableLock {
                game_type,
                round_id,
            } => {
                self.handle_global_table_lock(public, *game_type, *round_id)
                    .await
            }
            Instruction::GlobalTableReveal {
                game_type,
                round_id,
            } => {
                self.handle_global_table_reveal(public, *game_type, *round_id)
                    .await
            }
            Instruction::GlobalTableSettle {
                game_type,
                round_id,
            } => {
                self.handle_global_table_settle(public, *game_type, *round_id)
                    .await
            }
            Instruction::GlobalTableFinalize {
                game_type,
                round_id,
            } => {
                self.handle_global_table_finalize(public, *game_type, *round_id)
                    .await
            }
            Instruction::CasinoEndTournament { tournament_id } => {
                self.handle_casino_end_tournament(public, *tournament_id)
                    .await
            }
            _ => anyhow::bail!("internal error: apply_casino called with non-casino instruction"),
        }
    }

    #[cfg(feature = "staking")]
    async fn apply_staking(
        &mut self,
        public: &PublicKey,
        instruction: &Instruction,
    ) -> Result<Vec<Event>> {
        match instruction {
            Instruction::Stake { amount, duration } => {
                self.handle_stake(public, *amount, *duration).await
            }
            Instruction::Unstake => self.handle_unstake(public).await,
            Instruction::ClaimRewards => self.handle_claim_rewards(public).await,
            Instruction::ProcessEpoch => self.handle_process_epoch(public).await,
            _ => anyhow::bail!("internal error: apply_staking called with non-staking instruction"),
        }
    }

    #[cfg(not(feature = "staking"))]
    async fn apply_staking(
        &mut self,
        public: &PublicKey,
        _instruction: &Instruction,
    ) -> Result<Vec<Event>> {
        Ok(handlers::feature_disabled_error(public, "Staking"))
    }

    #[cfg(feature = "liquidity")]
    async fn apply_liquidity(
        &mut self,
        public: &PublicKey,
        instruction: &Instruction,
    ) -> Result<Vec<Event>> {
        match instruction {
            Instruction::CreateVault => self.handle_create_vault(public).await,
            Instruction::DepositCollateral { amount } => {
                self.handle_deposit_collateral(public, *amount).await
            }
            Instruction::BorrowUSDT { amount } => self.handle_borrow_usdt(public, *amount).await,
            Instruction::RepayUSDT { amount } => self.handle_repay_usdt(public, *amount).await,
            Instruction::Swap {
                amount_in,
                min_amount_out,
                is_buying_rng,
            } => {
                self.handle_swap(public, *amount_in, *min_amount_out, *is_buying_rng)
                    .await
            }
            Instruction::AddLiquidity {
                rng_amount,
                usdt_amount,
            } => {
                self.handle_add_liquidity(public, *rng_amount, *usdt_amount)
                    .await
            }
            Instruction::RemoveLiquidity { shares } => {
                self.handle_remove_liquidity(public, *shares).await
            }
            Instruction::LiquidateVault { target } => {
                self.handle_liquidate_vault(public, target).await
            }
            Instruction::SetPolicy { policy } => self.handle_set_policy(public, policy).await,
            Instruction::SetTreasury { treasury } => {
                self.handle_set_treasury(public, treasury).await
            }
            Instruction::FundRecoveryPool { amount } => {
                self.handle_fund_recovery_pool(public, *amount).await
            }
            Instruction::RetireVaultDebt { target, amount } => {
                self.handle_retire_vault_debt(public, target, *amount)
                    .await
            }
            Instruction::RetireWorstVaultDebt { amount } => {
                self.handle_retire_worst_vault_debt(public, *amount)
                    .await
            }
            Instruction::DepositSavings { amount } => {
                self.handle_savings_deposit(public, *amount).await
            }
            Instruction::WithdrawSavings { amount } => {
                self.handle_savings_withdraw(public, *amount).await
            }
            Instruction::ClaimSavingsRewards => self.handle_savings_claim(public).await,
            Instruction::SeedAmm {
                rng_amount,
                usdt_amount,
                bootstrap_price_vusdt_numerator,
                bootstrap_price_rng_denominator,
            } => {
                self.handle_seed_amm(
                    public,
                    *rng_amount,
                    *usdt_amount,
                    *bootstrap_price_vusdt_numerator,
                    *bootstrap_price_rng_denominator,
                )
                .await
            }
            Instruction::FinalizeAmmBootstrap => {
                self.handle_finalize_amm_bootstrap(public).await
            }
            Instruction::SetTreasuryVesting { vesting } => {
                self.handle_set_treasury_vesting(public, vesting).await
            }
            Instruction::ReleaseTreasuryAllocation { bucket, amount } => {
                self.handle_release_treasury_allocation(public, bucket, *amount)
                    .await
            }
            Instruction::UpdateOracle {
                price_vusdt_numerator,
                price_rng_denominator,
                updated_ts,
                source,
            } => {
                self.handle_update_oracle(
                    public,
                    *price_vusdt_numerator,
                    *price_rng_denominator,
                    *updated_ts,
                    source,
                )
                .await
            }
            _ => anyhow::bail!(
                "internal error: apply_liquidity called with non-liquidity instruction"
            ),
        }
    }

    #[cfg(not(feature = "liquidity"))]
    async fn apply_liquidity(
        &mut self,
        public: &PublicKey,
        _instruction: &Instruction,
    ) -> Result<Vec<Event>> {
        Ok(handlers::feature_disabled_error(public, "Liquidity/AMM"))
    }

    #[cfg(feature = "bridge")]
    async fn apply_bridge(
        &mut self,
        public: &PublicKey,
        instruction: &Instruction,
    ) -> Result<Vec<Event>> {
        match instruction {
            Instruction::BridgeWithdraw {
                amount,
                destination,
            } => {
                self.handle_bridge_withdraw(public, *amount, destination.as_slice())
                    .await
            }
            Instruction::BridgeDeposit {
                recipient,
                amount,
                source,
            } => {
                self.handle_bridge_deposit(public, recipient, *amount, source.as_slice())
                    .await
            }
            Instruction::FinalizeBridgeWithdrawal {
                withdrawal_id,
                source,
            } => {
                self.handle_finalize_bridge_withdrawal(
                    public,
                    *withdrawal_id,
                    source.as_slice(),
                )
                .await
            }
            _ => anyhow::bail!("internal error: apply_bridge called with non-bridge instruction"),
        }
    }

    #[cfg(not(feature = "bridge"))]
    async fn apply_bridge(
        &mut self,
        public: &PublicKey,
        _instruction: &Instruction,
    ) -> Result<Vec<Event>> {
        Ok(handlers::bridge_disabled_error(public))
    }

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

    async fn get_or_init_house(&mut self) -> Result<nullspace_types::casino::HouseState> {
        Ok(match self.get(Key::House).await? {
            Some(Value::House(h)) => h,
            _ => nullspace_types::casino::HouseState::new(self.seed_view),
        })
    }

    async fn get_or_init_amm(&mut self) -> Result<nullspace_types::casino::AmmPool> {
        Ok(match self.get(Key::AmmPool).await? {
            Some(Value::AmmPool(p)) => p,
            _ => nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            ),
        })
    }

    async fn get_or_init_policy(&mut self) -> Result<nullspace_types::casino::PolicyState> {
        Ok(match self.get(Key::Policy).await? {
            Some(Value::Policy(policy)) => policy,
            _ => nullspace_types::casino::PolicyState::default(),
        })
    }

    async fn get_or_init_oracle_state(&mut self) -> Result<nullspace_types::casino::OracleState> {
        Ok(match self.get(Key::OracleState).await? {
            Some(Value::OracleState(state)) => state,
            _ => nullspace_types::casino::OracleState::default(),
        })
    }

    async fn get_or_init_treasury(&mut self) -> Result<nullspace_types::casino::TreasuryState> {
        Ok(match self.get(Key::Treasury).await? {
            Some(Value::Treasury(treasury)) => treasury,
            _ => nullspace_types::casino::TreasuryState::default(),
        })
    }

    async fn get_or_init_treasury_vesting(
        &mut self,
    ) -> Result<nullspace_types::casino::TreasuryVestingState> {
        Ok(match self.get(Key::TreasuryVesting).await? {
            Some(Value::TreasuryVesting(vesting)) => vesting,
            _ => nullspace_types::casino::TreasuryVestingState::default(),
        })
    }

    async fn get_or_init_vault_registry(
        &mut self,
    ) -> Result<nullspace_types::casino::VaultRegistry> {
        Ok(match self.get(Key::VaultRegistry).await? {
            Some(Value::VaultRegistry(registry)) => registry,
            _ => nullspace_types::casino::VaultRegistry::default(),
        })
    }

    async fn get_or_init_player_registry(
        &mut self,
    ) -> Result<nullspace_types::casino::PlayerRegistry> {
        Ok(match self.get(Key::PlayerRegistry).await? {
            Some(Value::PlayerRegistry(registry)) => registry,
            _ => nullspace_types::casino::PlayerRegistry::default(),
        })
    }

    async fn get_or_init_savings_pool(&mut self) -> Result<nullspace_types::casino::SavingsPool> {
        Ok(match self.get(Key::SavingsPool).await? {
            Some(Value::SavingsPool(pool)) => pool,
            _ => nullspace_types::casino::SavingsPool::default(),
        })
    }

    async fn get_or_init_savings_balance(
        &mut self,
        public: &PublicKey,
    ) -> Result<nullspace_types::casino::SavingsBalance> {
        Ok(match self.get(Key::SavingsBalance(public.clone())).await? {
            Some(Value::SavingsBalance(balance)) => balance,
            _ => nullspace_types::casino::SavingsBalance::default(),
        })
    }

    async fn get_or_init_bridge_state(
        &mut self,
    ) -> Result<nullspace_types::casino::BridgeState> {
        Ok(match self.get(Key::BridgeState).await? {
            Some(Value::BridgeState(state)) => state,
            _ => nullspace_types::casino::BridgeState::default(),
        })
    }

    async fn get_or_init_ledger_state(
        &mut self,
    ) -> Result<nullspace_types::casino::LedgerState> {
        Ok(match self.get(Key::LedgerState).await? {
            Some(Value::LedgerState(state)) => state,
            _ => nullspace_types::casino::LedgerState::default(),
        })
    }

    async fn get_or_init_house_bankroll(
        &mut self,
    ) -> Result<nullspace_types::casino::HouseBankroll> {
        Ok(match self.get(Key::HouseBankroll).await? {
            Some(Value::HouseBankroll(bankroll)) => bankroll,
            _ => nullspace_types::casino::HouseBankroll::default(),
        })
    }

    async fn get_or_init_player_exposure(
        &mut self,
        public: &PublicKey,
    ) -> Result<nullspace_types::casino::PlayerExposure> {
        Ok(match self.get(Key::PlayerExposure(public.clone())).await? {
            Some(Value::PlayerExposure(exposure)) => exposure,
            _ => nullspace_types::casino::PlayerExposure::default(),
        })
    }

    async fn get_lp_balance(&self, public: &PublicKey) -> Result<u64> {
        Ok(match self.get(Key::LpBalance(public.clone())).await? {
            Some(Value::LpBalance(bal)) => bal,
            _ => 0,
        })
    }

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
                Err(PrepareError::NonceMismatch { expected, got }) => {
                    debug!(
                        public = ?tx.public,
                        expected,
                        got,
                        "nonce mismatch; dropping transaction"
                    );
                    continue;
                }
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

    pub fn commit(self) -> Vec<(Key, Status)> {
        self.pending.into_iter().collect()
    }
}

impl<'a, S: State> State for Layer<'a, S> {
    async fn get(&self, key: Key) -> Result<Option<Value>> {
        Ok(match self.pending.get(&key) {
            Some(Status::Update(value)) => Some(value.clone()),
            Some(Status::Delete) => None,
            None => self.state.get(key).await?,
        })
    }

    async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
        self.pending.insert(key, Status::Update(value));
        Ok(())
    }

    async fn delete(&mut self, key: Key) -> Result<()> {
        self.pending.insert(key, Status::Delete);
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use commonware_runtime::deterministic::Runner;
    use commonware_runtime::Runner as _;
    use commonware_utils::hex;
    use nullspace_types::casino::{GameType, TournamentPhase};

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
        async fn get(&self, key: Key) -> Result<Option<Value>> {
            Ok(self.data.get(&key).cloned())
        }

        async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
            self.data.insert(key, value);
            Ok(())
        }

        async fn delete(&mut self, key: Key) -> Result<()> {
            self.data.remove(&key);
            Ok(())
        }
    }

    #[test]
    fn test_nonce_validation() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let state = MockState::new();
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);
            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let (signer, _) = create_account_keypair(1);

            // Wrong nonce should fail
            let tx = Transaction::sign(
                &signer,
                1,
                Instruction::CasinoRegister {
                    name: "test".to_string(),
                },
            );
            assert!(layer.prepare(&tx).await.is_err());

            // Correct nonce should succeed
            let tx = Transaction::sign(
                &signer,
                0,
                Instruction::CasinoRegister {
                    name: "test".to_string(),
                },
            );
            assert!(layer.prepare(&tx).await.is_ok());

            let _ = layer.commit();
        });
    }

    #[test]
    fn test_casino_register() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let state = MockState::new();
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);
            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let (signer, public) = create_account_keypair(1);

            // Register player
            let tx = Transaction::sign(
                &signer,
                0,
                Instruction::CasinoRegister {
                    name: "Alice".to_string(),
                },
            );
            assert!(layer.prepare(&tx).await.is_ok());
            let events = layer.apply(&tx).await.unwrap();

            assert_eq!(events.len(), 2);
            if let Event::CasinoPlayerRegistered { player, name } = &events[0] {
                assert_eq!(player, &public);
                assert_eq!(name, "Alice");
            } else {
                panic!("Expected CasinoPlayerRegistered event");
            }
            if let Event::CasinoLeaderboardUpdated { leaderboard } = &events[1] {
                assert_eq!(leaderboard.entries.len(), 1);
                assert_eq!(leaderboard.entries[0].name, "Alice");
            } else {
                panic!("Expected CasinoLeaderboardUpdated event");
            }

            // Verify player was created
            if let Some(Value::CasinoPlayer(player)) =
                layer.get(Key::CasinoPlayer(public)).await.unwrap()
            {
                assert_eq!(player.profile.name, "Alice");
                assert_eq!(player.balances.chips, 1000); // Initial chips
            } else {
                panic!("Player not found");
            }

            let _ = layer.commit();
        });
    }

    #[test]
    fn test_tournament_join_start_end_flow() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let state = MockState::new();
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);
            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let (signer, public) = create_account_keypair(1);
            let (admin_signer, admin_public) = create_account_keypair(999);
            std::env::set_var("CASINO_ADMIN_PUBLIC_KEY_HEX", hex(admin_public.as_ref()));

            let register = Transaction::sign(
                &signer,
                0,
                Instruction::CasinoRegister {
                    name: "Alice".to_string(),
                },
            );
            assert!(layer.prepare(&register).await.is_ok());
            let _ = layer.apply(&register).await.unwrap();

            let tournament_id = 42;
            let join = Transaction::sign(
                &signer,
                1,
                Instruction::CasinoJoinTournament { tournament_id },
            );
            assert!(layer.prepare(&join).await.is_ok());
            let events = layer.apply(&join).await.unwrap();
            assert!(matches!(
                events.get(0),
                Some(Event::PlayerJoined { tournament_id: id, player }) if *id == tournament_id && player == &public
            ));

            let start_time_ms = 1_700_000_000_000;
            let expected_duration_ms =
                nullspace_types::casino::TOURNAMENT_DURATION_SECS.saturating_mul(1000);
            let start = Transaction::sign(
                &signer,
                2,
                Instruction::CasinoStartTournament {
                    tournament_id,
                    start_time_ms,
                    end_time_ms: start_time_ms + expected_duration_ms,
                },
            );
            assert!(layer.prepare(&start).await.is_ok());
            let events = layer.apply(&start).await.unwrap();
            assert!(
                !events.iter().any(|event| matches!(
                    event,
                    Event::TournamentStarted { id, .. } if *id == tournament_id
                )),
                "non-admin should not start tournaments"
            );

            let start = Transaction::sign(
                &admin_signer,
                0,
                Instruction::CasinoStartTournament {
                    tournament_id,
                    start_time_ms,
                    end_time_ms: start_time_ms + expected_duration_ms,
                },
            );
            assert!(layer.prepare(&start).await.is_ok());
            let events = layer.apply(&start).await.unwrap();
            assert!(events.iter().any(|event| matches!(
                event,
                Event::TournamentStarted { id, .. } if *id == tournament_id
            )));

            if let Some(Value::Tournament(tournament)) =
                layer.get(Key::Tournament(tournament_id)).await.unwrap()
            {
                assert!(matches!(tournament.phase, TournamentPhase::Active));
                assert!(tournament.players.contains(&public));
            } else {
                panic!("Tournament not found");
            }

            if let Some(Value::CasinoPlayer(player)) =
                layer.get(Key::CasinoPlayer(public.clone())).await.unwrap()
            {
                assert_eq!(
                    player.tournament.chips,
                    nullspace_types::casino::STARTING_CHIPS
                );
                assert_eq!(player.tournament.active_tournament, Some(tournament_id));
            } else {
                panic!("Player not found");
            }

            let end = Transaction::sign(
                &admin_signer,
                1,
                Instruction::CasinoEndTournament { tournament_id },
            );
            assert!(layer.prepare(&end).await.is_ok());
            let events = layer.apply(&end).await.unwrap();
            assert!(events.iter().any(|event| matches!(
                event,
                Event::TournamentEnded { id, .. } if *id == tournament_id
            )));

            if let Some(Value::Tournament(tournament)) =
                layer.get(Key::Tournament(tournament_id)).await.unwrap()
            {
                assert!(matches!(tournament.phase, TournamentPhase::Complete));
            } else {
                panic!("Tournament not found");
            }

            if let Some(Value::CasinoPlayer(player)) =
                layer.get(Key::CasinoPlayer(public)).await.unwrap()
            {
                assert_eq!(player.tournament.active_tournament, None);
                assert_eq!(player.tournament.chips, 0);
            } else {
                panic!("Player not found");
            }

            let _ = layer.commit();
        });
    }

    #[test]
    fn test_game_start_persists_session() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let state = MockState::new();
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);
            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let (signer, public) = create_account_keypair(1);
            let register = Transaction::sign(
                &signer,
                0,
                Instruction::CasinoRegister {
                    name: "Alice".to_string(),
                },
            );
            assert!(layer.prepare(&register).await.is_ok());
            let _ = layer.apply(&register).await.unwrap();

            let session_id = 42;
            let start = Transaction::sign(
                &signer,
                1,
                Instruction::CasinoStartGame {
                    game_type: GameType::Blackjack,
                    bet: 10,
                    session_id,
                },
            );
            assert!(layer.prepare(&start).await.is_ok());
            let events = layer.apply(&start).await.unwrap();
            assert!(events.iter().any(|event| matches!(
                event,
                Event::CasinoGameStarted { session_id: id, .. } if *id == session_id
            )));

            if let Some(Value::CasinoSession(session)) =
                layer.get(Key::CasinoSession(session_id)).await.unwrap()
            {
                assert_eq!(session.id, session_id);
                assert_eq!(session.player, public);
            } else {
                panic!("Session not found");
            }

            let _ = layer.commit();
        });
    }

    #[test]
    fn test_layer_execute_is_deterministic_for_identical_inputs() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let state1 = MockState::new();
            let state2 = MockState::new();

            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (signer, _public) = create_account_keypair(1);

            let txs = vec![
                Transaction::sign(
                    &signer,
                    0,
                    Instruction::CasinoRegister {
                        name: "Alice".to_string(),
                    },
                ),
                Transaction::sign(
                    &signer,
                    1,
                    Instruction::CasinoStartGame {
                        game_type: GameType::Roulette,
                        bet: 100,
                        session_id: 1,
                    },
                ),
                Transaction::sign(
                    &signer,
                    2,
                    Instruction::CasinoGameMove {
                        session_id: 1,
                        payload: {
                            let mut payload = vec![0u8, 1u8, 0u8]; // place RED bet
                            payload.extend_from_slice(&100u64.to_be_bytes());
                            payload
                        },
                    },
                ),
                Transaction::sign(
                    &signer,
                    3,
                    Instruction::CasinoGameMove {
                        session_id: 1,
                        payload: vec![1u8], // spin
                    },
                ),
            ];

            let mut layer1 = Layer::new(&state1, master_public, TEST_NAMESPACE, seed.clone());
            let mut layer2 = Layer::new(&state2, master_public, TEST_NAMESPACE, seed);

            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            #[cfg(feature = "parallel")]
            let (outputs1, nonces1) = layer1.execute(pool.clone(), txs.clone()).await.unwrap();
            #[cfg(not(feature = "parallel"))]
            let (outputs1, nonces1) = layer1.execute(txs.clone()).await.unwrap();

            #[cfg(feature = "parallel")]
            let (outputs2, nonces2) = layer2.execute(pool, txs).await.unwrap();
            #[cfg(not(feature = "parallel"))]
            let (outputs2, nonces2) = layer2.execute(txs).await.unwrap();

            assert_eq!(outputs1, outputs2);
            assert_eq!(nonces1, nonces2);
            assert!(layer1.commit() == layer2.commit());
        });
    }
}
