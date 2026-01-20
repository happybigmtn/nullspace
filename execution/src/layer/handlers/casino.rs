use super::casino_error_vec;
use super::super::*;
use commonware_cryptography::{sha256::Sha256, Hasher};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

const SECS_PER_VIEW: u64 = 3;
const MS_PER_VIEW: u64 = SECS_PER_VIEW * 1_000;

fn payload_prefix_hex(payload: &[u8], max_bytes: usize) -> String {
    let len = payload.len().min(max_bytes);
    let mut out = String::with_capacity(len.saturating_mul(2));
    for byte in &payload[..len] {
        let _ = write!(out, "{:02x}", byte);
    }
    out
}

fn settle_freeroll_credits(
    player: &mut nullspace_types::casino::Player,
    now: u64,
) {
    let locked = player.balances.freeroll_credits_locked;
    let start = player.balances.freeroll_credits_unlock_start_ts;
    let end = player.balances.freeroll_credits_unlock_end_ts;
    if locked == 0 || start == 0 || end <= start || now <= start {
        return;
    }
    let duration = end.saturating_sub(start);
    if duration == 0 {
        return;
    }
    let elapsed = now.saturating_sub(start).min(duration);
    let unlocked = (locked as u128)
        .saturating_mul(elapsed as u128)
        .checked_div(duration as u128)
        .unwrap_or(0) as u64;
    if unlocked > 0 {
        player.balances.freeroll_credits_locked =
            player.balances.freeroll_credits_locked.saturating_sub(unlocked);
        player.balances.freeroll_credits =
            player.balances.freeroll_credits.saturating_add(unlocked);
    }
    if now >= end {
        player.balances.freeroll_credits_locked = 0;
        player.balances.freeroll_credits_unlock_start_ts = 0;
        player.balances.freeroll_credits_unlock_end_ts = 0;
    } else {
        player.balances.freeroll_credits_unlock_start_ts = now;
    }
}

fn expire_freeroll_credits(
    player: &mut nullspace_types::casino::Player,
    now: u64,
    policy: &nullspace_types::casino::PolicyState,
) {
    let last_ts = player.tournament.last_tournament_ts;
    if last_ts == 0 {
        return;
    }
    if now.saturating_sub(last_ts) < policy.credit_expiry_secs {
        return;
    }
    player.balances.freeroll_credits = 0;
    player.balances.freeroll_credits_locked = 0;
    player.balances.freeroll_credits_unlock_start_ts = 0;
    player.balances.freeroll_credits_unlock_end_ts = 0;
}

