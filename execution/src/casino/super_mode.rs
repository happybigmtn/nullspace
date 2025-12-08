//! Super Mode multiplier generation and application.
//!
//! This module implements the "Lightning/Quantum/Strike" style super mode
//! features for all casino games, providing random multiplier generation
//! and application logic.

use super::GameRng;
use nullspace_types::casino::{SuperMultiplier, SuperModeState, SuperType};

/// Generate Lightning Baccarat multipliers (1-5 cards, 2-8x)
pub fn generate_baccarat_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 1-5 cards based on probability
    let roll = rng.next_f32();
    let count = if roll < 0.6 {
        1
    } else if roll < 0.8 {
        2
    } else if roll < 0.9 {
        3
    } else if roll < 0.98 {
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

        // Assign multiplier (2,3,4,5,8x with decreasing probability)
        let m_roll = rng.next_f32();
        let multiplier = if m_roll < 0.35 {
            2
        } else if m_roll < 0.65 {
            3
        } else if m_roll < 0.85 {
            4
        } else if m_roll < 0.95 {
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

/// Generate Quantum Roulette multipliers (5-7 numbers, 50-500x)
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

        // Assign multiplier (50, 100, 200, 300, 400, 500x)
        let roll = rng.next_f32();
        let multiplier = if roll < 0.35 {
            50
        } else if roll < 0.65 {
            100
        } else if roll < 0.83 {
            200
        } else if roll < 0.93 {
            300
        } else if roll < 0.98 {
            400
        } else {
            500
        };

        mults.push(SuperMultiplier {
            id: num,
            multiplier,
            super_type: SuperType::Number,
        });
    }
    mults
}

/// Generate Strike Blackjack multipliers (3 cards, 2-10x)
pub fn generate_blackjack_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    let mut mults = Vec::with_capacity(3);
    let mut used = 0u64;

    for _ in 0..3 {
        let card = loop {
            let c = rng.next_u8() % 52;
            if (used & (1 << c)) == 0 {
                used |= 1 << c;
                break c;
            }
        };

        let roll = rng.next_f32();
        let multiplier = if roll < 0.4 {
            2
        } else if roll < 0.7 {
            3
        } else if roll < 0.85 {
            5
        } else if roll < 0.95 {
            7
        } else {
            10
        };

        mults.push(SuperMultiplier {
            id: card,
            multiplier,
            super_type: SuperType::Card,
        });
    }
    mults
}

/// Generate Thunder Craps multipliers (3 numbers from [4,5,6,8,9,10], 3-25x)
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
        let roll = rng.next_f32();

        // Multiplier based on point difficulty
        let multiplier = if roll < 0.05 {
            25 // Rare 5%
        } else {
            match num {
                6 | 8 => 3,   // Easy points
                5 | 9 => 5,   // Medium points
                4 | 10 => 10, // Hard points
                _ => 3,
            }
        };

        mults.push(SuperMultiplier {
            id: num,
            multiplier,
            super_type: SuperType::Number,
        });
    }
    mults
}

/// Generate Fortune Sic Bo multipliers (3 totals from 4-17, 3-50x)
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

        // Multiplier based on probability (center totals easier)
        let multiplier = match total {
            10 | 11 => 3 + (rng.next_u8() % 3) as u16,      // 3-5x
            7 | 8 | 13 | 14 => 5 + (rng.next_u8() % 6) as u16, // 5-10x
            _ => 10 + (rng.next_u8() % 41) as u16,          // 10-50x (edges)
        };

        mults.push(SuperMultiplier {
            id: total,
            multiplier,
            super_type: SuperType::Total,
        });
    }
    mults
}

/// Generate Mega Video Poker multipliers (4 cards, 2-5x)
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

        let multiplier = 2 + (rng.next_u8() % 4) as u16; // 2-5x
        mults.push(SuperMultiplier {
            id: card,
            multiplier,
            super_type: SuperType::Card,
        });
    }
    mults
}

/// Generate Flash Three Card Poker multipliers (2 suits, 2x)
pub fn generate_three_card_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 2 suits with 2x
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
            multiplier: 2,
            super_type: SuperType::Suit,
        },
        SuperMultiplier {
            id: suit2,
            multiplier: 2,
            super_type: SuperType::Suit,
        },
    ]
}

/// Generate Blitz Ultimate Texas Hold'em multipliers (2 ranks, 2x)
pub fn generate_uth_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 2 ranks with 2x
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
            multiplier: 2,
            super_type: SuperType::Rank,
        },
        SuperMultiplier {
            id: rank2,
            multiplier: 2,
            super_type: SuperType::Rank,
        },
    ]
}

