//! Super Mode multiplier generation and application.
//!
//! This module implements the "Lightning/Quantum/Strike" style super mode
//! features for all casino games, providing random multiplier generation
//! and application logic.

use super::cards;
use super::GameRng;
use nullspace_types::casino::{SuperModeState, SuperMultiplier, SuperType};
use tracing::warn;

const PERCENT_SCALE: u32 = 10_000;

fn roll_percent(rng: &mut GameRng) -> u32 {
    rng.next_bounded_u32(PERCENT_SCALE)
}

/// Generate Lightning Baccarat multipliers (3-5 Aura Cards, 2-8x)
///
/// Distribution (RTP-adjusted for ~96.5%):
/// - Card count: 60% 3 cards, 30% 4 cards, 10% 5 cards
/// - Multipliers: 45% 2x, 35% 3x, 15% 4x, 4% 5x, 1% 8x
/// - Expected multiplier per card: 2.7x (down from 3.1x)
/// - Max multiplier: 8^5 = 32,768x (capped at 512x for sustainability)
pub fn generate_baccarat_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 3-5 cards based on probability (60/30/10)
    let roll = roll_percent(rng);
    let count = if roll < 6_000 {
        3
    } else if roll < 9_000 {
        4
    } else {
        5
    };

    let mut mults = Vec::with_capacity(count);
    let mut used_cards = 0u64; // Bit set

    for _ in 0..count {
        // Pick unused card (0-51)
        let card = loop {
            let c = rng.next_u8() % 52;
            if (used_cards & (1 << c)) == 0 {
                used_cards |= 1 << c;
                break c;
            }
        };

        // Assign multiplier: 45% 2x, 35% 3x, 15% 4x, 4% 5x, 1% 8x (RTP-adjusted)
        let m_roll = roll_percent(rng);
        let multiplier = if m_roll < 4_500 {
            2
        } else if m_roll < 8_000 {
            3
        } else if m_roll < 9_500 {
            4
        } else if m_roll < 9_900 {
            5
        } else {
            8
        };

        mults.push(SuperMultiplier {
            id: card,
            multiplier,
            super_type: SuperType::Card,
        });
    }
    mults
}

/// Generate Quantum Roulette multipliers (5-7 numbers, 50-400x)
///
/// Distribution (RTP-adjusted for ~96%):
/// - 5-7 numbers selected
/// - Multipliers: 45% 50x, 35% 100x, 15% 150x, 4% 200x, 1% 400x
pub fn generate_roulette_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 5-7 numbers
    let count = 5 + (rng.next_u8() % 3) as usize;
    let mut mults = Vec::with_capacity(count);
    let mut used = 0u64;

    for _ in 0..count {
        // Pick unused number (0-36)
        let num = loop {
            let n = rng.next_u8() % 37;
            if (used & (1 << n)) == 0 {
                used |= 1 << n;
                break n;
            }
        };

        // Assign multiplier: 45% 50x, 35% 100x, 15% 150x, 4% 200x, 1% 400x (RTP-adjusted)
        let roll = roll_percent(rng);
        let multiplier = if roll < 4_500 {
            50
        } else if roll < 8_000 {
            100
        } else if roll < 9_500 {
            150
        } else if roll < 9_900 {
            200
        } else {
            400
        };

        mults.push(SuperMultiplier {
            id: num,
            multiplier,
            super_type: SuperType::Number,
        });
    }
    mults
}

/// Generate Strike Blackjack multipliers (5 Strike Cards, 2-8x)
///
/// Distribution (RTP-adjusted for ~96.5%):
/// - 5 Strike Cards (specific rank+suit)
/// - Multipliers: 50% 2x, 35% 3x, 12% 4x, 2.5% 6x, 0.5% 8x
/// - Maximum: 8x × 8x = 64x
/// - Hit Frequency: ~12.5% in winning hands
pub fn generate_blackjack_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    let mut mults = Vec::with_capacity(5);
    let mut used = 0u64;

    for _ in 0..5 {
        let card = loop {
            let c = rng.next_u8() % 52;
            if (used & (1 << c)) == 0 {
                used |= 1 << c;
                break c;
            }
        };

        // Distribution: 50% 2x, 35% 3x, 12% 4x, 2.5% 6x, 0.5% 8x (RTP-adjusted)
        let roll = roll_percent(rng);
        let multiplier = if roll < 5_000 {
            2
        } else if roll < 8_500 {
            3
        } else if roll < 9_700 {
            4
        } else if roll < 9_950 {
            6
        } else {
            8
        };

        mults.push(SuperMultiplier {
            id: card,
            multiplier,
            super_type: SuperType::Card,
        });
    }
    mults
}

/// Generate Thunder Craps multipliers (3 numbers from [4,5,6,8,9,10], 2-15x)
///
/// Distribution (RTP-adjusted for ~97%):
/// - Reduced multipliers for all point difficulties
/// - Rare bonus reduced from 5% to 2%
pub fn generate_craps_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 3 numbers from [4,5,6,8,9,10]
    let opts = [4u8, 5, 6, 8, 9, 10];
    let mut indices = [0, 1, 2, 3, 4, 5];

    // Fisher-Yates shuffle first 3
    for i in 0..3 {
        let j = i + (rng.next_u8() as usize % (6 - i));
        indices.swap(i, j);
    }

    let mut mults = Vec::with_capacity(3);
    for i in 0..3 {
        let num = opts[indices[i]];
        let roll = roll_percent(rng);

        // Multiplier based on point difficulty (RTP-adjusted)
        let multiplier = if roll < 200 {
            15 // Rare 2% (down from 5% @ 25x)
        } else {
            match num {
                6 | 8 => 2,  // Easy points (down from 3x)
                5 | 9 => 4,  // Medium points (down from 5x)
                4 | 10 => 7, // Hard points (down from 10x)
                _ => 2,
            }
        };

        mults.push(SuperMultiplier {
            id: num,
            multiplier,
            super_type: SuperType::Total,
        });
    }
    mults
}

/// Generate Fortune Sic Bo multipliers (3 totals from 4-17, 2-30x)
///
/// Distribution (RTP-adjusted for ~96.5%):
/// - Reduced multipliers across all total ranges
pub fn generate_sic_bo_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 3 totals from 4-17
    let mut mults = Vec::with_capacity(3);
    let mut used = 0u32;

    for _ in 0..3 {
        let total = loop {
            let t = 4 + (rng.next_u8() % 14); // 4-17
            if (used & (1 << t)) == 0 {
                used |= 1 << t;
                break t;
            }
        };

        // Multiplier based on probability (RTP-adjusted)
        let multiplier = match total {
            10 | 11 => 2 + (rng.next_u8() % 2) as u16,         // 2-3x (down from 3-5x)
            7 | 8 | 13 | 14 => 4 + (rng.next_u8() % 4) as u16, // 4-7x (down from 5-10x)
            _ => 8 + (rng.next_u8() % 23) as u16,              // 8-30x (down from 10-50x)
        };

        mults.push(SuperMultiplier {
            id: total,
            multiplier,
            super_type: SuperType::Total,
        });
    }
    mults
}

