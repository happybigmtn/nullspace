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
    execution::{Event, Output, Progress},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap},
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
    txs: Vec<String>,
    events: Vec<String>,
    last_nonce: Option<u64>,
    last_updated_height: Option<u64>,
}

#[derive(Default)]
pub struct ExplorerState {
    pub(super) indexed_blocks: BTreeMap<u64, ExplorerBlock>,
    pub(super) blocks_by_hash: HashMap<Digest, ExplorerBlock>,
    pub(super) txs_by_hash: HashMap<Digest, ExplorerTransaction>,
    pub(super) accounts: HashMap<PublicKey, AccountActivity>,
    max_blocks: Option<usize>,
    max_account_entries: Option<usize>,
}

impl ExplorerState {
    pub(crate) fn set_retention(
        &mut self,
        max_blocks: Option<usize>,
        max_account_entries: Option<usize>,
    ) {
        self.max_blocks = max_blocks;
        self.max_account_entries = max_account_entries;
    }

    fn enforce_retention(&mut self) {
        if let Some(max_blocks) = self.max_blocks {
            while self.indexed_blocks.len() > max_blocks {
                let Some((removed_height, _)) = self.indexed_blocks.pop_first() else {
                    break;
                };

                let blocks_to_remove = self
                    .blocks_by_hash
                    .iter()
                    .filter(|(_, block)| block.height == removed_height)
                    .map(|(digest, _)| *digest)
                    .collect::<Vec<_>>();
                for digest in blocks_to_remove {
                    self.blocks_by_hash.remove(&digest);
                }

                let txs_to_remove = self
                    .txs_by_hash
                    .iter()
                    .filter(|(_, tx)| tx.block_height == removed_height)
                    .map(|(digest, _)| *digest)
                    .collect::<Vec<_>>();
                for digest in txs_to_remove {
                    self.txs_by_hash.remove(&digest);
                }
            }
        }

        if let Some(max_entries) = self.max_account_entries {
            for activity in self.accounts.values_mut() {
                if activity.txs.len() > max_entries {
                    let excess = activity.txs.len() - max_entries;
                    activity.txs.drain(0..excess);
                }
                if activity.events.len() > max_entries {
                    let excess = activity.events.len() - max_entries;
                    activity.events.drain(0..excess);
                }
            }
        }
    }
}

impl Simulator {
    pub(crate) fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn record_event_for_accounts(
        accounts: &mut HashMap<PublicKey, AccountActivity>,
        event: &Event,
        height: u64,
    ) {
        let event_name = match event {
            Event::CasinoPlayerRegistered { .. } => "CasinoPlayerRegistered",
            Event::CasinoDeposited { .. } => "CasinoDeposited",
            Event::CasinoGameStarted { .. } => "CasinoGameStarted",
            Event::CasinoGameMoved { .. } => "CasinoGameMoved",
            Event::CasinoGameCompleted { .. } => "CasinoGameCompleted",
            Event::CasinoLeaderboardUpdated { .. } => "CasinoLeaderboardUpdated",
            Event::CasinoError { .. } => "CasinoError",
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

        let mut touch_account = |pk: &PublicKey| {
            let activity = accounts
                .entry(pk.clone())
                .or_insert_with(|| AccountActivity {
                    public_key: hex(pk.as_ref()),
                    ..Default::default()
                });
            activity.events.push(event_name.to_string());
            activity.last_updated_height = Some(height);
        };

        match event {
            Event::CasinoPlayerRegistered { player, .. } => touch_account(player),
            Event::CasinoDeposited { player, .. } => touch_account(player),
            Event::CasinoGameStarted { player, .. } => touch_account(player),
            Event::CasinoGameMoved { .. } => {} // broadcasted; not account-specific
            Event::CasinoGameCompleted { player, .. } => touch_account(player),
            Event::CasinoLeaderboardUpdated { .. } => {}
            Event::CasinoError { player, .. } => touch_account(player),
            Event::TournamentStarted { .. } => {}
            Event::PlayerJoined { player, .. } => touch_account(player),
            Event::TournamentPhaseChanged { .. } => {}
            Event::TournamentEnded { rankings, .. } => {
                for (pk, _) in rankings {
                    touch_account(pk);
                }
            }
            Event::VaultCreated { player } => touch_account(player),
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

    fn describe_instruction(instruction: &nullspace_types::execution::Instruction) -> String {
        use nullspace_types::execution::Instruction;

        match instruction {
            Instruction::CasinoRegister { name } => format!("Register casino player \"{name}\""),
            Instruction::CasinoDeposit { amount } => format!("Deposit {amount} RNG (faucet)"),
            Instruction::CasinoStartGame {
                game_type,
                bet,
                session_id,
            } => format!(
                "Start {} game (bet {bet} RNG, session {session_id})",
                Self::describe_game_type(game_type)
            ),
            Instruction::CasinoGameMove {
                session_id,
                payload,
            } => {
                let bytes = payload.len();
                if bytes == 0 {
                    format!("Casino game move (session {session_id})")
                } else {
                    format!("Casino game move (session {session_id}, {bytes} bytes)")
                }
            }
            Instruction::CasinoToggleShield => "Toggle shield modifier".to_string(),
            Instruction::CasinoToggleDouble => "Toggle double modifier".to_string(),
            Instruction::CasinoToggleSuper => "Toggle super mode".to_string(),
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

    pub(crate) async fn index_block_from_summary(
        &self,
        progress: &Progress,
        ops: &[Keyless<Output>],
    ) {
        let mut explorer = self.explorer.write().await;

        if explorer.indexed_blocks.contains_key(&progress.height) {
            return;
        }

        let parent = progress.height.checked_sub(1).and_then(|h| {
            explorer
                .indexed_blocks
                .get(&h)
                .map(|b| b.block_digest.clone())
        });
        let mut tx_hashes = Vec::new();

        for (idx, op) in ops.iter().enumerate() {
            match op {
                Keyless::Append(Output::Transaction(tx)) => {
                    let digest = tx.digest();
                    let hash_hex = hex(digest.as_ref());
                    tx_hashes.push(hash_hex.clone());
                    let entry = ExplorerTransaction {
                        hash: hash_hex.clone(),
                        block_height: progress.height,
                        block_digest: hex(progress.block_digest.as_ref()),
                        position: idx as u32,
                        public_key: hex(tx.public.as_ref()),
                        nonce: tx.nonce,
                        description: Self::describe_instruction(&tx.instruction),
                        instruction: format!("{:?}", tx.instruction),
                    };
                    explorer.txs_by_hash.insert(digest, entry);

                    let activity =
                        explorer
                            .accounts
                            .entry(tx.public.clone())
                            .or_insert_with(|| AccountActivity {
                                public_key: hex(tx.public.as_ref()),
                                ..Default::default()
                            });
                    activity.txs.push(hash_hex);
                    activity.last_nonce = Some(tx.nonce);
                    activity.last_updated_height = Some(progress.height);
                }
                Keyless::Append(Output::Event(evt)) => {
                    Self::record_event_for_accounts(&mut explorer.accounts, evt, progress.height);
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
            indexed_at_ms: Self::now_ms(),
        };

        explorer
            .blocks_by_hash
            .insert(progress.block_digest, block.clone());
        explorer.indexed_blocks.insert(progress.height, block);
        explorer.enforce_retention();
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
