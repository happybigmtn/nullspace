//! L2 Deal Plan Builder with shuffle context binding.
//!
//! This module provides [`DealPlanBuilder`] for constructing deal plans that are
//! cryptographically bound to their [`ShuffleContext`]. This binding ensures that:
//!
//! 1. A deal plan is only valid for the specific table, hand, and seat configuration
//!    it was created for.
//! 2. Changing any context parameter invalidates the deal plan.
//! 3. Verifiers can deterministically reconstruct and verify the context binding.
//!
//! # Security Model
//!
//! The deal plan builder enforces shuffle context binding by:
//! - Requiring a valid [`ShuffleContext`] at construction time
//! - Including the context hash in the deal plan's commitment
//! - Validating card assignments against the context's `deck_length` and `seat_order`
//!
//! # Usage
//!
//! ```
//! use codexpoker::l2::{DealPlanBuilder, CardAssignment};
//! use protocol_messages::{ProtocolVersion, ShuffleContext};
//!
//! // Create shuffle context for this hand
//! let context = ShuffleContext::new(
//!     ProtocolVersion::current(),
//!     [1u8; 32],  // table_id
//!     42,          // hand_id
//!     vec![0, 1],  // seat_order (2 players)
//!     52,          // deck_length
//! );
//!
//! // Build the deal plan
//! let plan = DealPlanBuilder::new(context)
//!     .assign_hole_cards(0, vec![0, 1])   // Player at seat 0 gets cards 0, 1
//!     .assign_hole_cards(1, vec![2, 3])   // Player at seat 1 gets cards 2, 3
//!     .assign_community(vec![4, 5, 6, 7, 8])  // Community cards
//!     .build()
//!     .expect("valid deal plan");
//!
//! // The plan's context hash binds it to this specific game state
//! assert_eq!(plan.context_hash(), plan.context().context_hash());
//! ```
//!
//! # Verification Flow
//!
//! When verifying a deal plan:
//! 1. Reconstruct the expected [`ShuffleContext`] from current game state
//! 2. Compare the plan's `context_hash()` against the expected context's hash
//! 3. Reject if hashes don't match (prevents replay/substitution attacks)

use protocol_messages::ShuffleContext;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur when building a deal plan.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DealPlanError {
    /// Card index exceeds deck length.
    #[error("card index {index} exceeds deck length {deck_length}")]
    CardIndexOutOfBounds { index: u8, deck_length: u8 },

    /// Seat index not in shuffle context's seat order.
    #[error("seat {seat} not in seat order: {seat_order:?}")]
    InvalidSeat { seat: u8, seat_order: Vec<u8> },

    /// Duplicate card assignment.
    #[error("card {index} already assigned")]
    DuplicateCardAssignment { index: u8 },

    /// Missing hole card assignments.
    #[error("missing hole card assignments for seats: {missing:?}")]
    MissingHoleCards { missing: Vec<u8> },

    /// Missing community card assignments.
    #[error("community cards not assigned")]
    MissingCommunityCards,

    /// Wrong number of hole cards for a seat.
    #[error("seat {seat} has {count} hole cards, expected {expected}")]
    WrongHoleCardCount { seat: u8, count: usize, expected: usize },

    /// Wrong number of community cards.
    #[error("expected {expected} community cards, got {count}")]
    WrongCommunityCardCount { count: usize, expected: usize },
}

/// Assignment of cards to a specific purpose in the deal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CardAssignment {
    /// Hole cards for a specific seat.
    HoleCards { seat: u8, indices: Vec<u8> },
    /// Community cards (flop, turn, river).
    Community { indices: Vec<u8> },
    /// Burn cards (discarded before each street).
    Burn { indices: Vec<u8> },
}

impl CardAssignment {
    /// Get all card indices in this assignment.
    pub fn indices(&self) -> &[u8] {
        match self {
            CardAssignment::HoleCards { indices, .. } => indices,
            CardAssignment::Community { indices } => indices,
            CardAssignment::Burn { indices } => indices,
        }
    }
}

/// A complete deal plan bound to a shuffle context.
///
/// The deal plan specifies:
/// - The shuffle context (table, hand, seats, deck configuration)
/// - Card assignments (which cards go to which positions)
///
/// # Context Binding
///
/// The plan's `context_hash()` cryptographically binds it to its shuffle context.
/// Any attempt to use this plan with a different context will fail verification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DealPlan {
    /// The shuffle context this plan is bound to.
    context: ShuffleContext,
    /// Card assignments for this deal.
    assignments: Vec<CardAssignment>,
}

impl DealPlan {
    /// Get the shuffle context this plan is bound to.
    pub fn context(&self) -> &ShuffleContext {
        &self.context
    }

    /// Get the canonical hash of the shuffle context.
    ///
    /// This hash is used for binding and verification. Verifiers must compute
    /// the expected context hash and compare against this value.
    pub fn context_hash(&self) -> [u8; 32] {
        self.context.context_hash()
    }

    /// Get all card assignments in this plan.
    pub fn assignments(&self) -> &[CardAssignment] {
        &self.assignments
    }

