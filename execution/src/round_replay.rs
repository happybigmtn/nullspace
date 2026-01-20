//! Round replay and snapshot recovery for global table games (AC-2.4).
//!
//! This module provides append-only event log writing and snapshot-based recovery
//! for the global table round state machine. It allows replaying events from any
//! round boundary to reconstruct identical state.
//!
//! ## Determinism Guarantees
//!
//! Replay is deterministic because:
//! 1. All RNG is derived from the `roll_seed` captured in `GlobalTableOutcome` events
//! 2. Phase transitions are based on deterministic view-based timing (`view * MS_PER_VIEW`)
//! 3. Events are processed in append-order from the event log
//!
//! ## Usage
//!
//! ```rust,ignore
//! use nullspace_execution::round_replay::{RoundSnapshot, replay_round_from_events};
//!
//! // Save a snapshot at a round boundary
//! let snapshot = RoundSnapshot::from_round(&round);
//!
//! // Later, replay events from that snapshot
//! let events = [...]; // Events since the snapshot
//! let recovered = replay_round_from_events(&snapshot, &events)?;
//! assert_eq!(recovered.round_id, round.round_id);
//! ```

use nullspace_types::casino::{
    GameType, GlobalTableBet, GlobalTablePhase, GlobalTableRound, GlobalTableTotal,
};
use nullspace_types::execution::Event;

/// Error during round replay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayError {
    /// Event references a different round than expected.
    RoundMismatch { expected: u64, got: u64 },
    /// Event references a different game type than expected.
    GameTypeMismatch { expected: GameType, got: GameType },
    /// Events are out of order or missing.
    InvalidEventSequence(String),
    /// Snapshot is invalid or corrupted.
    InvalidSnapshot(String),
}

impl std::fmt::Display for ReplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RoundMismatch { expected, got } => {
                write!(f, "round mismatch: expected {expected}, got {got}")
            }
            Self::GameTypeMismatch { expected, got } => {
                write!(f, "game type mismatch: expected {expected:?}, got {got:?}")
            }
            Self::InvalidEventSequence(msg) => write!(f, "invalid event sequence: {msg}"),
            Self::InvalidSnapshot(msg) => write!(f, "invalid snapshot: {msg}"),
        }
    }
}

impl std::error::Error for ReplayError {}

/// A snapshot of global table round state at a round boundary.
///
/// Snapshots are taken at the start of each round (after `GlobalTableRoundOpened`)
/// or at finalization (after `GlobalTableFinalized`). They capture all state
/// necessary to replay subsequent events.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoundSnapshot {
    pub game_type: GameType,
    pub round_id: u64,
    pub phase: GlobalTablePhase,
    pub phase_ends_at_ms: u64,
    pub main_point: u8,
    pub d1: u8,
    pub d2: u8,
    pub made_points_mask: u8,
    pub epoch_point_established: bool,
    pub field_paytable: u8,
    pub rng_commit: Vec<u8>,
    pub roll_seed: Vec<u8>,
    pub totals: Vec<GlobalTableTotal>,
}

impl RoundSnapshot {
    /// Create a snapshot from an existing round state.
    pub fn from_round(round: &GlobalTableRound) -> Self {
        Self {
            game_type: round.game_type,
            round_id: round.round_id,
            phase: round.phase,
            phase_ends_at_ms: round.phase_ends_at_ms,
            main_point: round.main_point,
            d1: round.d1,
            d2: round.d2,
            made_points_mask: round.made_points_mask,
            epoch_point_established: round.epoch_point_established,
            field_paytable: round.field_paytable,
            rng_commit: round.rng_commit.clone(),
            roll_seed: round.roll_seed.clone(),
            totals: round.totals.clone(),
        }
    }

    /// Reconstruct a `GlobalTableRound` from this snapshot.
    pub fn to_round(&self) -> GlobalTableRound {
        GlobalTableRound {
            game_type: self.game_type,
            round_id: self.round_id,
            phase: self.phase,
            phase_ends_at_ms: self.phase_ends_at_ms,
            main_point: self.main_point,
            d1: self.d1,
            d2: self.d2,
            made_points_mask: self.made_points_mask,
            epoch_point_established: self.epoch_point_established,
            field_paytable: self.field_paytable,
            rng_commit: self.rng_commit.clone(),
            roll_seed: self.roll_seed.clone(),
            totals: self.totals.clone(),
        }
    }

    /// Validate that this snapshot is well-formed.
    pub fn validate(&self) -> Result<(), ReplayError> {
        // RNG commit must be empty or 32 bytes
        if !self.rng_commit.is_empty() && self.rng_commit.len() != 32 {
            return Err(ReplayError::InvalidSnapshot(format!(
                "rng_commit has invalid length: {}",
                self.rng_commit.len()
            )));
        }
        // Roll seed must be empty or 32 bytes
        if !self.roll_seed.is_empty() && self.roll_seed.len() != 32 {
            return Err(ReplayError::InvalidSnapshot(format!(
                "roll_seed has invalid length: {}",
                self.roll_seed.len()
            )));
        }
        Ok(())
    }
}