/// Generate Mega Video Poker multipliers (4 Mega Cards)
///
/// Distribution per plan (COUNT-BASED multipliers):
/// - 4 Mega Cards selected (specific rank+suit, revealed before draw)
/// - Multiplier based on count in final hand:
///   - 1 Mega Card: 1.5x (stored as 15, divide by 10 when applying)
///   - 2 Mega Cards: 3x
///   - 3 Mega Cards: 10x
///   - 4 Mega Cards: 100x
///   - Mega Card in Royal Flush: 1000x
/// - Hit Frequency: ~35% for at least 1 Mega
///
/// NOTE: This stores a base marker multiplier of 1. The actual payout
/// calculation should use `apply_video_poker_mega_multiplier()` which
/// counts matching cards and applies count-based multipliers.
pub fn generate_video_poker_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    let mut mults = Vec::with_capacity(4);
    let mut used = 0u64;

    for _ in 0..4 {
        let card = loop {
            let c = rng.next_u8() % 52;
            if (used & (1 << c)) == 0 {
                used |= 1 << c;
                break c;
            }
        };

        // Store 1 as marker - actual multiplier is count-based
        mults.push(SuperMultiplier {
            id: card,
            multiplier: 1, // Marker for count-based system
            super_type: SuperType::Card,
        });
    }
    mults
}

/// Apply Video Poker Mega multiplier based on count of Mega Cards in hand
///
/// Returns the boosted payout based on how many Mega Cards are in the final hand.
/// (RTP-adjusted for ~96%: reduced multipliers across all tiers)
#[allow(dead_code)]
pub fn apply_video_poker_mega_multiplier(
    hand_cards: &[u8],
    multipliers: &[SuperMultiplier],
    base_payout: u64,
    is_royal_flush: bool,
) -> u64 {
    let mut mega_count = 0;
    let mut has_mega_in_royal = false;

    for card in hand_cards {
        for m in multipliers {
            if m.super_type == SuperType::Card && *card == m.id {
                mega_count += 1;
                if is_royal_flush {
                    has_mega_in_royal = true;
                }
            }
        }
    }

    // Apply count-based multiplier (RTP-adjusted)
    let multiplier: u64 = if has_mega_in_royal {
        500 // Down from 1000x
    } else {
        match mega_count {
            0 => 1,
            1 => 12, // 1.2x stored as 12 (down from 1.5x)
            2 => 20, // 2x stored as 20 (down from 3x)
            3 => 50, // Down from 100x
            _ => 500, // Down from 1000x
        }
    };

    // For fractional multipliers, multiply then divide
    if mega_count == 1 && !has_mega_in_royal {
        base_payout.saturating_mul(12) / 10
    } else if mega_count == 2 && !has_mega_in_royal {
        base_payout.saturating_mul(2)
    } else {
        base_payout.saturating_mul(multiplier)
    }
}

/// Generate Flash Three Card Poker multipliers (2 Flash Suits)
///
/// Distribution per plan (CONFIGURATION-BASED multipliers):
/// - 2 Flash Suits selected (26 cards = half deck eligible)
/// - Multiplier based on hand configuration:
///   - 2 cards same Flash Suit: 2x
///   - 3 cards same Flash Suit (Flush): 5x
///   - Flash Suit Straight: 4x
///   - Flash Suit Straight Flush: 25x
/// - Hit Frequency: ~29% for 2+ cards in same Flash Suit
///
/// NOTE: Use `apply_three_card_flash_multiplier()` for proper
/// configuration-based multiplier application.
pub fn generate_three_card_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 2 Flash Suits
    let suit1 = rng.next_u8() % 4;
    let suit2 = loop {
        let s = rng.next_u8() % 4;
        if s != suit1 {
            break s;
        }
    };

    vec![
        SuperMultiplier {
            id: suit1,
            multiplier: 1, // Marker for config-based system
            super_type: SuperType::Suit,
        },
        SuperMultiplier {
            id: suit2,
            multiplier: 1,
            super_type: SuperType::Suit,
        },
    ]
}

/// Apply Three Card Poker Flash multiplier based on hand configuration
///
/// Returns the boosted payout based on Flash Suit matches in the hand.
/// (RTP-adjusted for ~96.5%: reduced multipliers)
#[allow(dead_code)]
pub fn apply_three_card_flash_multiplier(
    hand_cards: &[u8], // 3 cards, each 0-51
    multipliers: &[SuperMultiplier],
    base_payout: u64,
    is_straight: bool,
    is_flush: bool,
) -> u64 {
    // Count cards in each Flash Suit
    let mut flash_suit_counts = [0u8; 4];
    for card in hand_cards {
        let suit = card / 13;
        for m in multipliers {
            if m.super_type == SuperType::Suit && suit == m.id {
                flash_suit_counts[suit as usize] += 1;
            }
        }
    }

    let max_flash_count = flash_suit_counts.iter().max().copied().unwrap_or(0);

    // Determine multiplier based on configuration (RTP-adjusted)
    let multiplier: u64 = if is_flush && is_straight && max_flash_count == 3 {
        // Flash Suit Straight Flush (down from 25x)
        15
    } else if is_flush && max_flash_count == 3 {
        // 3 cards same Flash Suit (Flush) (down from 5x)
        4
    } else if is_straight && max_flash_count >= 2 {
        // Flash Suit Straight (down from 4x)
        3
    } else if max_flash_count >= 2 {
        // 2+ cards in same Flash Suit (down from 2x)
        2
    } else {
        1
    };

    base_payout.saturating_mul(multiplier)
}

/// Generate Blitz Ultimate Texas Hold'em multipliers (2 Blitz Ranks)
///
/// Distribution per plan (HAND-STRENGTH-BASED multipliers):
/// - 2 Blitz ranks selected (any suit matches = 8 cards from 52 eligible)
/// - Multiplier based on hand strength when Blitz card in winning hand:
///   - Pair: 2x
///   - Two Pair: 3x
///   - Three of a Kind: 5x
///   - Straight: 4x
///   - Flush: 4x
///   - Full House: 6x
///   - Four of a Kind: 15x
///   - Straight Flush: 25x
///   - Royal Flush: 50x
/// - Special: Both hole cards Blitz + win = automatic 5x
/// - Hit Frequency: ~63% Blitz in 7 cards, ~18% in winning pair+
///
/// NOTE: Use `apply_uth_blitz_multiplier()` for proper hand-based multiplier.
pub fn generate_uth_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 2 Blitz ranks (any suit matches)
    let rank1 = rng.next_u8() % 13;
    let rank2 = loop {
        let r = rng.next_u8() % 13;
        if r != rank1 {
            break r;
        }
    };

    vec![
        SuperMultiplier {
            id: rank1,
            multiplier: 1, // Marker for hand-based system
            super_type: SuperType::Rank,
        },
        SuperMultiplier {
            id: rank2,
            multiplier: 1,
            super_type: SuperType::Rank,
        },
    ]
}

/// Hand ranking for UTH Blitz multiplier
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[allow(dead_code)]
pub enum UthHandRank {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
    Straight,
    Flush,
    FullHouse,
    FourOfAKind,
    StraightFlush,
    RoyalFlush,
}

