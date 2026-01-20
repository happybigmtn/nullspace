//! Round scheduler state machine for table games.
//!
//! This module provides a deterministic state machine for managing round phases
//! in table games. It encapsulates the phase transition logic, timing calculations,
//! and state validation separately from storage/I/O concerns.
//!
//! ## Phases
//!
//! A round progresses through five phases:
//! 1. **Betting** - Players can place bets
//! 2. **Locked** - Betting closed, RNG commit published
//! 3. **Rolling** - RNG revealed, outcome determined
//! 4. **Payout** - Winners settled, payouts processed
//! 5. **Cooldown** - Rest period before next round
//!
//! ## Deterministic Clock
//!
//! All timing is based on `view * MS_PER_VIEW` where `view` is the consensus view
//! number. This ensures deterministic behavior across all nodes.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use nullspace_execution::round_scheduler::{RoundScheduler, PhaseConfig};
//!
//! let config = PhaseConfig {
//!     betting_ms: 30_000,  // 30 seconds
//!     lock_ms: 5_000,      // 5 seconds
//!     payout_ms: 10_000,   // 10 seconds
//!     cooldown_ms: 5_000,  // 5 seconds
//! };
//!
//! let mut scheduler = RoundScheduler::new(config);
//!
//! // Start a new round at view 100
//! let now_ms = 100 * 1000; // view 100 * 1000 ms/view
//! scheduler.start_round(1, now_ms);
//!
//! // Check current phase
//! assert_eq!(scheduler.current_phase(), Phase::Betting);
//! assert!(scheduler.is_betting_open(now_ms));
//!
//! // Later, check if we should transition
//! let later_ms = now_ms + 31_000;
//! if scheduler.should_transition(later_ms) {
//!     scheduler.advance_to_locked(later_ms);
//! }
//! ```

use nullspace_types::casino::{GlobalTableConfig, GlobalTablePhase};

/// Milliseconds per consensus view (1 second per view).
pub const MS_PER_VIEW: u64 = 1_000;

/// Phase configuration with durations in milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhaseConfig {
    /// Duration of the betting phase in milliseconds.
    pub betting_ms: u64,
    /// Duration of the lock phase in milliseconds.
    pub lock_ms: u64,
    /// Duration of the payout phase in milliseconds.
    pub payout_ms: u64,
    /// Duration of the cooldown phase in milliseconds.
    pub cooldown_ms: u64,
}

impl PhaseConfig {
    /// Create a new phase configuration with the given durations.
    pub fn new(betting_ms: u64, lock_ms: u64, payout_ms: u64, cooldown_ms: u64) -> Self {
        Self {
            betting_ms,
            lock_ms,
            payout_ms,
            cooldown_ms,
        }
    }

    /// Validate the configuration (all durations must be > 0).
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.betting_ms == 0 {
            return Err("betting_ms must be greater than zero");
        }
        if self.lock_ms == 0 {
            return Err("lock_ms must be greater than zero");
        }
        if self.payout_ms == 0 {
            return Err("payout_ms must be greater than zero");
        }
        if self.cooldown_ms == 0 {
            return Err("cooldown_ms must be greater than zero");
        }
        Ok(())
    }

    /// Get the duration for a specific phase.
    pub fn duration_for_phase(&self, phase: GlobalTablePhase) -> u64 {
        match phase {
            GlobalTablePhase::Betting => self.betting_ms,
            GlobalTablePhase::Locked => self.lock_ms,
            GlobalTablePhase::Rolling => 0, // Rolling is instant
            GlobalTablePhase::Payout => self.payout_ms,
            GlobalTablePhase::Cooldown => self.cooldown_ms,
        }
    }

    /// Calculate total round duration in milliseconds.
    pub fn total_round_duration_ms(&self) -> u64 {
        self.betting_ms
            .saturating_add(self.lock_ms)
            .saturating_add(self.payout_ms)
            .saturating_add(self.cooldown_ms)
    }
}

impl From<&GlobalTableConfig> for PhaseConfig {
    fn from(config: &GlobalTableConfig) -> Self {
        Self {
            betting_ms: config.betting_ms,
            lock_ms: config.lock_ms,
            payout_ms: config.payout_ms,
            cooldown_ms: config.cooldown_ms,
        }
    }
}

/// Result of a phase transition check.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransitionResult {
    /// No transition needed, remain in current phase.
    NoTransition,
    /// Transition to the specified phase with the given end time.
    TransitionTo {
        phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
    },
}