fn award_freeroll_credits(
    player: &mut nullspace_types::casino::Player,
    amount: u64,
    now: u64,
    policy: &nullspace_types::casino::PolicyState,
) {
    if amount == 0 {
        return;
    }
    expire_freeroll_credits(player, now, policy);
    settle_freeroll_credits(player, now);

    let immediate = (amount as u128)
        .saturating_mul(policy.credit_immediate_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    let locked = amount.saturating_sub(immediate);

    if immediate > 0 {
        player.balances.freeroll_credits =
            player.balances.freeroll_credits.saturating_add(immediate);
    }
    if locked > 0 {
        if player.balances.freeroll_credits_locked == 0 {
            player.balances.freeroll_credits_unlock_start_ts = now;
            player.balances.freeroll_credits_unlock_end_ts =
                now.saturating_add(policy.credit_vest_secs);
        } else {
            let desired_end = now.saturating_add(policy.credit_vest_secs);
            if player.balances.freeroll_credits_unlock_end_ts < desired_end {
                player.balances.freeroll_credits_unlock_end_ts = desired_end;
            }
            if player.balances.freeroll_credits_unlock_start_ts == 0 {
                player.balances.freeroll_credits_unlock_start_ts = now;
            }
        }
        player.balances.freeroll_credits_locked =
            player.balances.freeroll_credits_locked.saturating_add(locked);
    }
}

fn record_play_session(
    player: &mut nullspace_types::casino::Player,
    session: &nullspace_types::casino::GameSession,
    now: u64,
) {
    let created_at_secs = session.created_at.saturating_mul(SECS_PER_VIEW);
    let duration_secs = now.saturating_sub(created_at_secs).max(1);
    player.session.sessions_played = player.session.sessions_played.saturating_add(1);
    player.session.play_seconds = player.session.play_seconds.saturating_add(duration_secs);
    player.session.last_session_ts = now;
}

const PROOF_WEIGHT_SCALE: u128 = 1_000_000_000;
const PROOF_WEIGHT_MIN: u128 = 50_000_000;
const PROOF_WEIGHT_BASE: u128 = 200_000_000;
const PROOF_WEIGHT_MULTIPLIER: u128 = 800_000_000;

fn proof_of_play_multiplier(
    player: &nullspace_types::casino::Player,
    now: u64,
) -> u128 {
    let min_sessions = nullspace_types::casino::PROOF_OF_PLAY_MIN_SESSIONS as u128;
    let min_seconds = nullspace_types::casino::PROOF_OF_PLAY_MIN_SECONDS as u128;

    let session_weight = if min_sessions == 0 {
        PROOF_WEIGHT_SCALE
    } else {
        (player.session.sessions_played as u128)
            .saturating_mul(PROOF_WEIGHT_SCALE)
            .checked_div(min_sessions)
            .unwrap_or(0)
            .min(PROOF_WEIGHT_SCALE)
    };
    let seconds_weight = if min_seconds == 0 {
        PROOF_WEIGHT_SCALE
    } else {
        (player.session.play_seconds as u128)
            .saturating_mul(PROOF_WEIGHT_SCALE)
            .checked_div(min_seconds)
            .unwrap_or(0)
            .min(PROOF_WEIGHT_SCALE)
    };

    let activity_weight = (session_weight.saturating_add(seconds_weight)) / 2;
    let age_secs = now.saturating_sub(player.profile.created_ts) as u128;
    let age_weight = if nullspace_types::casino::ACCOUNT_TIER_NEW_SECS == 0 {
        PROOF_WEIGHT_SCALE
    } else {
        age_secs
            .saturating_mul(PROOF_WEIGHT_SCALE)
            .checked_div(nullspace_types::casino::ACCOUNT_TIER_NEW_SECS as u128)
            .unwrap_or(0)
            .min(PROOF_WEIGHT_SCALE)
    };

    let activity_age = activity_weight
        .saturating_mul(age_weight)
        .checked_div(PROOF_WEIGHT_SCALE)
        .unwrap_or(0);
    PROOF_WEIGHT_BASE
        .saturating_add(
            PROOF_WEIGHT_MULTIPLIER
                .saturating_mul(activity_age)
                .checked_div(PROOF_WEIGHT_SCALE)
                .unwrap_or(0),
        )
        .clamp(PROOF_WEIGHT_MIN, PROOF_WEIGHT_SCALE)
}
impl<'a, S: State> Layer<'a, S> {
    // === Casino Handler Methods ===

    async fn ensure_player_registry(&mut self, public: &PublicKey) -> anyhow::Result<()> {
        let mut registry = self.get_or_init_player_registry().await?;
        if registry.players.iter().any(|pk| pk == public) {
            return Ok(());
        }
        registry.players.push(public.clone());
        registry.players.sort_unstable();
        registry.players.dedup();
        self.insert(Key::PlayerRegistry, Value::PlayerRegistry(registry));
        Ok(())
    }

    async fn casino_player_or_error(
        &mut self,
        public: &PublicKey,
        session_id: Option<u64>,
    ) -> anyhow::Result<Result<nullspace_types::casino::Player, Vec<Event>>> {
        match self.get(Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(player)) => Ok(Ok(player)),
            _ => Ok(Err(casino_error_vec(
                public,
                session_id,
                nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
                "Player not found",
            ))),
        }
    }

    async fn casino_session_owned_active_or_error(
        &mut self,
        public: &PublicKey,
        session_id: u64,
    ) -> anyhow::Result<Result<nullspace_types::casino::GameSession, Vec<Event>>> {
        let session = match self.get(Key::CasinoSession(session_id)).await? {
            Some(Value::CasinoSession(session)) => session,
            _ => {
                return Ok(Err(casino_error_vec(
                    public,
                    Some(session_id),
                    nullspace_types::casino::ERROR_SESSION_NOT_FOUND,
                    "Session not found",
                )))
            }
        };

        if session.player != *public {
            return Ok(Err(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_SESSION_NOT_OWNED,
                "Session does not belong to this player",
            )));
        }

        if session.is_complete {
            return Ok(Err(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_SESSION_COMPLETE,
                "Session already complete",
            )));
        }

        Ok(Ok(session))
    }

    pub(in crate::layer) async fn handle_casino_register(
        &mut self,
        public: &PublicKey,
        name: &str,
    ) -> anyhow::Result<Vec<Event>> {
        // Check if player already exists
        if self
            .get(Key::CasinoPlayer(public.clone()))
            .await?
            .is_some()
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_PLAYER_ALREADY_REGISTERED,
                "Player already registered",
            ));
        }

        // Create new player with initial chips and created timestamp.
        let mut player = nullspace_types::casino::Player::new(name.to_string());
        let current_time_sec = self.seed_view.saturating_mul(SECS_PER_VIEW);
        player.profile.created_ts = current_time_sec;

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player.clone()),
        );
        self.ensure_player_registry(public).await?;

        // Update leaderboard with initial chips
        let mut events = vec![Event::CasinoPlayerRegistered {
            player: public.clone(),
            name: name.to_string(),
        }];
        if let Some(event) = self.update_casino_leaderboard(public, &player).await? {
            events.push(event);
        }
        tracing::info!(
            player = ?public,
            name = name,
            "casino player registered"
        );

        Ok(events)
    }

    pub(in crate::layer) async fn handle_casino_deposit(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.casino_player_or_error(public, None).await? {
            Ok(player) => player,
            Err(events) => return Ok(events),
        };

        // Daily faucet rate limiting (dev/testing).
        let current_block = self.seed_view;
        let current_time_sec = current_block.saturating_mul(SECS_PER_VIEW);
        let account_age = if player.profile.created_ts == 0 {
            0
        } else {
            current_time_sec.saturating_sub(player.profile.created_ts)
        };
        if account_age < nullspace_types::casino::FAUCET_MIN_ACCOUNT_AGE_SECS
            && player.session.sessions_played < nullspace_types::casino::FAUCET_MIN_SESSIONS
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_RATE_LIMITED,
                "Faucet locked until you have some play time",
            ));
        }
        let block_delta = current_block.saturating_sub(player.session.last_deposit_block);
        if player.session.last_deposit_block != 0
            && block_delta < nullspace_types::casino::FAUCET_RATE_LIMIT
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_RATE_LIMITED,
                "Faucet cooldown active, try again later",
            ));
        }
        let current_day = current_time_sec / 86_400;
        let last_deposit_day =
            player.session.last_deposit_block.saturating_mul(SECS_PER_VIEW) / 86_400;
        let is_rate_limited =
            player.session.last_deposit_block != 0 && last_deposit_day == current_day;
        if is_rate_limited {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_RATE_LIMITED,
                "Daily faucet already claimed, try again tomorrow",
            ));
        }

        // Grant faucet chips
        player.balances.chips = player.balances.chips.saturating_add(amount);
        player.session.last_deposit_block = current_block;

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player.clone()),
        );

        let mut events = vec![Event::CasinoDeposited {
            player: public.clone(),
            amount,
            new_chips: player.balances.chips,
        }];
        if let Some(event) = self.update_casino_leaderboard(public, &player).await? {
            events.push(event);
        }
        tracing::info!(
            player = ?public,
            amount = amount,
            new_chips = player.balances.chips,
            "casino deposit accepted"
        );

        Ok(events)
    }

    fn update_aura_meter_for_completion(
        player: &mut nullspace_types::casino::Player,
        session: &nullspace_types::casino::GameSession,
        won: bool,
    ) {
        if !session.super_mode.is_active {
            return;
        }

        // Consume a Super Aura Round once it has been used.
        if crate::casino::super_mode::is_super_aura_round(player.modifiers.aura_meter) {
            player.modifiers.aura_meter = crate::casino::super_mode::reset_aura_meter();
            return;
        }

        // Until we pipe game-specific aura element detection into the session lifecycle,
        // approximate "near-miss" behavior by incrementing on any super-mode loss.
        player.modifiers.aura_meter =
            crate::casino::super_mode::update_aura_meter(player.modifiers.aura_meter, true, won);
    }

    fn consume_aura_round_on_push(
        player: &mut nullspace_types::casino::Player,
        session: &nullspace_types::casino::GameSession,
    ) {
        if !session.super_mode.is_active {
            return;
        }
        if crate::casino::super_mode::is_super_aura_round(player.modifiers.aura_meter) {
            player.modifiers.aura_meter = crate::casino::super_mode::reset_aura_meter();
        }
    }

    pub(in crate::layer) async fn handle_casino_start_game(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
        bet: u64,
        session_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self
            .casino_player_or_error(public, Some(session_id))
            .await?
        {
            Ok(player) => player,
            Err(events) => return Ok(events),
        };
        self.ensure_player_registry(public).await?;

        // Determine play mode (cash vs tournament)
        let mut is_tournament = false;
        let mut tournament_id = None;
        if let Some(active_tid) = player.tournament.active_tournament {
            if let Some(Value::Tournament(t)) = self.get(Key::Tournament(active_tid)).await? {
                if matches!(t.phase, nullspace_types::casino::TournamentPhase::Active) {
                    is_tournament = true;
                    tournament_id = Some(active_tid);
                } else {
                    player.tournament.active_tournament = None;
                }
            } else {
                player.tournament.active_tournament = None;
            }
        }

        // Some table-style games place all wagers via `CasinoGameMove` deductions (ContinueWithUpdate),
        // so they can start with `bet = 0` without charging an extra "entry fee".
        let allows_zero_bet = matches!(
            game_type,
            nullspace_types::casino::GameType::Baccarat
                | nullspace_types::casino::GameType::Craps
                | nullspace_types::casino::GameType::Roulette
                | nullspace_types::casino::GameType::SicBo
        );
        if bet == 0 && !allows_zero_bet {
            return Ok(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_INVALID_BET,
                "Bet must be greater than zero",
            ));
        }
        let wants_super = player.modifiers.active_super;
        let super_fee = if wants_super && bet > 0 {
            crate::casino::get_super_mode_fee(bet)
        } else {
            0
        };
        let required_stack = bet.saturating_add(super_fee);
        let available_stack = if is_tournament {
            player.tournament.chips
        } else {
            player.balances.chips
        };
        if available_stack < required_stack {
            return Ok(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                format!(
                    "Insufficient chips: have {}, need {}",
                    available_stack, required_stack
                ),
            ));
        }

        // Check for existing session
        if self.get(Key::CasinoSession(session_id)).await?.is_some() {
            return Ok(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_SESSION_EXISTS,
                "Session already exists",
            ));
        }

        // Deduct bet (and any upfront super fee) from player
        if is_tournament {
            player.tournament.chips = player.tournament.chips.saturating_sub(required_stack);
        } else {
            player.balances.chips = player.balances.chips.saturating_sub(required_stack);
        }
        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player.clone()),
        );

        // Update House PnL (Income)
        if !is_tournament && required_stack > 0 {
            self.update_house_pnl(required_stack as i128).await?;
        }

        // Create game session and update leaderboard after bet deduction
        let mut session = nullspace_types::casino::GameSession {
            id: session_id,
            player: public.clone(),
            game_type,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: self.seed_view,
            is_complete: false,
            super_mode: nullspace_types::casino::SuperModeState::default(),
            is_tournament,
            tournament_id,
        };

        // Initialize Super/Aura mode for this session (independent RNG domain).
        if wants_super {
            session.super_mode.is_active = true;
            let aura_round =
                crate::casino::super_mode::is_super_aura_round(player.modifiers.aura_meter);
            let mut super_rng = crate::casino::GameRng::new(&self.seed, session_id, u32::MAX);
            let mut multipliers =
                crate::casino::generate_super_multipliers(session.game_type, &mut super_rng);
            if aura_round {
                crate::casino::super_mode::enhance_multipliers_for_aura_round(&mut multipliers);
            }
            session.super_mode.multipliers = multipliers;
        }
        let leaderboard_event = self
            .update_leaderboard_for_session(&session, public, &player)
            .await?;

        // Initialize game
        let mut rng = crate::casino::GameRng::new(&self.seed, session_id, 0);
        let result = crate::casino::init_game(&mut session, &mut rng);
        tracing::info!(
            player = ?public,
            session_id = session_id,
            game_type = ?session.game_type,
            bet = session.bet,
            tournament = session.is_tournament,
            super_mode = session.super_mode.is_active,
            "casino game started"
        );

        let initial_state = session.state_blob.clone();

        self.insert(
            Key::CasinoSession(session_id),
            Value::CasinoSession(session.clone()),
        );

        let mut events = vec![Event::CasinoGameStarted {
            session_id,
            player: public.clone(),
            game_type,
            bet,
            initial_state,
        }];
        if let Some(event) = leaderboard_event {
            events.push(event);
        }

        // Handle immediate result (e.g. Natural Blackjack)
        if !matches!(result, crate::casino::GameResult::Continue(_)) {
            log_game_completion(public, &session, &result);
            let now = self.seed_view.saturating_mul(SECS_PER_VIEW);
            if let Some(Value::CasinoPlayer(mut player)) =
                self.get(Key::CasinoPlayer(public.clone())).await?
            {
                match result {
                    crate::casino::GameResult::Win(base_payout, logs) => {
                        let mut payout = base_payout as i64;
                        let was_doubled = player.modifiers.active_double;
                        if was_doubled
                            && ((session.is_tournament && player.tournament.doubles > 0)
                                || (!session.is_tournament && player.modifiers.doubles > 0))
                        {
                            payout *= 2;
                            if session.is_tournament {
                                player.tournament.doubles -= 1;
                            } else {
                                player.modifiers.doubles -= 1;
                            }
                        }
                        // Safe cast: payout should always be positive for Win result
                        let addition = u64::try_from(payout).unwrap_or(0);
                        if session.is_tournament {
                            player.tournament.chips =
                                player.tournament.chips.saturating_add(addition);
                        } else {
                            player.balances.chips = player.balances.chips.saturating_add(addition);
                        }
                        player.clear_active_modifiers();
                        Self::update_aura_meter_for_completion(&mut player, &session, true);

                        // Update House PnL (Payout)
                        if !session.is_tournament {
                            self.update_house_pnl(-(payout as i128)).await?;
                        }

                        let final_chips = if session.is_tournament {
                            player.tournament.chips
                        } else {
                            player.balances.chips
                        };
                        record_play_session(&mut player, &session, now);
                        self.insert(
                            Key::CasinoPlayer(public.clone()),
                            Value::CasinoPlayer(player.clone()),
                        );
                        if let Some(event) = self
                            .update_leaderboard_for_session(&session, public, &player)
                            .await?
                        {
                            events.push(event);
                        }

                        let balances =
                            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                        events.push(Event::CasinoGameCompleted {
                            session_id,
                            player: public.clone(),
                            game_type: session.game_type,
                            payout,
                            final_chips,
                            was_shielded: false,
                            was_doubled,
                            logs,
                            player_balances: balances,
                        });
                    }
                    crate::casino::GameResult::Push(refund, logs) => {
                        if session.is_tournament {
                            player.tournament.chips =
                                player.tournament.chips.saturating_add(refund);
                        } else {
                            player.balances.chips =
                                player.balances.chips.saturating_add(refund);
                        }
                        player.clear_active_modifiers();
                        Self::consume_aura_round_on_push(&mut player, &session);

                        let final_chips = if session.is_tournament {
                            player.tournament.chips
                        } else {
                            player.balances.chips
                        };
                        record_play_session(&mut player, &session, now);
                        self.insert(
                            Key::CasinoPlayer(public.clone()),
                            Value::CasinoPlayer(player.clone()),
                        );

                        // Update leaderboard after push
                        if let Some(event) = self
                            .update_leaderboard_for_session(&session, public, &player)
                            .await?
                        {
                            events.push(event);
                        }

                        let balances =
                            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                        events.push(Event::CasinoGameCompleted {
                            session_id,
                            player: public.clone(),
                            game_type: session.game_type,
                            payout: refund as i64,
                            final_chips,
                            was_shielded: false,
                            was_doubled: false,
                            logs,
                            player_balances: balances,
                        });
                    }
                    crate::casino::GameResult::Loss(logs) => {
                        let shield_pool = if session.is_tournament {
                            player.tournament.shields
                        } else {
                            player.modifiers.shields
                        };
                        let was_shielded = player.modifiers.active_shield && shield_pool > 0;
                        let payout = if was_shielded {
                            if session.is_tournament {
                                player.tournament.shields =
                                    player.tournament.shields.saturating_sub(1);
                            } else {
                                player.modifiers.shields =
                                    player.modifiers.shields.saturating_sub(1);
                            }
                            0
                        } else {
                            -(session.bet as i64)
                        };
                        player.clear_active_modifiers();
                        Self::update_aura_meter_for_completion(&mut player, &session, false);

                        let final_chips = if session.is_tournament {
                            player.tournament.chips
                        } else {
                            player.balances.chips
                        };
                        record_play_session(&mut player, &session, now);
                        self.insert(
                            Key::CasinoPlayer(public.clone()),
                            Value::CasinoPlayer(player.clone()),
                        );

                        // Update leaderboard after immediate loss
                        if let Some(event) = self
                            .update_leaderboard_for_session(&session, public, &player)
                            .await?
                        {
                            events.push(event);
                        }

                        let balances =
                            nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                        events.push(Event::CasinoGameCompleted {
                            session_id,
                            player: public.clone(),
                            game_type: session.game_type,
                            payout,
                            final_chips,
                            was_shielded,
                            was_doubled: false,
                            logs,
                            player_balances: balances,
                        });
                    }
                    _ => {}
                }
            }
        }

        Ok(events)
    }

    pub(in crate::layer) async fn handle_casino_game_move(
        &mut self,
        public: &PublicKey,
        session_id: u64,
        payload: &[u8],
    ) -> anyhow::Result<Vec<Event>> {
        let mut session = match self
            .casino_session_owned_active_or_error(public, session_id)
            .await?
        {
            Ok(session) => session,
            Err(events) => return Ok(events),
        };
        let now = self.seed_view.saturating_mul(SECS_PER_VIEW);
        let payload_len = payload.len();
        let payload_action = payload.first().copied();
        let payload_prefix = payload_prefix_hex(payload, 12);

        // Process move
        session.move_count += 1;
        let mut rng = crate::casino::GameRng::new(&self.seed, session_id, session.move_count);

        let result = match crate::casino::process_game_move(&mut session, payload, &mut rng) {
            Ok(r) => r,
            Err(err) => {
                // Map each GameError variant to a distinct error code for debugging
                let (error_code, error_message) = match &err {
                    crate::casino::GameError::InvalidPayload => (
                        nullspace_types::casino::ERROR_INVALID_PAYLOAD,
                        "Invalid payload format",
                    ),
                    crate::casino::GameError::InvalidMove => (
                        nullspace_types::casino::ERROR_INVALID_MOVE,
                        "Invalid move for current game state",
                    ),
                    crate::casino::GameError::GameAlreadyComplete => (
                        nullspace_types::casino::ERROR_SESSION_COMPLETE,
                        "Game session already complete",
                    ),
                    crate::casino::GameError::InvalidState => (
                        nullspace_types::casino::ERROR_INVALID_STATE,
                        "Invalid or corrupted game state",
                    ),
                    crate::casino::GameError::DeckExhausted => (
                        nullspace_types::casino::ERROR_DECK_EXHAUSTED,
                        "Deck exhausted, no more cards available",
                    ),
                };
                tracing::warn!(
                    player = ?public,
                    session_id = session_id,
                    game_type = ?session.game_type,
                    payload_len = payload_len,
                    payload_action = payload_action,
                    payload_prefix = %payload_prefix,
                    ?err,
                    error_code = error_code,
                    "casino move rejected"
                );
                return Ok(casino_error_vec(
                    public,
                    Some(session_id),
                    error_code,
                    error_message,
                ));
            }
        };
        match &result {
            crate::casino::GameResult::Continue(logs) => {
                tracing::info!(
                    player = ?public,
                    session_id = session_id,
                    game_type = ?session.game_type,
                    move_count = session.move_count,
                    payload_len = payload_len,
                    payload_action = payload_action,
                    payload_prefix = %payload_prefix,
                    logs_len = logs.len(),
                    logs = ?logs,
                    "casino move accepted"
                );
            }
            crate::casino::GameResult::ContinueWithUpdate { payout, logs } => {
                tracing::info!(
                    player = ?public,
                    session_id = session_id,
                    game_type = ?session.game_type,
                    move_count = session.move_count,
                    payload_len = payload_len,
                    payload_action = payload_action,
                    payload_prefix = %payload_prefix,
                    payout = *payout,
                    logs_len = logs.len(),
                    logs = ?logs,
                    "casino move accepted"
                );
            }
            _ => {
                tracing::info!(
                    player = ?public,
                    session_id = session_id,
                    game_type = ?session.game_type,
                    move_count = session.move_count,
                    payload_len = payload_len,
                    payload_action = payload_action,
                    payload_prefix = %payload_prefix,
                    "casino move accepted"
                );
            }
        }

        let result = self
            .apply_progressive_meters_for_completion(&session, result)
            .await?;

        let move_number = session.move_count;
        let new_state = session.state_blob.clone();

        if matches!(
            result,
            crate::casino::GameResult::Win(..)
                | crate::casino::GameResult::Push(..)
                | crate::casino::GameResult::Loss(..)
                | crate::casino::GameResult::LossWithExtraDeduction(..)
                | crate::casino::GameResult::LossPreDeducted(..)
        ) {
            log_game_completion(public, &session, &result);
        }

        // Handle game result
        let mut events = Vec::with_capacity(2);
        let mut move_balances: Option<nullspace_types::casino::PlayerBalanceSnapshot> = None;
        let move_logs: Vec<String>;

        let atomic_wager = if session.move_count == 1
            && matches!(
                session.game_type,
                nullspace_types::casino::GameType::Baccarat
                    | nullspace_types::casino::GameType::Craps
                    | nullspace_types::casino::GameType::Roulette
                    | nullspace_types::casino::GameType::SicBo
            ) {
            session.bet
        } else {
            0
        };
        let atomic_super_fee = if atomic_wager > 0 && session.super_mode.is_active {
            crate::casino::get_super_mode_fee(atomic_wager)
        } else {
            0
        };
        let atomic_total = atomic_wager.saturating_add(atomic_super_fee);

        match result {
            crate::casino::GameResult::Continue(logs) => {
                move_logs = logs;
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session),
                );
                if let Some(Value::CasinoPlayer(player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    move_balances =
                        Some(nullspace_types::casino::PlayerBalanceSnapshot::from_player(
                            &player,
                        ));
                }
            }
            crate::casino::GameResult::ContinueWithUpdate { payout, logs } => {
                move_logs = logs;
                // Handle mid-game balance updates (additional bets or intermediate payouts)
                if let Some(Value::CasinoPlayer(mut player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    let skip_super_fee = session.game_type == nullspace_types::casino::GameType::Craps
                        && session.move_count == 1
                        && session.bet > 0;
                    let stack = if session.is_tournament {
                        &mut player.tournament.chips
                    } else {
                        &mut player.balances.chips
                    };
                    if payout < 0 {
                        // Deducting chips (new bet placed)
                        // Use checked_neg to safely convert negative i64 to positive value
                        let deduction = payout
                            .checked_neg()
                            .and_then(|v| u64::try_from(v).ok())
                            .unwrap_or(0);
                        let super_fee = if skip_super_fee {
                            0
                        } else if session.super_mode.is_active {
                            crate::casino::get_super_mode_fee(deduction)
                        } else {
                            0
                        };
                        let total_deduction = deduction.saturating_add(super_fee);
                        if deduction == 0 || *stack < total_deduction {
                            // Insufficient funds or overflow - reject the move
                            return Ok(casino_error_vec(
                                public,
                                Some(session_id),
                                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                format!(
                                    "Insufficient chips for additional bet: have {}, need {}",
                                    *stack, total_deduction
                                ),
                            ));
                        }
                        *stack = stack.saturating_sub(total_deduction);

                        // Update House PnL for cash games only (income from wager + super fee).
                        if !session.is_tournament && total_deduction > 0 {
                            self.update_house_pnl(total_deduction as i128).await?;
                        }
                    } else {
                        // Adding chips (intermediate win)
                        // Safe cast: positive i64 fits in u64
                        let addition = u64::try_from(payout).unwrap_or(0);
                        *stack = stack.saturating_add(addition);

                        // Update House PnL for cash games only (payout outflow).
                        if !session.is_tournament && addition > 0 {
                            self.update_house_pnl(-(addition as i128)).await?;
                        }
                    }
                    self.insert(
                        Key::CasinoPlayer(public.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );
                    move_balances =
                        Some(nullspace_types::casino::PlayerBalanceSnapshot::from_player(
                            &player,
                        ));

                    // Update leaderboard after mid-game balance change
                    if let Some(event) = self
                        .update_leaderboard_for_session(&session, public, &player)
                        .await?
                    {
                        events.push(event);
                    }
                }
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session),
                );
            }
            crate::casino::GameResult::Win(base_payout, logs) => {
                move_logs = logs;
                session.is_complete = true;
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session.clone()),
                );

                // Get player for modifier state
                if let Some(Value::CasinoPlayer(mut player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    let mut payout = base_payout as i64;
                    let was_doubled = player.modifiers.active_double;
                    let doubles_pool = if session.is_tournament {
                        &mut player.tournament.doubles
                    } else {
                        &mut player.modifiers.doubles
                    };
                    if was_doubled && *doubles_pool > 0 {
                        payout *= 2;
                        *doubles_pool -= 1;
                    }
                    // Safe cast: payout should always be positive for Win result
                    let addition = u64::try_from(payout).unwrap_or(0);
                    let final_chips = {
                        let stack = if session.is_tournament {
                            &mut player.tournament.chips
                        } else {
                            &mut player.balances.chips
                        };
                        if atomic_total > 0 {
                            if *stack < atomic_total {
                                return Ok(casino_error_vec(
                                    public,
                                    Some(session_id),
                                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                    format!(
                                        "Insufficient chips for additional bet: have {}, need {}",
                                        *stack, atomic_total
                                    ),
                                ));
                            }
                            *stack = stack.saturating_sub(atomic_total);
                            if !session.is_tournament {
                                self.update_house_pnl(atomic_total as i128).await?;
                            }
                        }
                        *stack = stack.saturating_add(addition);
                        *stack
                    };
                    player.clear_active_modifiers();
                    Self::update_aura_meter_for_completion(&mut player, &session, true);

                    if !session.is_tournament {
                        self.update_house_pnl(-(payout as i128)).await?;
                    }

                    record_play_session(&mut player, &session, now);
                    self.insert(
                        Key::CasinoPlayer(public.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );
                    if let Some(event) = self
                        .update_leaderboard_for_session(&session, public, &player)
                        .await?
                    {
                        events.push(event);
                    }

                    let balances =
                        nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                    move_balances = Some(balances.clone());
                    events.push(Event::CasinoGameCompleted {
                        session_id,
                        player: public.clone(),
                        game_type: session.game_type,
                        payout,
                        final_chips,
                        was_shielded: false,
                        was_doubled,
                        logs: move_logs.clone(),
                        player_balances: balances,
                    });
                }
            }
            crate::casino::GameResult::Push(refund, logs) => {
                move_logs = logs;
                session.is_complete = true;
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session.clone()),
                );

                if let Some(Value::CasinoPlayer(mut player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    // Return specified refund amount on push
                    let final_chips = {
                        let stack = if session.is_tournament {
                            &mut player.tournament.chips
                        } else {
                            &mut player.balances.chips
                        };
                        if atomic_total > 0 {
                            if *stack < atomic_total {
                                return Ok(casino_error_vec(
                                    public,
                                    Some(session_id),
                                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                    format!(
                                        "Insufficient chips for additional bet: have {}, need {}",
                                        *stack, atomic_total
                                    ),
                                ));
                            }
                            *stack = stack.saturating_sub(atomic_total);
                            if !session.is_tournament {
                                self.update_house_pnl(atomic_total as i128).await?;
                            }
                        }
                        *stack = stack.saturating_add(refund);
                        *stack
                    };
                    player.clear_active_modifiers();
                    Self::consume_aura_round_on_push(&mut player, &session);

                    // Update House PnL (Refund)
                    if !session.is_tournament {
                        self.update_house_pnl(-(refund as i128)).await?;
                    }

                    record_play_session(&mut player, &session, now);
                    self.insert(
                        Key::CasinoPlayer(public.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );

                    // Update leaderboard after push
                    if let Some(event) = self
                        .update_leaderboard_for_session(&session, public, &player)
                        .await?
                    {
                        events.push(event);
                    }

                    let balances =
                        nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                    move_balances = Some(balances.clone());
                    events.push(Event::CasinoGameCompleted {
                        session_id,
                        player: public.clone(),
                        game_type: session.game_type,
                        payout: refund as i64,
                        final_chips,
                        was_shielded: false,
                        was_doubled: false,
                        logs: move_logs.clone(),
                        player_balances: balances,
                    });
                }
            }
            crate::casino::GameResult::Loss(logs) => {
                move_logs = logs;
                session.is_complete = true;
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session.clone()),
                );

                if let Some(Value::CasinoPlayer(mut player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    let shields_pool = if session.is_tournament {
                        &mut player.tournament.shields
                    } else {
                        &mut player.modifiers.shields
                    };
                    let was_shielded = player.modifiers.active_shield && *shields_pool > 0;
                    let payout = if was_shielded {
                        *shields_pool = shields_pool.saturating_sub(1);
                        0 // Shield prevents loss
                    } else {
                        -(session.bet as i64)
                    };
                    player.clear_active_modifiers();
                    Self::update_aura_meter_for_completion(&mut player, &session, false);

                    let stack = if session.is_tournament {
                        &mut player.tournament.chips
                    } else {
                        &mut player.balances.chips
                    };
                    if atomic_total > 0 {
                        if *stack < atomic_total {
                            return Ok(casino_error_vec(
                                public,
                                Some(session_id),
                                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                format!(
                                    "Insufficient chips for additional bet: have {}, need {}",
                                    *stack, atomic_total
                                ),
                            ));
                        }
                        *stack = stack.saturating_sub(atomic_total);
                        if !session.is_tournament {
                            self.update_house_pnl(atomic_total as i128).await?;
                        }
                    }
                    let final_chips = *stack;
                    record_play_session(&mut player, &session, now);
                    self.insert(
                        Key::CasinoPlayer(public.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );

                    // Update leaderboard after loss
                    if let Some(event) = self
                        .update_leaderboard_for_session(&session, public, &player)
                        .await?
                    {
                        events.push(event);
                    }

                    let balances =
                        nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                    move_balances = Some(balances.clone());
                    events.push(Event::CasinoGameCompleted {
                        session_id,
                        player: public.clone(),
                        game_type: session.game_type,
                        payout,
                        final_chips,
                        was_shielded,
                        was_doubled: false,
                        logs: move_logs.clone(),
                        player_balances: balances,
                    });
                }
            }
            crate::casino::GameResult::LossWithExtraDeduction(extra, logs) => {
                move_logs = logs;
                // Loss with additional deduction for mid-game bet increases
                // (e.g., Blackjack double-down, Casino War go-to-war)
                session.is_complete = true;
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session.clone()),
                );

                if let Some(Value::CasinoPlayer(mut player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    let (was_shielded, payout, final_chips) = {
                        let shields_pool = if session.is_tournament {
                            &mut player.tournament.shields
                        } else {
                            &mut player.modifiers.shields
                        };
                        let stack = if session.is_tournament {
                            &mut player.tournament.chips
                        } else {
                            &mut player.balances.chips
                        };
                        let was_shielded = player.modifiers.active_shield && *shields_pool > 0;
                        let payout = if was_shielded {
                            *shields_pool = shields_pool.saturating_sub(1);
                            0 // Shield prevents loss (but extra still deducted)
                        } else {
                            -(session.bet as i64)
                        };

                        // Deduct the extra amount that wasn't charged at StartGame (plus any super fee).
                        if extra > 0 {
                            let super_fee = if session.super_mode.is_active {
                                crate::casino::get_super_mode_fee(extra)
                            } else {
                                0
                            };
                            let total_deduction = extra.saturating_add(super_fee);
                            if *stack < total_deduction {
                                return Ok(casino_error_vec(
                                    public,
                                    Some(session_id),
                                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                    format!(
                                        "Insufficient chips for additional bet: have {}, need {}",
                                        *stack, total_deduction
                                    ),
                                ));
                            }
                            *stack = stack.saturating_sub(total_deduction);

                            // Update House PnL for cash games only (income from extra wager + super fee).
                            // Note: Shield does NOT prevent this extra deduction in current logic.
                            if !session.is_tournament && total_deduction > 0 {
                                self.update_house_pnl(total_deduction as i128).await?;
                            }
                        }

                        (was_shielded, payout, *stack)
                    };

                    player.clear_active_modifiers();
                    Self::update_aura_meter_for_completion(&mut player, &session, false);

                    record_play_session(&mut player, &session, now);
                    self.insert(
                        Key::CasinoPlayer(public.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );

                    // Update leaderboard after loss with extra deduction
                    if let Some(event) = self
                        .update_leaderboard_for_session(&session, public, &player)
                        .await?
                    {
                        events.push(event);
                    }

                    let balances =
                        nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                    move_balances = Some(balances.clone());
                    events.push(Event::CasinoGameCompleted {
                        session_id,
                        player: public.clone(),
                        game_type: session.game_type,
                        payout: payout - (extra as i64), // Total loss includes extra
                        final_chips,
                        was_shielded,
                        was_doubled: false,
                        logs: move_logs.clone(),
                        player_balances: balances,
                    });
                }
            }
            crate::casino::GameResult::LossPreDeducted(total_loss, logs) => {
                move_logs = logs;
                // Loss where chips were already deducted via ContinueWithUpdate
                // (e.g., Baccarat, Craps, Roulette, Sic Bo table games)
                // No additional chip deduction needed, just report the loss amount
                session.is_complete = true;
                self.insert(
                    Key::CasinoSession(session_id),
                    Value::CasinoSession(session.clone()),
                );

                if let Some(Value::CasinoPlayer(mut player)) =
                    self.get(Key::CasinoPlayer(public.clone())).await?
                {
                    let (was_shielded, payout, final_chips) = {
                        let shields_pool = if session.is_tournament {
                            &mut player.tournament.shields
                        } else {
                            &mut player.modifiers.shields
                        };
                        let stack = if session.is_tournament {
                            &mut player.tournament.chips
                        } else {
                            &mut player.balances.chips
                        };
                        let was_shielded = player.modifiers.active_shield && *shields_pool > 0;
                        let payout = if was_shielded {
                            // Shield prevents loss - refund the pre-deducted amount
                            *shields_pool = shields_pool.saturating_sub(1);
                            *stack = stack.saturating_add(total_loss);

                            // Update House PnL (Refund)
                            if !session.is_tournament {
                                self.update_house_pnl(-(total_loss as i128)).await?;
                            }

                            0
                        } else {
                            -(total_loss as i64)
                        };

                        (was_shielded, payout, *stack)
                    };

                    player.clear_active_modifiers();
                    Self::update_aura_meter_for_completion(&mut player, &session, false);

                    record_play_session(&mut player, &session, now);
                    self.insert(
                        Key::CasinoPlayer(public.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );

                    // Update leaderboard after pre-deducted loss
                    if let Some(event) = self
                        .update_leaderboard_for_session(&session, public, &player)
                        .await?
                    {
                        events.push(event);
                    }

                    let balances =
                        nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
                    move_balances = Some(balances.clone());
                    events.push(Event::CasinoGameCompleted {
                        session_id,
                        player: public.clone(),
                        game_type: session.game_type,
                        payout,
                        final_chips,
                        was_shielded,
                        was_doubled: false,
                        logs: move_logs.clone(),
                        player_balances: balances,
                    });
                }
            }
        }

        if move_balances.is_none() {
            if let Some(Value::CasinoPlayer(player)) =
                self.get(Key::CasinoPlayer(public.clone())).await?
            {
                move_balances =
                    Some(nullspace_types::casino::PlayerBalanceSnapshot::from_player(
                        &player,
                    ));
            }
        }
        let move_balances = move_balances.unwrap_or_default();
        events.insert(
            0,
            Event::CasinoGameMoved {
                session_id,
                move_number,
                new_state,
                logs: move_logs,
                player_balances: move_balances,
            },
        );

        Ok(events)
    }

    /// Handle player actions (toggle shield/double/super modifiers).
    ///
    /// Validation rules:
    /// - Shield/Double: Only allowed when player is in an ACTIVE tournament (not Registration/Complete)
    /// - Super: Allowed in both cash and tournament games
    pub(in crate::layer) async fn handle_casino_player_action(
        &mut self,
        public: &PublicKey,
        action: nullspace_types::casino::PlayerAction,
    ) -> anyhow::Result<Vec<Event>> {
        use nullspace_types::casino::PlayerAction;

        let mut player = match self.casino_player_or_error(public, None).await? {
            Ok(player) => player,
            Err(events) => return Ok(events),
        };

        // Validate and apply action in single match
        match action {
            PlayerAction::ToggleShield | PlayerAction::ToggleDouble => {
                // Shield and Double require player to be in an ACTIVE tournament
                let is_in_active_tournament = match player.tournament.active_tournament {
                    Some(tid) => {
                        match self.get(Key::Tournament(tid)).await? {
                            Some(Value::Tournament(t)) => {
                                t.phase == nullspace_types::casino::TournamentPhase::Active
                            }
                            _ => false, // Tournament doesn't exist (stale reference)
                        }
                    }
                    None => false,
                };

                if !is_in_active_tournament {
                    return Ok(casino_error_vec(
                        public,
                        None,
                        nullspace_types::casino::ERROR_NOT_IN_TOURNAMENT,
                        "Shield/Double modifiers are only available in active tournaments",
                    ));
                }

                // Apply toggle
                if matches!(action, PlayerAction::ToggleShield) {
                    player.modifiers.active_shield = !player.modifiers.active_shield;
                } else {
                    player.modifiers.active_double = !player.modifiers.active_double;
                }
            }
            PlayerAction::ToggleSuper => {
                // Super mode is available in both cash and tournament games
                player.modifiers.active_super = !player.modifiers.active_super;
            }
        }

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player.clone()),
        );

        // Emit event for observability
        Ok(vec![Event::PlayerModifierToggled {
            player: public.clone(),
            action,
            active_shield: player.modifiers.active_shield,
            active_double: player.modifiers.active_double,
            active_super: player.modifiers.active_super,
        }])
    }

    pub(in crate::layer) async fn handle_casino_join_tournament(
        &mut self,
        public: &PublicKey,
        tournament_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.casino_player_or_error(public, None).await? {
            Ok(player) => player,
            Err(events) => return Ok(events),
        };

        // Check tournament limit (per-player daily limit).
        // Approximate time from view (3s per block)
        let current_time_sec = self.seed_view.saturating_mul(SECS_PER_VIEW);
        let current_day = current_time_sec / 86400;
        let last_played_day = player.tournament.last_tournament_ts / 86400;

        if current_day > last_played_day {
            player.tournament.tournaments_played_today = 0;
        }

        if player.tournament.last_tournament_ts > 0 {
            let since_last =
                current_time_sec.saturating_sub(player.tournament.last_tournament_ts);
            if since_last < nullspace_types::casino::TOURNAMENT_JOIN_COOLDOWN_SECS {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_TOURNAMENT_LIMIT_REACHED,
                    "Tournament cooldown active, try again later",
                ));
            }
        }

        let base_limit = if player.tournament.daily_limit > 0 {
            player.tournament.daily_limit
        } else {
            nullspace_types::casino::FREEROLL_DAILY_LIMIT_FREE
        };
        let account_age = if player.profile.created_ts == 0 {
            0
        } else {
            current_time_sec.saturating_sub(player.profile.created_ts)
        };
        let daily_limit = if account_age < nullspace_types::casino::ACCOUNT_TIER_NEW_SECS {
            base_limit.min(nullspace_types::casino::FREEROLL_DAILY_LIMIT_TRIAL)
        } else {
            base_limit
        };
        if player.tournament.tournaments_played_today >= daily_limit {
            let message = format!(
                "Daily tournament limit reached ({}/{})",
                player.tournament.tournaments_played_today, daily_limit
            );
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_TOURNAMENT_LIMIT_REACHED,
                &message,
            ));
        }

        // Get or create tournament
        let mut tournament = match self.get(Key::Tournament(tournament_id)).await? {
            Some(Value::Tournament(t)) => t,
            _ => nullspace_types::casino::Tournament {
                id: tournament_id,
                phase: nullspace_types::casino::TournamentPhase::Registration,
                start_block: 0,
                start_time_ms: 0,
                end_time_ms: 0,
                players: Vec::new(),
                prize_pool: 0,
                starting_chips: nullspace_types::casino::STARTING_CHIPS,
                starting_shields: nullspace_types::casino::STARTING_SHIELDS,
                starting_doubles: nullspace_types::casino::STARTING_DOUBLES,
                leaderboard: nullspace_types::casino::CasinoLeaderboard::default(),
            },
        };

        // Check if can join
        if !matches!(
            tournament.phase,
            nullspace_types::casino::TournamentPhase::Registration
        ) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_TOURNAMENT_NOT_REGISTERING,
                "Tournament is not in registration phase",
            ));
        }

        // Add player (check not already joined)
        if !tournament.add_player(public.clone()) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_ALREADY_IN_TOURNAMENT,
                "Already joined this tournament",
            ));
        }

        // Update player tracking
        player.tournament.tournaments_played_today += 1;
        player.tournament.last_tournament_ts = current_time_sec;
        player.tournament.active_tournament = Some(tournament_id);

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(
            Key::Tournament(tournament_id),
            Value::Tournament(tournament),
        );

        Ok(vec![Event::PlayerJoined {
            tournament_id,
            player: public.clone(),
        }])
    }

    pub(in crate::layer) async fn handle_casino_set_tournament_limit(
        &mut self,
        public: &PublicKey,
        player_key: &PublicKey,
        daily_limit: u8,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        if daily_limit == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_BET,
                "Daily tournament limit must be at least 1",
            ));
        }

        let mut player = match self.get(Key::CasinoPlayer(player_key.clone())).await? {
            Some(Value::CasinoPlayer(player)) => player,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
                    "Player not found",
                ))
            }
        };

        player.tournament.daily_limit = daily_limit;
        self.insert(
            Key::CasinoPlayer(player_key.clone()),
            Value::CasinoPlayer(player),
        );

        Ok(Vec::new())
    }

    pub(in crate::layer) async fn handle_casino_start_tournament(
        &mut self,
        public: &PublicKey,
        tournament_id: u64,
        start_time_ms: u64,
        end_time_ms: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        let mut tournament = match self.get(Key::Tournament(tournament_id)).await? {
            Some(Value::Tournament(t)) => {
                // Prevent double-starts which would double-mint the prize pool.
                if matches!(t.phase, nullspace_types::casino::TournamentPhase::Active) {
                    return Ok(casino_error_vec(
                        public,
                        None,
                        nullspace_types::casino::ERROR_INVALID_MOVE,
                        "Tournament already active",
                    ));
                }
                if matches!(t.phase, nullspace_types::casino::TournamentPhase::Complete) {
                    return Ok(casino_error_vec(
                        public,
                        None,
                        nullspace_types::casino::ERROR_INVALID_MOVE,
                        "Tournament already complete",
                    ));
                }
                t
            }
            None => {
                // Create new if doesn't exist (single player start)
                let mut t = nullspace_types::casino::Tournament {
                    id: tournament_id,
                    phase: nullspace_types::casino::TournamentPhase::Active,
                    start_block: self.seed_view,
                    start_time_ms,
                    end_time_ms,
                    players: Vec::new(),
                    prize_pool: 0,
                    starting_chips: nullspace_types::casino::STARTING_CHIPS,
                    starting_shields: nullspace_types::casino::STARTING_SHIELDS,
                    starting_doubles: nullspace_types::casino::STARTING_DOUBLES,
                    leaderboard: nullspace_types::casino::CasinoLeaderboard::default(),
                };
                t.add_player(public.clone());
                t
            }
            Some(_) => {
                return Err(anyhow::anyhow!(
                    "storage corruption: Key::Tournament returned non-Tournament value"
                ));
            }
        };

        // Enforce fixed tournament duration (5 minutes) for freeroll tournaments.
        // Ignore client-provided end time if inconsistent.
        let expected_duration_ms =
            nullspace_types::casino::TOURNAMENT_DURATION_SECS.saturating_mul(1000);
        let end_time_ms = if end_time_ms >= start_time_ms
            && end_time_ms.saturating_sub(start_time_ms) == expected_duration_ms
        {
            end_time_ms
        } else {
            start_time_ms.saturating_add(expected_duration_ms)
        };

        // Calculate Prize Pool (Inflationary)
        let total_supply = nullspace_types::casino::TOTAL_SUPPLY as u128;
        let annual_bps = nullspace_types::casino::ANNUAL_EMISSION_RATE_BPS as u128;
        let tournaments_per_day = nullspace_types::casino::TOURNAMENTS_PER_DAY as u128;
        let reward_pool_cap =
            total_supply * nullspace_types::casino::REWARD_POOL_BPS as u128 / 10000;

        let annual_emission = total_supply * annual_bps / 10000;
        let daily_emission = annual_emission / 365;
        let per_game_emission = daily_emission / tournaments_per_day;

        // Cap emissions to the remaining reward pool (25% of supply over ~5 years)
        let mut house = self.get_or_init_house().await?;
        let remaining_pool = reward_pool_cap.saturating_sub(house.total_issuance as u128);
        let capped_emission = per_game_emission.min(remaining_pool);
        let prize_pool = capped_emission as u64;

        // Track Issuance in House
        house.total_issuance = house
            .total_issuance
            .saturating_add(prize_pool)
            .min(reward_pool_cap as u64);
        self.insert(Key::House, Value::House(house));

        // Update state
        tournament.phase = nullspace_types::casino::TournamentPhase::Active;
        tournament.start_block = self.seed_view;
        tournament.start_time_ms = start_time_ms;
        tournament.end_time_ms = end_time_ms;
        tournament.prize_pool = prize_pool;

        // Reset tournament-only stacks for all players and rebuild the tournament leaderboard
        let mut leaderboard = nullspace_types::casino::CasinoLeaderboard::default();
        for player_pk in &tournament.players {
            if let Some(Value::CasinoPlayer(mut player)) =
                self.get(Key::CasinoPlayer(player_pk.clone())).await?
            {
                player.tournament.chips = tournament.starting_chips;
                player.tournament.shields = tournament.starting_shields;
                player.tournament.doubles = tournament.starting_doubles;
                player.tournament.active_tournament = Some(tournament_id);
                player.clear_active_modifiers();
                player.session.active_session = None;
                player.modifiers.aura_meter = 0;

                self.insert(
                    Key::CasinoPlayer(player_pk.clone()),
                    Value::CasinoPlayer(player.clone()),
                );
                leaderboard.update(
                    player_pk.clone(),
                    player.profile.name.clone(),
                    player.tournament.chips,
                );
            }
        }

        tournament.leaderboard = leaderboard;

        self.insert(
            Key::Tournament(tournament_id),
            Value::Tournament(tournament.clone()),
        );

        tracing::info!(
            tournament_id = tournament_id,
            start_block = self.seed_view,
            start_time_ms = tournament.start_time_ms,
            end_time_ms = tournament.end_time_ms,
            prize_pool = tournament.prize_pool,
            players = tournament.players.len(),
            "tournament started"
        );

        Ok(vec![Event::TournamentStarted {
            id: tournament_id,
            start_block: self.seed_view,
        }])
    }

    pub(in crate::layer) async fn handle_casino_end_tournament(
        &mut self,
        public: &PublicKey,
        tournament_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        let mut tournament =
            if let Some(Value::Tournament(t)) = self.get(Key::Tournament(tournament_id)).await? {
                t
            } else {
                return Ok(vec![]);
            };

        if !matches!(
            tournament.phase,
            nullspace_types::casino::TournamentPhase::Active
        ) {
            return Ok(vec![]);
        }

        let now = self.seed_view.saturating_mul(SECS_PER_VIEW);
        let policy = self.get_or_init_policy().await?;

        // Gather player tournament chips
        let mut rankings: Vec<(PublicKey, u64, u128)> = Vec::new();
        for player_pk in &tournament.players {
            if let Some(Value::CasinoPlayer(p)) =
                self.get(Key::CasinoPlayer(player_pk.clone())).await?
            {
                let proof_weight = proof_of_play_multiplier(&p, now);
                rankings.push((player_pk.clone(), p.tournament.chips, proof_weight));
            }
        }

        // Sort descending
        rankings.sort_by(|a, b| b.1.cmp(&a.1));

        // Determine winners (Top 15% for MTT style)
        let num_players = rankings.len();
        let num_winners = (num_players.saturating_mul(15).saturating_add(99)) / 100;
        let num_winners = num_winners.max(1).min(num_players);

        // Calculate payout weights (1/rank harmonic distribution)
        let mut weights = Vec::with_capacity(num_winners);
        let mut total_weight: u128 = 0;
        for (i, (_, _, proof_weight)) in rankings.iter().take(num_winners).enumerate() {
            let base_weight = PROOF_WEIGHT_SCALE / (i as u128 + 1);
            let w = base_weight
                .saturating_mul(*proof_weight)
                .checked_div(PROOF_WEIGHT_SCALE)
                .unwrap_or(0);
            weights.push(w);
            total_weight = total_weight.saturating_add(w);
        }

        // Distribute Prize Pool
        if total_weight > 0 && tournament.prize_pool > 0 {
            for (i, (pk, _, _)) in rankings.iter().take(num_winners).enumerate() {
                let weight = weights[i];
                let payout = (tournament.prize_pool as u128)
                    .saturating_mul(weight)
                    .checked_div(total_weight)
                    .unwrap_or(0) as u64;

                if payout > 0 {
                    if let Some(Value::CasinoPlayer(mut p)) =
                        self.get(Key::CasinoPlayer(pk.clone())).await?
                    {
                        // Tournament prizes are credited as non-transferable freeroll credits.
                        award_freeroll_credits(&mut p, payout, now, &policy);
                        self.insert(Key::CasinoPlayer(pk.clone()), Value::CasinoPlayer(p));
                    }
                }
            }
        }

        // Clear tournament flags and stacks now that the event is over
        for player_pk in &tournament.players {
            if let Some(Value::CasinoPlayer(mut player)) =
                self.get(Key::CasinoPlayer(player_pk.clone())).await?
            {
                if player.tournament.active_tournament == Some(tournament_id) {
                    player.tournament.active_tournament = None;
                    player.tournament.chips = 0;
                    player.tournament.shields = 0;
                    player.tournament.doubles = 0;
                    player.clear_active_modifiers();
                    player.session.active_session = None;
                    self.insert(
                        Key::CasinoPlayer(player_pk.clone()),
                        Value::CasinoPlayer(player.clone()),
                    );
                }
            }
        }

        tournament.phase = nullspace_types::casino::TournamentPhase::Complete;
        let prize_pool = tournament.prize_pool;
        let rankings_summary: Vec<(PublicKey, u64)> = rankings
            .iter()
            .map(|(pk, chips, _)| (pk.clone(), *chips))
            .collect();
        self.insert(
            Key::Tournament(tournament_id),
            Value::Tournament(tournament),
        );

        tracing::info!(
            tournament_id = tournament_id,
            players = num_players,
            winners = num_winners,
            prize_pool,
            "tournament ended"
        );

        Ok(vec![Event::TournamentEnded {
            id: tournament_id,
            rankings: rankings_summary,
        }])
    }

    pub(in crate::layer) async fn handle_global_table_init(
        &mut self,
        public: &PublicKey,
        config: &nullspace_types::casino::GlobalTableConfig,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        if config.min_bet == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_BET,
                "Minimum bet must be greater than zero",
            ));
        }
        if config.max_bet < config.min_bet {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_BET,
                "Maximum bet must be >= minimum bet",
            ));
        }
        if config.betting_ms == 0
            || config.lock_ms == 0
            || config.payout_ms == 0
            || config.cooldown_ms == 0
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Timing windows must be greater than zero",
            ));
        }

        let game_type = config.game_type;
        self.insert(
            Key::GlobalTableConfig(game_type),
            Value::GlobalTableConfig(config.clone()),
        );

        if self
            .get(Key::GlobalTableRound(game_type))
            .await?
            .is_none()
        {
            let round = default_global_table_round(game_type);
            self.insert(
                Key::GlobalTableRound(game_type),
                Value::GlobalTableRound(round),
            );
        }

        Ok(Vec::new())
    }

    pub(in crate::layer) async fn handle_global_table_open_round(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        if game_type != nullspace_types::casino::GameType::Craps {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table supports craps only",
            ));
        }

        let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
            Some(Value::GlobalTableConfig(config)) => config,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Global table config missing",
                ))
            }
        };

        let now_ms = self.seed_view.saturating_mul(MS_PER_VIEW);
        let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
            Some(Value::GlobalTableRound(round)) => round,
            _ => default_global_table_round(game_type),
        };

        let can_open = round.round_id == 0
            || (matches!(
                round.phase,
                nullspace_types::casino::GlobalTablePhase::Cooldown
            ) && now_ms >= round.phase_ends_at_ms);
        if !can_open {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round already active",
            ));
        }

        round.round_id = round.round_id.saturating_add(1);
        round.phase = nullspace_types::casino::GlobalTablePhase::Betting;
        round.phase_ends_at_ms = now_ms.saturating_add(config.betting_ms);
        round.rng_commit.clear();
        round.roll_seed.clear();

        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round.clone()),
        );

        Ok(vec![Event::GlobalTableRoundOpened { round }])
    }

    pub(in crate::layer) async fn handle_global_table_submit_bets(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
        round_id: u64,
        bets: &[nullspace_types::casino::GlobalTableBet],
    ) -> anyhow::Result<Vec<Event>> {
        let reject = |error_code: u8, message: &str| {
            tracing::warn!(
                player = ?public,
                game_type = ?game_type,
                round_id = round_id,
                error_code = error_code,
                message = message,
                "global table bet rejected"
            );
            Ok(vec![Event::GlobalTableBetRejected {
                player: public.clone(),
                round_id,
                error_code,
                message: message.to_string(),
            }])
        };

        if game_type != nullspace_types::casino::GameType::Craps {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table supports craps only",
            ));
        }

        if bets.is_empty() {
            return reject(nullspace_types::casino::ERROR_INVALID_BET, "No bets provided");
        }

        let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
            Some(Value::GlobalTableConfig(config)) => config,
            _ => {
                return reject(
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Global table config missing",
                )
            }
        };

        let now_ms = self.seed_view.saturating_mul(MS_PER_VIEW);
        let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
            Some(Value::GlobalTableRound(round)) => round,
            _ => return reject(nullspace_types::casino::ERROR_INVALID_MOVE, "Round not initialized"),
        };

        if round.round_id != round_id {
            return reject(nullspace_types::casino::ERROR_INVALID_MOVE, "Round ID mismatch");
        }

        if !matches!(
            round.phase,
            nullspace_types::casino::GlobalTablePhase::Betting
        ) || now_ms >= round.phase_ends_at_ms
        {
            return reject(
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Betting window closed",
            );
        }

        let mut player = match self.casino_player_or_error(public, None).await? {
            Ok(player) => player,
            Err(_) => {
                return reject(
                    nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
                    "Player not found",
                )
            }
        };

        let mut player_session = match self
            .get(Key::GlobalTablePlayerSession(game_type, public.clone()))
            .await?
        {
            Some(Value::GlobalTablePlayerSession(session)) => session,
            _ => {
                let session = nullspace_types::casino::GameSession {
                    id: round.round_id,
                    player: public.clone(),
                    game_type,
                    bet: 0,
                    state_blob: vec![],
                    move_count: 0,
                    created_at: self.seed_view,
                    is_complete: false,
                    super_mode: nullspace_types::casino::SuperModeState::default(),
                    is_tournament: false,
                    tournament_id: None,
                };
                nullspace_types::casino::GlobalTablePlayerSession {
                    game_type,
                    session,
                    last_settled_round: round.round_id.saturating_sub(1),
                }
            }
        };

        if player_session.last_settled_round.saturating_add(1) != round.round_id {
            return reject(
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Previous round not settled",
            );
        }

        if bets.len() > config.max_bets_per_round as usize {
            return reject(
                nullspace_types::casino::ERROR_INVALID_BET,
                "Too many bets submitted",
            );
        }

        ensure_craps_session_state(&mut player_session.session, &round, &self.seed);
        player_session.session.is_complete = false;

        let mut working_session = player_session.session.clone();
        let mut delta: i64 = 0;

        // Calculate total exposure for all bets and check limits
        // Craps max payout is typically 30:1 for proposition bets
        const CRAPS_MAX_PAYOUT_MULTIPLIER: u64 = 30;

        let mut total_bet_amount = 0u64;
        for bet in bets {
            total_bet_amount = total_bet_amount.saturating_add(bet.amount);
        }

        // Check exposure limits before processing any bets
        if let Err((error_code, message)) = self
            .check_exposure_limits(public, total_bet_amount, CRAPS_MAX_PAYOUT_MULTIPLIER)
            .await
        {
            return reject(error_code, &message);
        }

        for bet in bets {
            if bet.amount < config.min_bet || bet.amount > config.max_bet {
                return reject(
                    nullspace_types::casino::ERROR_INVALID_BET,
                    "Bet amount out of range",
                );
            }
            let mut payload = Vec::with_capacity(11);
            payload.push(0);
            payload.push(bet.bet_type);
            payload.push(bet.target);
            payload.extend_from_slice(&bet.amount.to_be_bytes());
            let mut rng = crate::casino::GameRng::from_state(round_roll_seed_or_default(
                &round,
                &self.seed,
            ));
            let result =
                crate::casino::process_game_move(&mut working_session, &payload, &mut rng);
            let result = match result {
                Ok(result) => result,
                Err(_) => {
                    return reject(nullspace_types::casino::ERROR_INVALID_BET, "Invalid bet")
                }
            };
            delta = delta.saturating_add(game_result_delta(&result));
        }

        if delta < 0 {
            let deduction = delta
                .checked_neg()
                .and_then(|v| u64::try_from(v).ok())
                .unwrap_or(0);
            if player.balances.chips < deduction {
                return reject(
                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                    "Insufficient chips",
                );
            }
            player.balances.chips = player.balances.chips.saturating_sub(deduction);
            if deduction > 0 {
                self.update_house_pnl(deduction as i128).await?;
            }
        } else if delta > 0 {
            let addition = u64::try_from(delta).unwrap_or(0);
            player.balances.chips = player.balances.chips.saturating_add(addition);
            if addition > 0 {
                self.update_house_pnl(-(addition as i128)).await?;
            }
        }

        player_session.session = working_session;
        for bet in bets {
            add_table_total(&mut round.totals, bet.bet_type, bet.target, bet.amount);
        }

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player.clone()),
        );
        self.insert(
            Key::GlobalTablePlayerSession(game_type, public.clone()),
            Value::GlobalTablePlayerSession(player_session.clone()),
        );
        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round),
        );

        let mut total_wagered = 0u64;
        for bet in bets {
            total_wagered = total_wagered.saturating_add(bet.amount);
        }
        tracing::info!(
            player = ?public,
            game_type = ?game_type,
            round_id = round_id,
            bets_len = bets.len(),
            total_wagered = total_wagered,
            bets = ?bets,
            "global table bets accepted"
        );

        // Track exposure for accepted bets
        self.add_bet_exposure(public, total_wagered, CRAPS_MAX_PAYOUT_MULTIPLIER)
            .await?;

        let mut events = vec![Event::GlobalTableBetAccepted {
            player: public.clone(),
            round_id,
            bets: bets.to_vec(),
            player_balances: nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player),
        }];
        if let Some(event) = self
            .update_casino_leaderboard(public, &player)
            .await?
        {
            events.push(event);
        }
        Ok(events)
    }

    pub(in crate::layer) async fn handle_global_table_lock(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
        round_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        if game_type != nullspace_types::casino::GameType::Craps {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table supports craps only",
            ));
        }

        let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
            Some(Value::GlobalTableConfig(config)) => config,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Global table config missing",
                ))
            }
        };
        let now_ms = self.seed_view.saturating_mul(MS_PER_VIEW);
        let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
            Some(Value::GlobalTableRound(round)) => round,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Round not initialized",
                ))
            }
        };

        if round.round_id != round_id {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round ID mismatch",
            ));
        }

        if !matches!(
            round.phase,
            nullspace_types::casino::GlobalTablePhase::Betting
        ) || now_ms < round.phase_ends_at_ms
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Betting still open",
            ));
        }

        round.phase = nullspace_types::casino::GlobalTablePhase::Locked;
        round.phase_ends_at_ms = now_ms.saturating_add(config.lock_ms);
        let roll_seed = derive_global_table_roll_seed(&self.seed, round.round_id);
        round.roll_seed = roll_seed.to_vec();
        round.rng_commit = hash_roll_seed(&round.roll_seed);
        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round.clone()),
        );

        Ok(vec![Event::GlobalTableLocked {
            game_type,
            round_id,
            phase_ends_at_ms: round.phase_ends_at_ms,
        }])
    }

    pub(in crate::layer) async fn handle_global_table_reveal(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
        round_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        if game_type != nullspace_types::casino::GameType::Craps {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table supports craps only",
            ));
        }

        let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
            Some(Value::GlobalTableConfig(config)) => config,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Global table config missing",
                ))
            }
        };

        let now_ms = self.seed_view.saturating_mul(MS_PER_VIEW);
        let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
            Some(Value::GlobalTableRound(round)) => round,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Round not initialized",
                ))
            }
        };

        if round.round_id != round_id {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round ID mismatch",
            ));
        }

        if !matches!(
            round.phase,
            nullspace_types::casino::GlobalTablePhase::Locked
        ) || now_ms < round.phase_ends_at_ms
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round not locked",
            ));
        }

        let roll_seed = match roll_seed_from_round(&round) {
            Some(seed) => seed,
            None if round.rng_commit.is_empty() => {
                let seed = derive_global_table_roll_seed(&self.seed, round.round_id);
                round.roll_seed = seed.to_vec();
                round.rng_commit = hash_roll_seed(&round.roll_seed);
                seed
            }
            None => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Round RNG commit missing",
                ));
            }
        };
        let expected_commit = hash_roll_seed(&roll_seed);
        if !round.rng_commit.is_empty() && round.rng_commit != expected_commit {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round RNG commit mismatch",
            ));
        }
        if round.rng_commit.is_empty() {
            round.rng_commit = expected_commit;
        }

        let mut table_session = nullspace_types::casino::GameSession {
            id: round.round_id,
            player: public.clone(),
            game_type,
            bet: 0,
            state_blob: vec![],
            move_count: 0,
            created_at: self.seed_view,
            is_complete: false,
            super_mode: nullspace_types::casino::SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        let mut init_rng = crate::casino::GameRng::from_state(roll_seed);
        let _ = crate::casino::init_game(&mut table_session, &mut init_rng);
        if bet_count_from_blob(&table_session.state_blob) == 0 {
            let amount = 1u64.to_be_bytes();
            let dummy_payload = [
                0u8,
                crate::casino::craps::BetType::Field as u8,
                0u8,
                amount[0],
                amount[1],
                amount[2],
                amount[3],
                amount[4],
                amount[5],
                amount[6],
                amount[7],
            ];
            if crate::casino::process_game_move(
                &mut table_session,
                &dummy_payload,
                &mut init_rng,
            )
            .is_err()
            {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Round roll failed",
                ));
            }
        }
        sync_craps_session_to_table(&mut table_session, &round);

        let mut roll_rng = crate::casino::GameRng::from_state(roll_seed);
        if crate::casino::process_game_move(&mut table_session, &[2], &mut roll_rng).is_err() {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round roll failed",
            ));
        }

        if let Some(state) = read_craps_table_state(&table_session.state_blob) {
            round.main_point = state.main_point;
            round.d1 = state.d1;
            round.d2 = state.d2;
            round.made_points_mask = state.made_points_mask;
            round.epoch_point_established = state.epoch_point_established;
            round.field_paytable = state.field_paytable;
        }
        let roll_total = round.d1.saturating_add(round.d2);
        tracing::info!(
            game_type = ?game_type,
            round_id = round.round_id,
            d1 = round.d1,
            d2 = round.d2,
            total = roll_total,
            main_point = round.main_point,
            epoch_point_established = round.epoch_point_established,
            "global table outcome revealed"
        );

        round.phase = nullspace_types::casino::GlobalTablePhase::Payout;
        round.phase_ends_at_ms = now_ms.saturating_add(config.payout_ms);

        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round.clone()),
        );

        Ok(vec![Event::GlobalTableOutcome { round }])
    }

    pub(in crate::layer) async fn handle_global_table_settle(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
        round_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if game_type != nullspace_types::casino::GameType::Craps {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table supports craps only",
            ));
        }

        let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
            Some(Value::GlobalTableRound(round)) => round,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Round not initialized",
                ))
            }
        };

        if round.round_id != round_id {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round ID mismatch",
            ));
        }

        if !matches!(
            round.phase,
            nullspace_types::casino::GlobalTablePhase::Payout
                | nullspace_types::casino::GlobalTablePhase::Cooldown
        ) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round outcome not revealed",
            ));
        }

        if round.roll_seed.len() != 32 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round outcome not revealed",
            ));
        }

        let mut player = match self.casino_player_or_error(public, None).await? {
            Ok(player) => player,
            Err(events) => return Ok(events),
        };

        let mut player_session = match self
            .get(Key::GlobalTablePlayerSession(game_type, public.clone()))
            .await?
        {
            Some(Value::GlobalTablePlayerSession(session)) => session,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Player not registered for global table",
                ))
            }
        };

        if player_session.last_settled_round.saturating_add(1) != round.round_id {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round already settled or out of order",
            ));
        }

        ensure_craps_session_state(&mut player_session.session, &round, &self.seed);
        player_session.session.is_complete = false;

        let bet_count = bet_count_from_blob(&player_session.session.state_blob);
        let before_bets = extract_craps_bets(&player_session.session.state_blob);

        let payout_delta = if bet_count == 0 {
            sync_craps_session_to_table(&mut player_session.session, &round);
            0
        } else {
            let roll_seed = roll_seed_from_round(&round).unwrap_or([0u8; 32]);
            let mut roll_rng = crate::casino::GameRng::from_state(roll_seed);
            let result = crate::casino::process_game_move(
                &mut player_session.session,
                &[2],
                &mut roll_rng,
            )
            .map_err(|_| anyhow::anyhow!("settle failed"))?;

            let mut delta = game_result_delta(&result);
            match result {
                crate::casino::GameResult::ContinueWithUpdate { .. } => {
                    if delta > 0 {
                        let addition = u64::try_from(delta).unwrap_or(0);
                        player.balances.chips = player.balances.chips.saturating_add(addition);
                        if addition > 0 {
                            self.update_house_pnl(-(addition as i128)).await?;
                        }
                    } else if delta < 0 {
                        let deduction = delta
                            .checked_neg()
                            .and_then(|v| u64::try_from(v).ok())
                            .unwrap_or(0);
                        if player.balances.chips < deduction {
                            return Ok(casino_error_vec(
                                public,
                                None,
                                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                "Insufficient chips for settlement",
                            ));
                        }
                        player.balances.chips = player.balances.chips.saturating_sub(deduction);
                        if deduction > 0 {
                            self.update_house_pnl(deduction as i128).await?;
                        }
                    }
                }
                crate::casino::GameResult::Win(base_payout, _) => {
                    let mut payout = base_payout as i64;
                    let was_doubled = player.modifiers.active_double
                        && player.modifiers.doubles > 0;
                    if was_doubled {
                        payout = payout.saturating_mul(2);
                        player.modifiers.doubles = player.modifiers.doubles.saturating_sub(1);
                    }
                    let addition = u64::try_from(payout).unwrap_or(0);
                    player.balances.chips = player.balances.chips.saturating_add(addition);
                    if addition > 0 {
                        self.update_house_pnl(-(addition as i128)).await?;
                    }
                    player.clear_active_modifiers();
                    delta = payout;
                }
                crate::casino::GameResult::Push(refund, _) => {
                    player.balances.chips = player.balances.chips.saturating_add(refund);
                    if refund > 0 {
                        self.update_house_pnl(-(refund as i128)).await?;
                    }
                    player.clear_active_modifiers();
                    delta = refund as i64;
                }
                crate::casino::GameResult::LossPreDeducted(total_loss, _) => {
                    let shields_pool = &mut player.modifiers.shields;
                    if player.modifiers.active_shield && *shields_pool > 0 && total_loss > 0 {
                        *shields_pool = shields_pool.saturating_sub(1);
                        player.balances.chips =
                            player.balances.chips.saturating_add(total_loss);
                        self.update_house_pnl(-(total_loss as i128)).await?;
                        delta = 0;
                    } else {
                        delta = 0;
                    }
                    player.clear_active_modifiers();
                }
                crate::casino::GameResult::LossWithExtraDeduction(extra, _) => {
                    if extra > 0 {
                        if player.balances.chips < extra {
                            return Ok(casino_error_vec(
                                public,
                                None,
                                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                                "Insufficient chips for settlement",
                            ));
                        }
                        player.balances.chips = player.balances.chips.saturating_sub(extra);
                        self.update_house_pnl(extra as i128).await?;
                    }
                    player.clear_active_modifiers();
                    delta = -(extra as i64);
                }
                crate::casino::GameResult::Continue(_) | crate::casino::GameResult::Loss(_) => {
                    delta = 0;
                }
            }

            if player_session.session.is_complete {
                player_session.session.is_complete = false;
                let now = self.seed_view.saturating_mul(SECS_PER_VIEW);
                record_play_session(&mut player, &player_session.session, now);
            }

            delta
        };

        player_session.last_settled_round = round.round_id;

        let after_bets = extract_craps_bets(&player_session.session.state_blob);
        apply_bet_totals_delta(&mut round.totals, &before_bets, &after_bets);

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player.clone()),
        );
        self.insert(
            Key::GlobalTablePlayerSession(game_type, public.clone()),
            Value::GlobalTablePlayerSession(player_session.clone()),
        );
        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round),
        );

        // Release exposure for settled bets
        const CRAPS_MAX_PAYOUT_MULTIPLIER: u64 = 30;
        let total_wagered: u64 = before_bets.iter().map(|b| b.amount).sum();
        let payout_amount = if payout_delta > 0 {
            payout_delta as u64
        } else {
            0
        };
        self.release_bet_exposure(
            public,
            total_wagered.saturating_mul(CRAPS_MAX_PAYOUT_MULTIPLIER),
            payout_amount,
        )
        .await?;

        let mut events = vec![Event::GlobalTablePlayerSettled {
            player: public.clone(),
            round_id,
            payout: payout_delta,
            player_balances: nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player),
            my_bets: after_bets,
        }];
        if let Some(event) = self
            .update_casino_leaderboard(public, &player)
            .await?
        {
            events.push(event);
        }
        Ok(events)
    }

    pub(in crate::layer) async fn handle_global_table_finalize(
        &mut self,
        public: &PublicKey,
        game_type: nullspace_types::casino::GameType,
        round_id: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if !super::is_admin_public_key(public) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_UNAUTHORIZED,
                "Unauthorized admin instruction",
            ));
        }
        if game_type != nullspace_types::casino::GameType::Craps {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table supports craps only",
            ));
        }

        let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
            Some(Value::GlobalTableConfig(config)) => config,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Global table config missing",
                ))
            }
        };

        let now_ms = self.seed_view.saturating_mul(MS_PER_VIEW);
        let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
            Some(Value::GlobalTableRound(round)) => round,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Round not initialized",
                ))
            }
        };

        if round.round_id != round_id {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round ID mismatch",
            ));
        }

        if !matches!(
            round.phase,
            nullspace_types::casino::GlobalTablePhase::Payout
        ) || now_ms < round.phase_ends_at_ms
        {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round not ready for finalize",
            ));
        }

        round.phase = nullspace_types::casino::GlobalTablePhase::Cooldown;
        round.phase_ends_at_ms = now_ms.saturating_add(config.cooldown_ms);
        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round.clone()),
        );

        Ok(vec![Event::GlobalTableFinalized { game_type, round_id }])
    }

    async fn update_casino_leaderboard(
        &mut self,
        public: &PublicKey,
        player: &nullspace_types::casino::Player,
    ) -> anyhow::Result<Option<Event>> {
        let mut leaderboard = match self.get(Key::CasinoLeaderboard).await? {
            Some(Value::CasinoLeaderboard(lb)) => lb,
            _ => nullspace_types::casino::CasinoLeaderboard::default(),
        };
        let previous = leaderboard.clone();
        leaderboard.update(
            public.clone(),
            player.profile.name.clone(),
            player.balances.chips,
        );
        if leaderboard == previous {
            return Ok(None);
        }
        self.insert(
            Key::CasinoLeaderboard,
            Value::CasinoLeaderboard(leaderboard.clone()),
        );
        Ok(Some(Event::CasinoLeaderboardUpdated { leaderboard }))
    }

    async fn update_tournament_leaderboard(
        &mut self,
        tournament_id: u64,
        public: &PublicKey,
        player: &nullspace_types::casino::Player,
    ) -> anyhow::Result<()> {
        if let Some(Value::Tournament(mut t)) = self.get(Key::Tournament(tournament_id)).await? {
            t.leaderboard.update(
                public.clone(),
                player.profile.name.clone(),
                player.tournament.chips,
            );
            self.insert(Key::Tournament(tournament_id), Value::Tournament(t));
        }
        Ok(())
    }

    async fn update_leaderboard_for_session(
        &mut self,
        session: &nullspace_types::casino::GameSession,
        public: &PublicKey,
        player: &nullspace_types::casino::Player,
    ) -> anyhow::Result<Option<Event>> {
        if session.is_tournament {
            if let Some(tid) = session.tournament_id {
                self.update_tournament_leaderboard(tid, public, player)
                    .await?;
            }
            Ok(None)
        } else {
            self.update_casino_leaderboard(public, player).await
        }
    }

    async fn apply_progressive_meters_for_completion(
        &mut self,
        session: &nullspace_types::casino::GameSession,
        result: crate::casino::GameResult,
    ) -> anyhow::Result<crate::casino::GameResult> {
        if session.is_tournament || !session.is_complete {
            return Ok(result);
        }

        match session.game_type {
            nullspace_types::casino::GameType::ThreeCard => {
                self.apply_three_card_progressive_meter(session, result)
                    .await
            }
            nullspace_types::casino::GameType::UltimateHoldem => {
                self.apply_uth_progressive_meter(session, result).await
            }
            _ => Ok(result),
        }
    }

    async fn apply_three_card_progressive_meter(
        &mut self,
        session: &nullspace_types::casino::GameSession,
        result: crate::casino::GameResult,
    ) -> anyhow::Result<crate::casino::GameResult> {
        let Some((progressive_bet, player_cards)) =
            parse_three_card_progressive_state(&session.state_blob)
        else {
            return Ok(result);
        };
        if progressive_bet == 0 {
            return Ok(result);
        }

        let mut house = self.get_or_init_house().await?;
        let base = nullspace_types::casino::THREE_CARD_PROGRESSIVE_BASE_JACKPOT;

        let mut jackpot = house.three_card_progressive_jackpot.max(base);
        jackpot = jackpot.saturating_add(progressive_bet);

        let can_adjust = matches!(result, crate::casino::GameResult::Win(..));
        let is_jackpot = can_adjust && is_three_card_mini_royal_spades(&player_cards);
        let delta = if is_jackpot {
            progressive_bet.saturating_mul(jackpot.saturating_sub(base))
        } else {
            0
        };

        house.three_card_progressive_jackpot = if is_jackpot { base } else { jackpot };
        self.insert(Key::House, Value::House(house));

        Ok(match result {
            crate::casino::GameResult::Win(payout, logs) if delta > 0 => {
                crate::casino::GameResult::Win(payout.saturating_add(delta), logs)
            }
            other => other,
        })
    }

    async fn apply_uth_progressive_meter(
        &mut self,
        session: &nullspace_types::casino::GameSession,
        result: crate::casino::GameResult,
    ) -> anyhow::Result<crate::casino::GameResult> {
        let Some((progressive_bet, hole, flop)) = parse_uth_progressive_state(&session.state_blob)
        else {
            return Ok(result);
        };
        if progressive_bet == 0 {
            return Ok(result);
        }

        let mut house = self.get_or_init_house().await?;
        let base = nullspace_types::casino::UTH_PROGRESSIVE_BASE_JACKPOT;

        let mut jackpot = house.uth_progressive_jackpot.max(base);
        jackpot = jackpot.saturating_add(progressive_bet);

        let can_adjust = matches!(result, crate::casino::GameResult::Win(..));
        let tier = if can_adjust {
            uth_progressive_jackpot_tier(&hole, &flop)
        } else {
            UthJackpotTier::None
        };
        let delta = match tier {
            UthJackpotTier::RoyalFlush => {
                progressive_bet.saturating_mul(jackpot.saturating_sub(base))
            }
            UthJackpotTier::StraightFlush => {
                let desired = jackpot / 10;
                let current = base / 10;
                progressive_bet.saturating_mul(desired.saturating_sub(current))
            }
            UthJackpotTier::None => 0,
        };

        house.uth_progressive_jackpot = if matches!(tier, UthJackpotTier::RoyalFlush) {
            base
        } else {
            jackpot
        };
        self.insert(Key::House, Value::House(house));

        Ok(match result {
            crate::casino::GameResult::Win(payout, logs) if delta > 0 => {
                crate::casino::GameResult::Win(payout.saturating_add(delta), logs)
            }
            other => other,
        })
    }

    async fn update_house_pnl(&mut self, amount: i128) -> anyhow::Result<()> {
        let mut house = self.get_or_init_house().await?;
        house.net_pnl += amount;
        self.insert(Key::House, Value::House(house));
        Ok(())
    }

    /// Check if a bet can be accepted based on exposure limits.
    /// Returns Ok(()) if allowed, or an error code and message if rejected.
    pub(in crate::layer) async fn check_exposure_limits(
        &mut self,
        public: &PublicKey,
        bet_amount: u64,
        max_payout_multiplier: u64,
    ) -> Result<(), (u8, String)> {
        let bankroll = self.get_or_init_house_bankroll().await.map_err(|e| {
            (
                nullspace_types::casino::ERROR_INVALID_STATE,
                format!("Failed to load house bankroll: {}", e),
            )
        })?;
        let player_exposure = self.get_or_init_player_exposure(public).await.map_err(|e| {
            (
                nullspace_types::casino::ERROR_INVALID_STATE,
                format!("Failed to load player exposure: {}", e),
            )
        })?;

        bankroll
            .check_bet_exposure(bet_amount, max_payout_multiplier, player_exposure.current_exposure)
            .map_err(|e| match e {
                nullspace_types::casino::ExposureLimitError::SingleBetExceeded {
                    bet_amount,
                    max_allowed,
                } => (
                    nullspace_types::casino::ERROR_INVALID_BET,
                    format!(
                        "Bet amount {} exceeds max allowed {}",
                        bet_amount, max_allowed
                    ),
                ),
                nullspace_types::casino::ExposureLimitError::PlayerExposureExceeded {
                    current_exposure,
                    new_exposure,
                    max_allowed,
                } => (
                    nullspace_types::casino::ERROR_INVALID_BET,
                    format!(
                        "Player exposure {} would exceed max {} (current: {})",
                        new_exposure, max_allowed, current_exposure
                    ),
                ),
                nullspace_types::casino::ExposureLimitError::HouseExposureExceeded {
                    current_exposure,
                    new_exposure,
                    max_allowed,
                } => (
                    nullspace_types::casino::ERROR_INVALID_BET,
                    format!(
                        "House exposure {} would exceed capacity {} (current: {})",
                        new_exposure, max_allowed, current_exposure
                    ),
                ),
            })
    }

    /// Add exposure for a bet that has been accepted.
    pub(in crate::layer) async fn add_bet_exposure(
        &mut self,
        public: &PublicKey,
        bet_amount: u64,
        max_payout_multiplier: u64,
    ) -> anyhow::Result<()> {
        let mut bankroll = self.get_or_init_house_bankroll().await?;
        bankroll.add_exposure(bet_amount, max_payout_multiplier);
        bankroll.last_updated_ts = self.seed_view;
        self.insert(Key::HouseBankroll, Value::HouseBankroll(bankroll));

        let mut player_exposure = self.get_or_init_player_exposure(public).await?;
        let bet_exposure = bet_amount.saturating_mul(max_payout_multiplier);
        player_exposure.current_exposure = player_exposure.current_exposure.saturating_add(bet_exposure);
        player_exposure.pending_bet_count = player_exposure.pending_bet_count.saturating_add(1);
        player_exposure.last_bet_ts = self.seed_view;
        self.insert(
            Key::PlayerExposure(public.clone()),
            Value::PlayerExposure(player_exposure),
        );

        Ok(())
    }

    /// Release exposure after bet settlement.
    pub(in crate::layer) async fn release_bet_exposure(
        &mut self,
        public: &PublicKey,
        exposure_amount: u64,
        payout_amount: u64,
    ) -> anyhow::Result<()> {
        let mut bankroll = self.get_or_init_house_bankroll().await?;
        bankroll.release_exposure(exposure_amount);
        if payout_amount > 0 {
            bankroll.record_payout(payout_amount);
        }
        bankroll.last_updated_ts = self.seed_view;
        self.insert(Key::HouseBankroll, Value::HouseBankroll(bankroll));

        let mut player_exposure = self.get_or_init_player_exposure(public).await?;
        player_exposure.current_exposure = player_exposure.current_exposure.saturating_sub(exposure_amount);
        player_exposure.pending_bet_count = player_exposure.pending_bet_count.saturating_sub(1);
        self.insert(
            Key::PlayerExposure(public.clone()),
            Value::PlayerExposure(player_exposure),
        );

        Ok(())
    }
}

