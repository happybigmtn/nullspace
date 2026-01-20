use super::*;
use commonware_codec::Encode;
use commonware_codec::ReadExt;
use commonware_cryptography::{ed25519::PrivateKey, Signer};
use commonware_math::algebra::Random;
use rand::{rngs::StdRng, SeedableRng};

#[test]
fn test_game_type_roundtrip() {
    for game_type in [
        GameType::Baccarat,
        GameType::Blackjack,
        GameType::CasinoWar,
        GameType::Craps,
        GameType::VideoPoker,
        GameType::HiLo,
        GameType::Roulette,
        GameType::SicBo,
        GameType::ThreeCard,
        GameType::UltimateHoldem,
    ] {
        let encoded = game_type.encode();
        let decoded = GameType::read(&mut &encoded[..]).unwrap();
        assert_eq!(game_type, decoded);
    }
}

#[test]
fn test_player_roundtrip() {
    let player = Player::new("TestPlayer".to_string());
    player.validate_invariants().expect("valid invariants");
    let encoded = player.encode();
    let decoded = Player::read(&mut &encoded[..]).unwrap();
    assert_eq!(player, decoded);
}

#[test]
fn test_player_validate_rejects_name_too_long() {
    let player = Player::new("x".repeat(MAX_NAME_LENGTH + 1));
    assert!(matches!(
        player.validate_invariants(),
        Err(PlayerInvariantError::NameTooLong { .. })
    ));
}

#[test]
fn test_player_validate_rejects_aura_meter_out_of_range() {
    let mut player = Player::new("TestPlayer".to_string());
    player.modifiers.aura_meter = 6;
    assert!(matches!(
        player.validate_invariants(),
        Err(PlayerInvariantError::AuraMeterOutOfRange { .. })
    ));
}

#[test]
fn test_leaderboard_update() {
    let mut rng = StdRng::seed_from_u64(42);
    let mut leaderboard = CasinoLeaderboard::default();

    // Add some players
    for i in 0..15 {
        let pk = PrivateKey::random(&mut rng).public_key();
        leaderboard.update(pk, format!("Player{}", i), (i as u64 + 1) * 1000);
    }

    // Should only keep top 10
    assert_eq!(leaderboard.entries.len(), 10);

    // Should be sorted by chips descending
    for i in 0..9 {
        assert!(leaderboard.entries[i].chips >= leaderboard.entries[i + 1].chips);
    }

    // Ranks should be 1-10
    for (i, entry) in leaderboard.entries.iter().enumerate() {
        assert_eq!(entry.rank, (i + 1) as u32);
    }
}

#[test]
fn test_leaderboard_equal_chip_ordering_is_deterministic() {
    let pk1 = PrivateKey::from_seed(1).public_key();
    let pk2 = PrivateKey::from_seed(2).public_key();
    let pk3 = PrivateKey::from_seed(3).public_key();

    let mut keys = vec![pk1, pk2, pk3];
    keys.sort();

    let mut leaderboard = CasinoLeaderboard::default();
    // Insert in non-sorted order; ordering should still be deterministic.
    leaderboard.update(keys[1].clone(), "b".to_string(), 1_000);
    leaderboard.update(keys[2].clone(), "c".to_string(), 1_000);
    leaderboard.update(keys[0].clone(), "a".to_string(), 1_000);

    assert_eq!(leaderboard.entries.len(), 3);
    for i in 0..2 {
        assert_eq!(leaderboard.entries[i].chips, 1_000);
        assert_eq!(leaderboard.entries[i + 1].chips, 1_000);
        assert!(
            leaderboard.entries[i].player <= leaderboard.entries[i + 1].player,
            "expected deterministic tie-breaker ordering by public key"
        );
    }
}

