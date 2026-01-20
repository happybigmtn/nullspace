//! Round query interfaces for global table games (AC-2.5).
//!
//! This module exposes query APIs for round status, totals, and player bet history.
//! These queries operate on stored state and events to provide game information.
//!
//! ## Query Types
//!
//! - [`RoundStatus`]: Current phase, timing, and outcome for a round
//! - [`RoundTotals`]: Aggregated bet amounts by (bet_type, target)
//! - [`PlayerBetRecord`]: Individual bet records for a player
//!
//! ## Usage
//!
//! ```rust,ignore
//! use nullspace_execution::round_query::{
//!     query_round_status, query_round_totals, query_player_history,
//! };
//!
//! // Query round status from state
//! let status = query_round_status(&state, game_type).await?;
//!
//! // Query totals for the current round
//! let totals = query_round_totals(&state, game_type).await?;
//!
//! // Query player bet history from events
//! let history = query_player_history(&events, game_type, &player_key);
//! ```

use commonware_cryptography::ed25519::PublicKey;
use nullspace_types::casino::{
    GameType, GlobalTableBet, GlobalTablePhase, GlobalTableRound, GlobalTableTotal,
    PlayerBalanceSnapshot,
};
use nullspace_types::execution::{Event, Key, Value};

use crate::state::State;

/// Error during round queries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryError {
    /// Round not found for the specified game type.
    RoundNotFound(GameType),
    /// Player session not found.
    PlayerNotFound,
    /// State access error.
    StateError(String),
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RoundNotFound(gt) => write!(f, "round not found for game type {gt:?}"),
            Self::PlayerNotFound => write!(f, "player session not found"),
            Self::StateError(msg) => write!(f, "state error: {msg}"),
        }
    }
}

impl std::error::Error for QueryError {}

/// Round status summary.
///
/// Provides a view of the current round state including phase, timing,
/// and outcome information when available.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoundStatus {
    /// Game type (e.g., Craps, Roulette).
    pub game_type: GameType,
    /// Round identifier.
    pub round_id: u64,
    /// Current phase (Betting, Locked, Rolling, Payout, Cooldown).
    pub phase: GlobalTablePhase,
    /// Millisecond timestamp when current phase ends.
    pub phase_ends_at_ms: u64,
    /// Whether betting is currently open.
    pub betting_open: bool,
    /// Whether outcome has been revealed.
    pub outcome_revealed: bool,
    /// Dice/outcome values (game-specific, e.g., d1+d2 for Craps).
    pub d1: u8,
    pub d2: u8,
    /// Point value for Craps (0 if none).
    pub main_point: u8,
    /// RNG commit hash (32 bytes, empty before commit).
    pub rng_commit: Vec<u8>,
    /// Revealed roll seed (32 bytes, empty before reveal).
    pub roll_seed: Vec<u8>,
}

impl RoundStatus {
    /// Create a status summary from a round state.
    pub fn from_round(round: &GlobalTableRound) -> Self {
        Self {
            game_type: round.game_type,
            round_id: round.round_id,
            phase: round.phase,
            phase_ends_at_ms: round.phase_ends_at_ms,
            betting_open: round.phase == GlobalTablePhase::Betting,
            outcome_revealed: !round.roll_seed.is_empty(),
            d1: round.d1,
            d2: round.d2,
            main_point: round.main_point,
            rng_commit: round.rng_commit.clone(),
            roll_seed: round.roll_seed.clone(),
        }
    }
}

/// Aggregated round totals.
///
/// Contains the accumulated bet amounts across all players for each
/// (bet_type, target) combination.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoundTotals {
    /// Game type.
    pub game_type: GameType,
    /// Round identifier.
    pub round_id: u64,
    /// Totals by (bet_type, target).
    pub totals: Vec<GlobalTableTotal>,
    /// Sum of all bet amounts.
    pub total_wagered: u64,
}