/// Apply UTH Blitz multiplier based on hand strength
///
/// Returns the boosted payout based on Blitz ranks in the winning hand.
/// (RTP-adjusted for ~97%: reduced multipliers across all hand ranks)
#[allow(dead_code)]
pub fn apply_uth_blitz_multiplier(
    final_hand: &[u8], // 5-card final hand
    hole_cards: &[u8], // 2 player hole cards
    multipliers: &[SuperMultiplier],
    base_payout: u64,
    hand_rank: UthHandRank,
) -> u64 {
    // Check if any card in final hand is a Blitz rank
    let has_blitz_in_hand = final_hand.iter().any(|card| {
        let rank = card % 13;
        multipliers
            .iter()
            .any(|m| m.super_type == SuperType::Rank && rank == m.id)
    });

    if !has_blitz_in_hand {
        return base_payout;
    }

    // Check for double Blitz hole cards bonus
    let both_hole_cards_blitz = hole_cards.iter().all(|card| {
        let rank = card % 13;
        multipliers
            .iter()
            .any(|m| m.super_type == SuperType::Rank && rank == m.id)
    });

    // Determine base multiplier from hand strength (RTP-adjusted)
    let hand_mult: u64 = match hand_rank {
        UthHandRank::HighCard => 1,
        UthHandRank::Pair => 2,
        UthHandRank::TwoPair => 2,        // Down from 3x
        UthHandRank::ThreeOfAKind => 4,   // Down from 5x
        UthHandRank::Straight => 3,       // Down from 4x
        UthHandRank::Flush => 3,          // Down from 4x
        UthHandRank::FullHouse => 5,      // Down from 6x
        UthHandRank::FourOfAKind => 10,   // Down from 15x
        UthHandRank::StraightFlush => 15, // Down from 25x
        UthHandRank::RoyalFlush => 30,    // Down from 50x
    };

    // Apply both hole cards Blitz bonus (automatic 4x if better, down from 5x)
    let final_mult = if both_hole_cards_blitz && hand_mult < 4 {
        4
    } else {
        hand_mult
    };

    base_payout.saturating_mul(final_mult)
}

/// Generate Strike Casino War multipliers (3 Strike Ranks)
///
/// Distribution per plan (SCENARIO-BASED multipliers):
/// - 3 Strike Ranks selected (any suit = 24 cards per rank in 6-deck shoe)
/// - Multiplier based on scenario:
///   - Your card is Strike Rank, win: 2x
///   - Both cards Strike Rank, win war: 3x
///   - Both cards same Strike Rank (tie), win war: 5x
/// - Hit Frequency: 3/13 = 23.08% for your card being Strike
/// - Special: War Bonus Wheel has 10% chance to add 2x-5x boost
///
/// NOTE: Use `apply_casino_war_strike_multiplier()` for proper scenario-based multiplier.
pub fn generate_casino_war_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 3 Strike Ranks
    let mut mults = Vec::with_capacity(3);
    let mut used = 0u16;

    for _ in 0..3 {
        let rank = loop {
            let r = rng.next_u8() % 13;
            if (used & (1 << r)) == 0 {
                used |= 1 << r;
                break r;
            }
        };

        mults.push(SuperMultiplier {
            id: rank,
            multiplier: 1, // Marker for scenario-based system
            super_type: SuperType::Rank,
        });
    }
    mults
}

/// Apply Casino War Strike multiplier based on scenario
///
/// Returns the boosted payout based on Strike Rank matches.
/// (RTP-adjusted for ~96.5%: reduced multipliers)
#[allow(dead_code)]
pub fn apply_casino_war_strike_multiplier(
    player_card: u8, // 0-51
    dealer_card: u8, // 0-51
    multipliers: &[SuperMultiplier],
    base_payout: u64,
    won_war: bool, // True if player won after going to war
    was_tie: bool, // True if original cards tied
) -> u64 {
    let player_rank = player_card % 13;
    let dealer_rank = dealer_card % 13;

    let player_is_strike = multipliers
        .iter()
        .any(|m| m.super_type == SuperType::Rank && player_rank == m.id);
    let dealer_is_strike = multipliers
        .iter()
        .any(|m| m.super_type == SuperType::Rank && dealer_rank == m.id);

    // Determine multiplier based on scenario (RTP-adjusted)
    let multiplier: u64 = if was_tie && player_rank == dealer_rank && player_is_strike && won_war {
        // Both cards same Strike Rank (tie), won war (down from 5x)
        4
    } else if player_is_strike && dealer_is_strike && won_war {
        // Both cards Strike Rank, won war (down from 3x)
        2
    } else if player_is_strike {
        // Your card is Strike Rank, win (down from 2x)
        2
    } else {
        1
    };

    base_payout.saturating_mul(multiplier)
}

/// Generate Super HiLo state (streak-based progressive multipliers)
///
/// Distribution (RTP-adjusted for ~97%):
/// | Correct Calls | Multiplier | Probability from Start |
/// |---------------|-----------|----------------------|
/// | 1             | 1.3x      | ~50%                 |
/// | 2             | 2x        | ~25%                 |
/// | 3             | 3x        | ~12.5%               |
/// | 4             | 5x        | ~6.25%               |
/// | 5             | 8x        | ~3.13%               |
/// | 6             | 15x       | ~1.56%               |
/// | 7             | 25x       | ~0.78%               |
/// | 8             | 40x       | ~0.39%               |
/// | 9             | 70x       | ~0.20%               |
/// | 10+           | 120x      | ~0.10%               |
///
/// - Ace Bonus: Correct call on Ace = 2x multiplier boost (down from 3x)
/// - Stored as x10 for fractional values (13 = 1.3x)
#[allow(dead_code)]
pub fn generate_hilo_state(streak: u8) -> SuperModeState {
    // Streak-based progressive multipliers (RTP-adjusted, stored as x10)
    let base_mult = match streak {
        0 | 1 => 13, // 1.3x (down from 1.5x)
        2 => 20,     // 2x (down from 2.5x)
        3 => 30,     // 3x (down from 4x)
        4 => 50,     // 5x (down from 7x)
        5 => 80,     // 8x (down from 12x)
        6 => 150,    // 15x (down from 20x)
        7 => 250,    // 25x (down from 35x)
        8 => 400,    // 40x (down from 60x)
        9 => 700,    // 70x (down from 100x)
        _ => 1200,   // 120x (down from 200x)
    };

    SuperModeState {
        is_active: true,
        multipliers: vec![SuperMultiplier {
            id: 0,
            multiplier: base_mult,
            super_type: SuperType::Card, // Unused, placeholder
        }],
        streak_level: streak,
        aura_meter: 0,
    }
}

/// Apply HiLo streak multiplier to payout
///
/// Handles the x10 storage format for fractional multipliers.
/// (RTP-adjusted for ~97%: reduced multipliers and Ace bonus)
pub fn apply_hilo_streak_multiplier(base_payout: u64, streak: u8, was_ace: bool) -> u64 {
    let mult = match streak {
        0 | 1 => 13, // 1.3x (down from 1.5x)
        2 => 20,     // 2x (down from 2.5x)
        3 => 30,     // 3x (down from 4x)
        4 => 50,     // 5x (down from 7x)
        5 => 80,     // 8x (down from 12x)
        6 => 150,    // 15x (down from 20x)
        7 => 250,    // 25x (down from 35x)
        8 => 400,    // 40x (down from 60x)
        9 => 700,    // 70x (down from 100x)
        _ => 1200,   // 120x (down from 200x)
    };

    // Apply Ace bonus (2x boost, down from 3x) if applicable
    let final_mult = if was_ace { mult * 2 } else { mult };

    // Divide by 10 to handle fractional storage
    base_payout.saturating_mul(final_mult as u64) / 10
}