    /// Get hole card assignments for a specific seat.
    pub fn hole_cards_for_seat(&self, seat: u8) -> Option<&[u8]> {
        self.assignments.iter().find_map(|a| match a {
            CardAssignment::HoleCards { seat: s, indices } if *s == seat => Some(indices.as_slice()),
            _ => None,
        })
    }

    /// Get community card indices.
    pub fn community_cards(&self) -> Option<&[u8]> {
        self.assignments.iter().find_map(|a| match a {
            CardAssignment::Community { indices } => Some(indices.as_slice()),
            _ => None,
        })
    }

    /// Get burn card indices.
    pub fn burn_cards(&self) -> Option<&[u8]> {
        self.assignments.iter().find_map(|a| match a {
            CardAssignment::Burn { indices } => Some(indices.as_slice()),
            _ => None,
        })
    }

    /// Verify that this plan's context matches an expected context.
    ///
    /// Returns `Ok(())` if the context hashes match, or an error describing
    /// the mismatch.
    pub fn verify_context(
        &self,
        expected: &ShuffleContext,
    ) -> Result<(), protocol_messages::ShuffleContextMismatch> {
        self.context.verify_matches(expected)
    }

    /// Get all card indices used in this plan.
    pub fn all_card_indices(&self) -> Vec<u8> {
        let mut indices = Vec::new();
        for assignment in &self.assignments {
            indices.extend_from_slice(assignment.indices());
        }
        indices
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Selective Reveal: Phase-to-Card-Indices Mapping
    // ─────────────────────────────────────────────────────────────────────────
    //
    // These methods enable selective reveal by returning only the card indices
    // required for each reveal phase, replacing full-deck reveals with minimal
    // disclosure.

    /// Get the card indices for the flop (first 3 community cards).
    ///
    /// # Returns
    ///
    /// - `Some([idx0, idx1, idx2])` if community cards are assigned and have at least 3 cards
    /// - `None` if community cards are not assigned or have fewer than 3 cards
    ///
    /// # Selective Reveal
    ///
    /// During the Flop phase, only these 3 card indices should be revealed,
    /// not the entire deck. This enforces minimal disclosure.
    pub fn flop_indices(&self) -> Option<[u8; 3]> {
        let community = self.community_cards()?;
        if community.len() >= 3 {
            Some([community[0], community[1], community[2]])
        } else {
            None
        }
    }

    /// Get the card index for the turn (4th community card).
    ///
    /// # Returns
    ///
    /// - `Some(idx)` if community cards are assigned and have at least 4 cards
    /// - `None` if community cards are not assigned or have fewer than 4 cards
    ///
    /// # Selective Reveal
    ///
    /// During the Turn phase, only this single card index should be revealed.
    pub fn turn_index(&self) -> Option<u8> {
        let community = self.community_cards()?;
        if community.len() >= 4 {
            Some(community[3])
        } else {
            None
        }
    }

    /// Get the card index for the river (5th community card).
    ///
    /// # Returns
    ///
    /// - `Some(idx)` if community cards are assigned and have at least 5 cards
    /// - `None` if community cards are not assigned or have fewer than 5 cards
    ///
    /// # Selective Reveal
    ///
    /// During the River phase, only this single card index should be revealed.
    pub fn river_index(&self) -> Option<u8> {
        let community = self.community_cards()?;
        if community.len() >= 5 {
            Some(community[4])
        } else {
            None
        }
    }

    /// Get all seats that have hole card assignments.
    pub fn seats_with_hole_cards(&self) -> Vec<u8> {
        self.assignments
            .iter()
            .filter_map(|a| match a {
                CardAssignment::HoleCards { seat, .. } => Some(*seat),
                _ => None,
            })
            .collect()
    }

    /// Get all hole card indices across all seats.
    ///
    /// Returns a vector of (seat, indices) pairs.
    ///
    /// # Selective Reveal
    ///
    /// During Preflop, each player reveals only their own hole cards.
    /// During Showdown, players still in the hand reveal their hole cards.
    pub fn all_hole_cards(&self) -> Vec<(u8, &[u8])> {
        self.assignments
            .iter()
            .filter_map(|a| match a {
                CardAssignment::HoleCards { seat, indices } => Some((*seat, indices.as_slice())),
                _ => None,
            })
            .collect()
    }

    /// Get card indices for a specific reveal phase.
    ///
    /// # Arguments
    ///
    /// * `phase` - The reveal phase to get indices for
    /// * `showdown_seats` - For `Showdown` phase, which seats should reveal
    ///   (only players still in the hand). If `None`, reveals all seats.
    ///
    /// # Returns
    ///
    /// Card indices that should be revealed for the given phase.
    ///
    /// # Phase Mapping
    ///
    /// - `Preflop`: Empty (hole cards are revealed privately per-seat, not via this method)
    /// - `Flop`: First 3 community card indices
    /// - `Turn`: 4th community card index
    /// - `River`: 5th community card index
    /// - `Showdown`: Hole card indices for specified seats (or all seats if `None`)
    ///
    /// # Note on Preflop
    ///
    /// Preflop hole card reveals are handled per-seat, not as a single reveal.
    /// Use [`hole_cards_for_seat`](Self::hole_cards_for_seat) for preflop reveals.
    pub fn card_indices_for_phase(
        &self,
        phase: protocol_messages::RevealPhase,
        showdown_seats: Option<&[u8]>,
    ) -> Vec<u8> {
        use protocol_messages::RevealPhase;

        match phase {
            RevealPhase::Preflop => {
                // Preflop hole cards are revealed per-seat privately.
                // This method returns empty; callers should use hole_cards_for_seat.
                Vec::new()
            }
            RevealPhase::Flop => self.flop_indices().map_or(Vec::new(), |arr| arr.to_vec()),
            RevealPhase::Turn => self.turn_index().map_or(Vec::new(), |idx| vec![idx]),
            RevealPhase::River => self.river_index().map_or(Vec::new(), |idx| vec![idx]),
            RevealPhase::Showdown => {
                let mut indices = Vec::new();
                match showdown_seats {
                    Some(seats) => {
                        for &seat in seats {
                            if let Some(hole) = self.hole_cards_for_seat(seat) {
                                indices.extend_from_slice(hole);
                            }
                        }
                    }
                    None => {
                        // Reveal all hole cards
                        for (_, hole) in self.all_hole_cards() {
                            indices.extend_from_slice(hole);
                        }
                    }
                }
                indices
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectiveRevealBuilder
// ─────────────────────────────────────────────────────────────────────────────

/// Builder for constructing selective reveal payloads.
///
/// This builder helps create [`RevealShare`](protocol_messages::RevealShare) payloads
/// with the correct card indices for each reveal phase, enforcing minimal disclosure.
///
/// # Selective Reveal Protocol
///
/// Instead of revealing the entire deck, only the cards required by poker rules
/// are revealed at each phase:
///
/// - **Flop**: 3 community cards
/// - **Turn**: 1 community card
/// - **River**: 1 community card
/// - **Showdown**: Hole cards for players still in the hand
///
/// # Usage
///
/// ```
/// use codexpoker::l2::{DealPlanBuilder, SelectiveRevealBuilder};
/// use protocol_messages::{ProtocolVersion, RevealPhase, ShuffleContext};
///
/// // Build a deal plan first
/// let context = ShuffleContext::new(
///     ProtocolVersion::current(),
///     [1u8; 32],
///     42,
///     vec![0, 1],
///     52,
/// );
/// let plan = DealPlanBuilder::new(context)
///     .assign_hole_cards(0, vec![0, 1])
///     .assign_hole_cards(1, vec![2, 3])
///     .assign_community(vec![4, 5, 6, 7, 8])
///     .build()
///     .expect("valid plan");
///
/// // Create a selective reveal for the flop
/// let commitment_hash = [0u8; 32]; // From the deal commitment
/// let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
///     .phase(RevealPhase::Flop)
///     .from_seat(0xFF) // Dealer
///     .build_reveal_share()
///     .expect("valid flop reveal");
///
/// // Only 3 cards are revealed (the flop), not 52
/// assert_eq!(reveal.card_indices.len(), 3);
/// ```
#[derive(Debug)]
pub struct SelectiveRevealBuilder<'a> {
    plan: &'a DealPlan,
    commitment_hash: [u8; 32],
    phase: Option<protocol_messages::RevealPhase>,
    from_seat: u8,
    showdown_seats: Option<Vec<u8>>,
    reveal_data: Vec<Vec<u8>>,
    signature: Vec<u8>,
}

/// Errors that can occur when building a selective reveal.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SelectiveRevealError {
    /// No phase was set.
    #[error("reveal phase not set")]
    PhaseNotSet,

    /// No card indices available for the phase.
    #[error("no card indices available for phase {phase:?}")]
    NoCardIndices {
        phase: protocol_messages::RevealPhase,
    },

    /// Reveal data count doesn't match card indices count.
    #[error("reveal data count ({data_count}) doesn't match card indices count ({indices_count})")]
    RevealDataMismatch {
        data_count: usize,
        indices_count: usize,
    },
}

impl<'a> SelectiveRevealBuilder<'a> {
    /// Create a new selective reveal builder.
    ///
    /// # Arguments
    ///
    /// * `plan` - The deal plan containing card assignments
    /// * `commitment_hash` - Hash of the deal commitment this reveal is for
    pub fn new(plan: &'a DealPlan, commitment_hash: [u8; 32]) -> Self {
        Self {
            plan,
            commitment_hash,
            phase: None,
            from_seat: 0xFF, // Default to dealer
            showdown_seats: None,
            reveal_data: Vec::new(),
            signature: Vec::new(),
        }
    }

    /// Set the reveal phase.
    pub fn phase(mut self, phase: protocol_messages::RevealPhase) -> Self {
        self.phase = Some(phase);
        self
    }

    /// Set the seat providing the reveal.
    ///
    /// Use `0xFF` for dealer (default).
    pub fn from_seat(mut self, seat: u8) -> Self {
        self.from_seat = seat;
        self
    }

    /// Set which seats should reveal during showdown.
    ///
    /// Only used when phase is `Showdown`. If not set, all seats reveal.
    pub fn showdown_seats(mut self, seats: Vec<u8>) -> Self {
        self.showdown_seats = Some(seats);
        self
    }

    /// Set the reveal data (decryption shares or revealed values).
    ///
    /// Each entry corresponds to a card index in the reveal.
    /// The order must match the card indices order.
    pub fn reveal_data(mut self, data: Vec<Vec<u8>>) -> Self {
        self.reveal_data = data;
        self
    }

    /// Set the signature for the reveal.
    pub fn signature(mut self, sig: Vec<u8>) -> Self {
        self.signature = sig;
        self
    }

    /// Get the card indices that would be revealed for the configured phase.
    ///
    /// This is useful for knowing how many reveal data entries are needed
    /// before building the payload.
    pub fn card_indices(&self) -> Vec<u8> {
        match self.phase {
            Some(phase) => self.plan.card_indices_for_phase(phase, self.showdown_seats.as_deref()),
            None => Vec::new(),
        }
    }

    /// Build the selective reveal share payload.
    ///
    /// # Errors
    ///
    /// - [`SelectiveRevealError::PhaseNotSet`] if no phase was set
    /// - [`SelectiveRevealError::NoCardIndices`] if the phase has no card indices
    /// - [`SelectiveRevealError::RevealDataMismatch`] if reveal_data count doesn't match
    pub fn build_reveal_share(
        self,
    ) -> Result<protocol_messages::RevealShare, SelectiveRevealError> {
        let phase = self.phase.ok_or(SelectiveRevealError::PhaseNotSet)?;

        let card_indices = self.plan.card_indices_for_phase(phase, self.showdown_seats.as_deref());

        if card_indices.is_empty() {
            return Err(SelectiveRevealError::NoCardIndices { phase });
        }

        // If reveal_data is provided, validate count matches
        if !self.reveal_data.is_empty() && self.reveal_data.len() != card_indices.len() {
            return Err(SelectiveRevealError::RevealDataMismatch {
                data_count: self.reveal_data.len(),
                indices_count: card_indices.len(),
            });
        }

        // If no reveal_data provided, create empty placeholders
        let reveal_data = if self.reveal_data.is_empty() {
            vec![Vec::new(); card_indices.len()]
        } else {
            self.reveal_data
        };

        Ok(protocol_messages::RevealShare {
            version: protocol_messages::ProtocolVersion::current(),
            commitment_hash: self.commitment_hash,
            phase,
            card_indices,
            reveal_data,
            from_seat: self.from_seat,
            signature: self.signature,
        })
    }

    /// Build a hole card reveal for a specific seat (Preflop).
    ///
    /// During Preflop, hole cards are revealed per-seat (privately to each player).
    /// This method creates a reveal for a single seat's hole cards.
    ///
    /// # Arguments
    ///
    /// * `seat` - The seat whose hole cards to reveal
    ///
    /// # Errors
    ///
    /// - [`SelectiveRevealError::NoCardIndices`] if the seat has no hole cards
    /// - [`SelectiveRevealError::RevealDataMismatch`] if reveal_data count doesn't match
    pub fn build_hole_card_reveal(
        self,
        seat: u8,
    ) -> Result<protocol_messages::RevealShare, SelectiveRevealError> {
        let card_indices = self
            .plan
            .hole_cards_for_seat(seat)
            .map(|h| h.to_vec())
            .unwrap_or_default();

        if card_indices.is_empty() {
            return Err(SelectiveRevealError::NoCardIndices {
                phase: protocol_messages::RevealPhase::Preflop,
            });
        }

        // If reveal_data is provided, validate count matches
        if !self.reveal_data.is_empty() && self.reveal_data.len() != card_indices.len() {
            return Err(SelectiveRevealError::RevealDataMismatch {
                data_count: self.reveal_data.len(),
                indices_count: card_indices.len(),
            });
        }

        // If no reveal_data provided, create empty placeholders
        let reveal_data = if self.reveal_data.is_empty() {
            vec![Vec::new(); card_indices.len()]
        } else {
            self.reveal_data
        };

        Ok(protocol_messages::RevealShare {
            version: protocol_messages::ProtocolVersion::current(),
            commitment_hash: self.commitment_hash,
            phase: protocol_messages::RevealPhase::Preflop,
            card_indices,
            reveal_data,
            from_seat: self.from_seat,
            signature: self.signature,
        })
    }
}

/// Builder for constructing deal plans with shuffle context binding.
///
/// The builder validates all assignments against the shuffle context's
/// constraints (deck length, seat order) and ensures no duplicate card
/// assignments.
///
/// # Standard Hold'em Configuration
///
/// For Texas Hold'em with N players:
/// - 2 hole cards per player (2N cards total)
/// - 5 community cards (flop + turn + river)
/// - 3 burn cards (before flop, turn, river)
/// - Total: 2N + 8 cards from a 52-card deck
#[derive(Debug)]
pub struct DealPlanBuilder {
    context: ShuffleContext,
    hole_cards: Vec<(u8, Vec<u8>)>,
    community: Option<Vec<u8>>,
    burn: Option<Vec<u8>>,
    assigned_cards: Vec<u8>,
    hole_cards_per_player: usize,
    community_card_count: usize,
}

impl DealPlanBuilder {
    /// Create a new deal plan builder bound to the given shuffle context.
    ///
    /// Defaults to standard Texas Hold'em configuration:
    /// - 2 hole cards per player
    /// - 5 community cards
    pub fn new(context: ShuffleContext) -> Self {
        Self {
            context,
            hole_cards: Vec::new(),
            community: None,
            burn: None,
            assigned_cards: Vec::new(),
            hole_cards_per_player: 2,
            community_card_count: 5,
        }
    }

    /// Set the number of hole cards per player (default: 2 for Hold'em).
    pub fn hole_cards_per_player(mut self, count: usize) -> Self {
        self.hole_cards_per_player = count;
        self
    }

    /// Set the number of community cards (default: 5 for Hold'em).
    pub fn community_card_count(mut self, count: usize) -> Self {
        self.community_card_count = count;
        self
    }

    /// Assign hole cards to a seat.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The seat is not in the shuffle context's seat order
    /// - Any card index exceeds the deck length
    /// - Any card has already been assigned
    pub fn assign_hole_cards(mut self, seat: u8, indices: Vec<u8>) -> Self {
        self.hole_cards.push((seat, indices));
        self
    }

    /// Assign community cards.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Any card index exceeds the deck length
    /// - Any card has already been assigned
    pub fn assign_community(mut self, indices: Vec<u8>) -> Self {
        self.community = Some(indices);
        self
    }

    /// Assign burn cards.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Any card index exceeds the deck length
    /// - Any card has already been assigned
    pub fn assign_burn(mut self, indices: Vec<u8>) -> Self {
        self.burn = Some(indices);
        self
    }

    /// Validate and build the deal plan.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Any seat is not in the shuffle context's seat order
    /// - Any card index exceeds the deck length
    /// - Any card is assigned more than once
    /// - Not all seats have hole cards assigned
    /// - Community cards are not assigned
    /// - Wrong number of hole cards for any seat
    /// - Wrong number of community cards
    pub fn build(mut self) -> Result<DealPlan, DealPlanError> {
        let deck_length = self.context.deck_length;
        let seat_order = &self.context.seat_order;

        // Validate hole card assignments
        for (seat, indices) in &self.hole_cards {
            // Check seat is valid
            if !seat_order.contains(seat) {
                return Err(DealPlanError::InvalidSeat {
                    seat: *seat,
                    seat_order: seat_order.clone(),
                });
            }

            // Check hole card count
            if indices.len() != self.hole_cards_per_player {
                return Err(DealPlanError::WrongHoleCardCount {
                    seat: *seat,
                    count: indices.len(),
                    expected: self.hole_cards_per_player,
                });
            }

            // Check card indices
            for &idx in indices {
                if idx >= deck_length {
                    return Err(DealPlanError::CardIndexOutOfBounds {
                        index: idx,
                        deck_length,
                    });
                }
                if self.assigned_cards.contains(&idx) {
                    return Err(DealPlanError::DuplicateCardAssignment { index: idx });
                }
                self.assigned_cards.push(idx);
            }
        }

        // Check all seats have hole cards
        let assigned_seats: Vec<u8> = self.hole_cards.iter().map(|(s, _)| *s).collect();
        let missing: Vec<u8> = seat_order
            .iter()
            .filter(|s| !assigned_seats.contains(s))
            .copied()
            .collect();
        if !missing.is_empty() {
            return Err(DealPlanError::MissingHoleCards { missing });
        }

        // Validate community cards
        let community = self.community.ok_or(DealPlanError::MissingCommunityCards)?;
        if community.len() != self.community_card_count {
            return Err(DealPlanError::WrongCommunityCardCount {
                count: community.len(),
                expected: self.community_card_count,
            });
        }
        for &idx in &community {
            if idx >= deck_length {
                return Err(DealPlanError::CardIndexOutOfBounds {
                    index: idx,
                    deck_length,
                });
            }
            if self.assigned_cards.contains(&idx) {
                return Err(DealPlanError::DuplicateCardAssignment { index: idx });
            }
            self.assigned_cards.push(idx);
        }

        // Validate burn cards (if provided)
        if let Some(ref burn) = self.burn {
            for &idx in burn {
                if idx >= deck_length {
                    return Err(DealPlanError::CardIndexOutOfBounds {
                        index: idx,
                        deck_length,
                    });
                }
                if self.assigned_cards.contains(&idx) {
                    return Err(DealPlanError::DuplicateCardAssignment { index: idx });
                }
                self.assigned_cards.push(idx);
            }
        }

        // Build assignments list
        let mut assignments = Vec::new();
        for (seat, indices) in self.hole_cards {
            assignments.push(CardAssignment::HoleCards { seat, indices });
        }
        assignments.push(CardAssignment::Community { indices: community });
        if let Some(burn) = self.burn {
            assignments.push(CardAssignment::Burn { indices: burn });
        }

        Ok(DealPlan {
            context: self.context,
            assignments,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol_messages::ProtocolVersion;

    fn test_context() -> ShuffleContext {
        ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 42, vec![0, 1, 2, 3], 52)
    }

    fn two_player_context() -> ShuffleContext {
        ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 42, vec![0, 1], 52)
    }

    #[test]
    fn test_build_valid_deal_plan() {
        let context = two_player_context();
        let plan = DealPlanBuilder::new(context.clone())
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan");

        assert_eq!(plan.context_hash(), context.context_hash());
        assert_eq!(plan.hole_cards_for_seat(0), Some(&[0, 1][..]));
        assert_eq!(plan.hole_cards_for_seat(1), Some(&[2, 3][..]));
        assert_eq!(plan.community_cards(), Some(&[4, 5, 6, 7, 8][..]));
    }

    #[test]
    fn test_build_with_burn_cards() {
        let context = two_player_context();
        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![5, 6, 7, 8, 9])
            .assign_burn(vec![4, 10, 11]) // burn before flop, turn, river
            .build()
            .expect("valid plan");

        assert_eq!(plan.burn_cards(), Some(&[4, 10, 11][..]));
    }

    #[test]
    fn test_context_hash_binding() {
        let context = two_player_context();
        let expected_hash = context.context_hash();

        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan");

        assert_eq!(
            plan.context_hash(),
            expected_hash,
            "plan's context hash must match input context"
        );
    }

    #[test]
    fn test_verify_context_success() {
        let context = two_player_context();
        let expected = context.clone();

        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan");

        assert!(plan.verify_context(&expected).is_ok());
    }

    #[test]
    fn test_verify_context_mismatch() {
        let context = two_player_context();

        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan");

        // Different hand_id
        let wrong_context = ShuffleContext::new(
            ProtocolVersion::current(),
            [1u8; 32],
            999, // different hand_id
            vec![0, 1],
            52,
        );

        let result = plan.verify_context(&wrong_context);
        assert!(matches!(
            result,
            Err(protocol_messages::ShuffleContextMismatch::HandId { .. })
        ));
    }

    #[test]
    fn test_invalid_seat() {
        let context = two_player_context(); // seats 0, 1

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(99, vec![2, 3]) // seat 99 not in context
            .assign_community(vec![4, 5, 6, 7, 8])
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::InvalidSeat { seat: 99, .. })
        ));
    }

