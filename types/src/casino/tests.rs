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

// ============================================================================
// Responsible Gaming Tests - AC-7.4: Daily/Weekly/Monthly Caps
// ============================================================================

#[test]
fn test_responsible_gaming_config_default() {
    let config = ResponsibleGamingConfig::default();
    assert_eq!(config.default_daily_wager_cap, DEFAULT_DAILY_WAGER_CAP);
    assert_eq!(config.default_weekly_wager_cap, DEFAULT_WEEKLY_WAGER_CAP);
    assert_eq!(config.default_monthly_wager_cap, DEFAULT_MONTHLY_WAGER_CAP);
    assert_eq!(config.default_daily_loss_cap, DEFAULT_DAILY_LOSS_CAP);
    assert_eq!(config.default_weekly_loss_cap, DEFAULT_WEEKLY_LOSS_CAP);
    assert_eq!(config.default_monthly_loss_cap, DEFAULT_MONTHLY_LOSS_CAP);
    assert_eq!(config.min_self_exclusion_period, SECS_PER_DAY);
    assert_eq!(config.max_self_exclusion_period, 365 * SECS_PER_DAY);
    assert_eq!(config.cooldown_after_exclusion, MIN_COOLDOWN_SECS);
    assert!(config.limits_enabled);
}

#[test]
fn test_responsible_gaming_config_roundtrip() {
    let config = ResponsibleGamingConfig {
        default_daily_wager_cap: 50_000,
        default_weekly_wager_cap: 200_000,
        default_monthly_wager_cap: 600_000,
        default_daily_loss_cap: 25_000,
        default_weekly_loss_cap: 100_000,
        default_monthly_loss_cap: 250_000,
        min_self_exclusion_period: 12 * 60 * 60,
        max_self_exclusion_period: 180 * SECS_PER_DAY,
        cooldown_after_exclusion: 48 * 60 * 60,
        limits_enabled: true,
    };

    let encoded = config.encode();
    let decoded = ResponsibleGamingConfig::read(&mut &encoded[..]).unwrap();
    assert_eq!(config, decoded);
}

#[test]
fn test_player_gaming_limits_default() {
    let limits = PlayerGamingLimits::default();
    assert_eq!(limits.daily_wager_cap, 0);
    assert_eq!(limits.weekly_wager_cap, 0);
    assert_eq!(limits.monthly_wager_cap, 0);
    assert_eq!(limits.daily_loss_cap, 0);
    assert_eq!(limits.weekly_loss_cap, 0);
    assert_eq!(limits.monthly_loss_cap, 0);
    assert_eq!(limits.daily_wagered, 0);
    assert_eq!(limits.weekly_wagered, 0);
    assert_eq!(limits.monthly_wagered, 0);
    assert_eq!(limits.daily_net_loss, 0);
    assert_eq!(limits.weekly_net_loss, 0);
    assert_eq!(limits.monthly_net_loss, 0);
    assert_eq!(limits.self_exclusion_until, 0);
    assert_eq!(limits.cooldown_until, 0);
}

#[test]
fn test_player_gaming_limits_roundtrip() {
    let limits = PlayerGamingLimits {
        daily_wager_cap: 10_000,
        weekly_wager_cap: 50_000,
        monthly_wager_cap: 150_000,
        daily_loss_cap: 5_000,
        weekly_loss_cap: 20_000,
        monthly_loss_cap: 50_000,
        day_start_ts: 1700000000,
        week_start_ts: 1699900000,
        month_start_ts: 1699000000,
        daily_wagered: 5_000,
        weekly_wagered: 25_000,
        monthly_wagered: 75_000,
        daily_net_loss: 2_000,
        weekly_net_loss: 10_000,
        monthly_net_loss: 25_000,
        self_exclusion_until: 1701000000,
        cooldown_until: 1701086400,
        last_activity_ts: 1700050000,
    };

    let encoded = limits.encode();
    let decoded = PlayerGamingLimits::read(&mut &encoded[..]).unwrap();
    assert_eq!(limits, decoded);
}