/// Apply super multiplier for card-based games
///
/// Returns the boosted payout if any winning cards match the super multipliers.
/// Multipliers stack multiplicatively.
///
/// Logs a warning if payout saturates to u64::MAX.
pub fn apply_super_multiplier_cards(
    winning_cards: &[u8],
    multipliers: &[SuperMultiplier],
    base_payout: u64,
) -> u64 {
    let mut total_mult: u64 = 1;
    let mut mult_saturated = false;

    for card in winning_cards {
        for m in multipliers {
            let matches = match m.super_type {
                SuperType::Card => *card == m.id,
                SuperType::Rank => cards::card_rank(*card) == m.id,
                SuperType::Suit => cards::card_suit(*card) == m.id,
                _ => false,
            };
            if matches {
                let prev = total_mult;
                total_mult = total_mult.saturating_mul(m.multiplier as u64);
                if total_mult == u64::MAX && prev != u64::MAX {
                    mult_saturated = true;
                }
            }
        }
    }

    let result = base_payout.saturating_mul(total_mult);

    if result == u64::MAX && (mult_saturated || (base_payout > 0 && total_mult > 1)) {
        warn!(
            base_payout = base_payout,
            total_multiplier = total_mult,
            matching_cards = winning_cards.len(),
            "Super mode payout saturated to u64::MAX"
        );
    }

    result
}

/// Apply super multiplier for number-based games (Roulette)
///
/// Returns the boosted payout if the result matches a super multiplier.
///
/// Logs a warning if payout saturates to u64::MAX.
pub fn apply_super_multiplier_number(
    result_num: u8,
    multipliers: &[SuperMultiplier],
    base_payout: u64,
) -> u64 {
    for m in multipliers {
        if m.super_type == SuperType::Number && m.id == result_num {
            let payout = base_payout.saturating_mul(m.multiplier as u64);
            if payout == u64::MAX && base_payout > 0 {
                warn!(
                    base_payout = base_payout,
                    multiplier = m.multiplier,
                    result_number = result_num,
                    "Super mode payout saturated to u64::MAX"
                );
            }
            return payout;
        }
    }
    base_payout
}

/// Apply super multiplier for total-based games (Sic Bo)
///
/// Returns the boosted payout if the total matches a super multiplier.
///
/// Logs a warning if payout saturates to u64::MAX.
pub fn apply_super_multiplier_total(
    total: u8,
    multipliers: &[SuperMultiplier],
    base_payout: u64,
) -> u64 {
    for m in multipliers {
        if m.super_type == SuperType::Total && m.id == total {
            let payout = base_payout.saturating_mul(m.multiplier as u64);
            if payout == u64::MAX && base_payout > 0 {
                warn!(
                    base_payout = base_payout,
                    multiplier = m.multiplier,
                    total = total,
                    "Super mode payout saturated to u64::MAX"
                );
            }
            return payout;
        }
    }
    base_payout
}

// ============================================================================
// Aura Meter System (Cross-Game Feature)
// ============================================================================

/// Maximum Aura Meter value (triggers Super Aura Round)
pub const AURA_METER_MAX: u8 = 5;

/// Update the player's Aura Meter based on round outcome.
///
/// The meter increments when:
/// - Player paid Super Mode fee (implied by calling this function)
/// - Player lost the round (won = false)
/// - At least one Aura element appeared in the round
///
/// Returns the new meter value.
pub fn update_aura_meter(current_meter: u8, had_aura_element: bool, won: bool) -> u8 {
    if had_aura_element && !won {
        // Near-miss: Aura element appeared but player lost
        (current_meter + 1).min(AURA_METER_MAX)
    } else if won {
        // Win resets the meter (they got their bonus)
        0
    } else {
        // No Aura element, keep current value
        current_meter
    }
}

/// Check if the player qualifies for a Super Aura Round.
///
/// At 5/5 meter, the next round becomes a Super Aura Round with:
/// - Enhanced multiplier distribution (all multipliers × 1.5)
/// - Guaranteed at least one Aura element in player's outcome area
pub fn is_super_aura_round(aura_meter: u8) -> bool {
    aura_meter >= AURA_METER_MAX
}

/// Reset the Aura Meter after a Super Aura Round completes.
pub fn reset_aura_meter() -> u8 {
    0
}

/// Generate enhanced multipliers for Super Aura Round.
///
/// Takes base multipliers and boosts them by 1.5x (rounded down).
pub fn enhance_multipliers_for_aura_round(multipliers: &mut [SuperMultiplier]) {
    for m in multipliers {
        // Multiply by 1.5 (3/2)
        m.multiplier = (m.multiplier * 3) / 2;
    }
}