    #[test]
    fn test_card_index_out_of_bounds() {
        let context = two_player_context();

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 52]) // 52 is out of bounds for 52-card deck
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::CardIndexOutOfBounds { index: 52, deck_length: 52 })
        ));
    }

    #[test]
    fn test_duplicate_card_assignment() {
        let context = two_player_context();

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![1, 3]) // card 1 already assigned to seat 0
            .assign_community(vec![4, 5, 6, 7, 8])
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::DuplicateCardAssignment { index: 1 })
        ));
    }

    #[test]
    fn test_duplicate_community_card() {
        let context = two_player_context();

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![0, 5, 6, 7, 8]) // card 0 already assigned to seat 0
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::DuplicateCardAssignment { index: 0 })
        ));
    }

    #[test]
    fn test_missing_hole_cards() {
        let context = two_player_context(); // seats 0, 1

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            // missing seat 1
            .assign_community(vec![4, 5, 6, 7, 8])
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::MissingHoleCards { missing }) if missing == vec![1]
        ));
    }

    #[test]
    fn test_missing_community_cards() {
        let context = two_player_context();

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            // missing community cards
            .build();

        assert!(matches!(result, Err(DealPlanError::MissingCommunityCards)));
    }

    #[test]
    fn test_wrong_hole_card_count() {
        let context = two_player_context();

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1, 2]) // 3 hole cards instead of 2
            .assign_hole_cards(1, vec![3, 4])
            .assign_community(vec![5, 6, 7, 8, 9])
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::WrongHoleCardCount { seat: 0, count: 3, expected: 2 })
        ));
    }

    #[test]
    fn test_wrong_community_card_count() {
        let context = two_player_context();

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6]) // 3 community cards instead of 5
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::WrongCommunityCardCount { count: 3, expected: 5 })
        ));
    }

    #[test]
    fn test_custom_hole_card_count() {
        let context = two_player_context();

        // Omaha: 4 hole cards per player
        let plan = DealPlanBuilder::new(context)
            .hole_cards_per_player(4)
            .assign_hole_cards(0, vec![0, 1, 2, 3])
            .assign_hole_cards(1, vec![4, 5, 6, 7])
            .assign_community(vec![8, 9, 10, 11, 12])
            .build()
            .expect("valid Omaha plan");

        assert_eq!(plan.hole_cards_for_seat(0), Some(&[0, 1, 2, 3][..]));
        assert_eq!(plan.hole_cards_for_seat(1), Some(&[4, 5, 6, 7][..]));
    }

    #[test]
    fn test_four_player_table() {
        let context = test_context(); // seats 0, 1, 2, 3

        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_hole_cards(2, vec![4, 5])
            .assign_hole_cards(3, vec![6, 7])
            .assign_community(vec![8, 9, 10, 11, 12])
            .build()
            .expect("valid 4-player plan");

        assert_eq!(plan.assignments().len(), 5); // 4 hole + 1 community
    }

    #[test]
    fn test_all_card_indices() {
        let context = two_player_context();

        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .assign_burn(vec![9, 10, 11])
            .build()
            .expect("valid plan");

        let all_indices = plan.all_card_indices();
        assert_eq!(all_indices.len(), 12); // 4 hole + 5 community + 3 burn
    }

    #[test]
    fn test_context_hash_changes_with_different_contexts() {
        let context1 = ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 1, vec![0, 1], 52);
        let context2 = ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 2, vec![0, 1], 52);

        let plan1 = DealPlanBuilder::new(context1)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan");

        let plan2 = DealPlanBuilder::new(context2)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan");

        assert_ne!(
            plan1.context_hash(),
            plan2.context_hash(),
            "different hand_id must produce different context hash"
        );
    }

    #[test]
    fn test_small_deck() {
        // 36-card short deck
        let context =
            ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 1, vec![0, 1], 36);

        let plan = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid short deck plan");

        assert_eq!(plan.context().deck_length, 36);
    }

    #[test]
    fn test_small_deck_out_of_bounds() {
        // 36-card short deck
        let context =
            ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 1, vec![0, 1], 36);

        let result = DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 50]) // 50 is out of bounds for 36-card deck
            .assign_community(vec![4, 5, 6, 7, 8])
            .build();

        assert!(matches!(
            result,
            Err(DealPlanError::CardIndexOutOfBounds { index: 50, deck_length: 36 })
        ));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Selective Reveal Tests
    // ─────────────────────────────────────────────────────────────────────────

    fn standard_deal_plan() -> DealPlan {
        let context = two_player_context();
        DealPlanBuilder::new(context)
            .assign_hole_cards(0, vec![0, 1])
            .assign_hole_cards(1, vec![2, 3])
            .assign_community(vec![4, 5, 6, 7, 8])
            .build()
            .expect("valid plan")
    }

    #[test]
    fn test_flop_indices() {
        let plan = standard_deal_plan();
        let flop = plan.flop_indices().expect("should have flop indices");
        assert_eq!(flop, [4, 5, 6], "flop should be first 3 community cards");
    }

    #[test]
    fn test_turn_index() {
        let plan = standard_deal_plan();
        let turn = plan.turn_index().expect("should have turn index");
        assert_eq!(turn, 7, "turn should be 4th community card");
    }

    #[test]
    fn test_river_index() {
        let plan = standard_deal_plan();
        let river = plan.river_index().expect("should have river index");
        assert_eq!(river, 8, "river should be 5th community card");
    }

    #[test]
    fn test_seats_with_hole_cards() {
        let plan = standard_deal_plan();
        let seats = plan.seats_with_hole_cards();
        assert_eq!(seats.len(), 2);
        assert!(seats.contains(&0));
        assert!(seats.contains(&1));
    }

    #[test]
    fn test_all_hole_cards() {
        let plan = standard_deal_plan();
        let all = plan.all_hole_cards();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|(s, _)| *s == 0));
        assert!(all.iter().any(|(s, _)| *s == 1));
    }

    #[test]
    fn test_card_indices_for_phase_flop() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let indices = plan.card_indices_for_phase(RevealPhase::Flop, None);
        assert_eq!(indices, vec![4, 5, 6], "flop phase should return 3 cards");
    }

    #[test]
    fn test_card_indices_for_phase_turn() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let indices = plan.card_indices_for_phase(RevealPhase::Turn, None);
        assert_eq!(indices, vec![7], "turn phase should return 1 card");
    }

    #[test]
    fn test_card_indices_for_phase_river() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let indices = plan.card_indices_for_phase(RevealPhase::River, None);
        assert_eq!(indices, vec![8], "river phase should return 1 card");
    }

    #[test]
    fn test_card_indices_for_phase_preflop() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let indices = plan.card_indices_for_phase(RevealPhase::Preflop, None);
        assert!(
            indices.is_empty(),
            "preflop phase returns empty (use hole_cards_for_seat instead)"
        );
    }

    #[test]
    fn test_card_indices_for_phase_showdown_all_seats() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let indices = plan.card_indices_for_phase(RevealPhase::Showdown, None);
        assert_eq!(
            indices.len(),
            4,
            "showdown with no filter should reveal all 4 hole cards"
        );
        // Should contain hole cards for both seats
        assert!(indices.contains(&0));
        assert!(indices.contains(&1));
        assert!(indices.contains(&2));
        assert!(indices.contains(&3));
    }

    #[test]
    fn test_card_indices_for_phase_showdown_filtered_seats() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        // Only seat 0 reveals at showdown
        let indices = plan.card_indices_for_phase(RevealPhase::Showdown, Some(&[0]));
        assert_eq!(indices, vec![0, 1], "showdown should only reveal seat 0's hole cards");
    }

    #[test]
    fn test_selective_reveal_builder_flop() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [0u8; 32];

        let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::Flop)
            .from_seat(0xFF)
            .build_reveal_share()
            .expect("valid flop reveal");

        assert_eq!(reveal.phase, RevealPhase::Flop);
        assert_eq!(reveal.card_indices, vec![4, 5, 6]);
        assert_eq!(reveal.from_seat, 0xFF);
        assert_eq!(reveal.commitment_hash, commitment_hash);
        assert_eq!(
            reveal.reveal_data.len(),
            3,
            "reveal_data should have placeholder for each card"
        );
    }

    #[test]
    fn test_selective_reveal_builder_turn() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [1u8; 32];

        let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::Turn)
            .build_reveal_share()
            .expect("valid turn reveal");

        assert_eq!(reveal.card_indices, vec![7]);
    }

    #[test]
    fn test_selective_reveal_builder_river() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [2u8; 32];

        let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::River)
            .build_reveal_share()
            .expect("valid river reveal");

        assert_eq!(reveal.card_indices, vec![8]);
    }

    #[test]
    fn test_selective_reveal_builder_showdown() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [3u8; 32];

        let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::Showdown)
            .showdown_seats(vec![1]) // Only seat 1 reveals
            .build_reveal_share()
            .expect("valid showdown reveal");

        assert_eq!(reveal.card_indices, vec![2, 3], "only seat 1's hole cards");
    }

    #[test]
    fn test_selective_reveal_builder_hole_card_reveal() {
        let plan = standard_deal_plan();
        let commitment_hash = [4u8; 32];

        let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .from_seat(0)
            .build_hole_card_reveal(0)
            .expect("valid hole card reveal");

        assert_eq!(
            reveal.phase,
            protocol_messages::RevealPhase::Preflop
        );
        assert_eq!(reveal.card_indices, vec![0, 1]);
        assert_eq!(reveal.from_seat, 0);
    }

    #[test]
    fn test_selective_reveal_builder_with_reveal_data() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [5u8; 32];

        let reveal = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::Flop)
            .reveal_data(vec![vec![10], vec![20], vec![30]])
            .build_reveal_share()
            .expect("valid reveal with data");

        assert_eq!(reveal.reveal_data, vec![vec![10], vec![20], vec![30]]);
    }

    #[test]
    fn test_selective_reveal_builder_reveal_data_mismatch() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [6u8; 32];

        let result = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::Flop)
            .reveal_data(vec![vec![10], vec![20]]) // 2 entries but flop needs 3
            .build_reveal_share();

        assert!(matches!(
            result,
            Err(SelectiveRevealError::RevealDataMismatch {
                data_count: 2,
                indices_count: 3
            })
        ));
    }

    #[test]
    fn test_selective_reveal_builder_phase_not_set() {
        let plan = standard_deal_plan();
        let commitment_hash = [7u8; 32];

        let result = SelectiveRevealBuilder::new(&plan, commitment_hash).build_reveal_share();

        assert!(matches!(result, Err(SelectiveRevealError::PhaseNotSet)));
    }

    #[test]
    fn test_selective_reveal_builder_card_indices_before_build() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [8u8; 32];

        let builder = SelectiveRevealBuilder::new(&plan, commitment_hash).phase(RevealPhase::Flop);

        // Can get card indices before building to know how many reveal_data entries are needed
        let indices = builder.card_indices();
        assert_eq!(indices, vec![4, 5, 6]);
    }

    #[test]
    fn test_selective_reveal_builder_no_card_indices_for_preflop_phase() {
        use protocol_messages::RevealPhase;
        let plan = standard_deal_plan();
        let commitment_hash = [9u8; 32];

        // Preflop phase via build_reveal_share returns no indices
        // (use build_hole_card_reveal instead)
        let result = SelectiveRevealBuilder::new(&plan, commitment_hash)
            .phase(RevealPhase::Preflop)
            .build_reveal_share();

        assert!(matches!(
            result,
            Err(SelectiveRevealError::NoCardIndices {
                phase: RevealPhase::Preflop
            })
        ));
    }

    #[test]
    fn test_selective_reveal_builder_invalid_seat_hole_card() {
        let plan = standard_deal_plan();
        let commitment_hash = [10u8; 32];

        // Seat 99 doesn't exist
        let result = SelectiveRevealBuilder::new(&plan, commitment_hash).build_hole_card_reveal(99);

        assert!(matches!(
            result,
            Err(SelectiveRevealError::NoCardIndices {
                phase: protocol_messages::RevealPhase::Preflop
            })
        ));
    }
}