/// Replay events from a snapshot to reconstruct round state.
///
/// This function applies a sequence of events to a snapshot, returning the
/// final round state. The events must be in order and consistent with the
/// snapshot's round_id and game_type.
///
/// # Arguments
///
/// * `snapshot` - Starting state (typically from `GlobalTableRoundOpened` or previous round)
/// * `events` - Ordered sequence of events to replay
///
/// # Returns
///
/// The reconstructed round state after applying all events.
pub fn replay_round_from_events(
    snapshot: &RoundSnapshot,
    events: &[Event],
) -> Result<GlobalTableRound, ReplayError> {
    snapshot.validate()?;
    let mut round = snapshot.to_round();

    for event in events {
        apply_event_to_round(&mut round, event)?;
    }

    Ok(round)
}

/// Apply a single event to the round state.
fn apply_event_to_round(round: &mut GlobalTableRound, event: &Event) -> Result<(), ReplayError> {
    match event {
        Event::GlobalTableRoundOpened { round: new_round } => {
            // This opens a new round; replace state entirely
            *round = new_round.clone();
        }

        Event::GlobalTableBetAccepted {
            player: _,
            round_id,
            bets,
            player_balances: _,
        } => {
            if *round_id != round.round_id {
                return Err(ReplayError::RoundMismatch {
                    expected: round.round_id,
                    got: *round_id,
                });
            }
            // Accumulate bets into totals
            accumulate_bets(&mut round.totals, bets);
        }

        Event::GlobalTableLocked {
            game_type,
            round_id,
            phase_ends_at_ms,
        } => {
            if *round_id != round.round_id {
                return Err(ReplayError::RoundMismatch {
                    expected: round.round_id,
                    got: *round_id,
                });
            }
            if *game_type != round.game_type {
                return Err(ReplayError::GameTypeMismatch {
                    expected: round.game_type,
                    got: *game_type,
                });
            }
            round.phase = GlobalTablePhase::Locked;
            round.phase_ends_at_ms = *phase_ends_at_ms;
        }

        Event::GlobalTableOutcome { round: outcome } => {
            if outcome.round_id != round.round_id {
                return Err(ReplayError::RoundMismatch {
                    expected: round.round_id,
                    got: outcome.round_id,
                });
            }
            if outcome.game_type != round.game_type {
                return Err(ReplayError::GameTypeMismatch {
                    expected: round.game_type,
                    got: outcome.game_type,
                });
            }
            // Outcome event carries the full revealed state including roll_seed
            round.phase = outcome.phase;
            round.phase_ends_at_ms = outcome.phase_ends_at_ms;
            round.roll_seed = outcome.roll_seed.clone();
            round.d1 = outcome.d1;
            round.d2 = outcome.d2;
            round.main_point = outcome.main_point;
            round.made_points_mask = outcome.made_points_mask;
            round.epoch_point_established = outcome.epoch_point_established;
        }

        Event::GlobalTablePlayerSettled {
            player: _,
            round_id,
            payout: _,
            player_balances: _,
            my_bets: _,
        } => {
            // Settlement events don't change round state directly
            if *round_id != round.round_id {
                return Err(ReplayError::RoundMismatch {
                    expected: round.round_id,
                    got: *round_id,
                });
            }
        }

        Event::GlobalTableFinalized { game_type, round_id } => {
            if *round_id != round.round_id {
                return Err(ReplayError::RoundMismatch {
                    expected: round.round_id,
                    got: *round_id,
                });
            }
            if *game_type != round.game_type {
                return Err(ReplayError::GameTypeMismatch {
                    expected: round.game_type,
                    got: *game_type,
                });
            }
            round.phase = GlobalTablePhase::Cooldown;
        }

        // Non-global-table events are ignored
        _ => {}
    }

    Ok(())
}

/// Accumulate bets into totals by (bet_type, target).
fn accumulate_bets(totals: &mut Vec<GlobalTableTotal>, bets: &[GlobalTableBet]) {
    for bet in bets {
        if let Some(existing) = totals
            .iter_mut()
            .find(|t| t.bet_type == bet.bet_type && t.target == bet.target)
        {
            existing.amount = existing.amount.saturating_add(bet.amount);
        } else {
            totals.push(GlobalTableTotal {
                bet_type: bet.bet_type,
                target: bet.target,
                amount: bet.amount,
            });
        }
    }
}