/// Pure state machine for round phase management.
///
/// This struct provides deterministic phase transition logic without any I/O.
/// It can be used to:
/// - Determine if a phase transition is due
/// - Calculate the next phase and its end time
/// - Validate whether an action is allowed in the current phase
#[derive(Clone, Debug)]
pub struct RoundScheduler {
    config: PhaseConfig,
}

impl RoundScheduler {
    /// Create a new round scheduler with the given configuration.
    pub fn new(config: PhaseConfig) -> Self {
        Self { config }
    }

    /// Get the phase configuration.
    pub fn config(&self) -> &PhaseConfig {
        &self.config
    }

    /// Determine the next phase after the given phase.
    ///
    /// Returns `None` if the phase is `Cooldown` (end of round).
    pub fn next_phase(phase: GlobalTablePhase) -> Option<GlobalTablePhase> {
        match phase {
            GlobalTablePhase::Betting => Some(GlobalTablePhase::Locked),
            GlobalTablePhase::Locked => Some(GlobalTablePhase::Rolling),
            GlobalTablePhase::Rolling => Some(GlobalTablePhase::Payout),
            GlobalTablePhase::Payout => Some(GlobalTablePhase::Cooldown),
            GlobalTablePhase::Cooldown => None,
        }
    }

    /// Check if a transition from the current phase is due.
    ///
    /// A transition is due when:
    /// - Current time >= phase_ends_at_ms
    /// - The phase is not Cooldown (which requires explicit round restart)
    pub fn check_transition(
        &self,
        current_phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
        now_ms: u64,
    ) -> TransitionResult {
        // Not time yet
        if now_ms < phase_ends_at_ms {
            return TransitionResult::NoTransition;
        }

        // Get the next phase
        let next_phase = match Self::next_phase(current_phase) {
            Some(p) => p,
            None => return TransitionResult::NoTransition, // Cooldown, wait for new round
        };

        // Calculate end time for next phase
        let next_duration = self.config.duration_for_phase(next_phase);
        let next_ends_at = now_ms.saturating_add(next_duration);

        TransitionResult::TransitionTo {
            phase: next_phase,
            phase_ends_at_ms: next_ends_at,
        }
    }

    /// Calculate the end time for starting a new round's betting phase.
    pub fn betting_phase_end_time(&self, start_time_ms: u64) -> u64 {
        start_time_ms.saturating_add(self.config.betting_ms)
    }

    /// Check if betting is currently allowed.
    pub fn is_betting_open(
        &self,
        current_phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
        now_ms: u64,
    ) -> bool {
        matches!(current_phase, GlobalTablePhase::Betting) && now_ms < phase_ends_at_ms
    }

    /// Check if we can start a new round.
    ///
    /// A new round can start when:
    /// - Round ID is 0 (first round ever)
    /// - Current phase is Cooldown AND current time >= phase_ends_at_ms
    pub fn can_start_new_round(
        &self,
        round_id: u64,
        current_phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
        now_ms: u64,
    ) -> bool {
        round_id == 0
            || (matches!(current_phase, GlobalTablePhase::Cooldown) && now_ms >= phase_ends_at_ms)
    }

    /// Calculate timing for a new round.
    ///
    /// Returns the phase_ends_at_ms for the Betting phase.
    pub fn new_round_timing(&self, start_time_ms: u64) -> u64 {
        self.betting_phase_end_time(start_time_ms)
    }

    /// Check if we can transition from Betting to Locked phase.
    pub fn can_lock(
        &self,
        current_phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
        now_ms: u64,
    ) -> bool {
        matches!(current_phase, GlobalTablePhase::Betting) && now_ms >= phase_ends_at_ms
    }

    /// Calculate timing for the Locked phase.
    pub fn locked_phase_timing(&self, now_ms: u64) -> u64 {
        now_ms.saturating_add(self.config.lock_ms)
    }

    /// Check if we can transition from Locked to Rolling/Payout phase.
    pub fn can_reveal(
        &self,
        current_phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
        now_ms: u64,
    ) -> bool {
        matches!(current_phase, GlobalTablePhase::Locked) && now_ms >= phase_ends_at_ms
    }

    /// Calculate timing for the Payout phase (Rolling is instantaneous).
    pub fn payout_phase_timing(&self, now_ms: u64) -> u64 {
        now_ms.saturating_add(self.config.payout_ms)
    }

