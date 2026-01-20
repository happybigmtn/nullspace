use axum::{
    extract::{Path, Query, State as AxumState},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use commonware_codec::{DecodeExt, ReadExt};
use commonware_cryptography::{
    ed25519::{self, PublicKey},
    sha256::Digest,
    Digestible,
};
use commonware_storage::qmdb::keyless;
use commonware_utils::{from_hex, hex};
use nullspace_types::{
    casino::GameType,
    execution::{Event, Instruction, Output, Progress},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    future::Future,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{ExplorerMetrics, Simulator};

const EXPLORER_CACHE_CONTROL: &str = "public, max-age=2, stale-while-revalidate=10";

#[derive(Clone, Serialize)]
pub struct ExplorerBlock {
    height: u64,
    view: u64,
    block_digest: String,
    parent: Option<String>,
    tx_hashes: Vec<String>,
    tx_count: usize,
    indexed_at_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct ExplorerTransaction {
    hash: String,
    block_height: u64,
    block_digest: String,
    position: u32,
    public_key: String,
    nonce: u64,
    description: String,
    instruction: String,
}

#[derive(Clone, Default, Serialize)]
pub struct AccountActivity {
    public_key: String,
    txs: VecDeque<String>,
    events: VecDeque<String>,
    last_nonce: Option<u64>,
    last_updated_height: Option<u64>,
}

/// Indexed game completion event with logs for explorer queries
#[derive(Clone, Serialize)]
pub struct IndexedGameEvent {
    session_id: u64,
    game_type: String,
    payout: i64,
    final_chips: u64,
    was_shielded: bool,
    was_doubled: bool,
    logs: Vec<String>,
    block_height: u64,
}

/// Indexed bet within a global table round
#[derive(Clone, Debug, Serialize)]
pub struct IndexedBet {
    pub game_type: String,
    pub player: String,
    pub round_id: u64,
    pub bet_type: u8,
    pub target: u8,
    pub amount: u64,
    pub block_height: u64,
}

/// Indexed payout from global table settlement
#[derive(Clone, Debug, Serialize)]
pub struct IndexedPayout {
    pub game_type: String,
    pub player: String,
    pub round_id: u64,
    pub payout: i64,
    pub block_height: u64,
}

/// Indexed global table round
#[derive(Clone, Debug, Serialize)]
pub struct IndexedRound {
    pub game_type: String,
    pub round_id: u64,
    pub phase: String,
    pub opened_at_height: u64,
    pub locked_at_height: Option<u64>,
    pub outcome_at_height: Option<u64>,
    pub finalized_at_height: Option<u64>,
    pub d1: u8,
    pub d2: u8,
    pub total_bet_amount: u64,
    pub total_payout_amount: i64,
    pub bet_count: usize,
    pub player_count: usize,
}

impl Default for IndexedRound {
    fn default() -> Self {
        Self {
            game_type: String::new(),
            round_id: 0,
            phase: "Betting".to_string(),
            opened_at_height: 0,
            locked_at_height: None,
            outcome_at_height: None,
            finalized_at_height: None,
            d1: 0,
            d2: 0,
            total_bet_amount: 0,
            total_payout_amount: 0,
            bet_count: 0,
            player_count: 0,
        }
    }
}

#[derive(Default)]
pub struct ExplorerState {
    pub(super) indexed_blocks: BTreeMap<u64, ExplorerBlock>,
    pub(super) blocks_by_hash: HashMap<Digest, ExplorerBlock>,
    pub(super) blocks_by_height: HashMap<u64, Digest>,
    pub(super) txs_by_hash: HashMap<Digest, ExplorerTransaction>,
    pub(super) txs_by_height: HashMap<u64, Vec<Digest>>,
    pub(super) accounts: HashMap<PublicKey, AccountActivity>,
    /// Game completion events indexed by player public key
    pub(super) game_events: HashMap<PublicKey, VecDeque<IndexedGameEvent>>,
    /// Global table rounds indexed by (game_type, round_id)
    pub(super) indexed_rounds: BTreeMap<(String, u64), IndexedRound>,
    /// Bets indexed by round for efficient round lookup
    pub(super) bets_by_round: HashMap<(String, u64), Vec<IndexedBet>>,
    /// Payouts indexed by round for efficient round lookup
    pub(super) payouts_by_round: HashMap<(String, u64), Vec<IndexedPayout>>,
    /// Recent rounds ordered by block height for pagination
    pub(super) rounds_by_height: BTreeMap<u64, Vec<(String, u64)>>,
    account_last_seen: HashMap<PublicKey, u64>,
    game_events_last_seen: HashMap<PublicKey, u64>,
    account_lru: VecDeque<(PublicKey, u64)>,
    game_events_lru: VecDeque<(PublicKey, u64)>,
    account_lru_counter: u64,
    game_events_lru_counter: u64,
    max_blocks: Option<usize>,
    max_account_entries: Option<usize>,
    max_game_events_per_account: Option<usize>,
    max_accounts: Option<usize>,
    max_game_event_accounts: Option<usize>,
    max_rounds: Option<usize>,
}

impl ExplorerState {
    pub(crate) fn set_retention(
        &mut self,
        max_blocks: Option<usize>,
        max_account_entries: Option<usize>,
        max_accounts: Option<usize>,
        max_game_event_accounts: Option<usize>,
    ) {
        self.max_blocks = max_blocks;
        self.max_account_entries = max_account_entries;
        self.max_game_events_per_account = Some(100); // Default limit
        self.max_accounts = max_accounts;
        self.max_game_event_accounts = max_game_event_accounts;
        self.max_rounds = Some(1000); // Default limit for rounds
    }

    fn enforce_block_retention(&mut self) {
        if let Some(max_blocks) = self.max_blocks {
            while self.indexed_blocks.len() > max_blocks {
                let Some((removed_height, _)) = self.indexed_blocks.pop_first() else {
                    break;
                };

                if let Some(digest) = self.blocks_by_height.remove(&removed_height) {
                    self.blocks_by_hash.remove(&digest);
                }

                if let Some(digests) = self.txs_by_height.remove(&removed_height) {
                    for digest in digests {
                        self.txs_by_hash.remove(&digest);
                    }
                }
            }
        }
    }

    fn touch_account_lru(&mut self, public_key: &PublicKey) {
        let Some(max_accounts) = self.max_accounts else {
            return;
        };
        self.account_lru_counter = self.account_lru_counter.wrapping_add(1);
        let token = self.account_lru_counter;
        self.account_last_seen.insert(public_key.clone(), token);
        self.account_lru.push_back((public_key.clone(), token));
        self.enforce_account_map_retention();
        self.compact_account_lru(max_accounts);
    }

    fn touch_game_events_lru(&mut self, public_key: &PublicKey) {
        let Some(max_accounts) = self.max_game_event_accounts else {
            return;
        };
        self.game_events_lru_counter = self.game_events_lru_counter.wrapping_add(1);
        let token = self.game_events_lru_counter;
        self.game_events_last_seen.insert(public_key.clone(), token);
        self.game_events_lru.push_back((public_key.clone(), token));
        self.enforce_game_event_map_retention();
        self.compact_game_events_lru(max_accounts);
    }

    fn compact_account_lru(&mut self, max_accounts: usize) {
        let max_queue = max_accounts.saturating_mul(2).max(1);
        if self.account_lru.len() <= max_queue {
            return;
        }

        let mut entries = self
            .account_last_seen
            .iter()
            .map(|(key, token)| (*token, key.clone()))
            .collect::<Vec<_>>();
        entries.sort_by_key(|(token, _)| *token);
        self.account_lru = entries
            .into_iter()
            .map(|(token, key)| (key, token))
            .collect();
    }

    fn compact_game_events_lru(&mut self, max_accounts: usize) {
        let max_queue = max_accounts.saturating_mul(2).max(1);
        if self.game_events_lru.len() <= max_queue {
            return;
        }

        let mut entries = self
            .game_events_last_seen
            .iter()
            .map(|(key, token)| (*token, key.clone()))
            .collect::<Vec<_>>();
        entries.sort_by_key(|(token, _)| *token);
        self.game_events_lru = entries
            .into_iter()
            .map(|(token, key)| (key, token))
            .collect();
    }

    fn enforce_account_map_retention(&mut self) {
        if let Some(max_accounts) = self.max_accounts {
            while self.accounts.len() > max_accounts {
                let Some((public_key, token)) = self.account_lru.pop_front() else {
                    break;
                };
                if self.account_last_seen.get(&public_key) == Some(&token) {
                    self.account_last_seen.remove(&public_key);
                    self.accounts.remove(&public_key);
                }
            }
        }
    }

    fn enforce_game_event_map_retention(&mut self) {
        if let Some(max_accounts) = self.max_game_event_accounts {
            while self.game_events.len() > max_accounts {
                let Some((public_key, token)) = self.game_events_lru.pop_front() else {
                    break;
                };
                if self.game_events_last_seen.get(&public_key) == Some(&token) {
                    self.game_events_last_seen.remove(&public_key);
                    self.game_events.remove(&public_key);
                }
            }
        }
    }

    fn enforce_round_retention(&mut self) {
        let Some(max_rounds) = self.max_rounds else {
            return;
        };
        while self.indexed_rounds.len() > max_rounds {
            // Remove oldest round (smallest height)
            let Some((_, round_keys)) = self.rounds_by_height.pop_first() else {
                break;
            };
            for round_key in round_keys {
                self.indexed_rounds.remove(&round_key);
                self.bets_by_round.remove(&round_key);
                self.payouts_by_round.remove(&round_key);
            }
        }
    }
}

fn enforce_account_retention(max_entries: Option<usize>, activity: &mut AccountActivity) {
    if let Some(max_entries) = max_entries {
        while activity.txs.len() > max_entries {
            activity.txs.pop_front();
        }
        while activity.events.len() > max_entries {
            activity.events.pop_front();
        }
    }
}

fn enforce_game_events_retention(
    max_events: Option<usize>,
    events: &mut VecDeque<IndexedGameEvent>,
) {
    if let Some(max_events) = max_events {
        while events.len() > max_events {
            events.pop_front();
        }
    }
}

fn record_event(
    explorer: &mut ExplorerState,
    event: &Event,
    height: u64,
    metrics: &ExplorerMetrics,
) {
    let event_name = match event {
        Event::CasinoPlayerRegistered { .. } => "CasinoPlayerRegistered",
        Event::CasinoDeposited { .. } => "CasinoDeposited",
        Event::CasinoGameStarted { .. } => "CasinoGameStarted",
        Event::CasinoGameMoved { .. } => "CasinoGameMoved",
        Event::CasinoGameCompleted { .. } => "CasinoGameCompleted",
        Event::CasinoLeaderboardUpdated { .. } => "CasinoLeaderboardUpdated",
        Event::CasinoError { .. } => "CasinoError",
        Event::PlayerModifierToggled { .. } => "PlayerModifierToggled",
        Event::TournamentStarted { .. } => "TournamentStarted",
        Event::PlayerJoined { .. } => "PlayerJoined",
        Event::TournamentPhaseChanged { .. } => "TournamentPhaseChanged",
        Event::TournamentEnded { .. } => "TournamentEnded",
        Event::VaultCreated { .. } => "VaultCreated",
        Event::CollateralDeposited { .. } => "CollateralDeposited",
        Event::VusdtBorrowed { .. } => "VusdtBorrowed",
        Event::VusdtRepaid { .. } => "VusdtRepaid",
        Event::AmmSwapped { .. } => "AmmSwapped",
        Event::LiquidityAdded { .. } => "LiquidityAdded",
        Event::LiquidityRemoved { .. } => "LiquidityRemoved",
        Event::AmmBootstrapped { .. } => "AmmBootstrapped",
        Event::AmmBootstrapFinalized { .. } => "AmmBootstrapFinalized",
        Event::PolicyUpdated { .. } => "PolicyUpdated",
        Event::OracleUpdated { .. } => "OracleUpdated",
        Event::TreasuryUpdated { .. } => "TreasuryUpdated",
        Event::TreasuryVestingUpdated { .. } => "TreasuryVestingUpdated",
        Event::TreasuryAllocationReleased { .. } => "TreasuryAllocationReleased",
        Event::BridgeWithdrawalRequested { .. } => "BridgeWithdrawalRequested",
        Event::BridgeWithdrawalFinalized { .. } => "BridgeWithdrawalFinalized",
        Event::BridgeDepositCredited { .. } => "BridgeDepositCredited",
        Event::VaultLiquidated { .. } => "VaultLiquidated",
        Event::RecoveryPoolFunded { .. } => "RecoveryPoolFunded",
        Event::RecoveryPoolRetired { .. } => "RecoveryPoolRetired",
        Event::SavingsDeposited { .. } => "SavingsDeposited",
        Event::SavingsWithdrawn { .. } => "SavingsWithdrawn",
        Event::SavingsRewardsClaimed { .. } => "SavingsRewardsClaimed",
        Event::Staked { .. } => "Staked",
        Event::Unstaked { .. } => "Unstaked",
        Event::EpochProcessed { .. } => "EpochProcessed",
        Event::RewardsClaimed { .. } => "RewardsClaimed",
        Event::GlobalTableRoundOpened { .. } => "GlobalTableRoundOpened",
        Event::GlobalTableBetAccepted { .. } => "GlobalTableBetAccepted",
        Event::GlobalTableBetRejected { .. } => "GlobalTableBetRejected",
        Event::GlobalTableLocked { .. } => "GlobalTableLocked",
        Event::GlobalTableOutcome { .. } => "GlobalTableOutcome",
        Event::GlobalTablePlayerSettled { .. } => "GlobalTablePlayerSettled",
        Event::GlobalTableFinalized { .. } => "GlobalTableFinalized",
    };

    let max_account_entries = explorer.max_account_entries;
    let max_game_events_per_account = explorer.max_game_events_per_account;
    let mut touch_account = |pk: &PublicKey| {
        {
            let activity = explorer
                .accounts
                .entry(pk.clone())
                .or_insert_with(|| AccountActivity {
                    public_key: hex(pk.as_ref()),
                    ..Default::default()
                });
            activity.events.push_back(event_name.to_string());
            activity.last_updated_height = Some(height);
            enforce_account_retention(max_account_entries, activity);
        }
        explorer.touch_account_lru(pk);
    };

    match event {
        Event::CasinoPlayerRegistered { player, .. } => touch_account(player),
        Event::CasinoDeposited { player, .. } => touch_account(player),
        Event::CasinoGameStarted { player, .. } => {
            metrics.inc_casino_started();
            touch_account(player);
        }
        Event::CasinoGameMoved { .. } => {
            metrics.inc_casino_moved();
        } // broadcasted; not account-specific
        Event::CasinoGameCompleted {
            session_id,
            player,
            game_type,
            payout,
            final_chips,
            was_shielded,
            was_doubled,
            logs,
            ..
        } => {
            metrics.inc_casino_completed();
            touch_account(player);
            // Index the game event with its logs
            let indexed_event = IndexedGameEvent {
                session_id: *session_id,
                game_type: describe_game_type(game_type).to_string(),
                payout: *payout,
                final_chips: *final_chips,
                was_shielded: *was_shielded,
                was_doubled: *was_doubled,
                logs: logs.clone(),
                block_height: height,
            };
            {
                let events = explorer.game_events.entry(player.clone()).or_default();
                events.push_back(indexed_event);
                enforce_game_events_retention(max_game_events_per_account, events);
            }
            explorer.touch_game_events_lru(player);
        }
        Event::CasinoLeaderboardUpdated { .. } => {
            metrics.inc_casino_leaderboard_update();
        }
        Event::CasinoError { player, .. } => {
            metrics.inc_casino_error();
            touch_account(player);
        }
        Event::PlayerModifierToggled { player, .. } => touch_account(player),
        Event::TournamentStarted { .. } => {
            metrics.inc_tournament_started();
        }
        Event::PlayerJoined { player, .. } => touch_account(player),
        Event::TournamentPhaseChanged { .. } => {}
        Event::TournamentEnded { rankings, .. } => {
            metrics.inc_tournament_ended();
            for (pk, _) in rankings {
                touch_account(pk);
            }
        }
        Event::VaultCreated { player, .. } => touch_account(player),
        Event::CollateralDeposited { player, .. } => touch_account(player),
        Event::VusdtBorrowed { player, .. } => touch_account(player),
        Event::VusdtRepaid { player, .. } => touch_account(player),
        Event::AmmSwapped { player, .. } => touch_account(player),
        Event::LiquidityAdded { player, .. } => touch_account(player),
        Event::LiquidityRemoved { player, .. } => touch_account(player),
        Event::AmmBootstrapped { .. } => {}
        Event::AmmBootstrapFinalized { .. } => {}
        Event::PolicyUpdated { .. } => {}
        Event::OracleUpdated { .. } => {}
        Event::TreasuryUpdated { .. } => {}
        Event::TreasuryVestingUpdated { .. } => {}
        Event::TreasuryAllocationReleased { .. } => {}
        Event::BridgeWithdrawalRequested { player, .. } => touch_account(player),
        Event::BridgeWithdrawalFinalized { .. } => {}
        Event::BridgeDepositCredited { recipient, .. } => touch_account(recipient),
        Event::VaultLiquidated {
            liquidator, target, ..
        } => {
            touch_account(liquidator);
            touch_account(target);
        }
        Event::RecoveryPoolFunded { .. } => {}
        Event::RecoveryPoolRetired { target, .. } => touch_account(target),
        Event::SavingsDeposited { player, .. } => touch_account(player),
        Event::SavingsWithdrawn { player, .. } => touch_account(player),
        Event::SavingsRewardsClaimed { player, .. } => touch_account(player),
        Event::Staked { player, .. } => touch_account(player),
        Event::Unstaked { player, .. } => touch_account(player),
        Event::EpochProcessed { .. } => {}
        Event::RewardsClaimed { player, .. } => touch_account(player),
        Event::GlobalTableRoundOpened { round } => {
            metrics.inc_global_table_round_opened();
            let game_type_str = describe_game_type(&round.game_type).to_string();
            let round_key = (game_type_str.clone(), round.round_id);
            let indexed_round = IndexedRound {
                game_type: game_type_str,
                round_id: round.round_id,
                phase: format!("{:?}", round.phase),
                opened_at_height: height,
                locked_at_height: None,
                outcome_at_height: None,
                finalized_at_height: None,
                d1: round.d1,
                d2: round.d2,
                total_bet_amount: round.totals.iter().map(|t| t.amount).sum(),
                total_payout_amount: 0,
                bet_count: 0,
                player_count: 0,
            };
            explorer.indexed_rounds.insert(round_key.clone(), indexed_round);
            explorer
                .rounds_by_height
                .entry(height)
                .or_default()
                .push(round_key);
            explorer.enforce_round_retention();
        }
        Event::GlobalTableLocked { game_type, round_id, .. } => {
            let game_type_str = describe_game_type(game_type).to_string();
            let round_key = (game_type_str, *round_id);
            if let Some(round) = explorer.indexed_rounds.get_mut(&round_key) {
                round.phase = "Locked".to_string();
                round.locked_at_height = Some(height);
            }
        }
        Event::GlobalTableOutcome { round, .. } => {
            let game_type_str = describe_game_type(&round.game_type).to_string();
            let round_key = (game_type_str, round.round_id);
            if let Some(indexed_round) = explorer.indexed_rounds.get_mut(&round_key) {
                indexed_round.phase = format!("{:?}", round.phase);
                indexed_round.outcome_at_height = Some(height);
                indexed_round.d1 = round.d1;
                indexed_round.d2 = round.d2;
            }
        }
        Event::GlobalTableFinalized { game_type, round_id } => {
            metrics.inc_global_table_round_finalized();
            let game_type_str = describe_game_type(game_type).to_string();
            let round_key = (game_type_str, *round_id);
            if let Some(round) = explorer.indexed_rounds.get_mut(&round_key) {
                round.phase = "Finalized".to_string();
                round.finalized_at_height = Some(height);
            }
        }
        Event::GlobalTableBetAccepted {
            player,
            round_id,
            bets,
            ..
        } => {
            touch_account(player);
            // Find game_type from any round that matches this round_id
            let game_type_str = explorer
                .indexed_rounds
                .keys()
                .find(|(_, rid)| *rid == *round_id)
                .map(|(gt, _)| gt.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            let round_key = (game_type_str.clone(), *round_id);
            let player_hex = hex(player.as_ref());

            // Index each bet
            for bet in bets {
                let indexed_bet = IndexedBet {
                    game_type: game_type_str.clone(),
                    player: player_hex.clone(),
                    round_id: *round_id,
                    bet_type: bet.bet_type,
                    target: bet.target,
                    amount: bet.amount,
                    block_height: height,
                };
                explorer
                    .bets_by_round
                    .entry(round_key.clone())
                    .or_default()
                    .push(indexed_bet);
            }

            // Update round stats
            if let Some(round) = explorer.indexed_rounds.get_mut(&round_key) {
                let total_bet: u64 = bets.iter().map(|b| b.amount).sum();
                round.total_bet_amount += total_bet;
                round.bet_count += bets.len();
                // Track unique players
                let existing_players: std::collections::HashSet<_> = explorer
                    .bets_by_round
                    .get(&round_key)
                    .map(|bets| bets.iter().map(|b| &b.player).collect())
                    .unwrap_or_default();
                round.player_count = existing_players.len();
            }
        }
        Event::GlobalTableBetRejected { player, .. } => touch_account(player),
        Event::GlobalTablePlayerSettled {
            player,
            round_id,
            payout,
            ..
        } => {
            touch_account(player);
            // Find game_type from any round that matches this round_id
            let game_type_str = explorer
                .indexed_rounds
                .keys()
                .find(|(_, rid)| *rid == *round_id)
                .map(|(gt, _)| gt.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            let round_key = (game_type_str, *round_id);
            let player_hex = hex(player.as_ref());

            // Index the payout
            let indexed_payout = IndexedPayout {
                game_type: round_key.0.clone(),
                player: player_hex,
                round_id: *round_id,
                payout: *payout,
                block_height: height,
            };
            explorer
                .payouts_by_round
                .entry(round_key.clone())
                .or_default()
                .push(indexed_payout);

            // Update round stats
            if let Some(round) = explorer.indexed_rounds.get_mut(&round_key) {
                round.total_payout_amount += payout;
            }
        }
    }
}

fn describe_game_type(game_type: &GameType) -> &'static str {
    match game_type {
        GameType::Blackjack => "Blackjack",
        GameType::Craps => "Craps",
        GameType::CasinoWar => "Casino War",
        GameType::Baccarat => "Baccarat",
        GameType::VideoPoker => "Video Poker",
        GameType::HiLo => "Hi-Lo",
        GameType::Roulette => "Roulette",
        GameType::SicBo => "Sic Bo",
        GameType::ThreeCard => "Three Card",
        GameType::UltimateHoldem => "Ultimate Hold'em",
    }
}

fn describe_instruction(instruction: &Instruction) -> String {
    match instruction {
        Instruction::CasinoRegister { name } => format!("Register casino player \"{name}\""),
        Instruction::CasinoDeposit { amount } => format!("Deposit {amount} RNG (faucet)"),
        Instruction::CasinoStartGame {
            game_type,
            bet,
            session_id,
        } => format!(
            "Start {} game (bet {bet} RNG, session {session_id})",
            describe_game_type(game_type)
        ),
        Instruction::CasinoGameMove { session_id, payload } => {
            let bytes = payload.len();
            if bytes == 0 {
                format!("Casino game move (session {session_id})")
            } else {
                format!("Casino game move (session {session_id}, {bytes} bytes)")
            }
        }
        Instruction::CasinoPlayerAction { action } => {
            use nullspace_types::casino::PlayerAction;
            match action {
                PlayerAction::ToggleShield => "Toggle shield modifier".to_string(),
                PlayerAction::ToggleDouble => "Toggle double modifier".to_string(),
                PlayerAction::ToggleSuper => "Toggle super mode".to_string(),
            }
        }
        Instruction::CasinoSetTournamentLimit {
            player,
            daily_limit,
        } => format!(
            "Set daily tournament limit {daily_limit} for player {}",
            hex(player.as_ref())
        ),
        Instruction::CasinoJoinTournament { tournament_id } => {
            format!("Join tournament {tournament_id}")
        }
        Instruction::CasinoStartTournament {
            tournament_id,
            start_time_ms,
            end_time_ms,
        } => format!(
            "Start tournament {tournament_id} (start {start_time_ms}, end {end_time_ms})"
        ),
        Instruction::GlobalTableInit { config } => format!(
            "Init global table ({})",
            describe_game_type(&config.game_type)
        ),
        Instruction::GlobalTableOpenRound { game_type } => format!(
            "Open global table round ({})",
            describe_game_type(game_type)
        ),
        Instruction::GlobalTableSubmitBets {
            game_type,
            round_id,
            bets,
        } => format!(
            "Submit {} global table bets ({}, round {round_id})",
            bets.len(),
            describe_game_type(game_type)
        ),
        Instruction::GlobalTableLock {
            game_type,
            round_id,
        } => format!(
            "Lock global table round ({}, round {round_id})",
            describe_game_type(game_type)
        ),
        Instruction::GlobalTableReveal {
            game_type,
            round_id,
        } => format!(
            "Reveal global table round ({}, round {round_id})",
            describe_game_type(game_type)
        ),
        Instruction::GlobalTableSettle {
            game_type,
            round_id,
        } => format!(
            "Settle global table round ({}, round {round_id})",
            describe_game_type(game_type)
        ),
        Instruction::GlobalTableFinalize {
            game_type,
            round_id,
        } => format!(
            "Finalize global table round ({}, round {round_id})",
            describe_game_type(game_type)
        ),
        Instruction::CasinoEndTournament { tournament_id } => {
            format!("End tournament {tournament_id}")
        }
        Instruction::Stake { amount, duration } => {
            format!("Stake {amount} RNG for {duration} blocks")
        }
        Instruction::Unstake => "Unstake".to_string(),
        Instruction::ClaimRewards => "Claim staking rewards".to_string(),
        Instruction::ProcessEpoch => "Process epoch".to_string(),
        Instruction::CreateVault => "Create vault".to_string(),
        Instruction::DepositCollateral { amount } => {
            format!("Deposit {amount} RNG as collateral")
        }
        Instruction::BorrowUSDT { amount } => format!("Borrow {amount} vUSDT"),
        Instruction::RepayUSDT { amount } => format!("Repay {amount} vUSDT"),
        Instruction::Swap {
            amount_in,
            min_amount_out,
            is_buying_rng,
        } => {
            if *is_buying_rng {
                format!("Swap {amount_in} vUSDT for ≥ {min_amount_out} RNG")
            } else {
                format!("Swap {amount_in} RNG for ≥ {min_amount_out} vUSDT")
            }
        }
        Instruction::AddLiquidity {
            rng_amount,
            usdt_amount,
        } => format!("Add liquidity ({rng_amount} RNG + {usdt_amount} vUSDT)"),
        Instruction::RemoveLiquidity { shares } => {
            format!("Remove liquidity ({shares} LP shares)")
        }
        Instruction::LiquidateVault { target } => {
            format!("Liquidate vault for {}", hex(target.as_ref()))
        }
        Instruction::SetPolicy { .. } => "Set policy parameters".to_string(),
        Instruction::SetTreasury { .. } => "Set treasury allocations".to_string(),
        Instruction::FundRecoveryPool { amount } => format!("Fund recovery pool ({amount} vUSDT)"),
        Instruction::RetireVaultDebt { target, amount } => format!(
            "Retire {amount} vUSDT debt for vault {}",
            hex(target.as_ref())
        ),
        Instruction::RetireWorstVaultDebt { amount } => {
            format!("Retire {amount} vUSDT debt for worst vault")
        }
        Instruction::DepositSavings { amount } => format!("Deposit {amount} vUSDT to savings"),
        Instruction::WithdrawSavings { amount } => format!("Withdraw {amount} vUSDT from savings"),
        Instruction::ClaimSavingsRewards => "Claim savings rewards".to_string(),
        Instruction::SeedAmm {
            rng_amount,
            usdt_amount,
            ..
        } => format!("Seed AMM ({rng_amount} RNG + {usdt_amount} vUSDT)"),
        Instruction::FinalizeAmmBootstrap => "Finalize AMM bootstrap".to_string(),
        Instruction::SetTreasuryVesting { .. } => "Set treasury vesting schedule".to_string(),
        Instruction::ReleaseTreasuryAllocation { bucket, amount } => {
            format!("Release treasury allocation {bucket:?} ({amount} RNG)")
        }
        Instruction::BridgeWithdraw { amount, destination } => {
            format!("Bridge withdraw {amount} RNG ({} bytes)", destination.len())
        }
        Instruction::BridgeDeposit {
            recipient, amount, ..
        } => format!(
            "Bridge deposit {amount} RNG to {}",
            hex(recipient.as_ref())
        ),
        Instruction::FinalizeBridgeWithdrawal { withdrawal_id, .. } => {
            format!("Finalize bridge withdrawal {withdrawal_id}")
        }
        Instruction::UpdateOracle {
            price_vusdt_numerator,
            price_rng_denominator,
            ..
        } => format!(
            "Update oracle price {price_vusdt_numerator}/{price_rng_denominator} vUSDT/RNG"
        ),
    }
}

pub(crate) fn apply_block_indexing(
    explorer: &mut ExplorerState,
    progress: &Progress,
    ops: &[keyless::Operation<Output>],
    indexed_at_ms: u64,
    metrics: &ExplorerMetrics,
) -> bool {
    if explorer.indexed_blocks.contains_key(&progress.height) {
        return false;
    }

    let parent = progress.height.checked_sub(1).and_then(|h| {
        explorer
            .indexed_blocks
            .get(&h)
            .map(|b| b.block_digest.clone())
    });
    let mut tx_hashes = Vec::new();
    let mut tx_digests = Vec::new();
    let max_account_entries = explorer.max_account_entries;

    for (idx, op) in ops.iter().enumerate() {
        match op {
            keyless::Operation::Append(Output::Transaction(tx)) => {
                let digest = tx.digest();
                let hash_hex = hex(digest.as_ref());
                tx_hashes.push(hash_hex.clone());
                tx_digests.push(digest);
                let entry = ExplorerTransaction {
                    hash: hash_hex.clone(),
                    block_height: progress.height,
                    block_digest: hex(progress.block_digest.as_ref()),
                    position: idx as u32,
                    public_key: hex(tx.public.as_ref()),
                    nonce: tx.nonce,
                    description: describe_instruction(&tx.instruction),
                    instruction: format!("{:?}", tx.instruction),
                };
                explorer.txs_by_hash.insert(digest, entry);

                {
                    let activity =
                        explorer
                            .accounts
                            .entry(tx.public.clone())
                            .or_insert_with(|| AccountActivity {
                                public_key: hex(tx.public.as_ref()),
                                ..Default::default()
                            });
                    activity.txs.push_back(hash_hex);
                    activity.last_nonce = Some(tx.nonce);
                    activity.last_updated_height = Some(progress.height);
                    enforce_account_retention(max_account_entries, activity);
                }
                explorer.touch_account_lru(&tx.public);
            }
            keyless::Operation::Append(Output::Event(evt)) => {
                record_event(explorer, evt, progress.height, metrics);
            }
            _ => {}
        }
    }

    let tx_count = tx_hashes.len();
    let block = ExplorerBlock {
        height: progress.height,
        view: progress.view.get(),
        block_digest: hex(progress.block_digest.as_ref()),
        parent,
        tx_hashes,
        tx_count,
        indexed_at_ms,
    };

    explorer
        .blocks_by_hash
        .insert(progress.block_digest, block.clone());
    explorer
        .blocks_by_height
        .insert(progress.height, progress.block_digest);
    explorer
        .txs_by_height
        .insert(progress.height, tx_digests);
    explorer.indexed_blocks.insert(progress.height, block);
    explorer.enforce_block_retention();
    true
}

impl Simulator {
    pub(crate) fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    pub(crate) async fn index_block_from_summary(
        &self,
        progress: &Progress,
        ops: &[keyless::Operation<Output>],
    ) {
        let indexed_at_ms = Self::now_ms();
        let applied = {
            let mut explorer = self.explorer.write().await;
            apply_block_indexing(
                &mut explorer,
                progress,
                ops,
                indexed_at_ms,
                self.explorer_metrics.as_ref(),
            )
        };

        if applied {
            self.persist_explorer_block(progress, ops, indexed_at_ms).await;
        }
    }

    async fn persist_explorer_block(
        &self,
        progress: &Progress,
        ops: &[keyless::Operation<Output>],
        indexed_at_ms: u64,
    ) {
        let Some(persistence) = &self.explorer_persistence else {
            return;
        };

        persistence
            .persist_block(*progress, ops.to_vec(), indexed_at_ms)
            .await;
    }
}

#[derive(Deserialize)]
pub(crate) struct Pagination {
    offset: Option<usize>,
    limit: Option<usize>,
}

pub(crate) async fn list_blocks(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(pagination): Query<Pagination>,
) -> impl IntoResponse {
    let offset = pagination.offset.unwrap_or(0);
    let limit = pagination.limit.unwrap_or(20).min(200);

    let cache_key = format!("blocks:offset={offset}:limit={limit}");
    let simulator_ref = Arc::clone(&simulator);
    cached_json(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;

            let total = explorer.indexed_blocks.len();
            let blocks: Vec<_> = explorer
                .indexed_blocks
                .iter()
                .rev()
                .skip(offset)
                .take(limit)
                .map(|(_, b)| b.clone())
                .collect();

            let next_offset = if offset + blocks.len() < total {
                Some(offset + blocks.len())
            } else {
                None
            };

            json!({ "blocks": blocks, "next_offset": next_offset, "total": total })
        }
    })
    .await
}

pub(crate) async fn get_block(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Try height first
    let cache_key = format!("block:{id}");
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        let id = id.clone();
        async move {
            let explorer = simulator.explorer.read().await;

            let block_opt = if let Ok(height) = id.parse::<u64>() {
                explorer.indexed_blocks.get(&height).cloned()
            } else {
                from_hex(&id)
                    .and_then(|raw| Digest::decode(&mut raw.as_slice()).ok())
                    .and_then(|digest| explorer.blocks_by_hash.get(&digest).cloned())
            };

            block_opt
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

pub(crate) async fn get_transaction(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    let raw = match from_hex(&hash) {
        Some(raw) => raw,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let digest = match Digest::decode(&mut raw.as_slice()) {
        Ok(d) => d,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let cache_key = format!("tx:{hash}");
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;
            explorer.txs_by_hash.get(&digest).cloned()
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

pub(crate) async fn get_account_activity(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(pubkey): Path<String>,
) -> impl IntoResponse {
    let raw = match from_hex(&pubkey) {
        Some(raw) => raw,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let public_key = match ed25519::PublicKey::read(&mut raw.as_slice()) {
        Ok(pk) => pk,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let cache_key = format!("account:{pubkey}");
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;
            explorer.accounts.get(&public_key).cloned()
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

#[derive(Deserialize)]
pub(crate) struct SearchQuery {
    q: String,
}

pub(crate) async fn search_explorer(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(params): Query<SearchQuery>,
) -> impl IntoResponse {
    let q = params.q.trim();
    if q.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let cache_key = format!("search:{q}");
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        let q = q.to_string();
        async move {
            let explorer = simulator.explorer.read().await;

            if let Ok(height) = q.parse::<u64>() {
                if let Some(block) = explorer.indexed_blocks.get(&height) {
                    return Some(json!({"type": "block", "block": block}));
                }
            }

            if let Some(raw) = from_hex(&q) {
                if raw.len() == 32 {
                    if let Ok(digest) = Digest::decode(&mut raw.as_slice()) {
                        if let Some(block) = explorer.blocks_by_hash.get(&digest) {
                            return Some(json!({"type": "block", "block": block}));
                        }
                        if let Some(tx) = explorer.txs_by_hash.get(&digest) {
                            return Some(json!({"type": "transaction", "transaction": tx}));
                        }
                    }
                }

                if let Ok(pk) = ed25519::PublicKey::read(&mut raw.as_slice()) {
                    if let Some(account) = explorer.accounts.get(&pk) {
                        return Some(json!({"type": "account", "account": account}));
                    }
                }
            }

            None
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

/// Get game history (completed games with logs) for an account
pub(crate) async fn get_game_history(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(pubkey): Path<String>,
    Query(pagination): Query<Pagination>,
) -> impl IntoResponse {
    let raw = match from_hex(&pubkey) {
        Some(raw) => raw,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let public_key = match ed25519::PublicKey::read(&mut raw.as_slice()) {
        Ok(pk) => pk,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let offset = pagination.offset.unwrap_or(0);
    let limit = pagination.limit.unwrap_or(20).min(100);

    let cache_key = format!("games:{pubkey}:offset={offset}:limit={limit}");
    let simulator_ref = Arc::clone(&simulator);
    cached_json(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;

            let events = explorer.game_events.get(&public_key);
            let empty_vec = VecDeque::new();
            let events = events.unwrap_or(&empty_vec);

            let total = events.len();

            let game_history: Vec<_> = events
                .iter()
                .rev()
                .skip(offset)
                .take(limit)
                .cloned()
                .collect();

            let next_offset = if offset + game_history.len() < total {
                Some(offset + game_history.len())
            } else {
                None
            };

            json!({
                "games": game_history,
                "next_offset": next_offset,
                "total": total
            })
        }
    })
    .await
}

fn with_cache(response: impl IntoResponse) -> axum::response::Response {
    let mut response = response.into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(EXPLORER_CACHE_CONTROL),
    );
    response
}

async fn cached_json<T, F, Fut>(simulator: &Simulator, key: &str, build: F) -> Response
where
    T: Serialize,
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    if let Some(cache) = simulator.cache() {
        if let Some(bytes) = cache.get(key).await {
            return with_cache_bytes(bytes);
        }
    }
    let value = build().await;
    match serde_json::to_vec(&value) {
        Ok(bytes) => {
            if let Some(cache) = simulator.cache() {
                cache.set(key, &bytes).await;
            }
            with_cache_bytes(bytes)
        }
        Err(err) => {
            tracing::warn!("Explorer cache serialization failed: {err}");
            with_cache(Json(value))
        }
    }
}

async fn cached_json_optional<T, F, Fut>(
    simulator: &Simulator,
    key: &str,
    build: F,
) -> Option<Response>
where
    T: Serialize,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    if let Some(cache) = simulator.cache() {
        if let Some(bytes) = cache.get(key).await {
            return Some(with_cache_bytes(bytes));
        }
    }
    let value = build().await?;
    match serde_json::to_vec(&value) {
        Ok(bytes) => {
            if let Some(cache) = simulator.cache() {
                cache.set(key, &bytes).await;
            }
            Some(with_cache_bytes(bytes))
        }
        Err(err) => {
            tracing::warn!("Explorer cache serialization failed: {err}");
            Some(with_cache(Json(value)))
        }
    }
}

fn with_cache_bytes(body: Vec<u8>) -> Response {
    let mut response = (StatusCode::OK, body).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(EXPLORER_CACHE_CONTROL),
    );
    response
}

// ─────────────────────────────────────────────────────────────────────────────
// Explorer Round Endpoints (AC-4.3)
// ─────────────────────────────────────────────────────────────────────────────

/// Query parameters for listing rounds
#[derive(Deserialize)]
pub(crate) struct RoundListQuery {
    offset: Option<usize>,
    limit: Option<usize>,
    /// Filter by game type (e.g. "Craps", "Blackjack")
    game_type: Option<String>,
    /// Filter by phase (e.g. "Betting", "Locked", "Finalized")
    phase: Option<String>,
    /// Filter by player public key (hex) - rounds where player placed a bet
    player: Option<String>,
}

/// Response for a single round with details
#[derive(Clone, Serialize)]
pub struct RoundDetail {
    #[serde(flatten)]
    pub round: IndexedRound,
    pub bets: Vec<IndexedBet>,
    pub payouts: Vec<IndexedPayout>,
}

/// Leaderboard entry for player stats
#[derive(Clone, Serialize)]
pub struct LeaderboardEntry {
    pub player: String,
    pub total_wagered: u64,
    pub total_payout: i64,
    pub net_profit: i64,
    pub bet_count: usize,
    pub round_count: usize,
    pub win_count: usize,
}

/// Query parameters for leaderboard
#[derive(Deserialize)]
pub(crate) struct LeaderboardQuery {
    offset: Option<usize>,
    limit: Option<usize>,
    /// Filter by game type
    game_type: Option<String>,
    /// Sort by field: "net_profit", "total_wagered", "bet_count" (default: "net_profit")
    sort_by: Option<String>,
}

/// List recent rounds with optional filters
pub(crate) async fn list_rounds(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(params): Query<RoundListQuery>,
) -> impl IntoResponse {
    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(20).min(100);
    let game_type_filter = params.game_type.clone();
    let phase_filter = params.phase.clone();
    let player_filter = params.player.clone();

    let cache_key = format!(
        "rounds:offset={offset}:limit={limit}:game_type={:?}:phase={:?}:player={:?}",
        game_type_filter, phase_filter, player_filter
    );
    let simulator_ref = Arc::clone(&simulator);
    cached_json(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;

            // Collect rounds in reverse chronological order (most recent first)
            let mut rounds: Vec<_> = explorer
                .rounds_by_height
                .iter()
                .rev()
                .flat_map(|(_, keys)| keys.iter())
                .filter_map(|key| explorer.indexed_rounds.get(key).cloned())
                .collect();

            // Apply game_type filter
            if let Some(ref gt) = game_type_filter {
                rounds.retain(|r| r.game_type.eq_ignore_ascii_case(gt));
            }

            // Apply phase filter
            if let Some(ref ph) = phase_filter {
                rounds.retain(|r| r.phase.eq_ignore_ascii_case(ph));
            }

            // Apply player filter - keep rounds where player has placed a bet
            if let Some(ref player_hex) = player_filter {
                rounds.retain(|r| {
                    let key = (r.game_type.clone(), r.round_id);
                    explorer
                        .bets_by_round
                        .get(&key)
                        .map(|bets| bets.iter().any(|b| b.player == *player_hex))
                        .unwrap_or(false)
                });
            }

            let total = rounds.len();
            let paginated: Vec<_> = rounds.into_iter().skip(offset).take(limit).collect();

            let next_offset = if offset + paginated.len() < total {
                Some(offset + paginated.len())
            } else {
                None
            };

            json!({
                "rounds": paginated,
                "next_offset": next_offset,
                "total": total
            })
        }
    })
    .await
}

/// Path parameters for getting a specific round
#[derive(Deserialize)]
pub(crate) struct RoundPath {
    game_type: String,
    round_id: u64,
}

/// Get a specific round with its bets and payouts
pub(crate) async fn get_round(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(path): Path<RoundPath>,
) -> impl IntoResponse {
    let cache_key = format!("round:{}:{}", path.game_type, path.round_id);
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        let game_type = path.game_type.clone();
        let round_id = path.round_id;
        async move {
            let explorer = simulator.explorer.read().await;

            // Find the round - try exact match first, then case-insensitive
            let key = explorer
                .indexed_rounds
                .keys()
                .find(|(gt, rid)| {
                    *rid == round_id && gt.eq_ignore_ascii_case(&game_type)
                })
                .cloned()?;

            let round = explorer.indexed_rounds.get(&key)?.clone();
            let bets = explorer.bets_by_round.get(&key).cloned().unwrap_or_default();
            let payouts = explorer
                .payouts_by_round
                .get(&key)
                .cloned()
                .unwrap_or_default();

            Some(RoundDetail {
                round,
                bets,
                payouts,
            })
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

/// Get leaderboard of players by net profit
pub(crate) async fn get_leaderboard(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(params): Query<LeaderboardQuery>,
) -> impl IntoResponse {
    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(20).min(100);
    let game_type_filter = params.game_type.clone();
    let sort_by = params.sort_by.clone().unwrap_or_else(|| "net_profit".to_string());

    let cache_key = format!(
        "leaderboard:offset={offset}:limit={limit}:game_type={:?}:sort_by={}",
        game_type_filter, sort_by
    );
    let simulator_ref = Arc::clone(&simulator);
    cached_json(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;

            // Aggregate player stats from indexed bets and payouts
            let mut player_stats: HashMap<String, LeaderboardEntry> = HashMap::new();

            // Iterate over all rounds, optionally filtered by game_type
            for ((gt, _round_id), round) in explorer.indexed_rounds.iter() {
                if let Some(ref filter) = game_type_filter {
                    if !gt.eq_ignore_ascii_case(filter) {
                        continue;
                    }
                }

                let round_key = (gt.clone(), round.round_id);

                // Aggregate bets
                if let Some(bets) = explorer.bets_by_round.get(&round_key) {
                    for bet in bets {
                        let entry = player_stats.entry(bet.player.clone()).or_insert_with(|| {
                            LeaderboardEntry {
                                player: bet.player.clone(),
                                total_wagered: 0,
                                total_payout: 0,
                                net_profit: 0,
                                bet_count: 0,
                                round_count: 0,
                                win_count: 0,
                            }
                        });
                        entry.total_wagered += bet.amount;
                        entry.bet_count += 1;
                    }
                }

                // Aggregate payouts
                if let Some(payouts) = explorer.payouts_by_round.get(&round_key) {
                    // Track unique players in this round for round_count
                    let mut players_in_round: std::collections::HashSet<String> =
                        std::collections::HashSet::new();

                    for payout in payouts {
                        players_in_round.insert(payout.player.clone());

                        let entry = player_stats.entry(payout.player.clone()).or_insert_with(|| {
                            LeaderboardEntry {
                                player: payout.player.clone(),
                                total_wagered: 0,
                                total_payout: 0,
                                net_profit: 0,
                                bet_count: 0,
                                round_count: 0,
                                win_count: 0,
                            }
                        });
                        entry.total_payout += payout.payout;
                        if payout.payout > 0 {
                            entry.win_count += 1;
                        }
                    }

                    // Increment round_count for each player in this round
                    for player in players_in_round {
                        if let Some(entry) = player_stats.get_mut(&player) {
                            entry.round_count += 1;
                        }
                    }
                }
            }

            // Calculate net profit
            for entry in player_stats.values_mut() {
                entry.net_profit = entry.total_payout - entry.total_wagered as i64;
            }

            // Sort by the requested field
            let mut entries: Vec<_> = player_stats.into_values().collect();
            match sort_by.as_str() {
                "total_wagered" => entries.sort_by(|a, b| b.total_wagered.cmp(&a.total_wagered)),
                "bet_count" => entries.sort_by(|a, b| b.bet_count.cmp(&a.bet_count)),
                _ => entries.sort_by(|a, b| b.net_profit.cmp(&a.net_profit)), // default: net_profit
            }

            let total = entries.len();
            let paginated: Vec<_> = entries.into_iter().skip(offset).take(limit).collect();

            let next_offset = if offset + paginated.len() < total {
                Some(offset + paginated.len())
            } else {
                None
            };

            json!({
                "leaderboard": paginated,
                "next_offset": next_offset,
                "total": total
            })
        }
    })
    .await
}

/// Get bets for a specific round (convenience endpoint)
pub(crate) async fn get_round_bets(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(path): Path<RoundPath>,
    Query(pagination): Query<Pagination>,
) -> impl IntoResponse {
    let offset = pagination.offset.unwrap_or(0);
    let limit = pagination.limit.unwrap_or(50).min(200);

    let cache_key = format!(
        "round_bets:{}:{}:offset={offset}:limit={limit}",
        path.game_type, path.round_id
    );
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        let game_type = path.game_type.clone();
        let round_id = path.round_id;
        async move {
            let explorer = simulator.explorer.read().await;

            // Find the round key - case-insensitive match
            let key = explorer
                .indexed_rounds
                .keys()
                .find(|(gt, rid)| *rid == round_id && gt.eq_ignore_ascii_case(&game_type))
                .cloned()?;

            let bets = explorer.bets_by_round.get(&key)?.clone();
            let total = bets.len();
            let paginated: Vec<_> = bets.into_iter().skip(offset).take(limit).collect();

            let next_offset = if offset + paginated.len() < total {
                Some(offset + paginated.len())
            } else {
                None
            };

            Some(json!({
                "bets": paginated,
                "next_offset": next_offset,
                "total": total
            }))
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

/// Get payouts for a specific round (convenience endpoint)
pub(crate) async fn get_round_payouts(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(path): Path<RoundPath>,
    Query(pagination): Query<Pagination>,
) -> impl IntoResponse {
    let offset = pagination.offset.unwrap_or(0);
    let limit = pagination.limit.unwrap_or(50).min(200);

    let cache_key = format!(
        "round_payouts:{}:{}:offset={offset}:limit={limit}",
        path.game_type, path.round_id
    );
    let simulator_ref = Arc::clone(&simulator);
    cached_json_optional(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        let game_type = path.game_type.clone();
        let round_id = path.round_id;
        async move {
            let explorer = simulator.explorer.read().await;

            // Find the round key - case-insensitive match
            let key = explorer
                .indexed_rounds
                .keys()
                .find(|(gt, rid)| *rid == round_id && gt.eq_ignore_ascii_case(&game_type))
                .cloned()?;

            let payouts = explorer.payouts_by_round.get(&key)?.clone();
            let total = payouts.len();
            let paginated: Vec<_> = payouts.into_iter().skip(offset).take(limit).collect();

            let next_offset = if offset + paginated.len() < total {
                Some(offset + paginated.len())
            } else {
                None
            };

            Some(json!({
                "payouts": paginated,
                "next_offset": next_offset,
                "total": total
            }))
        }
    })
    .await
    .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregated Metrics Endpoints (AC-4.4)
// ─────────────────────────────────────────────────────────────────────────────

/// Aggregated statistics for volume, house edge, and payouts
#[derive(Clone, Debug, Serialize)]
pub struct AggregatedStats {
    /// Total volume wagered across all rounds
    pub total_volume: u64,
    /// Total payouts disbursed across all rounds
    pub total_payouts: i64,
    /// House edge as a percentage (positive = house profit, negative = house loss)
    /// Calculated as: (total_volume - total_payouts) / total_volume * 100
    pub house_edge_percent: f64,
    /// Net house profit (total_volume - total_payouts)
    pub house_profit: i64,
    /// Number of rounds included in the aggregation
    pub round_count: usize,
    /// Number of bets included in the aggregation
    pub bet_count: usize,
    /// Number of unique players
    pub player_count: usize,
    /// Average bet size
    pub avg_bet_size: f64,
    /// Average payout per round
    pub avg_payout_per_round: f64,
    /// Win rate (percentage of rounds with positive total payout)
    pub player_win_rate_percent: f64,
}

/// Per-game statistics breakdown
#[derive(Clone, Debug, Serialize)]
pub struct GameStats {
    pub game_type: String,
    #[serde(flatten)]
    pub stats: AggregatedStats,
}

/// Query parameters for aggregated stats
#[derive(Deserialize)]
pub(crate) struct AggregationQuery {
    /// Filter by game type (e.g. "Craps", "Blackjack")
    game_type: Option<String>,
    /// Only include rounds opened at or after this block height
    from_height: Option<u64>,
    /// Only include rounds opened at or before this block height
    to_height: Option<u64>,
    /// Whether to include per-game breakdown (default: false)
    breakdown: Option<bool>,
}

/// Compute aggregated stats from indexed rounds
pub(crate) fn compute_aggregated_stats(
    explorer: &ExplorerState,
    game_type_filter: Option<&str>,
    from_height: Option<u64>,
    to_height: Option<u64>,
) -> AggregatedStats {
    let mut total_volume: u64 = 0;
    let mut total_payouts: i64 = 0;
    let mut round_count: usize = 0;
    let mut bet_count: usize = 0;
    let mut rounds_with_player_profit: usize = 0;
    let mut unique_players: std::collections::HashSet<String> = std::collections::HashSet::new();

    for ((gt, _round_id), round) in explorer.indexed_rounds.iter() {
        // Apply game_type filter
        if let Some(filter) = game_type_filter {
            if !gt.eq_ignore_ascii_case(filter) {
                continue;
            }
        }

        // Apply height filters
        if let Some(from) = from_height {
            if round.opened_at_height < from {
                continue;
            }
        }
        if let Some(to) = to_height {
            if round.opened_at_height > to {
                continue;
            }
        }

        // Only include finalized rounds for accurate stats
        if round.phase != "Finalized" {
            continue;
        }

        total_volume += round.total_bet_amount;
        total_payouts += round.total_payout_amount;
        round_count += 1;
        bet_count += round.bet_count;

        // Track if players profited in this round
        if round.total_payout_amount > round.total_bet_amount as i64 {
            rounds_with_player_profit += 1;
        }

        // Collect unique players from bets
        let round_key = (gt.clone(), round.round_id);
        if let Some(bets) = explorer.bets_by_round.get(&round_key) {
            for bet in bets {
                unique_players.insert(bet.player.clone());
            }
        }
    }

    let house_edge_percent = if total_volume > 0 {
        let house_profit = total_volume as i64 - total_payouts;
        (house_profit as f64 / total_volume as f64) * 100.0
    } else {
        0.0
    };

    let house_profit = total_volume as i64 - total_payouts;

    let avg_bet_size = if bet_count > 0 {
        total_volume as f64 / bet_count as f64
    } else {
        0.0
    };

    let avg_payout_per_round = if round_count > 0 {
        total_payouts as f64 / round_count as f64
    } else {
        0.0
    };

    let player_win_rate_percent = if round_count > 0 {
        (rounds_with_player_profit as f64 / round_count as f64) * 100.0
    } else {
        0.0
    };

    AggregatedStats {
        total_volume,
        total_payouts,
        house_edge_percent,
        house_profit,
        round_count,
        bet_count,
        player_count: unique_players.len(),
        avg_bet_size,
        avg_payout_per_round,
        player_win_rate_percent,
    }
}

/// Get all unique game types from indexed rounds
pub(crate) fn get_unique_game_types(explorer: &ExplorerState) -> Vec<String> {
    let mut game_types: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (gt, _) in explorer.indexed_rounds.keys() {
        game_types.insert(gt.clone());
    }
    let mut result: Vec<String> = game_types.into_iter().collect();
    result.sort();
    result
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill Endpoint (AC-4.5)
// ─────────────────────────────────────────────────────────────────────────────

/// Query parameters for backfill endpoint
#[derive(Deserialize)]
pub(crate) struct BackfillQuery {
    /// Starting block height (inclusive)
    from_height: Option<u64>,
    /// Maximum number of blocks to return
    limit: Option<usize>,
}

/// Response for backfill endpoint - includes raw persisted block data
#[derive(Serialize)]
pub(crate) struct BackfillResponse {
    /// List of raw blocks available for backfill
    pub blocks: Vec<BackfillBlock>,
    /// Minimum height in the persisted blocks
    pub min_height: Option<u64>,
    /// Maximum height in the persisted blocks
    pub max_height: Option<u64>,
    /// Total number of persisted blocks
    pub total_blocks: usize,
}

/// A single block's raw data for backfill
#[derive(Serialize)]
pub(crate) struct BackfillBlock {
    pub height: u64,
    /// Hex-encoded Progress bytes
    pub progress_hex: String,
    /// Hex-encoded operations bytes (each op is encoded separately)
    pub ops_hex: Vec<String>,
    pub indexed_at_ms: u64,
}

/// Get raw block data for backfill purposes
/// This endpoint returns the persisted block data that can be used to
/// backfill an empty indexer from genesis.
pub(crate) async fn get_backfill_blocks(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(params): Query<BackfillQuery>,
) -> impl IntoResponse {
    let from_height = params.from_height.unwrap_or(0);
    let limit = params.limit.unwrap_or(100).min(1000);

    let explorer = simulator.explorer.read().await;

    // Get block height range
    let min_height = explorer.indexed_blocks.first_key_value().map(|(h, _)| *h);
    let max_height = explorer.indexed_blocks.last_key_value().map(|(h, _)| *h);
    let total_blocks = explorer.indexed_blocks.len();

    // For now, we return the indexed block data in a serializable format
    // Note: This returns the already-indexed data, not the raw Progress/ops
    // For full backfill support, you would need access to the persisted raw data
    let blocks: Vec<BackfillBlock> = explorer
        .indexed_blocks
        .range(from_height..)
        .take(limit)
        .map(|(height, block)| BackfillBlock {
            height: *height,
            progress_hex: block.block_digest.clone(), // Block digest as identifier
            ops_hex: block.tx_hashes.clone(),         // Transaction hashes
            indexed_at_ms: block.indexed_at_ms,
        })
        .collect();

    Json(BackfillResponse {
        blocks,
        min_height,
        max_height,
        total_blocks,
    })
}

/// Get aggregated statistics for volume, house edge, and payouts
pub(crate) async fn get_aggregated_stats(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(params): Query<AggregationQuery>,
) -> impl IntoResponse {
    let game_type_filter = params.game_type.clone();
    let from_height = params.from_height;
    let to_height = params.to_height;
    let include_breakdown = params.breakdown.unwrap_or(false);

    let cache_key = format!(
        "stats:game_type={:?}:from={:?}:to={:?}:breakdown={}",
        game_type_filter, from_height, to_height, include_breakdown
    );
    let simulator_ref = Arc::clone(&simulator);
    cached_json(simulator.as_ref(), &cache_key, move || {
        let simulator = Arc::clone(&simulator_ref);
        async move {
            let explorer = simulator.explorer.read().await;

            // Compute overall stats
            let overall = compute_aggregated_stats(
                &explorer,
                game_type_filter.as_deref(),
                from_height,
                to_height,
            );

            if include_breakdown && game_type_filter.is_none() {
                // Compute per-game breakdown
                let game_types = get_unique_game_types(&explorer);
                let breakdown: Vec<GameStats> = game_types
                    .into_iter()
                    .map(|gt| {
                        let stats = compute_aggregated_stats(
                            &explorer,
                            Some(&gt),
                            from_height,
                            to_height,
                        );
                        GameStats {
                            game_type: gt,
                            stats,
                        }
                    })
                    .filter(|gs| gs.stats.round_count > 0) // Only include games with data
                    .collect();

                json!({
                    "overall": overall,
                    "by_game": breakdown
                })
            } else {
                json!({
                    "overall": overall
                })
            }
        }
    })
    .await
}
