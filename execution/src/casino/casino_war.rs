//! Casino War game implementation.
//!
//! State blob format:
//! [version:u8=1] [stage:u8] [playerCard:u8] [dealerCard:u8] [tie_bet:u64 BE]
//!
//! Stage: 0 = Betting (pre-deal), 1 = War (after tie), 2 = Complete
//!
//! Payload format:
//! [0] = Play (in Betting: deal + compare)
//! [1] = War (after tie, go to war)
//! [2] = Surrender (after tie, forfeit half bet)
//! [3, tie_bet:u64 BE] = Set tie bet (Betting stage only)

use super::super_mode::apply_super_multiplier_cards;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

const STATE_VERSION: u8 = 1;
const HIDDEN_CARD: u8 = 0xFF;
const TIE_BET_PAYOUT_TO_1: u64 = 10;
const TIE_AFTER_TIE_BONUS_MULTIPLIER: u64 = 1;
/// WoO: Casino War is played with six decks.
const CASINO_WAR_DECKS: u8 = 6;

/// Casino War stages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Stage {
    Betting = 0,
    War = 1,
    Complete = 2,
}

impl TryFrom<u8> for Stage {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Stage::Betting),
            1 => Ok(Stage::War),
            2 => Ok(Stage::Complete),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Player moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Move {
    Play = 0,      // Initial play or continue
    War = 1,       // Go to war (on tie)
    Surrender = 2, // Surrender on tie
    SetTieBet = 3, // Set optional tie bet (betting stage only)
}

impl TryFrom<u8> for Move {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Move::Play),
            1 => Ok(Move::War),
            2 => Ok(Move::Surrender),
            3 => Ok(Move::SetTieBet),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct CasinoWarState {
    player_card: u8,
    dealer_card: u8,
    stage: Stage,
    tie_bet: u64,
}

fn parse_state(state: &[u8]) -> Option<CasinoWarState> {
    if state.len() < 12 || state[0] != STATE_VERSION {
        return None;
    }
    let stage = Stage::try_from(state[1]).ok()?;
    let player_card = state[2];
    let dealer_card = state[3];
    let tie_bet = u64::from_be_bytes(state[4..12].try_into().ok()?);
    Some(CasinoWarState {
        player_card,
        dealer_card,
        stage,
        tie_bet,
    })
}

fn serialize_state(state: &CasinoWarState) -> Vec<u8> {
    let mut out = Vec::with_capacity(12);
    out.push(STATE_VERSION);
    out.push(state.stage as u8);
    out.push(state.player_card);
    out.push(state.dealer_card);
    out.extend_from_slice(&state.tie_bet.to_be_bytes());
    out
}

pub struct CasinoWar;

