//! Shared playing-card helpers.
//!
//! Cards are encoded as `0..=51`, where:
//! - suit = card / 13 (0..=3)
//! - rank = card % 13 (0..=12)
//!
//! Many games treat Ace as rank 1 for encoding, but as 14 for comparisons.

/// Total cards in a standard deck.
pub(crate) const CARDS_PER_DECK: u8 = 52;

/// Ranks per suit.
pub(crate) const RANKS_PER_SUIT: u8 = 13;

/// Returns true if `card` is within `0..CARDS_PER_DECK`.
pub(crate) fn is_valid_card(card: u8) -> bool {
    card < CARDS_PER_DECK
}

/// Returns the 0-based rank (0..=12), where 0 is Ace.
pub(crate) fn card_rank(card: u8) -> u8 {
    card % RANKS_PER_SUIT
}

/// Returns the 1-based rank (1..=13), where 1 is Ace and 13 is King.
pub(crate) fn card_rank_one_based(card: u8) -> u8 {
    card_rank(card) + 1
}

/// Returns the rank for comparisons (2..=14), where Ace is high (14).
pub(crate) fn card_rank_ace_high(card: u8) -> u8 {
    let r = card_rank_one_based(card);
    if r == 1 {
        14
    } else {
        r
    }
}

/// Returns the suit (0..=3).
pub(crate) fn card_suit(card: u8) -> u8 {
    card / RANKS_PER_SUIT
}