    /// Check if we can finalize (transition from Payout to Cooldown).
    pub fn can_finalize(
        &self,
        current_phase: GlobalTablePhase,
        phase_ends_at_ms: u64,
        now_ms: u64,
    ) -> bool {
        matches!(current_phase, GlobalTablePhase::Payout) && now_ms >= phase_ends_at_ms
    }

    /// Calculate timing for the Cooldown phase.
    pub fn cooldown_phase_timing(&self, now_ms: u64) -> u64 {
        now_ms.saturating_add(self.config.cooldown_ms)
    }

    /// Check if settlement is allowed.
    ///
    /// Settlement can happen during Payout or Cooldown phases.
    pub fn can_settle(&self, current_phase: GlobalTablePhase) -> bool {
        matches!(
            current_phase,
            GlobalTablePhase::Payout | GlobalTablePhase::Cooldown
        )
    }
}

/// Convert a view number to milliseconds using the deterministic clock.
#[inline]
pub fn view_to_ms(view: u64) -> u64 {
    view.saturating_mul(MS_PER_VIEW)
}

/// Convert milliseconds to view number (rounded down).
#[inline]
pub fn ms_to_view(ms: u64) -> u64 {
    ms / MS_PER_VIEW
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> PhaseConfig {
        PhaseConfig {
            betting_ms: 30_000,  // 30 seconds
            lock_ms: 5_000,      // 5 seconds
            payout_ms: 10_000,   // 10 seconds
            cooldown_ms: 5_000,  // 5 seconds
        }
    }

    #[test]
    fn test_phase_config_validation() {
        let valid = test_config();
        assert!(valid.validate().is_ok());

        let invalid_betting = PhaseConfig { betting_ms: 0, ..valid };
        assert!(invalid_betting.validate().is_err());

        let invalid_lock = PhaseConfig { lock_ms: 0, ..valid };
        assert!(invalid_lock.validate().is_err());

        let invalid_payout = PhaseConfig { payout_ms: 0, ..valid };
        assert!(invalid_payout.validate().is_err());

        let invalid_cooldown = PhaseConfig { cooldown_ms: 0, ..valid };
        assert!(invalid_cooldown.validate().is_err());
    }

    #[test]
    fn test_phase_config_duration_for_phase() {
        let config = test_config();
        assert_eq!(config.duration_for_phase(GlobalTablePhase::Betting), 30_000);
        assert_eq!(config.duration_for_phase(GlobalTablePhase::Locked), 5_000);
        assert_eq!(config.duration_for_phase(GlobalTablePhase::Rolling), 0);
        assert_eq!(config.duration_for_phase(GlobalTablePhase::Payout), 10_000);
        assert_eq!(config.duration_for_phase(GlobalTablePhase::Cooldown), 5_000);
    }

    #[test]
    fn test_phase_config_total_duration() {
        let config = test_config();
        // 30 + 5 + 10 + 5 = 50 seconds
        assert_eq!(config.total_round_duration_ms(), 50_000);
    }

    #[test]
    fn test_next_phase() {
        assert_eq!(
            RoundScheduler::next_phase(GlobalTablePhase::Betting),
            Some(GlobalTablePhase::Locked)
        );
        assert_eq!(
            RoundScheduler::next_phase(GlobalTablePhase::Locked),
            Some(GlobalTablePhase::Rolling)
        );
        assert_eq!(
            RoundScheduler::next_phase(GlobalTablePhase::Rolling),
            Some(GlobalTablePhase::Payout)
        );
        assert_eq!(
            RoundScheduler::next_phase(GlobalTablePhase::Payout),
            Some(GlobalTablePhase::Cooldown)
        );
        assert_eq!(
            RoundScheduler::next_phase(GlobalTablePhase::Cooldown),
            None
        );
    }

    #[test]
    fn test_check_transition_not_time_yet() {
        let scheduler = RoundScheduler::new(test_config());
        let result = scheduler.check_transition(
            GlobalTablePhase::Betting,
            100_000, // ends at 100 seconds
            50_000,  // current time 50 seconds
        );
        assert_eq!(result, TransitionResult::NoTransition);
    }

    #[test]
    fn test_check_transition_betting_to_locked() {
        let scheduler = RoundScheduler::new(test_config());
        let now_ms = 100_000;
        let result = scheduler.check_transition(
            GlobalTablePhase::Betting,
            100_000, // ends at 100 seconds
            now_ms,  // exactly at end time
        );
        assert_eq!(
            result,
            TransitionResult::TransitionTo {
                phase: GlobalTablePhase::Locked,
                phase_ends_at_ms: now_ms + 5_000, // lock_ms
            }
        );
    }

    #[test]
    fn test_check_transition_locked_to_rolling() {
        let scheduler = RoundScheduler::new(test_config());
        let now_ms = 105_000;
        let result = scheduler.check_transition(
            GlobalTablePhase::Locked,
            105_000,
            now_ms,
        );
        assert_eq!(
            result,
            TransitionResult::TransitionTo {
                phase: GlobalTablePhase::Rolling,
                phase_ends_at_ms: now_ms, // Rolling is instant (0 duration)
            }
        );
    }

    #[test]
    fn test_check_transition_cooldown_no_transition() {
        let scheduler = RoundScheduler::new(test_config());
        let result = scheduler.check_transition(
            GlobalTablePhase::Cooldown,
            100_000,
            150_000, // well past end time
        );
        // Cooldown never auto-transitions; requires explicit new round
        assert_eq!(result, TransitionResult::NoTransition);
    }

    #[test]
    fn test_is_betting_open() {
        let scheduler = RoundScheduler::new(test_config());

        // Betting phase, before end time
        assert!(scheduler.is_betting_open(GlobalTablePhase::Betting, 100_000, 50_000));

        // Betting phase, at end time (not open)
        assert!(!scheduler.is_betting_open(GlobalTablePhase::Betting, 100_000, 100_000));

        // Wrong phase
        assert!(!scheduler.is_betting_open(GlobalTablePhase::Locked, 100_000, 50_000));
    }

    #[test]
    fn test_can_start_new_round() {
        let scheduler = RoundScheduler::new(test_config());

        // First round ever (round_id == 0)
        assert!(scheduler.can_start_new_round(0, GlobalTablePhase::Cooldown, 0, 0));

        // Cooldown ended
        assert!(scheduler.can_start_new_round(
            1,
            GlobalTablePhase::Cooldown,
            100_000,
            100_000
        ));

        // Cooldown not ended yet
        assert!(!scheduler.can_start_new_round(
            1,
            GlobalTablePhase::Cooldown,
            100_000,
            50_000
        ));

        // Wrong phase
        assert!(!scheduler.can_start_new_round(
            1,
            GlobalTablePhase::Betting,
            100_000,
            150_000
        ));
    }

    #[test]
    fn test_can_lock() {
        let scheduler = RoundScheduler::new(test_config());

        // Betting ended
        assert!(scheduler.can_lock(GlobalTablePhase::Betting, 100_000, 100_000));

        // Betting not ended
        assert!(!scheduler.can_lock(GlobalTablePhase::Betting, 100_000, 50_000));

        // Wrong phase
        assert!(!scheduler.can_lock(GlobalTablePhase::Locked, 100_000, 150_000));
    }

    #[test]
    fn test_can_reveal() {
        let scheduler = RoundScheduler::new(test_config());

        // Lock ended
        assert!(scheduler.can_reveal(GlobalTablePhase::Locked, 105_000, 105_000));

        // Lock not ended
        assert!(!scheduler.can_reveal(GlobalTablePhase::Locked, 105_000, 100_000));

        // Wrong phase
        assert!(!scheduler.can_reveal(GlobalTablePhase::Betting, 105_000, 110_000));
    }

    #[test]
    fn test_can_finalize() {
        let scheduler = RoundScheduler::new(test_config());

        // Payout ended
        assert!(scheduler.can_finalize(GlobalTablePhase::Payout, 115_000, 115_000));

        // Payout not ended
        assert!(!scheduler.can_finalize(GlobalTablePhase::Payout, 115_000, 110_000));

        // Wrong phase
        assert!(!scheduler.can_finalize(GlobalTablePhase::Locked, 115_000, 120_000));
    }

    #[test]
    fn test_can_settle() {
        let scheduler = RoundScheduler::new(test_config());

        assert!(scheduler.can_settle(GlobalTablePhase::Payout));
        assert!(scheduler.can_settle(GlobalTablePhase::Cooldown));
        assert!(!scheduler.can_settle(GlobalTablePhase::Betting));
        assert!(!scheduler.can_settle(GlobalTablePhase::Locked));
        assert!(!scheduler.can_settle(GlobalTablePhase::Rolling));
    }

    #[test]
    fn test_view_to_ms() {
        assert_eq!(view_to_ms(0), 0);
        assert_eq!(view_to_ms(1), 1_000);
        assert_eq!(view_to_ms(100), 100_000);
    }

    #[test]
    fn test_ms_to_view() {
        assert_eq!(ms_to_view(0), 0);
        assert_eq!(ms_to_view(1_000), 1);
        assert_eq!(ms_to_view(1_500), 1); // rounds down
        assert_eq!(ms_to_view(100_000), 100);
    }

    #[test]
    fn test_full_round_cycle() {
        let scheduler = RoundScheduler::new(test_config());
        let mut now_ms = 0u64;
        let mut phase = GlobalTablePhase::Cooldown;
        let mut phase_ends_at_ms = 0u64;

        // Start new round
        assert!(scheduler.can_start_new_round(0, phase, phase_ends_at_ms, now_ms));
        phase = GlobalTablePhase::Betting;
        phase_ends_at_ms = scheduler.new_round_timing(now_ms);
        assert_eq!(phase_ends_at_ms, 30_000);

        // Advance time past betting
        now_ms = 30_000;
        assert!(scheduler.can_lock(phase, phase_ends_at_ms, now_ms));
        phase = GlobalTablePhase::Locked;
        phase_ends_at_ms = scheduler.locked_phase_timing(now_ms);
        assert_eq!(phase_ends_at_ms, 35_000);

        // Advance time past lock
        now_ms = 35_000;
        assert!(scheduler.can_reveal(phase, phase_ends_at_ms, now_ms));
        phase = GlobalTablePhase::Payout; // Rolling is instant
        phase_ends_at_ms = scheduler.payout_phase_timing(now_ms);
        assert_eq!(phase_ends_at_ms, 45_000);

        // Advance time past payout
        now_ms = 45_000;
        assert!(scheduler.can_finalize(phase, phase_ends_at_ms, now_ms));
        phase = GlobalTablePhase::Cooldown;
        phase_ends_at_ms = scheduler.cooldown_phase_timing(now_ms);
        assert_eq!(phase_ends_at_ms, 50_000);

        // Advance past cooldown, can start new round
        now_ms = 50_000;
        assert!(scheduler.can_start_new_round(1, phase, phase_ends_at_ms, now_ms));
    }

    #[test]
    fn test_phase_config_from_global_table_config() {
        let gtc = GlobalTableConfig {
            game_type: nullspace_types::casino::GameType::Craps,
            betting_ms: 20_000,
            lock_ms: 3_000,
            payout_ms: 8_000,
            cooldown_ms: 4_000,
            min_bet: 100,
            max_bet: 10_000,
            max_bets_per_round: 10,
        };
        let config = PhaseConfig::from(&gtc);
        assert_eq!(config.betting_ms, 20_000);
        assert_eq!(config.lock_ms, 3_000);
        assert_eq!(config.payout_ms, 8_000);
        assert_eq!(config.cooldown_ms, 4_000);
    }

    #[test]
    fn test_deterministic_timing() {
        // Ensure same inputs always produce same outputs
        let scheduler = RoundScheduler::new(test_config());

        for i in 0..100 {
            let start = i * 1000;
            assert_eq!(
                scheduler.betting_phase_end_time(start),
                start + 30_000
            );
            assert_eq!(
                scheduler.locked_phase_timing(start),
                start + 5_000
            );
            assert_eq!(
                scheduler.payout_phase_timing(start),
                start + 10_000
            );
            assert_eq!(
                scheduler.cooldown_phase_timing(start),
                start + 5_000
            );
        }
    }

    #[test]
    fn test_overflow_protection() {
        let config = PhaseConfig {
            betting_ms: u64::MAX,
            lock_ms: u64::MAX,
            payout_ms: u64::MAX,
            cooldown_ms: u64::MAX,
        };
        let scheduler = RoundScheduler::new(config);

        // Should saturate instead of overflow
        let result = scheduler.betting_phase_end_time(u64::MAX);
        assert_eq!(result, u64::MAX);

        let result = scheduler.check_transition(
            GlobalTablePhase::Betting,
            0,
            u64::MAX,
        );
        match result {
            TransitionResult::TransitionTo { phase_ends_at_ms, .. } => {
                assert_eq!(phase_ends_at_ms, u64::MAX);
            }
            _ => panic!("Expected transition"),
        }
    }
}