#[test]
fn test_effective_caps_use_system_default_when_player_unset() {
    let config = ResponsibleGamingConfig::default();
    let limits = PlayerGamingLimits::default();

    // Player caps are 0, so system defaults should be used
    assert_eq!(limits.effective_daily_wager_cap(&config), DEFAULT_DAILY_WAGER_CAP);
    assert_eq!(limits.effective_weekly_wager_cap(&config), DEFAULT_WEEKLY_WAGER_CAP);
    assert_eq!(limits.effective_monthly_wager_cap(&config), DEFAULT_MONTHLY_WAGER_CAP);
    assert_eq!(limits.effective_daily_loss_cap(&config), DEFAULT_DAILY_LOSS_CAP);
    assert_eq!(limits.effective_weekly_loss_cap(&config), DEFAULT_WEEKLY_LOSS_CAP);
    assert_eq!(limits.effective_monthly_loss_cap(&config), DEFAULT_MONTHLY_LOSS_CAP);
}

#[test]
fn test_effective_caps_use_player_cap_when_stricter() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();

    // Set player caps lower than system defaults
    limits.daily_wager_cap = 10_000;
    limits.weekly_wager_cap = 40_000;
    limits.monthly_wager_cap = 100_000;

    assert_eq!(limits.effective_daily_wager_cap(&config), 10_000);
    assert_eq!(limits.effective_weekly_wager_cap(&config), 40_000);
    assert_eq!(limits.effective_monthly_wager_cap(&config), 100_000);
}

#[test]
fn test_effective_caps_use_system_cap_when_stricter() {
    let mut config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();

    // Set system cap very low
    config.default_daily_wager_cap = 5_000;
    // Set player cap higher (won't be used)
    limits.daily_wager_cap = 20_000;

    // System cap is stricter, so it should be used
    assert_eq!(limits.effective_daily_wager_cap(&config), 5_000);
}

#[test]
fn test_period_reset_daily() {
    let mut limits = PlayerGamingLimits::default();
    let base_ts = SECS_PER_DAY * 100; // Some arbitrary day

    // Set initial values
    limits.day_start_ts = base_ts;
    limits.daily_wagered = 50_000;
    limits.daily_net_loss = 10_000;

    // Same day - no reset
    limits.maybe_reset_periods(base_ts + 1000);
    assert_eq!(limits.daily_wagered, 50_000);
    assert_eq!(limits.daily_net_loss, 10_000);

    // Next day - should reset
    limits.maybe_reset_periods(base_ts + SECS_PER_DAY + 1);
    assert_eq!(limits.daily_wagered, 0);
    assert_eq!(limits.daily_net_loss, 0);
    assert_eq!(limits.day_start_ts, base_ts + SECS_PER_DAY);
}

#[test]
fn test_period_reset_weekly() {
    let mut limits = PlayerGamingLimits::default();
    let base_ts = SECS_PER_WEEK * 10; // Some arbitrary week

    limits.week_start_ts = base_ts;
    limits.weekly_wagered = 200_000;
    limits.weekly_net_loss = 50_000;

    // Same week - no reset
    limits.maybe_reset_periods(base_ts + SECS_PER_DAY);
    assert_eq!(limits.weekly_wagered, 200_000);

    // Next week - should reset
    limits.maybe_reset_periods(base_ts + SECS_PER_WEEK + 1);
    assert_eq!(limits.weekly_wagered, 0);
    assert_eq!(limits.weekly_net_loss, 0);
}

#[test]
fn test_period_reset_monthly() {
    let mut limits = PlayerGamingLimits::default();
    let base_ts = SECS_PER_MONTH * 5; // Some arbitrary month

    limits.month_start_ts = base_ts;
    limits.monthly_wagered = 500_000;
    limits.monthly_net_loss = 100_000;

    // Same month - no reset
    limits.maybe_reset_periods(base_ts + SECS_PER_WEEK);
    assert_eq!(limits.monthly_wagered, 500_000);

    // Next month - should reset
    limits.maybe_reset_periods(base_ts + SECS_PER_MONTH + 1);
    assert_eq!(limits.monthly_wagered, 0);
    assert_eq!(limits.monthly_net_loss, 0);
}

#[test]
fn test_check_limits_allows_bet_within_caps() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;

    // Bet well under all caps
    let result = limits.check_limits(&config, 1_000, now_ts);
    assert!(result.is_ok());
}

#[test]
fn test_check_limits_rejects_daily_wager_cap_exceeded() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;
    limits.daily_wagered = DEFAULT_DAILY_WAGER_CAP - 500;

    // This bet would exceed daily cap
    let result = limits.check_limits(&config, 1_000, now_ts);
    assert!(matches!(
        result,
        Err(ResponsibleGamingError::DailyWagerCapExceeded { .. })
    ));
}

