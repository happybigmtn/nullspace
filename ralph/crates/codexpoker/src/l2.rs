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
}