/// Generate Strike Casino War multipliers (3 ranks, 3x)
pub fn generate_casino_war_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 3 ranks with 3x
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
            multiplier: 3,
            super_type: SuperType::Rank,
        });
    }
    mults
}

/// Generate Super HiLo state (streak-based, no random multipliers)
pub fn generate_hilo_state(streak: u8) -> SuperModeState {
    // Streak-based multipliers, no random generation
    let base_mult = match streak {
        0..=1 => 15, // 1.5x (stored as 15 = 1.5 * 10)
        2..=3 => 25, // 2.5x
        _ => 40,     // 4.0x
    };

    SuperModeState {
        is_active: true,
        multipliers: vec![SuperMultiplier {
            id: 0,
            multiplier: base_mult,
            super_type: SuperType::Card, // Unused, placeholder
        }],
        streak_level: streak,
    }
}

/// Apply super multiplier for card-based games
///
/// Returns the boosted payout if any winning cards match the super multipliers.
/// Multipliers stack multiplicatively.
pub fn apply_super_multiplier_cards(
    winning_cards: &[u8],
    multipliers: &[SuperMultiplier],
    base_payout: u64,
) -> u64 {
    let mut total_mult: u64 = 1;

    for card in winning_cards {
        for m in multipliers {
            let matches = match m.super_type {
                SuperType::Card => *card == m.id,
                SuperType::Rank => (*card % 13) == m.id,
                SuperType::Suit => (*card / 13) == m.id,
                _ => false,
            };
            if matches {
                total_mult = total_mult.saturating_mul(m.multiplier as u64);
            }
        }
    }

    base_payout.saturating_mul(total_mult)
}

/// Apply super multiplier for number-based games (Roulette)
///
/// Returns the boosted payout if the result matches a super multiplier.
pub fn apply_super_multiplier_number(
    result: u8,
    multipliers: &[SuperMultiplier],
    base_payout: u64,
) -> u64 {
    for m in multipliers {
        if m.super_type == SuperType::Number && m.id == result {
            return base_payout.saturating_mul(m.multiplier as u64);
        }
    }
    base_payout
}

/// Apply super multiplier for total-based games (Sic Bo)
///
/// Returns the boosted payout if the total matches a super multiplier.
pub fn apply_super_multiplier_total(
    total: u8,
    multipliers: &[SuperMultiplier],
    base_payout: u64,
) -> u64 {
    for m in multipliers {
        if m.super_type == SuperType::Total && m.id == total {
            return base_payout.saturating_mul(m.multiplier as u64);
        }
    }
    base_payout
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

        assert!(!mults.is_empty() && mults.len() <= 5);
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
            assert!(m.multiplier >= 50 && m.multiplier <= 500);
            assert_eq!(m.super_type, SuperType::Number);
        }
    }

    #[test]
    fn test_generate_blackjack_multipliers() {
        let mut rng = create_test_rng(3);
        let mults = generate_blackjack_multipliers(&mut rng);

        assert_eq!(mults.len(), 3);
        for m in &mults {
            assert!(m.id < 52);
            assert!(m.multiplier >= 2 && m.multiplier <= 10);
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
            assert!(m.multiplier >= 3 && m.multiplier <= 25);
            assert_eq!(m.super_type, SuperType::Number);
        }
    }

    #[test]
    fn test_generate_sic_bo_multipliers() {
        let mut rng = create_test_rng(5);
        let mults = generate_sic_bo_multipliers(&mut rng);

        assert_eq!(mults.len(), 3);
        for m in &mults {
            assert!(m.id >= 4 && m.id <= 17);
            assert!(m.multiplier >= 3 && m.multiplier <= 50);
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
            assert!(m.multiplier >= 2 && m.multiplier <= 5);
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
            assert_eq!(m.multiplier, 2);
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
            assert_eq!(m.multiplier, 2);
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
            assert_eq!(m.multiplier, 3);
            assert_eq!(m.super_type, SuperType::Rank);
        }
    }

    #[test]
    fn test_generate_hilo_state() {
        let state0 = generate_hilo_state(0);
        assert_eq!(state0.streak_level, 0);
        assert_eq!(state0.multipliers[0].multiplier, 15);

        let state2 = generate_hilo_state(2);
        assert_eq!(state2.streak_level, 2);
        assert_eq!(state2.multipliers[0].multiplier, 25);

        let state5 = generate_hilo_state(5);
        assert_eq!(state5.streak_level, 5);
        assert_eq!(state5.multipliers[0].multiplier, 40);
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
}