/// Extract events for a specific round from an event stream.
///
/// This filters the event stream to only include events relevant to the
/// specified game type and round ID.
pub fn filter_round_events(
    events: &[Event],
    game_type: GameType,
    round_id: u64,
) -> Vec<&Event> {
    events
        .iter()
        .filter(|event| match event {
            Event::GlobalTableRoundOpened { round } => {
                round.game_type == game_type && round.round_id == round_id
            }
            Event::GlobalTableBetAccepted {
                round_id: rid, ..
            } => *rid == round_id,
            Event::GlobalTableBetRejected {
                round_id: rid, ..
            } => *rid == round_id,
            Event::GlobalTableLocked {
                game_type: gt,
                round_id: rid,
                ..
            } => *gt == game_type && *rid == round_id,
            Event::GlobalTableOutcome { round } => {
                round.game_type == game_type && round.round_id == round_id
            }
            Event::GlobalTablePlayerSettled {
                round_id: rid, ..
            } => *rid == round_id,
            Event::GlobalTableFinalized {
                game_type: gt,
                round_id: rid,
            } => *gt == game_type && *rid == round_id,
            _ => false,
        })
        .collect()
}

/// Create an initial snapshot for a new round.
///
/// This is used when starting fresh without any prior state.
pub fn initial_snapshot(game_type: GameType) -> RoundSnapshot {
    RoundSnapshot {
        game_type,
        round_id: 0,
        phase: GlobalTablePhase::Cooldown,
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

#[cfg(test)]
mod tests {
    use super::*;
    use commonware_cryptography::ed25519::PublicKey;
    use commonware_math::algebra::Random as _;
    use nullspace_types::casino::PlayerBalanceSnapshot;

    fn test_public_key() -> PublicKey {
        use commonware_cryptography::Signer;
        use rand::{rngs::StdRng, SeedableRng};
        let mut rng = StdRng::seed_from_u64(12345);
        let private = commonware_cryptography::ed25519::PrivateKey::random(&mut rng);
        private.public_key()
    }

    fn test_player_balance() -> PlayerBalanceSnapshot {
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

    #[test]
    fn test_snapshot_round_trip() {
        let round = GlobalTableRound {
            game_type: GameType::Craps,
            round_id: 42,
            phase: GlobalTablePhase::Betting,
            phase_ends_at_ms: 30_000,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: 0,
            rng_commit: vec![0u8; 32],
            roll_seed: Vec::new(),
            totals: vec![GlobalTableTotal {
                bet_type: 1,
                target: 0,
                amount: 100,
            }],
        };

        let snapshot = RoundSnapshot::from_round(&round);
        let recovered = snapshot.to_round();

        assert_eq!(round, recovered);
    }

    #[test]
    fn test_snapshot_validation() {
        let mut snapshot = RoundSnapshot {
            game_type: GameType::Craps,
            round_id: 1,
            phase: GlobalTablePhase::Betting,
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
        };

        // Valid empty commit
        assert!(snapshot.validate().is_ok());

        // Valid 32-byte commit
        snapshot.rng_commit = vec![0u8; 32];
        assert!(snapshot.validate().is_ok());

        // Invalid commit length
        snapshot.rng_commit = vec![0u8; 16];
        assert!(snapshot.validate().is_err());
    }

    #[test]
    fn test_replay_bet_accepted() {
        let initial = RoundSnapshot {
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
            rng_commit: Vec::new(),
            roll_seed: Vec::new(),
            totals: Vec::new(),
        };

        let events = vec![Event::GlobalTableBetAccepted {
            player: test_public_key(),
            round_id: 1,
            bets: vec![
                GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                },
                GlobalTableBet {
                    bet_type: 2,
                    target: 7,
                    amount: 50,
                },
            ],
            player_balances: test_player_balance(),
        }];

        let round = replay_round_from_events(&initial, &events).unwrap();

        assert_eq!(round.totals.len(), 2);
        assert_eq!(round.totals[0].amount, 100);
        assert_eq!(round.totals[1].amount, 50);
    }

    #[test]
    fn test_replay_multiple_bets_accumulate() {
        let initial = RoundSnapshot {
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
            rng_commit: Vec::new(),
            roll_seed: Vec::new(),
            totals: Vec::new(),
        };

        let events = vec![
            Event::GlobalTableBetAccepted {
                player: test_public_key(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_player_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: test_public_key(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 50,
                }],
                player_balances: test_player_balance(),
            },
        ];

        let round = replay_round_from_events(&initial, &events).unwrap();

        // Bets on same (bet_type, target) should accumulate
        assert_eq!(round.totals.len(), 1);
        assert_eq!(round.totals[0].amount, 150);
    }

    #[test]
    fn test_replay_phase_transitions() {
        let initial = RoundSnapshot {
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
            rng_commit: Vec::new(),
            roll_seed: Vec::new(),
            totals: Vec::new(),
        };

        let events = vec![
            Event::GlobalTableLocked {
                game_type: GameType::Craps,
                round_id: 1,
                phase_ends_at_ms: 35_000,
            },
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
                    rng_commit: vec![0u8; 32],
                    roll_seed: vec![1u8; 32],
                    totals: Vec::new(),
                },
            },
            Event::GlobalTableFinalized {
                game_type: GameType::Craps,
                round_id: 1,
            },
        ];

        let round = replay_round_from_events(&initial, &events).unwrap();

        assert_eq!(round.phase, GlobalTablePhase::Cooldown);
        assert_eq!(round.d1, 4);
        assert_eq!(round.d2, 3);
        assert_eq!(round.roll_seed.len(), 32);
    }

    #[test]
    fn test_replay_round_mismatch_error() {
        let initial = RoundSnapshot {
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
            rng_commit: Vec::new(),
            roll_seed: Vec::new(),
            totals: Vec::new(),
        };

        let events = vec![Event::GlobalTableBetAccepted {
            player: test_public_key(),
            round_id: 2, // Wrong round!
            bets: vec![],
            player_balances: test_player_balance(),
        }];

        let result = replay_round_from_events(&initial, &events);
        assert!(matches!(result, Err(ReplayError::RoundMismatch { .. })));
    }

    #[test]
    fn test_filter_round_events() {
        let events = vec![
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
                    rng_commit: Vec::new(),
                    roll_seed: Vec::new(),
                    totals: Vec::new(),
                },
            },
            Event::GlobalTableBetAccepted {
                player: test_public_key(),
                round_id: 1,
                bets: vec![],
                player_balances: test_player_balance(),
            },
            Event::GlobalTableBetAccepted {
                player: test_public_key(),
                round_id: 2, // Different round
                bets: vec![],
                player_balances: test_player_balance(),
            },
            Event::GlobalTableFinalized {
                game_type: GameType::Craps,
                round_id: 1,
            },
        ];

        let filtered = filter_round_events(&events, GameType::Craps, 1);
        assert_eq!(filtered.len(), 3); // Excludes round 2 event
    }

    #[test]
    fn test_replay_full_round_lifecycle() {
        // Start from initial state (round 0, cooldown)
        let initial = initial_snapshot(GameType::Craps);

        // Events for a complete round
        let events = vec![
            // Round opens
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
                    rng_commit: Vec::new(),
                    roll_seed: Vec::new(),
                    totals: Vec::new(),
                },
            },
            // Bets placed
            Event::GlobalTableBetAccepted {
                player: test_public_key(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_player_balance(),
            },
            // Locked
            Event::GlobalTableLocked {
                game_type: GameType::Craps,
                round_id: 1,
                phase_ends_at_ms: 35_000,
            },
            // Outcome (dice rolled)
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
                    rng_commit: vec![0xAB; 32],
                    roll_seed: vec![0xCD; 32],
                    totals: vec![GlobalTableTotal {
                        bet_type: 1,
                        target: 0,
                        amount: 100,
                    }],
                },
            },
            // Player settled
            Event::GlobalTablePlayerSettled {
                player: test_public_key(),
                round_id: 1,
                payout: 100,
                player_balances: PlayerBalanceSnapshot {
                    chips: 1100,
                    vusdt_balance: 0,
                    shields: 0,
                    doubles: 0,
                    tournament_chips: 0,
                    tournament_shields: 0,
                    tournament_doubles: 0,
                    active_tournament: None,
                },
                my_bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
            },
            // Finalized
            Event::GlobalTableFinalized {
                game_type: GameType::Craps,
                round_id: 1,
            },
        ];

        let round = replay_round_from_events(&initial, &events).unwrap();

        assert_eq!(round.round_id, 1);
        assert_eq!(round.phase, GlobalTablePhase::Cooldown);
        assert_eq!(round.d1, 4);
        assert_eq!(round.d2, 3);
        assert_eq!(round.roll_seed, vec![0xCD; 32]);
        // Totals come from outcome event
        assert_eq!(round.totals.len(), 1);
        assert_eq!(round.totals[0].amount, 100);
    }

    #[test]
    fn test_deterministic_replay() {
        // Same events replayed twice should produce identical state
        let initial = initial_snapshot(GameType::Craps);

        let events = vec![
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
                    rng_commit: Vec::new(),
                    roll_seed: Vec::new(),
                    totals: Vec::new(),
                },
            },
            Event::GlobalTableBetAccepted {
                player: test_public_key(),
                round_id: 1,
                bets: vec![GlobalTableBet {
                    bet_type: 1,
                    target: 0,
                    amount: 100,
                }],
                player_balances: test_player_balance(),
            },
        ];

        let round1 = replay_round_from_events(&initial, &events).unwrap();
        let round2 = replay_round_from_events(&initial, &events).unwrap();

        assert_eq!(round1, round2);
    }
}