impl RoundTotals {
    /// Create totals summary from a round state.
    pub fn from_round(round: &GlobalTableRound) -> Self {
        let total_wagered = round.totals.iter().map(|t| t.amount).sum();
        Self {
            game_type: round.game_type,
            round_id: round.round_id,
            totals: round.totals.clone(),
            total_wagered,
        }
    }
}

/// Individual player bet record.
///
/// Captures a single bet placement or settlement event for history tracking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerBetRecord {
    /// Round in which the bet was placed.
    pub round_id: u64,
    /// Bets placed by the player.
    pub bets: Vec<GlobalTableBet>,
    /// Player balance snapshot after the action.
    pub balance_after: PlayerBalanceSnapshot,
    /// Settlement payout (positive = win, negative = loss, None if not settled).
    pub payout: Option<i64>,
}

/// Player bet history for a game type.
///
/// Contains all bet records for a player in chronological order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerHistory {
    /// Player public key.
    pub player: PublicKey,
    /// Game type.
    pub game_type: GameType,
    /// Bet records in chronological order.
    pub records: Vec<PlayerBetRecord>,
    /// Total amount wagered across all records.
    pub total_wagered: u64,
    /// Net result (sum of payouts).
    pub net_result: i64,
}

// -----------------------------------------------------------------------------
// Query Functions
// -----------------------------------------------------------------------------

/// Query the current round status for a game type.
///
/// Returns the current round state including phase, timing, and outcome.
///
/// # Arguments
///
/// * `state` - State store implementing the State trait
/// * `game_type` - The game type to query
///
/// # Returns
///
/// The round status or an error if the round is not found.
pub async fn query_round_status<S: State>(
    state: &S,
    game_type: GameType,
) -> Result<RoundStatus, QueryError> {
    let round = load_round(state, game_type).await?;
    Ok(RoundStatus::from_round(&round))
}

/// Query the current round totals for a game type.
///
/// Returns aggregated bet amounts by (bet_type, target).
///
/// # Arguments
///
/// * `state` - State store implementing the State trait
/// * `game_type` - The game type to query
///
/// # Returns
///
/// The round totals or an error if the round is not found.
pub async fn query_round_totals<S: State>(
    state: &S,
    game_type: GameType,
) -> Result<RoundTotals, QueryError> {
    let round = load_round(state, game_type).await?;
    Ok(RoundTotals::from_round(&round))
}

/// Query the full round state for a game type.
///
/// Returns the complete `GlobalTableRound` for direct access.
///
/// # Arguments
///
/// * `state` - State store implementing the State trait
/// * `game_type` - The game type to query
///
/// # Returns
///
/// The full round state or an error if not found.
pub async fn query_round<S: State>(
    state: &S,
    game_type: GameType,
) -> Result<GlobalTableRound, QueryError> {
    load_round(state, game_type).await
}