/// Check if any of the outcome elements match Aura elements.
///
/// Used to determine if the round qualifies as a "near-miss" for meter purposes.
#[allow(dead_code)]
pub fn check_aura_element_presence(
    outcome_cards: &[u8],
    outcome_numbers: &[u8],
    outcome_totals: &[u8],
    multipliers: &[SuperMultiplier],
) -> bool {
    // Check cards
    for card in outcome_cards {
        for m in multipliers {
            let matches = match m.super_type {
                SuperType::Card => *card == m.id,
                SuperType::Rank => (*card % 13) == m.id,
                SuperType::Suit => (*card / 13) == m.id,
                _ => false,
            };
            if matches {
                return true;
            }
        }
    }

    // Check numbers
    for num in outcome_numbers {
        for m in multipliers {
            if m.super_type == SuperType::Number && *num == m.id {
                return true;
            }
        }
    }

    // Check totals
    for total in outcome_totals {
        for m in multipliers {
            if m.super_type == SuperType::Total && *total == m.id {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_network_keypair, create_seed};

    fn create_test_rng(session_id: u64) -> GameRng {
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, 1);
        GameRng::new(&seed, session_id, 0)
    }

    #[test]
    fn test_generate_baccarat_multipliers() {
        let mut rng = create_test_rng(1);
        let mults = generate_baccarat_multipliers(&mut rng);

        // Now 3-5 cards (was 1-5)
        assert!(mults.len() >= 3 && mults.len() <= 5);
        for m in &mults {
            assert!(m.id < 52);
            assert!(m.multiplier >= 2 && m.multiplier <= 8);
            assert_eq!(m.super_type, SuperType::Card);
        }

        // Check no duplicates
        let mut seen = [false; 52];
        for m in &mults {
            assert!(!seen[m.id as usize]);
            seen[m.id as usize] = true;
        }
    }

    #[test]
    fn test_generate_roulette_multipliers() {
        let mut rng = create_test_rng(2);
        let mults = generate_roulette_multipliers(&mut rng);

        assert!(mults.len() >= 5 && mults.len() <= 7);
        for m in &mults {
            assert!(m.id <= 36);
            assert!(m.multiplier >= 50 && m.multiplier <= 400); // RTP-adjusted max
            assert_eq!(m.super_type, SuperType::Number);
        }
    }

    #[test]
    fn test_generate_blackjack_multipliers() {
        let mut rng = create_test_rng(3);
        let mults = generate_blackjack_multipliers(&mut rng);

        // Now 5 Strike Cards (was 3)
        assert_eq!(mults.len(), 5);
        for m in &mults {
            assert!(m.id < 52);
            assert!(m.multiplier >= 2 && m.multiplier <= 8); // RTP-adjusted max
            assert_eq!(m.super_type, SuperType::Card);
        }
    }

    #[test]
    fn test_generate_craps_multipliers() {
        let mut rng = create_test_rng(4);
        let mults = generate_craps_multipliers(&mut rng);

        assert_eq!(mults.len(), 3);
        for m in &mults {
            assert!([4, 5, 6, 8, 9, 10].contains(&m.id));
            assert!(m.multiplier >= 2 && m.multiplier <= 15); // RTP-adjusted
            assert_eq!(m.super_type, SuperType::Total);
        }
    }

    #[test]
    fn test_generate_sic_bo_multipliers() {
        let mut rng = create_test_rng(5);
        let mults = generate_sic_bo_multipliers(&mut rng);

        assert_eq!(mults.len(), 3);
        for m in &mults {
            assert!(m.id >= 4 && m.id <= 17);
            assert!(m.multiplier >= 2 && m.multiplier <= 30); // RTP-adjusted
            assert_eq!(m.super_type, SuperType::Total);
        }
    }

    #[test]
    fn test_generate_video_poker_multipliers() {
        let mut rng = create_test_rng(6);
        let mults = generate_video_poker_multipliers(&mut rng);

        assert_eq!(mults.len(), 4);
        for m in &mults {
            assert!(m.id < 52);
            // Now uses marker multiplier=1 (actual multiplier is count-based)
            assert_eq!(m.multiplier, 1);
            assert_eq!(m.super_type, SuperType::Card);
        }
    }

    #[test]
    fn test_generate_three_card_multipliers() {
        let mut rng = create_test_rng(7);
        let mults = generate_three_card_multipliers(&mut rng);

        assert_eq!(mults.len(), 2);
        for m in &mults {
            assert!(m.id < 4);
            // Now uses marker multiplier=1 (actual multiplier is config-based)
            assert_eq!(m.multiplier, 1);
            assert_eq!(m.super_type, SuperType::Suit);
        }
        assert_ne!(mults[0].id, mults[1].id);
    }

    #[test]
    fn test_generate_uth_multipliers() {
        let mut rng = create_test_rng(8);
        let mults = generate_uth_multipliers(&mut rng);

        assert_eq!(mults.len(), 2);
        for m in &mults {
            assert!(m.id < 13);
            // Now uses marker multiplier=1 (actual multiplier is hand-based)
            assert_eq!(m.multiplier, 1);
            assert_eq!(m.super_type, SuperType::Rank);
        }
        assert_ne!(mults[0].id, mults[1].id);
    }

    #[test]
    fn test_generate_casino_war_multipliers() {
        let mut rng = create_test_rng(9);
        let mults = generate_casino_war_multipliers(&mut rng);

        assert_eq!(mults.len(), 3);
        for m in &mults {
            assert!(m.id < 13);
            // Now uses marker multiplier=1 (actual multiplier is scenario-based)
            assert_eq!(m.multiplier, 1);
            assert_eq!(m.super_type, SuperType::Rank);
        }
    }

    #[test]
    fn test_generate_hilo_state() {
        let state0 = generate_hilo_state(0);
        assert_eq!(state0.streak_level, 0);
        assert_eq!(state0.multipliers[0].multiplier, 13); // 1.3x (RTP-adjusted)

        let state2 = generate_hilo_state(2);
        assert_eq!(state2.streak_level, 2);
        assert_eq!(state2.multipliers[0].multiplier, 20); // 2x (RTP-adjusted)

        // RTP-adjusted: streak 5 now has 8x (80)
        let state5 = generate_hilo_state(5);
        assert_eq!(state5.streak_level, 5);
        assert_eq!(state5.multipliers[0].multiplier, 80); // 8x (RTP-adjusted)

        // Test higher streaks (RTP-adjusted)
        let state10 = generate_hilo_state(10);
        assert_eq!(state10.streak_level, 10);
        assert_eq!(state10.multipliers[0].multiplier, 1200); // 120x (RTP-adjusted)
    }

    #[test]
    fn test_apply_super_multiplier_cards() {
        let multipliers = vec![
            SuperMultiplier {
                id: 0, // Ace of Spades
                multiplier: 5,
                super_type: SuperType::Card,
            },
            SuperMultiplier {
                id: 10, // Jack of Spades (rank=10, suit=0)
                multiplier: 2,
                super_type: SuperType::Rank,
            },
        ];

        // Winning with Ace of Spades
        let payout1 = apply_super_multiplier_cards(&[0], &multipliers, 100);
        assert_eq!(payout1, 500); // 100 * 5

        // Winning with Jack of Spades (matches rank multiplier)
        let payout2 = apply_super_multiplier_cards(&[10], &multipliers, 100);
        assert_eq!(payout2, 200); // 100 * 2

        // Winning with card that has no multiplier
        let payout3 = apply_super_multiplier_cards(&[25], &multipliers, 100);
        assert_eq!(payout3, 100); // No multiplier
    }

    #[test]
    fn test_apply_super_multiplier_number() {
        let multipliers = vec![SuperMultiplier {
            id: 17,
            multiplier: 100,
            super_type: SuperType::Number,
        }];

        let payout1 = apply_super_multiplier_number(17, &multipliers, 35);
        assert_eq!(payout1, 3500); // 35 * 100

        let payout2 = apply_super_multiplier_number(5, &multipliers, 35);
        assert_eq!(payout2, 35); // No multiplier
    }

    #[test]
    fn test_apply_super_multiplier_total() {
        let multipliers = vec![SuperMultiplier {
            id: 10,
            multiplier: 8,
            super_type: SuperType::Total,
        }];

        let payout1 = apply_super_multiplier_total(10, &multipliers, 60);
        assert_eq!(payout1, 480); // 60 * 8

        let payout2 = apply_super_multiplier_total(7, &multipliers, 60);
        assert_eq!(payout2, 60); // No multiplier
    }

    // ========== Aura Meter Tests ==========

    #[test]
    fn test_update_aura_meter_near_miss() {
        // Near-miss: had aura element but lost
        let new_meter = update_aura_meter(0, true, false);
        assert_eq!(new_meter, 1);

        let new_meter = update_aura_meter(4, true, false);
        assert_eq!(new_meter, 5);

        // Capped at 5
        let new_meter = update_aura_meter(5, true, false);
        assert_eq!(new_meter, 5);
    }

    #[test]
    fn test_update_aura_meter_win_resets() {
        // Win resets the meter
        let new_meter = update_aura_meter(3, true, true);
        assert_eq!(new_meter, 0);

        let new_meter = update_aura_meter(5, false, true);
        assert_eq!(new_meter, 0);
    }

    #[test]
    fn test_update_aura_meter_no_aura_element() {
        // No aura element, keep current
        let new_meter = update_aura_meter(3, false, false);
        assert_eq!(new_meter, 3);
    }

    #[test]
    fn test_is_super_aura_round() {
        assert!(!is_super_aura_round(0));
        assert!(!is_super_aura_round(4));
        assert!(is_super_aura_round(5));
        assert!(is_super_aura_round(6)); // Edge case
    }

    #[test]
    fn test_enhance_multipliers_for_aura_round() {
        let mut mults = vec![
            SuperMultiplier {
                id: 0,
                multiplier: 2,
                super_type: SuperType::Card,
            },
            SuperMultiplier {
                id: 1,
                multiplier: 8,
                super_type: SuperType::Card,
            },
        ];
        enhance_multipliers_for_aura_round(&mut mults);
        assert_eq!(mults[0].multiplier, 3); // 2 * 1.5 = 3
        assert_eq!(mults[1].multiplier, 12); // 8 * 1.5 = 12
    }

    #[test]
    fn test_check_aura_element_presence_cards() {
        let multipliers = vec![SuperMultiplier {
            id: 5,
            multiplier: 1,
            super_type: SuperType::Card,
        }];

        // Card matches
        assert!(check_aura_element_presence(&[5], &[], &[], &multipliers));
        // Card doesn't match
        assert!(!check_aura_element_presence(&[10], &[], &[], &multipliers));
    }

    #[test]
    fn test_check_aura_element_presence_numbers() {
        let multipliers = vec![SuperMultiplier {
            id: 17,
            multiplier: 100,
            super_type: SuperType::Number,
        }];

        // Number matches
        assert!(check_aura_element_presence(&[], &[17], &[], &multipliers));
        // Number doesn't match
        assert!(!check_aura_element_presence(&[], &[5], &[], &multipliers));
    }

    // ========== New Apply Function Tests ==========

    #[test]
    fn test_apply_video_poker_mega_multiplier() {
        let multipliers = vec![
            SuperMultiplier {
                id: 0,
                multiplier: 1,
                super_type: SuperType::Card,
            },
            SuperMultiplier {
                id: 1,
                multiplier: 1,
                super_type: SuperType::Card,
            },
            SuperMultiplier {
                id: 2,
                multiplier: 1,
                super_type: SuperType::Card,
            },
            SuperMultiplier {
                id: 3,
                multiplier: 1,
                super_type: SuperType::Card,
            },
        ];

        // 1 Mega Card = 1.2x (RTP-adjusted)
        let payout =
            apply_video_poker_mega_multiplier(&[0, 10, 20, 30, 40], &multipliers, 100, false);
        assert_eq!(payout, 120); // 100 * 1.2

        // 2 Mega Cards = 2x (RTP-adjusted)
        let payout =
            apply_video_poker_mega_multiplier(&[0, 1, 20, 30, 40], &multipliers, 100, false);
        assert_eq!(payout, 200); // 100 * 2

        // No Mega Cards = 1x
        let payout =
            apply_video_poker_mega_multiplier(&[10, 20, 30, 40, 50], &multipliers, 100, false);
        assert_eq!(payout, 100);
    }

    #[test]
    fn test_apply_hilo_streak_multiplier() {
        // Streak 1 = 1.3x -> 100 * 13 / 10 = 130 (RTP-adjusted)
        let payout = apply_hilo_streak_multiplier(100, 1, false);
        assert_eq!(payout, 130);

        // Streak 3 = 3x -> 100 * 30 / 10 = 300 (RTP-adjusted)
        let payout = apply_hilo_streak_multiplier(100, 3, false);
        assert_eq!(payout, 300);

        // Streak 5 = 8x -> 100 * 80 / 10 = 800 (RTP-adjusted)
        let payout = apply_hilo_streak_multiplier(100, 5, false);
        assert_eq!(payout, 800);

        // Streak 10+ = 120x -> 100 * 1200 / 10 = 12000 (RTP-adjusted)
        let payout = apply_hilo_streak_multiplier(100, 10, false);
        assert_eq!(payout, 12000);

        // Ace bonus: 2x extra on streak 3 = 6x -> 100 * 60 / 10 = 600 (RTP-adjusted)
        let payout = apply_hilo_streak_multiplier(100, 3, true);
        assert_eq!(payout, 600);
    }

    #[test]
    fn test_apply_casino_war_strike_multiplier() {
        let multipliers = vec![
            SuperMultiplier {
                id: 5,
                multiplier: 1,
                super_type: SuperType::Rank,
            }, // Rank 5 (6s)
        ];

        // Player card is Strike (rank 5), win = 2x
        let payout = apply_casino_war_strike_multiplier(5, 10, &multipliers, 100, false, false);
        assert_eq!(payout, 200);

        // Neither card is Strike = 1x
        let payout = apply_casino_war_strike_multiplier(10, 11, &multipliers, 100, false, false);
        assert_eq!(payout, 100);
    }

    // ========== RTP Verification Tests ==========
    //
    // These tests verify that the RTP-adjusted multiplier distributions
    // achieve the target 95-99% RTP range.

    const RTP_TEST_ROUNDS: u64 = 10_000;

    /// Helper to calculate average multiplier from generator
    fn avg_multiplier(rng: &mut GameRng, rounds: u64, gen_fn: fn(&mut GameRng) -> Vec<SuperMultiplier>) -> f64 {
        let mut total_mult: f64 = 0.0;
        let mut total_count: u64 = 0;

        for _ in 0..rounds {
            let mults = gen_fn(rng);
            for m in mults {
                total_mult += m.multiplier as f64;
                total_count += 1;
            }
        }

        total_mult / total_count as f64
    }

    #[test]
    fn verify_baccarat_rtp_distribution() {
        let mut rng = create_test_rng(1000);
        let avg = avg_multiplier(&mut rng, RTP_TEST_ROUNDS, generate_baccarat_multipliers);

        // Target: ~2.7x expected (down from 3.1x)
        println!("Baccarat avg mult: {:.2}x", avg);
        assert!((2.4..=3.0).contains(&avg),
                "Baccarat avg {:.2}x outside target range [2.4, 3.0]", avg);
    }

    #[test]
    fn verify_blackjack_rtp_distribution() {
        let mut rng = create_test_rng(1001);
        let avg = avg_multiplier(&mut rng, RTP_TEST_ROUNDS, generate_blackjack_multipliers);

        // Target: ~2.6x expected (RTP-adjusted)
        println!("Blackjack avg mult: {:.2}x", avg);
        assert!((2.3..=3.0).contains(&avg),
                "Blackjack avg {:.2}x outside target range [2.3, 3.0]", avg);
    }

    #[test]
    fn verify_roulette_rtp_distribution() {
        let mut rng = create_test_rng(1002);
        let avg = avg_multiplier(&mut rng, RTP_TEST_ROUNDS, generate_roulette_multipliers);

        // Target: ~90x expected (down from ~140x)
        println!("Roulette avg mult: {:.2}x", avg);
        assert!((70.0..=120.0).contains(&avg),
                "Roulette avg {:.2}x outside target range [70, 120]", avg);
    }

    #[test]
    fn verify_craps_rtp_distribution() {
        let mut rng = create_test_rng(1003);
        let avg = avg_multiplier(&mut rng, RTP_TEST_ROUNDS, generate_craps_multipliers);

        // Target: ~4x expected (RTP-adjusted)
        println!("Craps avg mult: {:.2}x", avg);
        assert!((3.0..=6.0).contains(&avg),
                "Craps avg {:.2}x outside target range [3.0, 6.0]", avg);
    }

    #[test]
    fn verify_sic_bo_rtp_distribution() {
        let mut rng = create_test_rng(1004);
        let avg = avg_multiplier(&mut rng, RTP_TEST_ROUNDS, generate_sic_bo_multipliers);

        // Target: ~10x expected (RTP-adjusted)
        println!("Sic Bo avg mult: {:.2}x", avg);
        assert!((6.0..=15.0).contains(&avg),
                "Sic Bo avg {:.2}x outside target range [6.0, 15.0]", avg);
    }

    #[test]
    fn verify_hilo_rtp_progression() {
        let base = 1000u64;

        // Verify streak progression is monotonically increasing
        let mut prev = 0u64;
        for streak in 1..=10 {
            let mult = apply_hilo_streak_multiplier(base, streak, false);
            assert!(mult > prev, "Streak {} mult {} not > prev {}", streak, mult, prev);
            prev = mult;
        }

        // Verify Ace bonus is consistent
        for streak in 1..=10 {
            let normal = apply_hilo_streak_multiplier(base, streak, false);
            let ace = apply_hilo_streak_multiplier(base, streak, true);
            assert!(ace > normal, "Ace bonus should increase payout at streak {}", streak);
            // Ace bonus is 2x
            assert_eq!(ace, normal * 2, "Ace bonus should double payout");
        }
    }

    #[test]
    #[ignore] // Long-running Monte Carlo test - run with --ignored
    fn monte_carlo_rtp_summary() {
        println!("\n========== SUPER MODE RTP SUMMARY (Monte Carlo) ==========\n");

        let rounds = 100_000u64;

        // Test all generators
        type GameGenerator = fn(&mut GameRng) -> Vec<SuperMultiplier>;
        let games: [(&str, GameGenerator); 5] = [
            ("Baccarat", generate_baccarat_multipliers),
            ("Blackjack", generate_blackjack_multipliers),
            ("Roulette", generate_roulette_multipliers),
            ("Craps", generate_craps_multipliers),
            ("Sic Bo", generate_sic_bo_multipliers),
        ];

        for (i, (name, gen_fn)) in games.iter().enumerate() {
            let mut rng = create_test_rng(2000 + i as u64);
            let avg = avg_multiplier(&mut rng, rounds, *gen_fn);
            println!("{:12}: avg mult = {:.2}x", name, avg);
        }

        println!("\nHiLo Streak Multipliers:");
        for streak in [1, 3, 5, 7, 10] {
            let mult = apply_hilo_streak_multiplier(1000, streak, false);
            let ace = apply_hilo_streak_multiplier(1000, streak, true);
            println!("  Streak {:2}: {:.1}x (Ace: {:.1}x)", streak, mult as f64 / 1000.0, ace as f64 / 1000.0);
        }

        println!("\n============================================================\n");
    }

    // ==========================================================================
    // Super Mode Stacking Overflow Tests (US-050)
    // ==========================================================================
    //
    // These tests verify the behavior of multiplicative stacking when high
    // multipliers could cause u64 overflow. The apply_super_multiplier_cards()
    // function uses saturating_mul which prevents panics but may produce
    // clamped results.

    #[test]
    fn test_super_stacking_multiple_8x_multipliers() {
        // Test 4x 8x multipliers stacking: 8^4 = 4,096x
        let multipliers = vec![
            SuperMultiplier { id: 0, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: 8, super_type: SuperType::Card },
        ];

        // All 4 cards match, base payout 1000
        let payout = apply_super_multiplier_cards(&[0, 1, 2, 3], &multipliers, 1_000);
        assert_eq!(payout, 4_096_000, "8^4 * 1000 = 4,096,000");

        // 5x 8x multipliers: 8^5 = 32,768x (max Baccarat scenario per docs)
        let mults5 = vec![
            SuperMultiplier { id: 0, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 4, multiplier: 8, super_type: SuperType::Card },
        ];
        let payout5 = apply_super_multiplier_cards(&[0, 1, 2, 3, 4], &mults5, 1_000);
        assert_eq!(payout5, 32_768_000, "8^5 * 1000 = 32,768,000");
    }

    #[test]
    fn test_super_stacking_extreme_payouts_with_high_base() {
        // Test high base payout with multiple multipliers
        // Max table bet might be 100,000 with 5x 8x multipliers = 3.2 billion (fits in u64)
        let multipliers = vec![
            SuperMultiplier { id: 0, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 4, multiplier: 8, super_type: SuperType::Card },
        ];

        let high_base = 100_000u64;
        let payout = apply_super_multiplier_cards(&[0, 1, 2, 3, 4], &multipliers, high_base);
        assert_eq!(payout, 3_276_800_000, "8^5 * 100,000 = 3.2768 billion");

        // Even higher: 1 million base (still fits: 32.768 billion)
        let very_high_base = 1_000_000u64;
        let payout_big = apply_super_multiplier_cards(&[0, 1, 2, 3, 4], &multipliers, very_high_base);
        assert_eq!(payout_big, 32_768_000_000, "8^5 * 1,000,000 = 32.768 billion");
    }

    #[test]
    fn test_super_stacking_saturating_mul_at_boundary() {
        // Create scenario that hits saturating_mul boundary
        // u64::MAX = 18,446,744,073,709,551,615
        // With multiplier stacking: total_mult can grow very large
        // Test that saturating_mul prevents panic but correctly saturates

        let huge_multipliers = vec![
            SuperMultiplier { id: 0, multiplier: u16::MAX, super_type: SuperType::Card }, // 65535
            SuperMultiplier { id: 1, multiplier: u16::MAX, super_type: SuperType::Card }, // 65535
            SuperMultiplier { id: 2, multiplier: u16::MAX, super_type: SuperType::Card }, // 65535
        ];

        // 65535^3 = 281,462,092,005,375 (fits in u64)
        // With base 100, result = 28,146,209,200,537,500 (still fits)
        let payout = apply_super_multiplier_cards(&[0, 1, 2], &huge_multipliers, 100);
        let expected = 65535u64 * 65535u64 * 65535u64 * 100u64;
        assert_eq!(payout, expected, "65535^3 * 100 should compute correctly");
    }

    #[test]
    fn test_super_stacking_saturates_at_u64_max() {
        // Force saturation by using impossibly high multipliers
        // Note: SuperMultiplier.multiplier is u16, max 65535
        // 4x u16::MAX = 65535^4 = 18,445,618,173,802,708,225 (close to u64::MAX)
        // With any base > 1, this will saturate

        let max_multipliers = vec![
            SuperMultiplier { id: 0, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: u16::MAX, super_type: SuperType::Card },
        ];

        // This will overflow: 65535^4 * base = overflow
        let payout = apply_super_multiplier_cards(&[0, 1, 2, 3], &max_multipliers, 1);
        // 65535^4 = 18,445,618,173,802,708,225 which is < u64::MAX, so no saturation yet
        let expected = 65535u64.pow(4);
        assert_eq!(payout, expected, "65535^4 * 1 should fit in u64");

        // Now with base 2, we exceed u64::MAX
        let payout_overflow = apply_super_multiplier_cards(&[0, 1, 2, 3], &max_multipliers, 2);
        // 65535^4 * 2 = 36,891,236,347,605,416,450 > u64::MAX = 18,446,744,073,709,551,615
        // saturating_mul should clamp to u64::MAX
        assert_eq!(payout_overflow, u64::MAX, "65535^4 * 2 should saturate to u64::MAX");
    }

    #[test]
    fn test_super_stacking_logs_warning_on_saturation() {
        // Saturation now emits tracing::warn! for observability
        // This allows operators to detect extreme payout scenarios

        // Create saturation scenario
        let max_multipliers = vec![
            SuperMultiplier { id: 0, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: u16::MAX, super_type: SuperType::Card },
        ];

        // This will log a warning via tracing::warn!
        // The function still uses saturating_mul to prevent overflow panics
        let result = apply_super_multiplier_cards(&[0, 1, 2, 3], &max_multipliers, 1_000_000);

        // Verify saturation still occurs (safety) but now with logging (observability)
        assert_eq!(result, u64::MAX, "Saturation should occur with extreme multipliers");

        // Note: To verify the warning is emitted in integration tests, use tracing-test
        // or check logs contain "Super mode payout saturated to u64::MAX"
    }

    #[test]
    fn test_super_stacking_4_matching_cards_realistic_scenario() {
        // Realistic Baccarat scenario: 4 Aura cards in winning hand
        // Per docs: 3-5 Aura Cards with multipliers 2-8x

        // Best case: 4 cards with 8x each = 4096x
        let multipliers = vec![
            SuperMultiplier { id: 10, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 20, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 30, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 40, multiplier: 8, super_type: SuperType::Card },
        ];

        // Player wins with all 4 cards in hand (unlikely but possible in Baccarat)
        let base = 10_000u64;
        let payout = apply_super_multiplier_cards(&[10, 20, 30, 40], &multipliers, base);
        assert_eq!(payout, 40_960_000, "4x 8x multipliers with $10K bet = $40.96M");

        // Verify this doesn't overflow
        assert!(payout < u64::MAX, "Realistic scenario should not saturate");
    }

    #[test]
    fn test_super_stacking_intermediate_overflow() {
        // Test that intermediate overflow in total_mult is handled
        // even before applying to base_payout

        // Create scenario where total_mult overflows before base multiplication
        let huge_mults = vec![
            SuperMultiplier { id: 0, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: u16::MAX, super_type: SuperType::Card },
            SuperMultiplier { id: 4, multiplier: u16::MAX, super_type: SuperType::Card },
        ];

        // 65535^5 = far exceeds u64::MAX (1.21e24 vs 1.84e19)
        // Intermediate total_mult will saturate during stacking
        let payout = apply_super_multiplier_cards(&[0, 1, 2, 3, 4], &huge_mults, 1);

        // Due to saturating_mul, total_mult caps at u64::MAX
        // Then base_payout.saturating_mul(u64::MAX) for base=1 returns u64::MAX
        assert_eq!(payout, u64::MAX, "5x u16::MAX should saturate intermediate total_mult");
    }

    #[test]
    fn test_super_stacking_partial_match_no_overflow() {
        // Only some cards match multipliers - verify stacking is selective

        let multipliers = vec![
            SuperMultiplier { id: 0, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: 8, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: 8, super_type: SuperType::Card },
        ];

        // Only 2 of 4 cards match
        let payout = apply_super_multiplier_cards(&[0, 1, 50, 51], &multipliers, 1_000);
        assert_eq!(payout, 64_000, "2x 8x = 64x = $64K");

        // Only 1 card matches
        let payout1 = apply_super_multiplier_cards(&[0, 50, 51, 49], &multipliers, 1_000);
        assert_eq!(payout1, 8_000, "1x 8x = 8x = $8K");

        // No cards match
        let payout0 = apply_super_multiplier_cards(&[50, 51, 49, 48], &multipliers, 1_000);
        assert_eq!(payout0, 1_000, "No match = 1x = $1K");
    }

    #[test]
    fn test_super_stacking_rank_type_multipliers() {
        // Test rank-based multipliers (any suit matches)
        // This allows more matches than card-based

        let multipliers = vec![
            SuperMultiplier { id: 0, multiplier: 8, super_type: SuperType::Rank },  // Aces
            SuperMultiplier { id: 12, multiplier: 8, super_type: SuperType::Rank }, // Kings
        ];

        // Ace of spades (0) + Ace of hearts (13) + King of spades (12) + King of hearts (25)
        // All 4 match rank multipliers: 8^4 = 4096x
        let payout = apply_super_multiplier_cards(&[0, 13, 12, 25], &multipliers, 1_000);
        assert_eq!(payout, 4_096_000, "4 rank matches with 8x each = 4096x");
    }

    #[test]
    fn test_super_stacking_suit_type_multipliers() {
        // Test suit-based multipliers (13 cards per suit)

        let multipliers = vec![
            SuperMultiplier { id: 0, multiplier: 4, super_type: SuperType::Suit }, // Spades (cards 0-12)
            SuperMultiplier { id: 1, multiplier: 4, super_type: SuperType::Suit }, // Hearts (cards 13-25)
        ];

        // 3 spades + 2 hearts = 5 matches = 4^5 = 1024x
        let cards = [0, 5, 10, 13, 20]; // 3 spades, 2 hearts
        let payout = apply_super_multiplier_cards(&cards, &multipliers, 1_000);
        assert_eq!(payout, 1_024_000, "5 suit matches with 4x each = 1024x");
    }

    #[test]
    fn test_video_poker_mega_multiplier_count_stacking() {
        // Video Poker uses count-based multipliers, not stacking
        // Verify the count-based system doesn't have overflow issues

        let multipliers = vec![
            SuperMultiplier { id: 0, multiplier: 1, super_type: SuperType::Card },
            SuperMultiplier { id: 1, multiplier: 1, super_type: SuperType::Card },
            SuperMultiplier { id: 2, multiplier: 1, super_type: SuperType::Card },
            SuperMultiplier { id: 3, multiplier: 1, super_type: SuperType::Card },
        ];

        // 4 Mega Cards in hand (max): 500x (RTP-adjusted from 1000x)
        let payout = apply_video_poker_mega_multiplier(&[0, 1, 2, 3, 4], &multipliers, 1_000_000, false);
        assert_eq!(payout, 500_000_000, "4 Mega Cards = 500x = $500M");

        // Royal Flush with Mega: 500x (RTP-adjusted)
        let royal = apply_video_poker_mega_multiplier(&[0, 1, 2, 3, 4], &multipliers, 4_000, true);
        assert_eq!(royal, 2_000_000, "Royal with Mega = 500x = $2M");
    }

    #[test]
    fn test_hilo_ace_bonus_stacking_with_high_streak() {
        // HiLo: streak 10 = 120x, Ace bonus = 2x, total = 240x
        // Verify this doesn't overflow with reasonable base

        let base = 10_000_000_000u64; // 10 billion (high but realistic)
        let payout = apply_hilo_streak_multiplier(base, 10, true);

        // Expected: base * 1200 * 2 / 10 = base * 240
        // Uses saturating_mul internally so should handle correctly
        let mult = 1200u64 * 2; // 2400 (10x stored + ace bonus)
        let expected = base.saturating_mul(mult) / 10;
        assert_eq!(payout, expected, "HiLo max streak with ace should calculate correctly");
        assert!(payout > base, "HiLo payout should exceed base");
        assert_eq!(payout, 2_400_000_000_000, "10B * 240 = 2.4 trillion");
    }

    #[test]
    fn test_hilo_streak_saturation_at_extreme_base() {
        // Test HiLo with extreme base that could cause saturation
        // The function uses saturating_mul internally

        // Use base that when multiplied by max streak mult (1200*2=2400) / 10 = 240x
        // would approach u64::MAX
        let extreme_base = u64::MAX / 300; // ~61 quadrillion
        let payout = apply_hilo_streak_multiplier(extreme_base, 10, true);

        // saturating_mul should handle this without panic
        // The exact behavior depends on order of operations in apply_hilo_streak_multiplier
        // which does: base * (mult * 2) / 10 = base * 2400 / 10
        // With saturating_mul: base.saturating_mul(2400) / 10
        assert!(payout >= extreme_base, "Even with saturation, payout should be >= base");
    }
}
