use super::super::*;
use super::casino_error_vec;

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
    let created_at_secs = session.created_at.saturating_mul(3);
    let duration_secs = now.saturating_sub(created_at_secs).max(1);
    player.session.sessions_played = player.session.sessions_played.saturating_add(1);
    player.session.play_seconds = player.session.play_seconds.saturating_add(duration_secs);
    player.session.last_session_ts = now;
}

fn proof_of_play_multiplier(
    player: &nullspace_types::casino::Player,
    now: u64,
) -> f64 {
    let min_sessions = nullspace_types::casino::PROOF_OF_PLAY_MIN_SESSIONS as f64;
    let min_seconds = nullspace_types::casino::PROOF_OF_PLAY_MIN_SECONDS as f64;
    let session_weight = if min_sessions <= 0.0 {
        1.0
    } else {
        (player.session.sessions_played as f64 / min_sessions).min(1.0)
    };
    let seconds_weight = if min_seconds <= 0.0 {
        1.0
    } else {
        (player.session.play_seconds as f64 / min_seconds).min(1.0)
    };
    let activity_weight = (session_weight + seconds_weight) / 2.0;
    let age_secs = now.saturating_sub(player.profile.created_ts) as f64;
    let age_weight = if nullspace_types::casino::ACCOUNT_TIER_NEW_SECS == 0 {
        1.0
    } else {
        (age_secs / nullspace_types::casino::ACCOUNT_TIER_NEW_SECS as f64).min(1.0)
    };
    let weight = 0.2 + 0.8 * (activity_weight * age_weight);
    weight.clamp(0.05, 1.0)
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
        match self.get(&Key::CasinoPlayer(public.clone())).await? {
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
        let session = match self.get(&Key::CasinoSession(session_id)).await? {
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
            .get(&Key::CasinoPlayer(public.clone()))
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
        let current_time_sec = self.seed.view.saturating_mul(3);
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
        let current_block = self.seed.view;
        let current_time_sec = current_block.saturating_mul(3);
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
        let last_deposit_day = player.session.last_deposit_block.saturating_mul(3) / 86_400;
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
            if let Some(Value::Tournament(t)) = self.get(&Key::Tournament(active_tid)).await? {
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
        if self.get(&Key::CasinoSession(session_id)).await?.is_some() {
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
            created_at: self.seed.view,
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
            let now = self.seed.view.saturating_mul(3);
            if let Some(Value::CasinoPlayer(mut player)) =
                self.get(&Key::CasinoPlayer(public.clone())).await?
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
        let now = self.seed.view.saturating_mul(3);
        let payload_len = payload.len();
        let payload_action = payload.first().copied();

        // Process move
        session.move_count += 1;
        let mut rng = crate::casino::GameRng::new(&self.seed, session_id, session.move_count);

        let result = match crate::casino::process_game_move(&mut session, payload, &mut rng) {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(
                    player = ?public,
                    session_id = session_id,
                    game_type = ?session.game_type,
                    payload_len = payload_len,
                    payload_action = payload_action,
                    ?err,
                    "casino move rejected"
                );
                return Ok(casino_error_vec(
                    public,
                    Some(session_id),
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Invalid game move",
                ));
            }
        };
        tracing::debug!(
            player = ?public,
            session_id = session_id,
            game_type = ?session.game_type,
            move_count = session.move_count,
            "casino move processed"
        );

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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                    self.get(&Key::CasinoPlayer(public.clone())).await?
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
                self.get(&Key::CasinoPlayer(public.clone())).await?
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
                        match self.get(&Key::Tournament(tid)).await? {
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
        let current_time_sec = self.seed.view * 3;
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
        let mut tournament = match self.get(&Key::Tournament(tournament_id)).await? {
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

        let mut player = match self.get(&Key::CasinoPlayer(player_key.clone())).await? {
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
        let mut tournament = match self.get(&Key::Tournament(tournament_id)).await? {
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
                    start_block: self.seed.view,
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
        tournament.start_block = self.seed.view;
        tournament.start_time_ms = start_time_ms;
        tournament.end_time_ms = end_time_ms;
        tournament.prize_pool = prize_pool;

        // Reset tournament-only stacks for all players and rebuild the tournament leaderboard
        let mut leaderboard = nullspace_types::casino::CasinoLeaderboard::default();
        for player_pk in &tournament.players {
            if let Some(Value::CasinoPlayer(mut player)) =
                self.get(&Key::CasinoPlayer(player_pk.clone())).await?
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
            start_block = self.seed.view,
            start_time_ms = tournament.start_time_ms,
            end_time_ms = tournament.end_time_ms,
            prize_pool = tournament.prize_pool,
            players = tournament.players.len(),
            "tournament started"
        );

        Ok(vec![Event::TournamentStarted {
            id: tournament_id,
            start_block: self.seed.view,
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
            if let Some(Value::Tournament(t)) = self.get(&Key::Tournament(tournament_id)).await? {
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

        let now = self.seed.view.saturating_mul(3);
        let policy = self.get_or_init_policy().await?;

        // Gather player tournament chips
        let mut rankings: Vec<(PublicKey, u64, f64)> = Vec::new();
        for player_pk in &tournament.players {
            if let Some(Value::CasinoPlayer(p)) =
                self.get(&Key::CasinoPlayer(player_pk.clone())).await?
            {
                let proof_weight = proof_of_play_multiplier(&p, now);
                rankings.push((player_pk.clone(), p.tournament.chips, proof_weight));
            }
        }

        // Sort descending
        rankings.sort_by(|a, b| b.1.cmp(&a.1));

        // Determine winners (Top 15% for MTT style)
        let num_players = rankings.len();
        let num_winners = (num_players as f64 * 0.15).ceil() as usize;
        let num_winners = num_winners.max(1).min(num_players);

        // Calculate payout weights (1/rank harmonic distribution)
        let mut weights = Vec::with_capacity(num_winners);
        let mut total_weight = 0.0;
        for i in 0..num_winners {
            let base_weight = 1.0 / ((i + 1) as f64);
            let proof_weight = rankings[i].2;
            let w = base_weight * proof_weight;
            weights.push(w);
            total_weight += w;
        }

        // Distribute Prize Pool
        if total_weight > 0.0 && tournament.prize_pool > 0 {
            for i in 0..num_winners {
                let (pk, _, _) = &rankings[i];
                let weight = weights[i];
                let share = weight / total_weight;
                let payout = (share * tournament.prize_pool as f64) as u64;

                if payout > 0 {
                    if let Some(Value::CasinoPlayer(mut p)) =
                        self.get(&Key::CasinoPlayer(pk.clone())).await?
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
                self.get(&Key::CasinoPlayer(player_pk.clone())).await?
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

    async fn update_casino_leaderboard(
        &mut self,
        public: &PublicKey,
        player: &nullspace_types::casino::Player,
    ) -> anyhow::Result<Option<Event>> {
        let mut leaderboard = match self.get(&Key::CasinoLeaderboard).await? {
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
        if let Some(Value::Tournament(mut t)) = self.get(&Key::Tournament(tournament_id)).await? {
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
}

fn log_game_completion(
    public: &PublicKey,
    session: &nullspace_types::casino::GameSession,
    result: &crate::casino::GameResult,
) {
    let (outcome, payout, loss) = match result {
        crate::casino::GameResult::Win(amount, _) => ("win", Some(*amount), None),
        crate::casino::GameResult::Push(amount, _) => ("push", Some(*amount), None),
        crate::casino::GameResult::Loss(_) => ("loss", None, None),
        crate::casino::GameResult::LossWithExtraDeduction(amount, _) => {
            ("loss_extra", None, Some(*amount))
        }
        crate::casino::GameResult::LossPreDeducted(amount, _) => {
            ("loss_prededucted", None, Some(*amount))
        }
        _ => return,
    };
    tracing::info!(
        player = ?public,
        session_id = session.id,
        game_type = ?session.game_type,
        outcome,
        payout,
        loss,
        "casino game completed"
    );
}