struct CrapsTableState {
    main_point: u8,
    d1: u8,
    d2: u8,
    made_points_mask: u8,
    epoch_point_established: bool,
    field_paytable: u8,
}

fn default_global_table_round(
    game_type: nullspace_types::casino::GameType,
) -> nullspace_types::casino::GlobalTableRound {
    nullspace_types::casino::GlobalTableRound {
        game_type,
        round_id: 0,
        phase: nullspace_types::casino::GlobalTablePhase::Cooldown,
        phase_ends_at_ms: 0,
        main_point: 0,
        d1: 0,
        d2: 0,
        made_points_mask: 0,
        epoch_point_established: false,
        field_paytable: 0,
        rng_commit: Vec::new(),
        roll_seed: Vec::new(),
        totals: Vec::new(),
    }
}

fn derive_global_table_roll_seed(seed: &nullspace_types::Seed, round_id: u64) -> [u8; 32] {
    crate::casino::GameRng::new(seed, round_id, 0).state()
}

fn roll_seed_from_round(round: &nullspace_types::casino::GlobalTableRound) -> Option<[u8; 32]> {
    round.roll_seed.as_slice().try_into().ok()
}

fn round_roll_seed_or_default(
    round: &nullspace_types::casino::GlobalTableRound,
    seed: &nullspace_types::Seed,
) -> [u8; 32] {
    roll_seed_from_round(round)
        .unwrap_or_else(|| derive_global_table_roll_seed(seed, round.round_id))
}

