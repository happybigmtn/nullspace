use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Context;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State as AxumState;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use commonware_cryptography::bls12381::primitives::group::G1;
use commonware_consensus::types::Round;
use commonware_cryptography::Signer;
use commonware_math::algebra::{Additive, Random};
use nullspace_execution::{init_game, process_game_move, GameError, GameResult, GameRng};
use nullspace_types::casino::{GameSession, GameType, SuperModeState};
use nullspace_types::Seed;
use rand::{Rng, SeedableRng};
use rand::seq::SliceRandom;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc};
use tokio::time;
use tracing::{info, warn};
use futures_util::{SinkExt, StreamExt};

const YES_NO_TARGETS: [u8; 6] = [4, 5, 6, 8, 9, 10];
const HARDWAY_TARGETS: [u8; 4] = [4, 6, 8, 10];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Betting,
    Locked,
    Rolling,
    Payout,
    Cooldown,
}

impl Phase {
    fn as_str(&self) -> &'static str {
        match self {
            Phase::Betting => "betting",
            Phase::Locked => "locked",
            Phase::Rolling => "rolling",
            Phase::Payout => "payout",
            Phase::Cooldown => "cooldown",
        }
    }
}

#[derive(Clone, Debug)]
struct TableState {
    main_point: u8,
    d1: u8,
    d2: u8,
    made_points_mask: u8,
    epoch_point_established: bool,
    field_paytable: u8,
}

impl TableState {
    fn new() -> Self {
        Self {
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: 0,
        }
    }

    fn point(&self) -> Option<u8> {
        if self.main_point == 0 { None } else { Some(self.main_point) }
    }

    fn dice(&self) -> Option<[u8; 2]> {
        if self.d1 == 0 && self.d2 == 0 {
            None
        } else {
            Some([self.d1, self.d2])
        }
    }

    fn apply_roll(&mut self, d1: u8, d2: u8) {
        let total = d1.saturating_add(d2);
        let mut point_made: Option<u8> = None;
        let mut seven_out = false;

        // Use existing phase rules (ComeOut vs Point) based on main_point.
        // When main_point is 0, treat as come-out, otherwise point phase.
        if self.main_point == 0 {
            if ![2, 3, 7, 11, 12].contains(&total) {
                self.main_point = total;
                self.epoch_point_established = true;
            }
        } else {
            if total == self.main_point {
                point_made = Some(self.main_point);
                self.main_point = 0;
            } else if total == 7 {
                seven_out = true;
                self.main_point = 0;
                self.epoch_point_established = false;
            }
        }

        if let Some(point) = point_made {
            if let Some(bit) = point_to_fire_bit(point) {
                self.made_points_mask |= 1u8 << bit;
            }
        }

        if seven_out {
            self.made_points_mask = 0;
        }

        // Track come-out vs point phase for UI message; phase enum is for timers only.
        self.d1 = d1;
        self.d2 = d2;
    }
}

fn point_to_fire_bit(point: u8) -> Option<u8> {
    match point {
        4 => Some(0),
        5 => Some(1),
        6 => Some(2),
        8 => Some(3),
        9 => Some(4),
        10 => Some(5),
        _ => None,
    }
}

#[derive(Clone, Debug)]
struct PlayerState {
    balance: i128,
    session: GameSession,
}

#[derive(Clone, Debug)]
struct LiveTableConfig {
    betting_ms: u64,
    lock_ms: u64,
    payout_ms: u64,
    cooldown_ms: u64,
    tick_ms: u64,
    bot_count: usize,
    bot_balance: i128,
    bot_bet_min: u64,
    bot_bet_max: u64,
    bot_bets_per_round_min: u8,
    bot_bets_per_round_max: u8,
    bot_max_active_bets: usize,
    bot_seed: u64,
}

impl LiveTableConfig {
    fn from_env() -> Self {
        Self {
            betting_ms: read_ms("LIVE_TABLE_BETTING_MS", 18_000),
            lock_ms: read_ms("LIVE_TABLE_LOCK_MS", 2_000),
            payout_ms: read_ms("LIVE_TABLE_PAYOUT_MS", 2_000),
            cooldown_ms: read_ms("LIVE_TABLE_COOLDOWN_MS", 8_000),
            tick_ms: read_ms("LIVE_TABLE_TICK_MS", 1_000),
            bot_count: read_usize("LIVE_TABLE_BOT_COUNT", 0),
            bot_balance: read_u64("LIVE_TABLE_BOT_BALANCE", 1_000_000) as i128,
            bot_bet_min: read_u64("LIVE_TABLE_BOT_BET_MIN", 10),
            bot_bet_max: read_u64("LIVE_TABLE_BOT_BET_MAX", 200),
            bot_bets_per_round_min: read_u8("LIVE_TABLE_BOT_BETS_MIN", 1),
            bot_bets_per_round_max: read_u8("LIVE_TABLE_BOT_BETS_MAX", 3),
            bot_max_active_bets: read_usize("LIVE_TABLE_BOT_MAX_ACTIVE_BETS", 12),
            bot_seed: read_u64("LIVE_TABLE_BOT_SEED", 42),
        }
    }
}

