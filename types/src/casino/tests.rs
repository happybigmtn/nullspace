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