impl CasinoGame for CasinoWar {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        // Start in a betting stage so optional side bets can be placed before the deal.
        let state = CasinoWarState {
            player_card: HIDDEN_CARD,
            dealer_card: HIDDEN_CARD,
            stage: Stage::Betting,
            tie_bet: 0,
        };
        session.state_blob = serialize_state(&state);
        GameResult::Continue(vec![])
    }

    fn process_move(
        session: &mut GameSession,
        payload: &[u8],
        rng: &mut GameRng,
    ) -> Result<GameResult, GameError> {
        if session.is_complete {
            return Err(GameError::GameAlreadyComplete);
        }

        if payload.is_empty() {
            return Err(GameError::InvalidPayload);
        }

        let mv = Move::try_from(payload[0])?;
        let mut state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;

        session.move_count += 1;

        match state.stage {
            Stage::Betting => match mv {
                Move::SetTieBet => {
                    if payload.len() != 9 {
                        return Err(GameError::InvalidPayload);
                    }
                    let next_amount = u64::from_be_bytes(
                        payload[1..9]
                            .try_into()
                            .map_err(|_| GameError::InvalidPayload)?,
                    );

                    let prev_amount = state.tie_bet;

                    // We only support i64 deltas in ContinueWithUpdate.
                    let (payout, new_tie_bet) = if next_amount >= prev_amount {
                        let delta = next_amount - prev_amount;
                        let delta_i64 =
                            i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?;
                        (-(delta_i64), next_amount)
                    } else {
                        let delta = prev_amount - next_amount;
                        let delta_i64 =
                            i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?;
                        (delta_i64, next_amount)
                    };

                    state.tie_bet = new_tie_bet;
                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::ContinueWithUpdate { payout, logs: vec![] })
                }
                Move::Play => {
                    if payload.len() != 1 {
                        return Err(GameError::InvalidPayload);
                    }

                    // Deal one card each.
                    let mut deck = rng.create_shoe(CASINO_WAR_DECKS);
                    let player_card = rng.draw_card(&mut deck).unwrap_or(0);
                    let dealer_card = rng.draw_card(&mut deck).unwrap_or(1);

                    let player_rank = cards::card_rank_ace_high(player_card);
                    let dealer_rank = cards::card_rank_ace_high(dealer_card);

                    // Tie bet pays on initial tie only.
                    let tie_bet_return: i64 = if state.tie_bet > 0 && player_rank == dealer_rank
                    {
                        let credited = state
                            .tie_bet
                            .saturating_mul(TIE_BET_PAYOUT_TO_1.saturating_add(1));
                        i64::try_from(credited).map_err(|_| GameError::InvalidPayload)?
                    } else {
                        0
                    };

                    if player_rank > dealer_rank {
                        // Player wins 1:1.
                        state.stage = Stage::Complete;
                        state.player_card = player_card;
                        state.dealer_card = dealer_card;
                        session.state_blob = serialize_state(&state);
                        session.is_complete = true;

                        let base_winnings = session.bet.saturating_mul(2);
                        let final_winnings = if session.super_mode.is_active {
                            apply_super_multiplier_cards(
                                &[player_card],
                                &session.super_mode.multipliers,
                                base_winnings,
                            )
                        } else {
                            base_winnings
                        };
                        let logs = vec![format!(
                            r#"{{"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"PLAYER_WIN","tieBet":{},"payout":{}}}"#,
                            player_card, dealer_card, state.tie_bet, final_winnings
                        )];
                        Ok(GameResult::Win(final_winnings, logs))
                    } else if player_rank < dealer_rank {
                        // Dealer wins.
                        state.stage = Stage::Complete;
                        state.player_card = player_card;
                        state.dealer_card = dealer_card;
                        session.state_blob = serialize_state(&state);
                        session.is_complete = true;
                        let logs = vec![format!(
                            r#"{{"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"DEALER_WIN","tieBet":{},"payout":0}}"#,
                            player_card, dealer_card, state.tie_bet
                        )];
                        Ok(GameResult::Loss(logs))
                    } else {
                        // Tie: offer war or surrender, and pay tie bet (if any) immediately.
                        state.stage = Stage::War;
                        state.player_card = player_card;
                        state.dealer_card = dealer_card;
                        session.state_blob = serialize_state(&state);

                        let logs = vec![format!(
                            r#"{{"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"TIE","tieBet":{},"tieBetPayout":{}}}"#,
                            player_card, dealer_card, state.tie_bet, tie_bet_return
                        )];
                        if tie_bet_return != 0 {
                            Ok(GameResult::ContinueWithUpdate {
                                payout: tie_bet_return as i64,
                                logs,
                            })
                        } else {
                            Ok(GameResult::Continue(logs))
                        }
                    }
                }
                _ => {
                    // Check for atomic batch action (payload[0] == 4)
                    // [4, tie_bet: u64 BE]
                    if payload[0] == 4 {
                        if payload.len() != 9 {
                            return Err(GameError::InvalidPayload);
                        }

                        // Parse tie bet
                        let next_amount = u64::from_be_bytes(
                            payload[1..9]
                                .try_into()
                                .map_err(|_| GameError::InvalidPayload)?,
                        );

                        // Apply tie bet
                        let prev_amount = state.tie_bet;
                        let tie_bet_payout = if next_amount >= prev_amount {
                            let delta = next_amount - prev_amount;
                            let delta_i64 =
                                i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?;
                            -(delta_i64)
                        } else {
                            let delta = prev_amount - next_amount;
                            i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?
                        };
                        state.tie_bet = next_amount;

                        // Deal one card each
                        let mut deck = rng.create_shoe(CASINO_WAR_DECKS);
                        let player_card = rng.draw_card(&mut deck).unwrap_or(0);
                        let dealer_card = rng.draw_card(&mut deck).unwrap_or(1);

                        let player_rank = cards::card_rank_ace_high(player_card);
                        let dealer_rank = cards::card_rank_ace_high(dealer_card);

                        // Tie bet pays on initial tie only
                        let tie_bet_return: i64 = if state.tie_bet > 0 && player_rank == dealer_rank
                        {
                            let credited = state
                                .tie_bet
                                .saturating_mul(TIE_BET_PAYOUT_TO_1.saturating_add(1));
                            i64::try_from(credited).map_err(|_| GameError::InvalidPayload)?
                        } else {
                            0
                        };

                        state.player_card = player_card;
                        state.dealer_card = dealer_card;

                        // Total payout is tie bet placement delta + tie bet winnings
                        let total_payout = tie_bet_payout.saturating_add(tie_bet_return);

                        match player_rank.cmp(&dealer_rank) {
                            std::cmp::Ordering::Greater => {
                                // Player wins
                                let final_winnings = session.bet.saturating_mul(2);
                                state.stage = Stage::Complete;
                                session.state_blob = serialize_state(&state);
                                session.is_complete = true;
                                session.move_count += 1;

                                let base_payout = final_winnings;
                                let final_payout = if session.super_mode.is_active {
                                    apply_super_multiplier_cards(
                                        &[player_card, dealer_card],
                                        &session.super_mode.multipliers,
                                        base_payout,
                                    )
                                } else {
                                    base_payout
                                };

                                let logs = vec![format!(
                                    r#"{{"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"PLAYER_WIN","tieBet":{},"payout":{}}}"#,
                                    player_card, dealer_card, state.tie_bet, final_payout
                                )];
                                if total_payout != 0 {
                                    Ok(GameResult::ContinueWithUpdate {
                                        payout: total_payout + final_payout as i64,
                                        logs,
                                    })
                                } else {
                                    Ok(GameResult::Win(final_payout, logs))
                                }
                            }
                            std::cmp::Ordering::Less => {
                                // Dealer wins - player loses ante (already deducted)
                                state.stage = Stage::Complete;
                                session.state_blob = serialize_state(&state);
                                session.is_complete = true;
                                session.move_count += 1;

                                let logs = vec![format!(
                                    r#"{{"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"DEALER_WIN","tieBet":{},"payout":0}}"#,
                                    player_card, dealer_card, state.tie_bet
                                )];
                                if total_payout != 0 {
                                    Ok(GameResult::ContinueWithUpdate {
                                        payout: total_payout,
                                        logs,
                                    })
                                } else {
                                    Ok(GameResult::Loss(logs))
                                }
                            }
                            std::cmp::Ordering::Equal => {
                                // Tie - player must go to war or surrender
                                state.stage = Stage::War;
                                session.state_blob = serialize_state(&state);
                                session.move_count += 1;

                                let logs = vec![format!(
                                    r#"{{"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"TIE","tieBet":{},"tieBetPayout":{}}}"#,
                                    player_card, dealer_card, state.tie_bet, tie_bet_return
                                )];
                                if total_payout != 0 {
                                    Ok(GameResult::ContinueWithUpdate {
                                        payout: total_payout,
                                        logs,
                                    })
                                } else {
                                    Ok(GameResult::Continue(logs))
                                }
                            }
                        }
                    } else {
                        Err(GameError::InvalidMove)
                    }
                }
            },
            Stage::War => match mv {
                Move::Surrender => {
                    state.stage = Stage::Complete;
                    session.state_blob = serialize_state(&state);
                    session.is_complete = true;
                    // CasinoStartGame already deducted the ante, so refund half to realize a
                    // half-loss outcome.
                    let refund = session.bet / 2;
                    let logs = vec![format!(
                        r#"{{"stage":"SURRENDER","playerCard":{},"dealerCard":{},"outcome":"SURRENDER","payout":{}}}"#,
                        state.player_card, state.dealer_card, refund
                    )];
                    Ok(GameResult::Win(refund, logs))
                }
                Move::War => {
                    let war_bet = session.bet;
                    let original_player_card = state.player_card;
                    let original_dealer_card = state.dealer_card;

                    // Burn 3 cards, then deal new cards.
                    let mut deck = rng.create_shoe_excluding(
                        &[state.player_card, state.dealer_card],
                        CASINO_WAR_DECKS,
                    );
                    for _ in 0..3 {
                        rng.draw_card(&mut deck);
                    }

                    let new_player_card =
                        rng.draw_card(&mut deck).ok_or(GameError::InvalidMove)?;
                    let new_dealer_card =
                        rng.draw_card(&mut deck).ok_or(GameError::InvalidMove)?;

                    let new_player_rank = cards::card_rank_ace_high(new_player_card);
                    let new_dealer_rank = cards::card_rank_ace_high(new_dealer_card);

                    state.stage = Stage::Complete;
                    state.player_card = new_player_card;
                    state.dealer_card = new_dealer_card;
                    session.state_blob = serialize_state(&state);
                    session.is_complete = true;

                    if new_player_rank >= new_dealer_rank {
                        // WoO "bonus" variant: tie-after-tie awards a bonus equal to the ante.
                        // https://wizardofodds.com/games/casino-war/
                        //
                        // Note: We model the raise as a contingent loss (`LossWithExtraDeduction`)
                        // instead of a pre-deducted bet, so we express the bonus via the credited return.
                        let is_tie_after_tie = new_player_rank == new_dealer_rank;
                        let base_winnings = if is_tie_after_tie {
                            session.bet.saturating_mul(2).saturating_add(
                                session.bet.saturating_mul(TIE_AFTER_TIE_BONUS_MULTIPLIER),
                            )
                        } else {
                            session.bet.saturating_mul(2)
                        };
                        let final_winnings = if session.super_mode.is_active {
                            apply_super_multiplier_cards(
                                &[new_player_card],
                                &session.super_mode.multipliers,
                                base_winnings,
                            )
                        } else {
                            base_winnings
                        };
                        let outcome = if is_tie_after_tie { "TIE_AFTER_TIE" } else { "PLAYER_WIN" };
                        let logs = vec![format!(
                            r#"{{"stage":"WAR","originalPlayerCard":{},"originalDealerCard":{},"warPlayerCard":{},"warDealerCard":{},"outcome":"{}","payout":{}}}"#,
                            original_player_card, original_dealer_card, new_player_card, new_dealer_card, outcome, final_winnings
                        )];
                        Ok(GameResult::Win(final_winnings, logs))
                    } else {
                        // Lose both bets (ante + war bet).
                        let logs = vec![format!(
                            r#"{{"stage":"WAR","originalPlayerCard":{},"originalDealerCard":{},"warPlayerCard":{},"warDealerCard":{},"outcome":"DEALER_WIN","payout":0}}"#,
                            original_player_card, original_dealer_card, new_player_card, new_dealer_card
                        )];
                        Ok(GameResult::LossWithExtraDeduction(war_bet, logs))
                    }
                }
                _ => Err(GameError::InvalidMove),
            },
            Stage::Complete => Err(GameError::GameAlreadyComplete),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use nullspace_types::casino::GameType;

    fn create_test_seed() -> nullspace_types::Seed {
        let (network_secret, _) = create_network_keypair();
        create_seed(&network_secret, 1)
    }

    fn create_test_session(bet: u64) -> GameSession {
        let (_, pk) = create_account_keypair(1);
        GameSession {
            id: 1,
            player: pk,
            game_type: GameType::CasinoWar,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: nullspace_types::casino::SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        }
    }

    #[test]
    fn test_init_starts_in_betting_stage() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        CasinoWar::init(&mut session, &mut rng);

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.stage, Stage::Betting);
        assert_eq!(state.player_card, HIDDEN_CARD);
        assert_eq!(state.dealer_card, HIDDEN_CARD);
        assert_eq!(state.tie_bet, 0);
    }

    #[test]
    fn test_set_tie_bet_updates_state() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        CasinoWar::init(&mut session, &mut rng);

        let mut payload = vec![3];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = CasinoWar::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(
            result,
            Ok(GameResult::ContinueWithUpdate { payout: -10, .. })
        ));

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.tie_bet, 10);
        assert_eq!(state.stage, Stage::Betting);
    }

    #[test]
    fn test_tie_bet_pays_on_tie() {
        let seed = create_test_seed();

        // Find a session that produces an initial tie.
        for session_id in 1..300 {
            let mut session = create_test_session(100);
            session.id = session_id;
            let mut rng = GameRng::new(&seed, session.id, 0);
            CasinoWar::init(&mut session, &mut rng);

            // Set tie bet to 10.
            let mut payload = vec![3];
            payload.extend_from_slice(&10u64.to_be_bytes());
            let mut rng = GameRng::new(&seed, session.id, 1);
            CasinoWar::process_move(&mut session, &payload, &mut rng).expect("set tie bet");

            // Deal + compare.
            let mut rng = GameRng::new(&seed, session.id, 2);
            let result = CasinoWar::process_move(&mut session, &[0], &mut rng);

            if matches!(result, Ok(GameResult::ContinueWithUpdate { payout: 110, .. })) {
                let state = parse_state(&session.state_blob).expect("Failed to parse state");
                assert_eq!(state.stage, Stage::War);
                assert!(state.player_card < 52);
                assert!(state.dealer_card < 52);
                assert_eq!(
                    cards::card_rank_ace_high(state.player_card),
                    cards::card_rank_ace_high(state.dealer_card)
                );
                return;
            }
        }

        panic!("failed to find a tie in 300 trials");
    }

    #[test]
    fn test_tie_after_tie_awards_bonus() {
        let seed = create_test_seed();

        // Find a session that produces a tie and then a tie-after-tie.
        for session_id in 1..10_000 {
            let mut session = create_test_session(100);
            session.id = session_id;
            let mut rng = GameRng::new(&seed, session.id, 0);
            CasinoWar::init(&mut session, &mut rng);

            // Deal + compare.
            let mut rng = GameRng::new(&seed, session.id, 1);
            let _ = CasinoWar::process_move(&mut session, &[0], &mut rng).expect("deal");

            let state = parse_state(&session.state_blob).expect("parse state");
            if state.stage != Stage::War {
                continue;
            }

            // Go to war.
            let mut rng = GameRng::new(&seed, session.id, 2);
            let result = CasinoWar::process_move(&mut session, &[1], &mut rng).expect("war");

            let final_state = parse_state(&session.state_blob).expect("parse final state");
            assert_eq!(final_state.stage, Stage::Complete);

            if cards::card_rank_ace_high(final_state.player_card)
                == cards::card_rank_ace_high(final_state.dealer_card)
            {
                // Bonus is equal to the ante, so the win credits 3x the ante in our model.
                assert!(matches!(result, GameResult::Win(300, _)));
                return;
            }
        }

        panic!("failed to find a tie-after-tie in 10,000 trials");
    }
}