fn read_ms(key: &str, fallback: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn read_u64(key: &str, fallback: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn read_u8(key: &str, fallback: u8) -> u8 {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<u8>().ok())
        .unwrap_or(fallback)
}

fn read_usize(key: &str, fallback: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .unwrap_or(fallback)
}

#[derive(Clone, Debug)]
struct LiveTableEngine {
    config: LiveTableConfig,
    table: TableState,
    players: HashMap<String, PlayerState>,
    round_id: u64,
    phase: Phase,
    phase_ends_at: Instant,
    seed: Seed,
    roll_index: u32,
    session_counter: u64,
    totals: HashMap<BetKey, u64>,
    bot_ids: Vec<String>,
    bot_rng: StdRng,
}

impl LiveTableEngine {
    fn new(config: LiveTableConfig) -> Self {
        let seed = Seed::new(Round::zero(), G1::zero());
        let now = Instant::now();
        let betting_ms = config.betting_ms;
        let bot_seed = config.bot_seed;
        let mut engine = Self {
            config,
            table: TableState::new(),
            players: HashMap::new(),
            round_id: 1,
            phase: Phase::Betting,
            phase_ends_at: now + Duration::from_millis(betting_ms),
            seed,
            roll_index: 0,
            session_counter: 1,
            totals: HashMap::new(),
            bot_ids: Vec::new(),
            bot_rng: StdRng::seed_from_u64(bot_seed),
        };
        engine.init_bots();
        engine.seed_bot_bets();
        engine
    }

    fn handle_join(&mut self, player_id: &str, balance: Option<String>) -> Result<LiveTableStateMessage, LiveTableError> {
        if !self.players.contains_key(player_id) {
            let balance_value = parse_balance(balance.as_deref()).unwrap_or(0);
            let session = self.create_session();
            self.players.insert(
                player_id.to_string(),
                PlayerState {
                    balance: balance_value,
                    session,
                },
            );
        } else if let Some(balance_value) = parse_balance(balance.as_deref()) {
            if let Some(player) = self.players.get_mut(player_id) {
                player.balance = balance_value;
            }
        }

        self.recompute_totals();
        Ok(self.build_state_message(Some(player_id)))
    }

    fn handle_leave(&mut self, player_id: &str) {
        self.players.remove(player_id);
        self.recompute_totals();
    }

    fn handle_bet(&mut self, player_id: &str, bets: Vec<BetInput>) -> Result<LiveTableStateMessage, LiveTableError> {
        if self.phase != Phase::Betting {
            return Err(LiveTableError::BettingClosed);
        }
        let needs_reset = {
            let player = self.players.get(player_id).ok_or(LiveTableError::NotSubscribed)?;
            player.session.is_complete || bet_count_from_blob(&player.session.state_blob) == 0
        };

        if needs_reset {
            let table_snapshot = self.table.clone();
            let seed = self.seed.clone();
            if let Some(player) = self.players.get_mut(player_id) {
                reset_session_if_needed(&seed, &mut player.session);
                sync_session_to_table(&mut player.session, &table_snapshot);
            }
        }

        let player = self.players.get_mut(player_id).ok_or(LiveTableError::NotSubscribed)?;

        let mut normalized_bets = Vec::with_capacity(bets.len());
        let mut total_amount: u64 = 0;
        for bet in bets {
            let amount = normalize_amount(bet.amount)?;
            let (bet_type, target) = normalize_bet_type(&bet.bet_type, bet.target)?;
            total_amount = total_amount.saturating_add(amount);
            normalized_bets.push((bet_type, target, amount));
        }

        if player.balance < total_amount as i128 {
            return Err(LiveTableError::InsufficientBalance);
        }

        // Apply bets atomically on a cloned session.
        let mut test_session = player.session.clone();
        for (bet_type, target, amount) in &normalized_bets {
            let payload = build_place_bet_payload(*bet_type, *target, *amount);
            test_session.move_count = test_session.move_count.saturating_add(1);
            let mut rng = GameRng::new(&self.seed, test_session.id, test_session.move_count);
            let _ = process_game_move(&mut test_session, &payload, &mut rng)?;
        }

        // Commit to real session.
        for (bet_type, target, amount) in &normalized_bets {
            let payload = build_place_bet_payload(*bet_type, *target, *amount);
            player.session.move_count = player.session.move_count.saturating_add(1);
            let mut rng = GameRng::new(&self.seed, player.session.id, player.session.move_count);
            let result = process_game_move(&mut player.session, &payload, &mut rng)?;
            let delta = result_delta(&result);
            player.balance = player.balance.saturating_add(delta as i128);
        }

        for (bet_type, target, amount) in normalized_bets {
            let key = bet_key_from_type(bet_type, target);
            *self.totals.entry(key).or_insert(0) += amount;
        }

        Ok(self.build_state_message(Some(player_id)))
    }

    fn tick(&mut self, now: Instant) -> Vec<OutboundEvent> {
        let mut events = Vec::new();
        if now >= self.phase_ends_at {
            self.advance_phase();
            if self.phase == Phase::Rolling {
                let roll_events = self.execute_roll();
                events.extend(roll_events);
            }
            if self.phase == Phase::Betting {
                self.seed_bot_bets();
            }
        }

        events.push(OutboundEvent::State {
            player_id: None,
            payload: self.build_state_message(None),
        });

        events
    }

    fn advance_phase(&mut self) {
        match self.phase {
            Phase::Betting => {
                self.phase = Phase::Locked;
                self.phase_ends_at = Instant::now() + Duration::from_millis(self.config.lock_ms);
            }
            Phase::Locked => {
                self.phase = Phase::Rolling;
                self.phase_ends_at = Instant::now() + Duration::from_millis(500);
            }
            Phase::Rolling => {
                self.phase = Phase::Payout;
                self.phase_ends_at = Instant::now() + Duration::from_millis(self.config.payout_ms);
            }
            Phase::Payout => {
                self.phase = Phase::Cooldown;
                self.phase_ends_at = Instant::now() + Duration::from_millis(self.config.cooldown_ms);
            }
            Phase::Cooldown => {
                self.round_id = self.round_id.saturating_add(1);
                self.phase = Phase::Betting;
                self.phase_ends_at = Instant::now() + Duration::from_millis(self.config.betting_ms);
            }
        }
    }

    fn execute_roll(&mut self) -> Vec<OutboundEvent> {
        let mut rng = GameRng::new(&self.seed, 1, self.roll_index);
        let d1 = rng.roll_die();
        let d2 = rng.roll_die();
        let total = d1.saturating_add(d2);
        self.roll_index = self.roll_index.saturating_add(1);

        self.table.apply_roll(d1, d2);

        let mut events = Vec::new();
        let player_ids: Vec<String> = self.players.keys().cloned().collect();

        let table_snapshot = self.table.clone();
        let seed = self.seed.clone();
        for player_id in player_ids {
            let is_bot = self.is_bot(&player_id);
            let Some(player) = self.players.get_mut(&player_id) else { continue; };
            if bet_count_from_blob(&player.session.state_blob) == 0 {
                continue;
            }

            let mut roll_rng = GameRng::new(&self.seed, 1, self.roll_index.saturating_sub(1));
            player.session.move_count = player.session.move_count.saturating_add(1);
            let result = match process_game_move(&mut player.session, &[2], &mut roll_rng) {
                Ok(result) => result,
                Err(err) => {
                    warn!(?err, "roll failed for player");
                    continue;
                }
            };
            let delta = result_delta(&result);
            player.balance = player.balance.saturating_add(delta as i128);

            let (net_win, payout) = parse_roll_net_and_payout(&result).unwrap_or((0, 0));
            let my_bets = extract_bets(&player.session.state_blob);

            if !is_bot {
                events.push(OutboundEvent::Result {
                    player_id: player_id.clone(),
                    payload: LiveTableResultMessage {
                        msg_type: "live_table_result",
                        game: "craps",
                        round_id: self.round_id,
                        dice: [d1, d2],
                        total: total as u8,
                        point: self.table.point(),
                        payout: Some(payout as i64),
                        net_win: Some(net_win),
                        balance: Some(player.balance.to_string()),
                        my_bets: Some(my_bets),
                        message: None,
                    },
                });
            }

            if player.session.is_complete {
                reset_session_if_needed(&seed, &mut player.session);
                sync_session_to_table(&mut player.session, &table_snapshot);
            }
        }

        self.recompute_totals();

        events
    }

    fn build_state_message(&self, target: Option<&str>) -> LiveTableStateMessage {
        let (my_bets, balance) = if let Some(player_id) = target {
            if let Some(player) = self.players.get(player_id) {
                (
                    Some(extract_bets(&player.session.state_blob)),
                    Some(player.balance.to_string()),
                )
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        LiveTableStateMessage {
            msg_type: "live_table_state",
            game: "craps",
            round_id: self.round_id,
            phase: self.phase.as_str(),
            time_remaining_ms: Some(self.phase_ends_at.saturating_duration_since(Instant::now()).as_millis() as u64),
            point: self.table.point(),
            dice: self.table.dice(),
            table_totals: self.totals_as_vec(),
            my_bets,
            balance,
        }
    }

    fn totals_as_vec(&self) -> Vec<TableTotal> {
        self.totals
            .iter()
            .map(|(key, amount)| TableTotal {
                bet_type: key.bet_type.clone(),
                amount: *amount,
                target: key.target,
            })
            .collect()
    }

    fn recompute_totals(&mut self) {
        self.totals.clear();
        for player in self.players.values() {
            for bet in extract_bets(&player.session.state_blob) {
                let key = BetKey {
                    bet_type: bet.bet_type.clone(),
                    target: bet.target,
                };
                *self.totals.entry(key).or_insert(0) += bet.amount;
            }
        }
    }

    fn init_bots(&mut self) {
        if self.config.bot_count == 0 {
            return;
        }
        for idx in 0..self.config.bot_count {
            let bot_id = format!("bot-{idx:03}");
            if self.players.contains_key(&bot_id) {
                continue;
            }
            let session = self.create_session();
            self.players.insert(
                bot_id.clone(),
                PlayerState {
                    balance: self.config.bot_balance,
                    session,
                },
            );
            self.bot_ids.push(bot_id);
        }
    }

    fn seed_bot_bets(&mut self) {
        if self.bot_ids.is_empty() || self.phase != Phase::Betting {
            return;
        }
        let bet_count = if self.config.bot_bets_per_round_min >= self.config.bot_bets_per_round_max {
            self.config.bot_bets_per_round_min
        } else {
            self.bot_rng.gen_range(self.config.bot_bets_per_round_min..=self.config.bot_bets_per_round_max)
        };
        let bot_ids = self.bot_ids.clone();
        for bot_id in bot_ids {
            let Some(player) = self.players.get_mut(&bot_id) else { continue; };
            if player.balance < self.config.bot_bet_min as i128 {
                player.balance = self.config.bot_balance;
            }
            let active_bets = bet_count_from_blob(&player.session.state_blob);
            if active_bets >= self.config.bot_max_active_bets {
                continue;
            }
            let remaining_capacity = self.config.bot_max_active_bets.saturating_sub(active_bets) as u8;
            let desired = bet_count.min(remaining_capacity.max(1));
            let bets = self.generate_bot_bets(desired);
            if bets.is_empty() {
                continue;
            }
            let _ = self.handle_bet(&bot_id, bets);
        }
    }

    fn generate_bot_bets(&mut self, count: u8) -> Vec<BetInput> {
        if count == 0 {
            return Vec::new();
        }
        let mut bets = Vec::with_capacity(count as usize);
        let can_place_bonus = {
            let has_rolled = self.table.d1 != 0 || self.table.d2 != 0;
            let last_total = self.table.d1.saturating_add(self.table.d2);
            !self.table.epoch_point_established
                && (!has_rolled || (self.table.main_point == 0 && last_total == 7))
        };
        let in_point = self.table.main_point != 0;
        for _ in 0..count {
            let bet_type = self.random_bot_bet_type(can_place_bonus, in_point);
            let amount = if self.config.bot_bet_min >= self.config.bot_bet_max {
                self.config.bot_bet_min
            } else {
                self.bot_rng.gen_range(self.config.bot_bet_min..=self.config.bot_bet_max)
            };
            let (bet_type_value, target) = match bet_type.as_str() {
                "YES" | "NO" => {
                    let target = *YES_NO_TARGETS.choose(&mut self.bot_rng).unwrap_or(&6);
                    (bet_type, Some(target))
                }
                "NEXT" => {
                    let target = self.bot_rng.gen_range(2..=12);
                    (bet_type, Some(target))
                }
                "HARDWAY" => {
                    let target = *HARDWAY_TARGETS.choose(&mut self.bot_rng).unwrap_or(&6);
                    (bet_type, Some(target))
                }
                _ => (bet_type, None),
            };
            bets.push(BetInput {
                bet_type: BetTypeInput::Text(bet_type_value),
                amount: amount as f64,
                target,
            });
        }
        bets
    }

    fn random_bot_bet_type(&mut self, can_place_bonus: bool, in_point: bool) -> String {
        let mut options: Vec<&'static str> = vec![
            "PASS",
            "DONT_PASS",
            "FIELD",
            "YES",
            "NO",
            "NEXT",
            "HARDWAY",
        ];
        if in_point {
            options.push("COME");
            options.push("DONT_COME");
        }
        if can_place_bonus {
            options.extend_from_slice(&[
                "FIRE",
                "ATS_SMALL",
                "ATS_TALL",
                "ATS_ALL",
                "MUGGSY",
                "DIFF_DOUBLES",
                "RIDE_LINE",
                "REPLAY",
                "HOT_ROLLER",
            ]);
        }
        let choice = options[self.bot_rng.gen_range(0..options.len())];
        choice.to_string()
    }

    fn is_bot(&self, player_id: &str) -> bool {
        self.bot_ids.iter().any(|id| id == player_id)
    }

    fn create_session(&mut self) -> GameSession {
        let session_id = self.session_counter;
        self.session_counter = self.session_counter.saturating_add(1);
        let session = GameSession {
            id: session_id,
            player: dummy_public_key(),
            game_type: GameType::Craps,
            bet: 0,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        session
    }

}

fn dummy_public_key() -> commonware_cryptography::ed25519::PublicKey {
    let mut rng = StdRng::seed_from_u64(42);
    let private = commonware_cryptography::ed25519::PrivateKey::random(&mut rng);
    private.public_key()
}

fn normalize_amount(amount: f64) -> Result<u64, LiveTableError> {
    if !amount.is_finite() || amount <= 0.0 {
        return Err(LiveTableError::InvalidBet("INVALID_BET_AMOUNT".to_string()));
    }
    let floored = amount.floor() as u64;
    if floored == 0 {
        return Err(LiveTableError::InvalidBet("INVALID_BET_AMOUNT".to_string()));
    }
    Ok(floored)
}

fn parse_balance(balance: Option<&str>) -> Option<i128> {
    balance.and_then(|value| value.parse::<i128>().ok())
}

fn build_place_bet_payload(bet_type: u8, target: u8, amount: u64) -> Vec<u8> {
    let mut payload = Vec::with_capacity(11);
    payload.push(0);
    payload.push(bet_type);
    payload.push(target);
    payload.extend_from_slice(&amount.to_be_bytes());
    payload
}

fn normalize_bet_type(input: &BetTypeInput, target: Option<u8>) -> Result<(u8, u8), LiveTableError> {
    match input {
        BetTypeInput::Number(value) => {
            let bet_type = *value;
            match bet_type {
                8 => Ok((8, 0)),
                9 => Ok((9, 0)),
                10 => Ok((10, 0)),
                11 => Ok((11, 0)),
                5 | 6 | 7 => {
                    let target = target.ok_or_else(|| LiveTableError::InvalidBet("TARGET_REQUIRED".to_string()))?;
                    Ok((bet_type, target))
                }
                _ => Ok((bet_type, target.unwrap_or(0))),
            }
        }
        BetTypeInput::Text(value) => {
            let normalized = value.to_ascii_uppercase();
            match normalized.as_str() {
                "PASS" => Ok((0, 0)),
                "DONT_PASS" | "DON'T_PASS" => Ok((1, 0)),
                "COME" => Ok((2, 0)),
                "DONT_COME" | "DON'T_COME" => Ok((3, 0)),
                "FIELD" => Ok((4, 0)),
                "YES" => Ok((5, target.ok_or_else(|| LiveTableError::InvalidBet("TARGET_REQUIRED".to_string()))?)),
                "NO" => Ok((6, target.ok_or_else(|| LiveTableError::InvalidBet("TARGET_REQUIRED".to_string()))?)),
                "NEXT" => Ok((7, target.ok_or_else(|| LiveTableError::InvalidBet("TARGET_REQUIRED".to_string()))?)),
                "HARDWAY" => {
                    let target = target.ok_or_else(|| LiveTableError::InvalidBet("TARGET_REQUIRED".to_string()))?;
                    let bet_type = match target {
                        4 => 8,
                        6 => 9,
                        8 => 10,
                        10 => 11,
                        _ => return Err(LiveTableError::InvalidBet("INVALID_HARDWAY_TARGET".to_string())),
                    };
                    Ok((bet_type, 0))
                }
                "HARDWAY_4" => Ok((8, 0)),
                "HARDWAY_6" => Ok((9, 0)),
                "HARDWAY_8" => Ok((10, 0)),
                "HARDWAY_10" => Ok((11, 0)),
                "FIRE" => Ok((12, 0)),
                "ATS_SMALL" => Ok((15, 0)),
                "ATS_TALL" => Ok((16, 0)),
                "ATS_ALL" => Ok((17, 0)),
                "MUGGSY" => Ok((18, 0)),
                "DIFF_DOUBLES" => Ok((19, 0)),
                "RIDE_LINE" => Ok((20, 0)),
                "REPLAY" => Ok((21, 0)),
                "HOT_ROLLER" => Ok((22, 0)),
                _ => Err(LiveTableError::InvalidBet(format!("UNSUPPORTED_BET:{normalized}"))),
            }
        }
    }
}

fn bet_key_from_type(bet_type: u8, target: u8) -> BetKey {
    let (bet_name, bet_target) = bet_type_to_view(bet_type, target);
    BetKey {
        bet_type: bet_name,
        target: bet_target,
    }
}

#[derive(Debug)]
enum LiveTableError {
    BettingClosed,
    NotSubscribed,
    InsufficientBalance,
    InvalidBet(String),
    Execution(GameError),
}

impl From<GameError> for LiveTableError {
    fn from(value: GameError) -> Self {
        LiveTableError::Execution(value)
    }
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct BetKey {
    bet_type: String,
    target: Option<u8>,
}

#[derive(Clone, Debug, Serialize)]
struct TableTotal {
    #[serde(rename = "type")]
    bet_type: String,
    amount: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<u8>,
}

#[derive(Clone, Debug, Serialize)]
struct BetView {
    #[serde(rename = "type")]
    bet_type: String,
    amount: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<u8>,
}

#[derive(Clone, Debug, Serialize)]
struct LiveTableStateMessage {
    #[serde(rename = "type")]
    msg_type: &'static str,
    game: &'static str,
    #[serde(rename = "roundId")]
    round_id: u64,
    phase: &'static str,
    #[serde(rename = "timeRemainingMs", skip_serializing_if = "Option::is_none")]
    time_remaining_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    point: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dice: Option<[u8; 2]>,
    #[serde(rename = "tableTotals", skip_serializing_if = "Vec::is_empty")]
    table_totals: Vec<TableTotal>,
    #[serde(rename = "myBets", skip_serializing_if = "Option::is_none")]
    my_bets: Option<Vec<BetView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    balance: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct LiveTableResultMessage {
    #[serde(rename = "type")]
    msg_type: &'static str,
    game: &'static str,
    #[serde(rename = "roundId")]
    round_id: u64,
    dice: [u8; 2],
    total: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    point: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payout: Option<i64>,
    #[serde(rename = "netWin", skip_serializing_if = "Option::is_none")]
    net_win: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    balance: Option<String>,
    #[serde(rename = "myBets", skip_serializing_if = "Option::is_none")]
    my_bets: Option<Vec<BetView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
enum OutboundEvent {
    #[serde(rename = "state")]
    State {
        #[serde(rename = "playerId", skip_serializing_if = "Option::is_none")]
        player_id: Option<String>,
        payload: LiveTableStateMessage,
    },
    #[serde(rename = "result")]
    Result {
        #[serde(rename = "playerId")]
        player_id: String,
        payload: LiveTableResultMessage,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum InboundMessage {
    #[serde(rename = "join")]
    Join {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "playerId")]
        player_id: String,
        balance: Option<String>,
    },
    #[serde(rename = "leave")]
    Leave {
        #[serde(rename = "requestId")]
        request_id: Option<String>,
        #[serde(rename = "playerId")]
        player_id: String,
    },
    #[serde(rename = "bet")]
    Bet {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "playerId")]
        player_id: String,
        bets: Vec<BetInput>,
    },
}

#[derive(Debug, Deserialize)]
struct BetInput {
    #[serde(rename = "type")]
    bet_type: BetTypeInput,
    amount: f64,
    target: Option<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BetTypeInput {
    Text(String),
    Number(u8),
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OutboundResponse {
    #[serde(rename = "ack")]
    Ack { #[serde(rename = "requestId")] request_id: String },
    #[serde(rename = "error")]
    Error { #[serde(rename = "requestId")] request_id: String, code: String, message: String },
}

fn bet_count_from_blob(blob: &[u8]) -> usize {
    if blob.len() < 8 {
        return 0;
    }
    blob[7] as usize
}

fn sync_session_to_table(session: &mut GameSession, table: &TableState) {
    if session.state_blob.len() < 8 {
        return;
    }
    session.state_blob[1] = if table.main_point == 0 { 0 } else { 1 };
    session.state_blob[2] = table.main_point;
    session.state_blob[3] = table.d1;
    session.state_blob[4] = table.d2;
    session.state_blob[5] = table.made_points_mask;
    session.state_blob[6] = if table.epoch_point_established { 1 } else { 0 };

    let bet_count = session.state_blob[7] as usize;
    let rules_offset = 8 + bet_count * 19;
    if session.state_blob.len() >= rules_offset + 1 {
        session.state_blob[rules_offset] = table.field_paytable;
    }
}

fn extract_bets(blob: &[u8]) -> Vec<BetView> {
    if blob.len() < 8 {
        return Vec::new();
    }
    if blob[0] != 2 {
        return Vec::new();
    }
    let bet_count = blob[7] as usize;
    let mut bets = Vec::with_capacity(bet_count);
    let mut offset = 8;
    for _ in 0..bet_count {
        if offset + 19 > blob.len() {
            break;
        }
        let bet_type = blob[offset];
        let target = blob[offset + 1];
        let amount = u64::from_be_bytes([
            blob[offset + 3],
            blob[offset + 4],
            blob[offset + 5],
            blob[offset + 6],
            blob[offset + 7],
            blob[offset + 8],
            blob[offset + 9],
            blob[offset + 10],
        ]);
        if amount == 0 {
            offset += 19;
            continue;
        }
        let (bet_name, bet_target) = bet_type_to_view(bet_type, target);
        bets.push(BetView {
            bet_type: bet_name,
            amount,
            target: bet_target,
        });
        offset += 19;
    }
    bets
}

fn bet_type_to_view(bet_type: u8, target: u8) -> (String, Option<u8>) {
    match bet_type {
        0 => ("PASS".to_string(), None),
        1 => ("DONT_PASS".to_string(), None),
        2 => ("COME".to_string(), None),
        3 => ("DONT_COME".to_string(), None),
        4 => ("FIELD".to_string(), None),
        5 => ("YES".to_string(), Some(target)),
        6 => ("NO".to_string(), Some(target)),
        7 => ("NEXT".to_string(), Some(target)),
        8 => ("HARDWAY".to_string(), Some(4)),
        9 => ("HARDWAY".to_string(), Some(6)),
        10 => ("HARDWAY".to_string(), Some(8)),
        11 => ("HARDWAY".to_string(), Some(10)),
        12 => ("FIRE".to_string(), None),
        15 => ("ATS_SMALL".to_string(), None),
        16 => ("ATS_TALL".to_string(), None),
        17 => ("ATS_ALL".to_string(), None),
        18 => ("MUGGSY".to_string(), None),
        19 => ("DIFF_DOUBLES".to_string(), None),
        20 => ("RIDE_LINE".to_string(), None),
        21 => ("REPLAY".to_string(), None),
        22 => ("HOT_ROLLER".to_string(), None),
        _ => (format!("BET_{bet_type}"), None),
    }
}

fn result_delta(result: &GameResult) -> i64 {
    match result {
        GameResult::Continue(_) => 0,
        GameResult::ContinueWithUpdate { payout, .. } => *payout,
        GameResult::Win(amount, _) => *amount as i64,
        GameResult::Push(amount, _) => *amount as i64,
        GameResult::LossWithExtraDeduction(extra, _) => -(*extra as i64),
        GameResult::Loss(_) => 0,
        GameResult::LossPreDeducted(_, _) => 0,
    }
}

fn parse_roll_net_and_payout(result: &GameResult) -> Option<(i64, i64)> {
    let logs = match result {
        GameResult::Continue(logs) => logs,
        GameResult::ContinueWithUpdate { logs, .. } => logs,
        GameResult::Win(_, logs) => logs,
        GameResult::Push(_, logs) => logs,
        GameResult::Loss(logs) => logs,
        GameResult::LossPreDeducted(_, logs) => logs,
        GameResult::LossWithExtraDeduction(_, logs) => logs,
    };
    let Some(first) = logs.first() else { return None; };
    let value: serde_json::Value = serde_json::from_str(first).ok()?;
    let net = value.get("netPnl")?.as_i64()?;
    let payout = value.get("totalReturn")?.as_i64()?;
    Some((net, payout))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

#[derive(Clone)]
struct AppState {
    engine: Arc<Mutex<LiveTableEngine>>,
    broadcaster: broadcast::Sender<OutboundEvent>,
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let mut broadcast_rx = state.broadcaster.subscribe();

    let write_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sender.send(message).await.is_err() {
                break;
            }
        }
    });

    let broadcast_task = {
        let tx = tx.clone();
        tokio::spawn(async move {
            while let Ok(event) = broadcast_rx.recv().await {
                if let Ok(payload) = serde_json::to_string(&event) {
                    let _ = tx.send(Message::Text(payload));
                }
            }
        })
    };

    while let Some(Ok(message)) = receiver.next().await {
        match message {
            Message::Text(text) => {
                match serde_json::from_str::<InboundMessage>(&text) {
                    Ok(inbound) => {
                        handle_inbound(inbound, &state, &tx).await;
                    }
                    Err(err) => {
                        warn!(?err, "invalid inbound message");
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    write_task.abort();
    broadcast_task.abort();
}

async fn handle_inbound(
    inbound: InboundMessage,
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
) {
    match inbound {
        InboundMessage::Join { request_id, player_id, balance } => {
            let response = {
                let mut engine = state.engine.lock().unwrap();
                match engine.handle_join(&player_id, balance) {
                    Ok(payload) => {
                        state.broadcaster.send(OutboundEvent::State {
                            player_id: Some(player_id.clone()),
                            payload,
                        }).ok();
                        OutboundResponse::Ack { request_id }
                    }
                    Err(err) => error_response(request_id, err),
                }
            };
            send_response(tx, response);
        }
        InboundMessage::Leave { request_id, player_id } => {
            {
                let mut engine = state.engine.lock().unwrap();
                engine.handle_leave(&player_id);
            }
            if let Some(request_id) = request_id {
                send_response(tx, OutboundResponse::Ack { request_id });
            }
        }
        InboundMessage::Bet { request_id, player_id, bets } => {
            let response = {
                let mut engine = state.engine.lock().unwrap();
                match engine.handle_bet(&player_id, bets) {
                    Ok(payload) => {
                        state.broadcaster.send(OutboundEvent::State {
                            player_id: Some(player_id.clone()),
                            payload,
                        }).ok();
                        OutboundResponse::Ack { request_id }
                    }
                    Err(err) => error_response(request_id, err),
                }
            };
            send_response(tx, response);
        }
    }
}

fn send_response(tx: &mpsc::UnboundedSender<Message>, response: OutboundResponse) {
    if let Ok(payload) = serde_json::to_string(&response) {
        let _ = tx.send(Message::Text(payload));
    }
}

fn error_response(request_id: String, err: LiveTableError) -> OutboundResponse {
    let (code, message) = match err {
        LiveTableError::BettingClosed => ("BETTING_CLOSED".to_string(), "BETTING_CLOSED".to_string()),
        LiveTableError::NotSubscribed => ("NOT_SUBSCRIBED".to_string(), "NOT_SUBSCRIBED".to_string()),
        LiveTableError::InsufficientBalance => ("INSUFFICIENT_BALANCE".to_string(), "INSUFFICIENT_BALANCE".to_string()),
        LiveTableError::InvalidBet(msg) => ("INVALID_BET".to_string(), msg),
        LiveTableError::Execution(err) => ("INVALID_MOVE".to_string(), format!("{err:?}")),
    };
    OutboundResponse::Error { request_id, code, message }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let host = std::env::var("LIVE_TABLE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("LIVE_TABLE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9123);

    let config = LiveTableConfig::from_env();
    let engine = Arc::new(Mutex::new(LiveTableEngine::new(config.clone())));
    let (broadcaster, _) = broadcast::channel::<OutboundEvent>(1024);

    let state = AppState { engine: engine.clone(), broadcaster: broadcaster.clone() };

    // Tick loop
    let tick_engine = engine.clone();
    let tick_broadcaster = broadcaster.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_millis(config.tick_ms));
        loop {
            interval.tick().await;
            let events = {
                let mut engine = tick_engine.lock().unwrap();
                engine.tick(Instant::now())
            };
            for event in events {
                let _ = tick_broadcaster.send(event);
            }
        }
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/healthz", get(healthz))
        .with_state(state);

    let addr: SocketAddr = format!("{host}:{port}").parse().context("invalid listen addr")?;
    info!(%addr, "live table service listening");

    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}
fn reset_session_if_needed(seed: &Seed, session: &mut GameSession) {
    if session.state_blob.is_empty() || session.is_complete {
        session.state_blob.clear();
        session.is_complete = false;
        session.move_count = 0;
        let mut rng = GameRng::new(seed, session.id, 0);
        let _ = init_game(session, &mut rng);
    }
}