fn hash_roll_seed(roll_seed: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(roll_seed);
    hasher.finalize().0.to_vec()
}

fn ensure_craps_session_state(
    session: &mut nullspace_types::casino::GameSession,
    round: &nullspace_types::casino::GlobalTableRound,
    seed: &nullspace_types::Seed,
) {
    if session.state_blob.is_empty() {
        let mut rng = crate::casino::GameRng::from_state(round_roll_seed_or_default(round, seed));
        let _ = crate::casino::init_game(session, &mut rng);
    }
    sync_craps_session_to_table(session, round);
}

fn sync_craps_session_to_table(
    session: &mut nullspace_types::casino::GameSession,
    round: &nullspace_types::casino::GlobalTableRound,
) {
    if session.state_blob.len() < 8 {
        return;
    }
    session.state_blob[1] = if round.main_point == 0 { 0 } else { 1 };
    session.state_blob[2] = round.main_point;
    session.state_blob[3] = round.d1;
    session.state_blob[4] = round.d2;
    session.state_blob[5] = round.made_points_mask;
    session.state_blob[6] = if round.epoch_point_established { 1 } else { 0 };

    let bet_count = session.state_blob[7] as usize;
    let rules_offset = 8usize.saturating_add(bet_count.saturating_mul(19));
    if session.state_blob.len() > rules_offset {
        session.state_blob[rules_offset] = round.field_paytable;
    }
}