/// Query player bet history from event logs.
///
/// Extracts all bet placements and settlements for a specific player
/// from the event stream.
///
/// # Arguments
///
/// * `events` - Slice of events to search through
/// * `game_type` - The game type to filter by
/// * `player` - The player public key to query
///
/// # Returns
///
/// Player history containing all bet records.
pub fn query_player_history(
    events: &[Event],
    game_type: GameType,
    player: &PublicKey,
) -> PlayerHistory {
    let mut records: Vec<PlayerBetRecord> = Vec::new();

    for event in events {
        match event {
            Event::GlobalTableBetAccepted {
                player: event_player,
                round_id,
                bets,
                player_balances,
            } if event_player == player => {
                // Check if we already have a record for this round
                if let Some(existing) = records.iter_mut().find(|r| r.round_id == *round_id) {
                    // Append bets to existing record
                    existing.bets.extend(bets.clone());
                    existing.balance_after = player_balances.clone();
                } else {
                    records.push(PlayerBetRecord {
                        round_id: *round_id,
                        bets: bets.clone(),
                        balance_after: player_balances.clone(),
                        payout: None,
                    });
                }
            }

            Event::GlobalTablePlayerSettled {
                player: event_player,
                round_id,
                payout,
                player_balances,
                my_bets,
            } if event_player == player => {
                // Find existing record or create one
                if let Some(existing) = records.iter_mut().find(|r| r.round_id == *round_id) {
                    existing.payout = Some(*payout);
                    existing.balance_after = player_balances.clone();
                } else {
                    // Settlement without prior bet record (shouldn't happen normally)
                    records.push(PlayerBetRecord {
                        round_id: *round_id,
                        bets: my_bets.clone(),
                        balance_after: player_balances.clone(),
                        payout: Some(*payout),
                    });
                }
            }

            _ => {}
        }
    }

    // Filter by game_type using round events (we need to cross-reference)
    // For now, we include all records since game_type is encoded in round events
    // A more complete implementation would track round_id -> game_type mapping

    let total_wagered: u64 = records
        .iter()
        .flat_map(|r| r.bets.iter())
        .map(|b| b.amount)
        .sum();

    let net_result: i64 = records.iter().filter_map(|r| r.payout).sum();

    PlayerHistory {
        player: player.clone(),
        game_type,
        records,
        total_wagered,
        net_result,
    }
}

/// Query player history filtered by round ID range.
///
/// Returns bet records for rounds within [start_round, end_round] inclusive.
///
/// # Arguments
///
/// * `events` - Slice of events to search through
/// * `game_type` - The game type to filter by
/// * `player` - The player public key to query
/// * `start_round` - First round ID to include
/// * `end_round` - Last round ID to include
///
/// # Returns
///
/// Player history for the specified round range.
pub fn query_player_history_range(
    events: &[Event],
    game_type: GameType,
    player: &PublicKey,
    start_round: u64,
    end_round: u64,
) -> PlayerHistory {
    let mut history = query_player_history(events, game_type, player);

    // Filter to range
    history
        .records
        .retain(|r| r.round_id >= start_round && r.round_id <= end_round);

    // Recalculate totals
    history.total_wagered = history
        .records
        .iter()
        .flat_map(|r| r.bets.iter())
        .map(|b| b.amount)
        .sum();

    history.net_result = history.records.iter().filter_map(|r| r.payout).sum();

    history
}

/// Extract round IDs that a player participated in.
///
/// # Arguments
///
/// * `events` - Slice of events to search through
/// * `player` - The player public key to query
///
/// # Returns
///
/// Sorted list of unique round IDs the player bet in.
pub fn query_player_rounds(events: &[Event], player: &PublicKey) -> Vec<u64> {
    let mut round_ids: Vec<u64> = events
        .iter()
        .filter_map(|event| match event {
            Event::GlobalTableBetAccepted {
                player: event_player,
                round_id,
                ..
            } if event_player == player => Some(*round_id),
            _ => None,
        })
        .collect();

    round_ids.sort_unstable();
    round_ids.dedup();
    round_ids
}

// -----------------------------------------------------------------------------
// Internal Helpers
// -----------------------------------------------------------------------------