#[test]
fn test_check_limits_rejects_weekly_wager_cap_exceeded() {
    let mut config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    // Make daily cap unlimited so we hit weekly first
    config.default_daily_wager_cap = 0;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;
    limits.weekly_wagered = DEFAULT_WEEKLY_WAGER_CAP - 500;

    let result = limits.check_limits(&config, 1_000, now_ts);
    assert!(matches!(
        result,
        Err(ResponsibleGamingError::WeeklyWagerCapExceeded { .. })
    ));
}

#[test]
fn test_check_limits_rejects_monthly_wager_cap_exceeded() {
    let mut config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    // Make daily and weekly caps unlimited
    config.default_daily_wager_cap = 0;
    config.default_weekly_wager_cap = 0;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;
    limits.monthly_wagered = DEFAULT_MONTHLY_WAGER_CAP - 500;

    let result = limits.check_limits(&config, 1_000, now_ts);
    assert!(matches!(
        result,
        Err(ResponsibleGamingError::MonthlyWagerCapExceeded { .. })
    ));
}

#[test]
fn test_check_limits_rejects_daily_loss_cap_reached() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;
    // Loss cap already reached
    limits.daily_net_loss = DEFAULT_DAILY_LOSS_CAP as i64;

    let result = limits.check_limits(&config, 100, now_ts);
    assert!(matches!(
        result,
        Err(ResponsibleGamingError::DailyLossCapReached { .. })
    ));
}

#[test]
fn test_check_limits_allows_bet_when_in_profit() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;
    // Player is in profit (negative net_loss)
    limits.daily_net_loss = -10_000;

    let result = limits.check_limits(&config, 1_000, now_ts);
    assert!(result.is_ok());
}

#[test]
fn test_check_limits_rejects_self_excluded() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.self_exclusion_until = now_ts + SECS_PER_DAY;

    let result = limits.check_limits(&config, 100, now_ts);
    assert!(matches!(
        result,
        Err(ResponsibleGamingError::SelfExcluded { until_ts }) if until_ts == now_ts + SECS_PER_DAY
    ));
}

#[test]
fn test_check_limits_rejects_in_cooldown() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    // Self-exclusion ended, but cooldown is active
    limits.self_exclusion_until = now_ts - 1000;
    limits.cooldown_until = now_ts + SECS_PER_DAY;

    let result = limits.check_limits(&config, 100, now_ts);
    assert!(matches!(
        result,
        Err(ResponsibleGamingError::InCooldown { until_ts }) if until_ts == now_ts + SECS_PER_DAY
    ));
}

#[test]
fn test_check_limits_disabled_allows_all() {
    let mut config = ResponsibleGamingConfig::default();
    config.limits_enabled = false;

    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    // Even with self-exclusion set, disabled limits allow betting
    limits.self_exclusion_until = now_ts + SECS_PER_DAY;
    limits.daily_wagered = u64::MAX - 1;

    let result = limits.check_limits(&config, 100, now_ts);
    assert!(result.is_ok());
}

#[test]
fn test_record_wager_updates_all_periods() {
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;

    limits.record_wager(1_000, now_ts);

    assert_eq!(limits.daily_wagered, 1_000);
    assert_eq!(limits.weekly_wagered, 1_000);
    assert_eq!(limits.monthly_wagered, 1_000);
    assert_eq!(limits.last_activity_ts, now_ts);

    // Record another wager
    limits.record_wager(500, now_ts + 100);

    assert_eq!(limits.daily_wagered, 1_500);
    assert_eq!(limits.weekly_wagered, 1_500);
    assert_eq!(limits.monthly_wagered, 1_500);
}

#[test]
fn test_record_settlement_loss() {
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;

    // Player loses 1000 (negative net_result)
    limits.record_settlement(-1_000, now_ts);

    // net_loss is positive when player loses
    assert_eq!(limits.daily_net_loss, 1_000);
    assert_eq!(limits.weekly_net_loss, 1_000);
    assert_eq!(limits.monthly_net_loss, 1_000);
}

#[test]
fn test_record_settlement_win() {
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.day_start_ts = now_ts;
    limits.week_start_ts = now_ts;
    limits.month_start_ts = now_ts;

    // Player wins 1000 (positive net_result)
    limits.record_settlement(1_000, now_ts);

    // net_loss is negative when player profits
    assert_eq!(limits.daily_net_loss, -1_000);
    assert_eq!(limits.weekly_net_loss, -1_000);
    assert_eq!(limits.monthly_net_loss, -1_000);
}

