use super::*;
use commonware_codec::Encode;
use commonware_codec::ReadExt;
use commonware_cryptography::{ed25519::PrivateKey, PrivateKeyExt, Signer};
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
    let encoded = player.encode();
    let decoded = Player::read(&mut &encoded[..]).unwrap();
    assert_eq!(player, decoded);
}

#[test]
fn test_leaderboard_update() {
    let mut rng = StdRng::seed_from_u64(42);
    let mut leaderboard = CasinoLeaderboard::default();

    // Add some players
    for i in 0..15 {
        let pk = PrivateKey::from_rng(&mut rng).public_key();
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