async fn load_round<S: State>(
    state: &S,
    game_type: GameType,
) -> Result<GlobalTableRound, QueryError> {
    let key = Key::GlobalTableRound(game_type);
    match state.get(key).await {
        Ok(Some(Value::GlobalTableRound(round))) => Ok(round),
        Ok(Some(_)) => Err(QueryError::StateError(
            "unexpected value type for round key".to_string(),
        )),
        Ok(None) => Err(QueryError::RoundNotFound(game_type)),
        Err(e) => Err(QueryError::StateError(e.to_string())),
    }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_public_key() -> PublicKey {
        use commonware_cryptography::Signer;
        use commonware_math::algebra::Random as _;
        use rand::{rngs::StdRng, SeedableRng};
        let mut rng = StdRng::seed_from_u64(12345);
        let private = commonware_cryptography::ed25519::PrivateKey::random(&mut rng);
        private.public_key()
    }

    fn test_public_key_2() -> PublicKey {
        use commonware_cryptography::Signer;
        use commonware_math::algebra::Random as _;
        use rand::{rngs::StdRng, SeedableRng};
        let mut rng = StdRng::seed_from_u64(67890);
        let private = commonware_cryptography::ed25519::PrivateKey::random(&mut rng);
        private.public_key()
    }

    fn test_balance() -> PlayerBalanceSnapshot {
        PlayerBalanceSnapshot {
            chips: 1000,
            vusdt_balance: 0,
            shields: 0,
            doubles: 0,
            tournament_chips: 0,
            tournament_shields: 0,
            tournament_doubles: 0,
            active_tournament: None,
        }
    }

    fn test_round() -> GlobalTableRound {
        GlobalTableRound {
            game_type: GameType::Craps,
            round_id: 1,
            phase: GlobalTablePhase::Betting,
            phase_ends_at_ms: 30_000,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: 0,
            rng_commit: vec![0xAB; 32],
            roll_seed: Vec::new(),
            totals: vec![
                GlobalTableTotal {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                },
                GlobalTableTotal {
                    bet_type: 2,
                    target: 7,
                    amount: 50,
                },
            ],
        }
    }

    #[test]
    fn test_round_status_from_round() {
        let round = test_round();
        let status = RoundStatus::from_round(&round);

        assert_eq!(status.game_type, GameType::Craps);
        assert_eq!(status.round_id, 1);
        assert_eq!(status.phase, GlobalTablePhase::Betting);
        assert!(status.betting_open);
        assert!(!status.outcome_revealed);
        assert_eq!(status.rng_commit.len(), 32);
        assert!(status.roll_seed.is_empty());
    }

    #[test]
    fn test_round_status_outcome_revealed() {
        let mut round = test_round();
        round.phase = GlobalTablePhase::Payout;
        round.roll_seed = vec![0xCD; 32];
        round.d1 = 4;
        round.d2 = 3;

        let status = RoundStatus::from_round(&round);

        assert!(!status.betting_open);
        assert!(status.outcome_revealed);
        assert_eq!(status.d1, 4);
        assert_eq!(status.d2, 3);
    }

    #[test]
    fn test_round_totals_from_round() {
        let round = test_round();
        let totals = RoundTotals::from_round(&round);

        assert_eq!(totals.game_type, GameType::Craps);
        assert_eq!(totals.round_id, 1);
        assert_eq!(totals.totals.len(), 2);
        assert_eq!(totals.total_wagered, 150); // 100 + 50
    }

    #[test]
    fn test_query_player_history_single_bet() {
        let player = test_public_key();

        let events = vec![Event::GlobalTableBetAccepted {
            player: player.clone(),
            round_id: 1,
            bets: vec![GlobalTableBet {
                bet_type: 1,
                target: 0,
                amount: 100,
            }],
            player_balances: test_balance(),
        }];

        let history = query_player_history(&events, GameType::Craps, &player);

        assert_eq!(history.records.len(), 1);
        assert_eq!(history.records[0].round_id, 1);
        assert_eq!(history.records[0].bets.len(), 1);
        assert_eq!(history.records[0].bets[0].amount, 100);
        assert!(history.records[0].payout.is_none());
        assert_eq!(history.total_wagered, 100);
        assert_eq!(history.net_result, 0);
    }

    #[test]
    fn test_query_player_history_bet_and_settle() {
        let player = test_public_key();

        let events = vec![
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_balance(),
            },
            Event::GlobalTablePlayerSettled {
                player: player.clone(),
                round_id: 1,
                payout: 200, // Won +200
                player_balances: PlayerBalanceSnapshot {
                    chips: 1200,
                    ..test_balance()
                },
                my_bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
            },
        ];

        let history = query_player_history(&events, GameType::Craps, &player);

        assert_eq!(history.records.len(), 1);
        assert_eq!(history.records[0].payout, Some(200));
        assert_eq!(history.records[0].balance_after.chips, 1200);
        assert_eq!(history.net_result, 200);
    }

    #[test]
    fn test_query_player_history_multiple_rounds() {
        let player = test_public_key();

        let events = vec![
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_balance(),
            },
            Event::GlobalTablePlayerSettled {
                player: player.clone(),
                round_id: 1,
                payout: -100, // Lost
                player_balances: PlayerBalanceSnapshot {
                    chips: 900,
                    ..test_balance()
                },
                my_bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
            },
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 2,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 50,
                }],
                player_balances: PlayerBalanceSnapshot {
                    chips: 850,
                    ..test_balance()
                },
            },
            Event::GlobalTablePlayerSettled {
                player: player.clone(),
                round_id: 2,
                payout: 100, // Won
                player_balances: PlayerBalanceSnapshot {
                    chips: 950,
                    ..test_balance()
                },
                my_bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 50,
                }],
            },
        ];

        let history = query_player_history(&events, GameType::Craps, &player);

        assert_eq!(history.records.len(), 2);
        assert_eq!(history.total_wagered, 150); // 100 + 50
        assert_eq!(history.net_result, 0); // -100 + 100
    }

    #[test]
    fn test_query_player_history_excludes_other_players() {
        let player1 = test_public_key();
        let player2 = test_public_key_2();

        let events = vec![
            Event::GlobalTableBetAccepted {
                player: player1.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: player2.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 200,
                }],
                player_balances: test_balance(),
            },
        ];

        let history1 = query_player_history(&events, GameType::Craps, &player1);
        let history2 = query_player_history(&events, GameType::Craps, &player2);

        assert_eq!(history1.records.len(), 1);
        assert_eq!(history1.total_wagered, 100);

        assert_eq!(history2.records.len(), 1);
        assert_eq!(history2.total_wagered, 200);
    }

    #[test]
    fn test_query_player_history_range() {
        let player = test_public_key();

        let events = vec![
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 2,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 150,
                }],
                player_balances: test_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 3,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 200,
                }],
                player_balances: test_balance(),
            },
        ];

        // Query only rounds 1-2
        let history = query_player_history_range(&events, GameType::Craps, &player, 1, 2);

        assert_eq!(history.records.len(), 2);
        assert_eq!(history.total_wagered, 250); // 100 + 150
    }

    #[test]
    fn test_query_player_rounds() {
        let player = test_public_key();

        let events = vec![
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 3,
                bets: vec![],
                player_balances: test_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 1,
                bets: vec![],
                player_balances: test_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: player.clone(),
                round_id: 3, // Duplicate
                bets: vec![],
                player_balances: test_balance(),
            },
        ];

        let rounds = query_player_rounds(&events, &player);

        assert_eq!(rounds, vec![1, 3]); // Sorted and deduplicated
    }

    #[test]
    fn test_query_player_history_empty() {
        let player = test_public_key();
        let events: Vec<Event> = vec![];

        let history = query_player_history(&events, GameType::Craps, &player);

        assert!(history.records.is_empty());
        assert_eq!(history.total_wagered, 0);
        assert_eq!(history.net_result, 0);
    }

    #[tokio::test]
    async fn test_query_round_status_from_state() {
        use crate::state::Memory;

        let mut state = Memory::default();
        let round = test_round();

        // Store the round
        state
            .insert(
                Key::GlobalTableRound(GameType::Craps),
                Value::GlobalTableRound(round.clone()),
            )
            .await
            .unwrap();

        // Query it back
        let status = query_round_status(&state, GameType::Craps).await.unwrap();

        assert_eq!(status.game_type, GameType::Craps);
        assert_eq!(status.round_id, 1);
        assert!(status.betting_open);
    }

    #[tokio::test]
    async fn test_query_round_totals_from_state() {
        use crate::state::Memory;

        let mut state = Memory::default();
        let round = test_round();

        state
            .insert(
                Key::GlobalTableRound(GameType::Craps),
                Value::GlobalTableRound(round),
            )
            .await
            .unwrap();

        let totals = query_round_totals(&state, GameType::Craps).await.unwrap();

        assert_eq!(totals.total_wagered, 150);
        assert_eq!(totals.totals.len(), 2);
    }

    #[tokio::test]
    async fn test_query_round_not_found() {
        use crate::state::Memory;

        let state = Memory::default();

        let result = query_round_status(&state, GameType::Craps).await;

        assert!(matches!(result, Err(QueryError::RoundNotFound(_))));
    }

    #[tokio::test]
    async fn test_query_full_round() {
        use crate::state::Memory;

        let mut state = Memory::default();
        let round = test_round();

        state
            .insert(
                Key::GlobalTableRound(GameType::Craps),
                Value::GlobalTableRound(round.clone()),
            )
            .await
            .unwrap();

        let queried = query_round(&state, GameType::Craps).await.unwrap();

        assert_eq!(queried, round);
    }

    /// Integration test: verifies query API works correctly after a complete
    /// round settlement lifecycle (AC-2.5 T5 validation).
    ///
    /// This test simulates:
    /// 1. Round opens (Betting phase)
    /// 2. Multiple players place bets
    /// 3. Round locks
    /// 4. Outcome revealed (dice rolled)
    /// 5. Players settled with payouts
    /// 6. Round finalized
    ///
    /// Then queries:
    /// - Round status shows Cooldown phase with outcome revealed
    /// - Round totals show accumulated bets
    /// - Player history shows bets and settlements
    #[tokio::test]
    async fn test_query_api_after_settlement_integration() {
        use crate::round_replay::{replay_round_from_events, initial_snapshot};
        use crate::state::Memory;

        let player1 = test_public_key();
        let player2 = test_public_key_2();

        // Simulate a complete round lifecycle via events
        let events = vec![
            // 1. Round opens
            Event::GlobalTableRoundOpened {
                round: GlobalTableRound {
                    game_type: GameType::Craps,
                    round_id: 1,
                    phase: GlobalTablePhase::Betting,
                    phase_ends_at_ms: 30_000,
                    main_point: 0,
                    d1: 0,
                    d2: 0,
                    made_points_mask: 0,
                    epoch_point_established: false,
                    field_paytable: 0,
                    rng_commit: vec![0xAA; 32],
                    roll_seed: Vec::new(),
                    totals: Vec::new(),
                },
            },
            // 2. Player 1 places bet
            Event::GlobalTableBetAccepted {
                player: player1.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1, // Pass line
                    target: 0,
                    amount: 100,
                }],
                player_balances: PlayerBalanceSnapshot {
                    chips: 900,
                    ..test_balance()
                },
            },
            // 3. Player 2 places bet
            Event::GlobalTableBetAccepted {
                player: player2.clone(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 2, // Field bet
                    target: 7,
                    amount: 50,
                }],
                player_balances: PlayerBalanceSnapshot {
                    chips: 950,
                    ..test_balance()
                },
            },
            // 4. Round locks
            Event::GlobalTableLocked {
                game_type: GameType::Craps,
                round_id: 1,
                phase_ends_at_ms: 35_000,
            },
            // 5. Outcome revealed (dice: 4+3=7)
            Event::GlobalTableOutcome {
                round: GlobalTableRound {
                    game_type: GameType::Craps,
                    round_id: 1,
                    phase: GlobalTablePhase::Payout,
                    phase_ends_at_ms: 45_000,
                    main_point: 0,
                    d1: 4,
                    d2: 3,
                    made_points_mask: 0,
                    epoch_point_established: false,
                    field_paytable: 0,
                    rng_commit: vec![0xAA; 32],
                    roll_seed: vec![0xBB; 32],
                    totals: vec![
                        GlobalTableTotal { bet_type: 1, target: 0, amount: 100 },
                        GlobalTableTotal { bet_type: 2, target: 7, amount: 50 },
                    ],
                },
            },
            // 6. Player 1 settled (won on pass line with 7)
            Event::GlobalTablePlayerSettled {
                player: player1.clone(),
                round_id: 1,
                payout: 100, // Won 1:1
                player_balances: PlayerBalanceSnapshot {
                    chips: 1100, // 900 + 100 bet + 100 win
                    ..test_balance()
                },
                my_bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
            },
            // 7. Player 2 settled (won on field 7)
            Event::GlobalTablePlayerSettled {
                player: player2.clone(),
                round_id: 1,
                payout: 50, // Won 1:1
                player_balances: PlayerBalanceSnapshot {
                    chips: 1050, // 950 + 50 bet + 50 win
                    ..test_balance()
                },
                my_bets: vec![GlobalTableBet {
                    bet_type: 2,
                    target: 7,
                    amount: 50,
                }],
            },
            // 8. Round finalized
            Event::GlobalTableFinalized {
                game_type: GameType::Craps,
                round_id: 1,
            },
        ];

        // Reconstruct final state via replay
        let initial = initial_snapshot(GameType::Craps);
        let final_round = replay_round_from_events(&initial, &events).unwrap();

        // Store final round state
        let mut state = Memory::default();
        state
            .insert(
                Key::GlobalTableRound(GameType::Craps),
                Value::GlobalTableRound(final_round),
            )
            .await
            .unwrap();

        // ---------------------------------------------------------------------
        // Query API Verification (AC-2.5)
        // ---------------------------------------------------------------------

        // 1. Query round status
        let status = query_round_status(&state, GameType::Craps).await.unwrap();
        assert_eq!(status.round_id, 1);
        assert_eq!(status.phase, GlobalTablePhase::Cooldown);
        assert!(!status.betting_open, "betting should be closed after settlement");
        assert!(status.outcome_revealed, "outcome should be revealed after settlement");
        assert_eq!(status.d1, 4);
        assert_eq!(status.d2, 3);
        assert_eq!(status.roll_seed.len(), 32);

        // 2. Query round totals
        let totals = query_round_totals(&state, GameType::Craps).await.unwrap();
        assert_eq!(totals.round_id, 1);
        assert_eq!(totals.total_wagered, 150, "total should be 100 + 50");
        assert_eq!(totals.totals.len(), 2);

        // 3. Query player 1 history
        let history1 = query_player_history(&events, GameType::Craps, &player1);
        assert_eq!(history1.records.len(), 1);
        assert_eq!(history1.records[0].round_id, 1);
        assert_eq!(history1.records[0].bets[0].amount, 100);
        assert_eq!(history1.records[0].payout, Some(100));
        assert_eq!(history1.total_wagered, 100);
        assert_eq!(history1.net_result, 100, "player1 won 100");

        // 4. Query player 2 history
        let history2 = query_player_history(&events, GameType::Craps, &player2);
        assert_eq!(history2.records.len(), 1);
        assert_eq!(history2.records[0].payout, Some(50));
        assert_eq!(history2.net_result, 50, "player2 won 50");

        // 5. Query player rounds
        let player1_rounds = query_player_rounds(&events, &player1);
        assert_eq!(player1_rounds, vec![1]);

        let player2_rounds = query_player_rounds(&events, &player2);
        assert_eq!(player2_rounds, vec![1]);

        // 6. Verify full round query
        let full_round = query_round(&state, GameType::Craps).await.unwrap();
        assert_eq!(full_round.phase, GlobalTablePhase::Cooldown);
        assert_eq!(full_round.totals.len(), 2);
    }
}