#[test]
fn test_leaderboard_tiebreaker_affects_top10_cutoff() {
    let mut keys = (0..11u8)
        .map(|seed| PrivateKey::from_seed(seed as u64 + 1).public_key())
        .collect::<Vec<_>>();
    keys.sort();

    let mut leaderboard = CasinoLeaderboard::default();

    // Fill with the 10 highest keys at the same chip count.
    for pk in keys.iter().skip(1) {
        leaderboard.update(pk.clone(), "x".to_string(), 1_000);
    }
    assert_eq!(leaderboard.entries.len(), 10);
    assert!(!leaderboard.entries.iter().any(|e| e.player == keys[0]));

    // A key that sorts earlier should displace the current last entry even with equal chips.
    leaderboard.update(keys[0].clone(), "new".to_string(), 1_000);
    assert_eq!(leaderboard.entries.len(), 10);
    assert!(leaderboard.entries.iter().any(|e| e.player == keys[0]));
    assert!(!leaderboard
        .entries
        .iter()
        .any(|e| e.player == *keys.last().unwrap()));
}

#[test]
fn test_tournament_players_canonicalized_on_decode() {
    let pk1 = PrivateKey::from_seed(1).public_key();
    let pk2 = PrivateKey::from_seed(2).public_key();

    let tournament = Tournament {
        players: vec![pk2.clone(), pk1.clone(), pk1.clone()],
        ..Default::default()
    };

    let encoded = tournament.encode();
    let decoded = Tournament::read(&mut &encoded[..]).unwrap();

    assert_eq!(decoded.players, vec![pk1, pk2]);
}

#[test]
fn test_tournament_add_player_keeps_sorted_unique() {
    let pk1 = PrivateKey::from_seed(1).public_key();
    let pk2 = PrivateKey::from_seed(2).public_key();
    let pk3 = PrivateKey::from_seed(3).public_key();

    let mut tournament = Tournament::default();
    assert!(tournament.add_player(pk2.clone()));
    assert!(tournament.add_player(pk1.clone()));
    assert!(tournament.add_player(pk3.clone()));
    assert!(!tournament.add_player(pk2.clone()));

    assert_eq!(tournament.players, vec![pk1, pk2, pk3]);
}

#[test]
fn test_tournament_contains_player_uses_sorted_membership() {
    let pk1 = PrivateKey::from_seed(1).public_key();
    let pk2 = PrivateKey::from_seed(2).public_key();

    let mut tournament = Tournament::default();
    assert!(!tournament.contains_player(&pk1));
    assert!(tournament.add_player(pk1.clone()));
    assert!(tournament.contains_player(&pk1));
    assert!(!tournament.contains_player(&pk2));
}

#[test]
fn test_tournament_decode_rejects_too_many_players() {
    let players = (0..1001u64)
        .map(|seed| PrivateKey::from_seed(seed + 1).public_key())
        .collect::<Vec<_>>();

    let tournament = Tournament {
        players,
        ..Default::default()
    };

    let encoded = tournament.encode();
    let err = Tournament::read(&mut &encoded[..]).expect_err("should reject >1000 players");
    assert!(matches!(err, commonware_codec::Error::InvalidLength(_)));
}

// ============================================================================
// HouseBankroll Tests - AC-7.2 Exposure Limit Enforcement
// ============================================================================

#[test]
fn test_house_bankroll_default() {
    let bankroll = HouseBankroll::default();
    assert_eq!(bankroll.bankroll, 0);
    assert_eq!(bankroll.current_exposure, 0);
    assert_eq!(bankroll.max_exposure_bps, 5000); // 50%
    assert_eq!(bankroll.max_single_bet, 10_000);
    assert_eq!(bankroll.max_player_exposure, 50_000);
}

#[test]
fn test_house_bankroll_new_with_initial_funds() {
    let bankroll = HouseBankroll::new(1_000_000);
    assert_eq!(bankroll.bankroll, 1_000_000);
    assert_eq!(bankroll.current_exposure, 0);
}

#[test]
fn test_house_bankroll_max_allowed_exposure() {
    let bankroll = HouseBankroll::new(1_000_000);
    // 50% of 1M = 500K
    assert_eq!(bankroll.max_allowed_exposure(), 500_000);
}

#[test]
fn test_house_bankroll_available_capacity() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    assert_eq!(bankroll.available_capacity(), 500_000);

    bankroll.current_exposure = 200_000;
    assert_eq!(bankroll.available_capacity(), 300_000);
}

#[test]
fn test_house_bankroll_utilization() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    assert_eq!(bankroll.utilization_bps(), 0);

    bankroll.current_exposure = 250_000;
    // 250K / 500K = 50% = 5000 bps
    assert_eq!(bankroll.utilization_bps(), 5000);

    bankroll.current_exposure = 500_000;
    assert_eq!(bankroll.utilization_bps(), 10_000); // 100%
}