fn bet_count_from_blob(blob: &[u8]) -> usize {
    if blob.len() < 8 {
        return 0;
    }
    blob[7] as usize
}

fn read_craps_table_state(blob: &[u8]) -> Option<CrapsTableState> {
    if blob.len() < 8 || blob[0] != 2 {
        return None;
    }
    let bet_count = blob[7] as usize;
    let rules_offset = 8usize.saturating_add(bet_count.saturating_mul(19));
    let field_paytable = if blob.len() > rules_offset {
        blob[rules_offset]
    } else {
        0
    };
    Some(CrapsTableState {
        main_point: blob[2],
        d1: blob[3],
        d2: blob[4],
        made_points_mask: blob[5],
        epoch_point_established: blob[6] != 0,
        field_paytable,
    })
}

fn extract_craps_bets(
    blob: &[u8],
) -> Vec<nullspace_types::casino::GlobalTableBet> {
    if blob.len() < 8 || blob[0] != 2 {
        return Vec::new();
    }
    let bet_count = blob[7] as usize;
    let mut bets = Vec::with_capacity(bet_count);
    let mut offset = 8usize;
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
        if amount > 0 {
            bets.push(nullspace_types::casino::GlobalTableBet {
                bet_type,
                target,
                amount,
            });
        }
        offset = offset.saturating_add(19);
    }
    bets
}

