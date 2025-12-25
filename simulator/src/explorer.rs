use axum::{
    extract::{Path, Query, State as AxumState},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use commonware_codec::{DecodeExt, ReadExt};
use commonware_cryptography::{
    ed25519::{self, PublicKey},
    sha256::Digest,
    Digestible,
};
use commonware_storage::store::operation::Keyless;
use commonware_utils::{from_hex, hex};
use nullspace_types::{
    casino::GameType,
    execution::{Event, Instruction, Output, Progress},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::Simulator;

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

fn record_event(explorer: &mut ExplorerState, event: &Event, height: u64) {
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
        Event::Staked { .. } => "Staked",
        Event::Unstaked { .. } => "Unstaked",
        Event::EpochProcessed { .. } => "EpochProcessed",
        Event::RewardsClaimed { .. } => "RewardsClaimed",
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
        Event::CasinoGameStarted { player, .. } => touch_account(player),
        Event::CasinoGameMoved { .. } => {} // broadcasted; not account-specific
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
                let events = explorer
                    .game_events
                    .entry(player.clone())
                    .or_insert_with(VecDeque::new);
                events.push_back(indexed_event);
                enforce_game_events_retention(max_game_events_per_account, events);
            }
            explorer.touch_game_events_lru(player);
        }
        Event::CasinoLeaderboardUpdated { .. } => {}
        Event::CasinoError { player, .. } => touch_account(player),
        Event::PlayerModifierToggled { player, .. } => touch_account(player),
        Event::TournamentStarted { .. } => {}
        Event::PlayerJoined { player, .. } => touch_account(player),
        Event::TournamentPhaseChanged { .. } => {}
        Event::TournamentEnded { rankings, .. } => {
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
        Event::Staked { player, .. } => touch_account(player),
        Event::Unstaked { player, .. } => touch_account(player),
        Event::EpochProcessed { .. } => {}
        Event::RewardsClaimed { player, .. } => touch_account(player),
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
    }
}

pub(crate) fn apply_block_indexing(
    explorer: &mut ExplorerState,
    progress: &Progress,
    ops: &[Keyless<Output>],
    indexed_at_ms: u64,
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
            Keyless::Append(Output::Transaction(tx)) => {
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
            Keyless::Append(Output::Event(evt)) => {
                record_event(explorer, evt, progress.height);
            }
            _ => {}
        }
    }

    let tx_count = tx_hashes.len();
    let block = ExplorerBlock {
        height: progress.height,
        view: progress.view,
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
        ops: &[Keyless<Output>],
    ) {
        let indexed_at_ms = Self::now_ms();
        let applied = {
            let mut explorer = self.explorer.write().await;
            apply_block_indexing(&mut explorer, progress, ops, indexed_at_ms)
        };

        if applied {
            self.persist_explorer_block(progress, ops, indexed_at_ms).await;
        }
    }

    async fn persist_explorer_block(
        &self,
        progress: &Progress,
        ops: &[Keyless<Output>],
        indexed_at_ms: u64,
    ) {
        let Some(persistence) = &self.explorer_persistence else {
            return;
        };

        persistence
            .persist_block(progress.clone(), ops.to_vec(), indexed_at_ms)
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

    Json(json!({ "blocks": blocks, "next_offset": next_offset, "total": total })).into_response()
}

pub(crate) async fn get_block(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let explorer = simulator.explorer.read().await;

    // Try height first
    let block_opt = if let Ok(height) = id.parse::<u64>() {
        explorer.indexed_blocks.get(&height).cloned()
    } else {
        // Try hash
        from_hex(&id)
            .and_then(|raw| Digest::decode(&mut raw.as_slice()).ok())
            .and_then(|digest| explorer.blocks_by_hash.get(&digest).cloned())
    };

    match block_opt {
        Some(block) => Json(block).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
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

    let explorer = simulator.explorer.read().await;

    match explorer.txs_by_hash.get(&digest) {
        Some(tx) => Json(tx).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
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

    let explorer = simulator.explorer.read().await;

    match explorer.accounts.get(&public_key) {
        Some(account) => Json(account).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct SearchQuery {
    q: String,
}

pub(crate) async fn search_explorer(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Query(params): Query<SearchQuery>,
) -> impl IntoResponse {
    let explorer = simulator.explorer.read().await;

    let q = params.q.trim();

    // Height search
    if let Ok(height) = q.parse::<u64>() {
        if let Some(block) = explorer.indexed_blocks.get(&height) {
            return Json(json!({"type": "block", "block": block})).into_response();
        }
    }

    // Hex search
    if let Some(raw) = from_hex(q) {
        if raw.len() == 32 {
            if let Ok(digest) = Digest::decode(&mut raw.as_slice()) {
                if let Some(block) = explorer.blocks_by_hash.get(&digest) {
                    return Json(json!({"type": "block", "block": block})).into_response();
                }
                if let Some(tx) = explorer.txs_by_hash.get(&digest) {
                    return Json(json!({"type": "transaction", "transaction": tx})).into_response();
                }
            }
        }

        // Account search
        if let Ok(pk) = ed25519::PublicKey::read(&mut raw.as_slice()) {
            if let Some(account) = explorer.accounts.get(&pk) {
                return Json(json!({"type": "account", "account": account})).into_response();
            }
        }
    }

    StatusCode::NOT_FOUND.into_response()
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

    let explorer = simulator.explorer.read().await;

    let events = explorer.game_events.get(&public_key);
    let empty_vec = VecDeque::new();
    let events = events.unwrap_or(&empty_vec);

    let offset = pagination.offset.unwrap_or(0);
    let limit = pagination.limit.unwrap_or(20).min(100);
    let total = events.len();

    // Return events in reverse order (most recent first)
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

    Json(json!({
        "games": game_history,
        "next_offset": next_offset,
        "total": total
    }))
    .into_response()
}