#[test]
fn test_house_bankroll_check_bet_exposure_allows_valid_bet() {
    let bankroll = HouseBankroll::new(1_000_000);
    // Bet 1000, max multiplier 30x = 30K exposure, well under 500K limit
    assert!(bankroll.check_bet_exposure(1_000, 30, 0).is_ok());
}

#[test]
fn test_house_bankroll_check_bet_rejects_single_bet_too_large() {
    let bankroll = HouseBankroll::new(1_000_000);
    // Default max_single_bet is 10K
    let result = bankroll.check_bet_exposure(15_000, 30, 0);
    assert!(matches!(
        result,
        Err(ExposureLimitError::SingleBetExceeded { bet_amount: 15_000, max_allowed: 10_000 })
    ));
}

#[test]
fn test_house_bankroll_check_bet_rejects_player_exposure_exceeded() {
    let bankroll = HouseBankroll::new(1_000_000);
    // Player already has 45K exposure, trying to add 10K @ 30x = 300K more
    let result = bankroll.check_bet_exposure(10_000, 30, 45_000);
    assert!(matches!(
        result,
        Err(ExposureLimitError::PlayerExposureExceeded { current_exposure: 45_000, .. })
    ));
}

#[test]
fn test_house_bankroll_check_bet_rejects_house_exposure_exceeded() {
    let mut bankroll = HouseBankroll::new(100_000);
    // Max exposure is 50K (50% of 100K)
    // Current exposure is 40K, trying to add 5K @ 30x = 150K more would exceed
    bankroll.current_exposure = 40_000;
    bankroll.max_player_exposure = 1_000_000; // raise player limit to not hit it first

    let result = bankroll.check_bet_exposure(5_000, 30, 0);
    assert!(matches!(
        result,
        Err(ExposureLimitError::HouseExposureExceeded { current_exposure: 40_000, .. })
    ));
}

#[test]
fn test_house_bankroll_add_exposure() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    assert_eq!(bankroll.current_exposure, 0);
    assert_eq!(bankroll.total_bets_placed, 0);
    assert_eq!(bankroll.total_amount_wagered, 0);

    bankroll.add_exposure(1_000, 30);

    assert_eq!(bankroll.current_exposure, 30_000);
    assert_eq!(bankroll.total_bets_placed, 1);
    assert_eq!(bankroll.total_amount_wagered, 1_000);
}

#[test]
fn test_house_bankroll_release_exposure() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    bankroll.current_exposure = 30_000;

    bankroll.release_exposure(30_000);
    assert_eq!(bankroll.current_exposure, 0);
}

#[test]
fn test_house_bankroll_record_payout() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    bankroll.record_payout(50_000);

    assert_eq!(bankroll.total_payouts, 50_000);
    assert_eq!(bankroll.bankroll, 950_000);
}

#[test]
fn test_house_bankroll_add_funds() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    bankroll.add_funds(500_000);
    assert_eq!(bankroll.bankroll, 1_500_000);
}

#[test]
fn test_house_bankroll_roundtrip() {
    let mut bankroll = HouseBankroll::new(1_000_000);
    bankroll.current_exposure = 150_000;
    bankroll.total_bets_placed = 100;
    bankroll.total_amount_wagered = 500_000;
    bankroll.total_payouts = 450_000;
    bankroll.last_updated_ts = 12345;

    let encoded = bankroll.encode();
    let decoded = HouseBankroll::read(&mut &encoded[..]).unwrap();

    assert_eq!(bankroll, decoded);
}

#[test]
fn test_player_exposure_default() {
    let exposure = PlayerExposure::default();
    assert_eq!(exposure.current_exposure, 0);
    assert_eq!(exposure.pending_bet_count, 0);
    assert_eq!(exposure.last_bet_ts, 0);
}

#[test]
fn test_player_exposure_roundtrip() {
    let exposure = PlayerExposure {
        current_exposure: 50_000,
        pending_bet_count: 5,
        last_bet_ts: 12345,
    };

    let encoded = exposure.encode();
    let decoded = PlayerExposure::read(&mut &encoded[..]).unwrap();

    assert_eq!(exposure, decoded);
}