fn add_table_total(
    totals: &mut Vec<nullspace_types::casino::GlobalTableTotal>,
    bet_type: u8,
    target: u8,
    amount: u64,
) {
    if amount == 0 {
        return;
    }
    if let Some(existing) = totals
        .iter_mut()
        .find(|entry| entry.bet_type == bet_type && entry.target == target)
    {
        existing.amount = existing.amount.saturating_add(amount);
        return;
    }
    if totals.len() >= 64 {
        return;
    }
    totals.push(nullspace_types::casino::GlobalTableTotal {
        bet_type,
        target,
        amount,
    });
}

fn subtract_table_total(
    totals: &mut Vec<nullspace_types::casino::GlobalTableTotal>,
    bet_type: u8,
    target: u8,
    amount: u64,
) {
    if amount == 0 {
        return;
    }
    if let Some(idx) = totals
        .iter()
        .position(|entry| entry.bet_type == bet_type && entry.target == target)
    {
        let entry = &mut totals[idx];
        entry.amount = entry.amount.saturating_sub(amount);
        if entry.amount == 0 {
            totals.remove(idx);
        }
    }
}

fn apply_bet_totals_delta(
    totals: &mut Vec<nullspace_types::casino::GlobalTableTotal>,
    before: &[nullspace_types::casino::GlobalTableBet],
    after: &[nullspace_types::casino::GlobalTableBet],
) {
    let mut before_map: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    let mut after_map: BTreeMap<(u8, u8), u64> = BTreeMap::new();
    for bet in before {
        let entry = before_map.entry((bet.bet_type, bet.target)).or_insert(0);
        *entry = entry.saturating_add(bet.amount);
    }
    for bet in after {
        let entry = after_map.entry((bet.bet_type, bet.target)).or_insert(0);
        *entry = entry.saturating_add(bet.amount);
    }

    let mut keys = BTreeSet::new();
    keys.extend(before_map.keys().copied());
    keys.extend(after_map.keys().copied());
    for key in keys {
        let before_amt = before_map.get(&key).copied().unwrap_or(0);
        let after_amt = after_map.get(&key).copied().unwrap_or(0);
        if after_amt > before_amt {
            add_table_total(
                totals,
                key.0,
                key.1,
                after_amt.saturating_sub(before_amt),
            );
        } else if before_amt > after_amt {
            subtract_table_total(
                totals,
                key.0,
                key.1,
                before_amt.saturating_sub(after_amt),
            );
        }
    }
}