#[test]
fn test_set_self_exclusion() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    limits.set_self_exclusion(7 * SECS_PER_DAY, now_ts, &config);

    assert_eq!(limits.self_exclusion_until, now_ts + 7 * SECS_PER_DAY);
    assert_eq!(limits.cooldown_until, now_ts + 7 * SECS_PER_DAY + MIN_COOLDOWN_SECS);
}

#[test]
fn test_set_self_exclusion_clamps_to_min() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    // Try to set exclusion shorter than minimum
    limits.set_self_exclusion(1000, now_ts, &config);

    // Should be clamped to minimum (1 day)
    assert_eq!(limits.self_exclusion_until, now_ts + SECS_PER_DAY);
}

#[test]
fn test_set_self_exclusion_clamps_to_max() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();
    let now_ts = SECS_PER_DAY * 100;

    // Try to set exclusion longer than maximum
    limits.set_self_exclusion(500 * SECS_PER_DAY, now_ts, &config);

    // Should be clamped to maximum (365 days)
    assert_eq!(limits.self_exclusion_until, now_ts + 365 * SECS_PER_DAY);
}

#[test]
fn test_remaining_wager_allowance() {
    let config = ResponsibleGamingConfig::default();
    let mut limits = PlayerGamingLimits::default();

    limits.daily_wagered = 30_000;
    limits.weekly_wagered = 100_000;
    limits.monthly_wagered = 500_000;

    assert_eq!(
        limits.remaining_daily_wager(&config),
        DEFAULT_DAILY_WAGER_CAP - 30_000
    );
    assert_eq!(
        limits.remaining_weekly_wager(&config),
        DEFAULT_WEEKLY_WAGER_CAP - 100_000
    );
    assert_eq!(
        limits.remaining_monthly_wager(&config),
        DEFAULT_MONTHLY_WAGER_CAP - 500_000
    );
}

#[test]
fn test_remaining_wager_unlimited_when_cap_zero() {
    let mut config = ResponsibleGamingConfig::default();
    config.default_daily_wager_cap = 0;

    let limits = PlayerGamingLimits::default();

    assert_eq!(limits.remaining_daily_wager(&config), u64::MAX);
}

#[test]
fn test_is_self_excluded() {
    let mut limits = PlayerGamingLimits::default();
    let now_ts = 1000;

    // Not excluded
    assert!(!limits.is_self_excluded(now_ts));

    // Set exclusion in the future
    limits.self_exclusion_until = now_ts + 100;
    assert!(limits.is_self_excluded(now_ts));

    // Exclusion expired
    limits.self_exclusion_until = now_ts - 1;
    assert!(!limits.is_self_excluded(now_ts));
}

#[test]
fn test_is_in_cooldown() {
    let mut limits = PlayerGamingLimits::default();
    let now_ts = 1000;

    // Not in cooldown
    assert!(!limits.is_in_cooldown(now_ts));

    // Set cooldown in the future
    limits.cooldown_until = now_ts + 100;
    assert!(limits.is_in_cooldown(now_ts));

    // Cooldown expired
    limits.cooldown_until = now_ts - 1;
    assert!(!limits.is_in_cooldown(now_ts));
}

#[test]
fn test_responsible_gaming_error_variants() {
    // Ensure all error variants can be created and compared
    let errors = vec![
        ResponsibleGamingError::SelfExcluded { until_ts: 100 },
        ResponsibleGamingError::InCooldown { until_ts: 200 },
        ResponsibleGamingError::DailyWagerCapExceeded {
            current: 90_000,
            cap: 100_000,
            bet_amount: 20_000,
        },
        ResponsibleGamingError::WeeklyWagerCapExceeded {
            current: 450_000,
            cap: 500_000,
            bet_amount: 100_000,
        },
        ResponsibleGamingError::MonthlyWagerCapExceeded {
            current: 1_400_000,
            cap: 1_500_000,
            bet_amount: 200_000,
        },
        ResponsibleGamingError::DailyLossCapReached {
            current_loss: 50_000,
            cap: 50_000,
        },
        ResponsibleGamingError::WeeklyLossCapReached {
            current_loss: 200_000,
            cap: 200_000,
        },
        ResponsibleGamingError::MonthlyLossCapReached {
            current_loss: 500_000,
            cap: 500_000,
        },
    ];

    // All variants should be distinct
    for (i, e1) in errors.iter().enumerate() {
        for (j, e2) in errors.iter().enumerate() {
            if i == j {
                assert_eq!(e1, e2);
            } else {
                assert_ne!(e1, e2);
            }
        }
    }
}