fn game_result_delta(result: &crate::casino::GameResult) -> i64 {
    match result {
        crate::casino::GameResult::Continue(_) => 0,
        crate::casino::GameResult::ContinueWithUpdate { payout, .. } => *payout,
        crate::casino::GameResult::Win(amount, _) => *amount as i64,
        crate::casino::GameResult::Push(amount, _) => *amount as i64,
        crate::casino::GameResult::LossWithExtraDeduction(extra, _) => -(*extra as i64),
        crate::casino::GameResult::Loss(_) => 0,
        crate::casino::GameResult::LossPreDeducted(_, _) => 0,
    }
}

fn log_game_completion(
    public: &PublicKey,
    session: &nullspace_types::casino::GameSession,
    result: &crate::casino::GameResult,
) {
    let (outcome, payout, loss, logs) = match result {
        crate::casino::GameResult::Win(amount, logs) => ("win", Some(*amount), None, Some(logs)),
        crate::casino::GameResult::Push(amount, logs) => ("push", Some(*amount), None, Some(logs)),
        crate::casino::GameResult::Loss(logs) => ("loss", None, None, Some(logs)),
        crate::casino::GameResult::LossWithExtraDeduction(amount, logs) => {
            ("loss_extra", None, Some(*amount), Some(logs))
        }
        crate::casino::GameResult::LossPreDeducted(amount, logs) => {
            ("loss_prededucted", None, Some(*amount), Some(logs))
        }
        _ => return,
    };
    let logs_len = logs.map(|value| value.len()).unwrap_or(0);
    tracing::info!(
        player = ?public,
        session_id = session.id,
        game_type = ?session.game_type,
        outcome,
        payout,
        loss,
        logs_len,
        logs = ?logs,
        "casino game completed"
    );
}
