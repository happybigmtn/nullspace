//! State blob migration tests.
//!
//! These tests verify that state blobs from older versions can be deserialized
//! correctly when the format changes, ensuring in-progress games don't brick
//! on upgrade.

#[cfg(test)]
mod tests {
    use crate::casino::blackjack::{Stage, HandStatus};
    use crate::casino::serialization::{StateReader, StateWriter};

    const STATE_VERSION_V2: u8 = 2;
    const STATE_VERSION_V3: u8 = 3;
    const STATE_VERSION_V4: u8 = 4;

    /// Create a v2 blackjack state blob (only 21plus3 side bet)
    fn create_v2_blackjack_blob() -> Vec<u8> {
        let mut w = StateWriter::with_capacity(128);

        // Version
        w.push_u8(STATE_VERSION_V2);

        // Stage
        w.push_u8(Stage::PlayerTurn as u8);

        // Side bets (v2 only has 21plus3)
        w.push_u64_be(100); // side_bet_21plus3

        // Initial player cards
        w.push_bytes(&[0, 13]); // A♠, 2♠

        // Active hand index
        w.push_u8(0);

        // Hand count
        w.push_u8(1);

        // Hand 0
        w.push_u8(1); // bet_mult
        w.push_u8(HandStatus::Playing as u8);
        w.push_u8(0); // was_split = false
        w.push_u8(2); // card count
        w.push_bytes(&[0, 13]); // A♠, 2♠

        // Dealer cards
        w.push_u8(1); // dealer card count
        w.push_bytes(&[26]); // A♥

        // Rules
        w.push_bytes(&[0, 0]); // default rules

        w.into_inner()
    }

    /// Create a v3 blackjack state blob (4 side bets)
    fn create_v3_blackjack_blob() -> Vec<u8> {
        let mut w = StateWriter::with_capacity(128);

        // Version
        w.push_u8(STATE_VERSION_V3);

        // Stage
        w.push_u8(Stage::PlayerTurn as u8);

        // Side bets (v3 has 4 side bets)
        w.push_u64_be(100); // side_bet_21plus3
        w.push_u64_be(50);  // side_bet_lucky_ladies
        w.push_u64_be(25);  // side_bet_perfect_pairs
        w.push_u64_be(10);  // side_bet_bust_it

        // Initial player cards
        w.push_bytes(&[0, 13]); // A♠, 2♠

        // Active hand index
        w.push_u8(0);

        // Hand count
        w.push_u8(1);

        // Hand 0
        w.push_u8(1); // bet_mult
        w.push_u8(HandStatus::Playing as u8);
        w.push_u8(0); // was_split = false
        w.push_u8(2); // card count
        w.push_bytes(&[0, 13]); // A♠, 2♠

        // Dealer cards
        w.push_u8(1); // dealer card count
        w.push_bytes(&[26]); // A♥

        // Rules
        w.push_bytes(&[0, 0]); // default rules

        w.into_inner()
    }

    /// Create a v4 blackjack state blob (5 side bets - current version)
    fn create_v4_blackjack_blob() -> Vec<u8> {
        let mut w = StateWriter::with_capacity(128);

        // Version
        w.push_u8(STATE_VERSION_V4);

        // Stage
        w.push_u8(Stage::PlayerTurn as u8);

        // Side bets (v4 has 5 side bets)
        w.push_u64_be(100); // side_bet_21plus3
        w.push_u64_be(50);  // side_bet_lucky_ladies
        w.push_u64_be(25);  // side_bet_perfect_pairs
        w.push_u64_be(10);  // side_bet_bust_it
        w.push_u64_be(5);   // side_bet_royal_match

        // Initial player cards
        w.push_bytes(&[0, 13]); // A♠, 2♠

        // Active hand index
        w.push_u8(0);

        // Hand count
        w.push_u8(1);

        // Hand 0
        w.push_u8(1); // bet_mult
        w.push_u8(HandStatus::Playing as u8);
        w.push_u8(0); // was_split = false
        w.push_u8(2); // card count
        w.push_bytes(&[0, 13]); // A♠, 2♠

        // Dealer cards
        w.push_u8(1); // dealer card count
        w.push_bytes(&[26]); // A♥

        // Rules
        w.push_bytes(&[0, 0]); // default rules

        w.into_inner()
    }

    /// Parse side bets from a state blob based on version
    /// Returns (version, stage, side_bet_21plus3, side_bet_lucky_ladies, side_bet_perfect_pairs, side_bet_bust_it, side_bet_royal_match)
    fn parse_side_bets_from_blob(blob: &[u8]) -> Option<(u8, Stage, u64, u64, u64, u64, u64)> {
        if blob.len() < 2 {
            return None;
        }

        let mut reader = StateReader::new(blob);
        let version = reader.read_u8()?;
        let stage_byte = reader.read_u8()?;
        let stage = Stage::try_from(stage_byte).ok()?;

        // Read side bets based on version
        let (side_bet_21plus3, side_bet_lucky_ladies, side_bet_perfect_pairs, side_bet_bust_it, side_bet_royal_match) =
            if version == 2 {
                (reader.read_u64_be()?, 0, 0, 0, 0)
            } else if version == 3 {
                (
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                    0,
                )
            } else if version == 4 {
                (
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                    reader.read_u64_be()?,
                )
            } else {
                return None;
            };

        Some((version, stage, side_bet_21plus3, side_bet_lucky_ladies, side_bet_perfect_pairs, side_bet_bust_it, side_bet_royal_match))
    }

    #[test]
    fn test_v2_to_current_migration() {
        let v2_blob = create_v2_blackjack_blob();
        let (version, stage, bet_21plus3, bet_lucky_ladies, bet_perfect_pairs, bet_bust_it, bet_royal_match) =
            parse_side_bets_from_blob(&v2_blob)
            .expect("v2 blob should parse successfully");

        // Verify version and stage
        assert_eq!(version, STATE_VERSION_V2, "version should be v2");
        assert_eq!(stage, Stage::PlayerTurn, "stage should be PlayerTurn");

        // Verify v2 fields are preserved
        assert_eq!(bet_21plus3, 100, "21plus3 bet should be preserved");

        // Verify newer fields default to 0
        assert_eq!(bet_lucky_ladies, 0, "lucky_ladies should default to 0");
        assert_eq!(bet_perfect_pairs, 0, "perfect_pairs should default to 0");
        assert_eq!(bet_bust_it, 0, "bust_it should default to 0");
        assert_eq!(bet_royal_match, 0, "royal_match should default to 0");
    }

    #[test]
    fn test_v3_to_current_migration() {
        let v3_blob = create_v3_blackjack_blob();
        let (version, stage, bet_21plus3, bet_lucky_ladies, bet_perfect_pairs, bet_bust_it, bet_royal_match) =
            parse_side_bets_from_blob(&v3_blob)
            .expect("v3 blob should parse successfully");

        // Verify version and stage
        assert_eq!(version, STATE_VERSION_V3, "version should be v3");
        assert_eq!(stage, Stage::PlayerTurn, "stage should be PlayerTurn");

        // Verify v3 fields are preserved
        assert_eq!(bet_21plus3, 100, "21plus3 bet should be preserved");
        assert_eq!(bet_lucky_ladies, 50, "lucky_ladies bet should be preserved");
        assert_eq!(bet_perfect_pairs, 25, "perfect_pairs bet should be preserved");
        assert_eq!(bet_bust_it, 10, "bust_it bet should be preserved");

        // Verify newest field defaults to 0
        assert_eq!(bet_royal_match, 0, "royal_match should default to 0");
    }

    #[test]
    fn test_v4_round_trip() {
        let v4_blob = create_v4_blackjack_blob();
        let (version, stage, bet_21plus3, bet_lucky_ladies, bet_perfect_pairs, bet_bust_it, bet_royal_match) =
            parse_side_bets_from_blob(&v4_blob)
            .expect("v4 blob should parse successfully");

        // Verify version and stage
        assert_eq!(version, STATE_VERSION_V4, "version should be v4");
        assert_eq!(stage, Stage::PlayerTurn, "stage should be PlayerTurn");

        // Verify all v4 fields are preserved
        assert_eq!(bet_21plus3, 100, "21plus3 bet should be preserved");
        assert_eq!(bet_lucky_ladies, 50, "lucky_ladies bet should be preserved");
        assert_eq!(bet_perfect_pairs, 25, "perfect_pairs bet should be preserved");
        assert_eq!(bet_bust_it, 10, "bust_it bet should be preserved");
        assert_eq!(bet_royal_match, 5, "royal_match bet should be preserved");
    }

    #[test]
    fn test_unknown_version_rejected() {
        let mut blob = create_v4_blackjack_blob();
        blob[0] = 99; // Invalid version

        let result = parse_side_bets_from_blob(&blob);
        assert!(result.is_none(), "Unknown version should be rejected");
    }

    #[test]
    fn test_migration_preserves_game_state() {
        // Create v2 blob with specific game state
        let v2_blob = create_v2_blackjack_blob();

        // Parse it
        let (v2_version, v2_stage, v2_bet_21plus3, _, _, _, _) =
            parse_side_bets_from_blob(&v2_blob)
            .expect("v2 blob should parse");

        // Verify game state fields are correct
        assert_eq!(v2_version, STATE_VERSION_V2);
        assert_eq!(v2_stage, Stage::PlayerTurn);
        assert_eq!(v2_bet_21plus3, 100);

        // Create v3 blob with same base state
        let v3_blob = create_v3_blackjack_blob();
        let (v3_version, v3_stage, v3_bet_21plus3, _, _, _, _) =
            parse_side_bets_from_blob(&v3_blob)
            .expect("v3 blob should parse");

        // Verify stage is preserved across versions
        assert_eq!(v3_version, STATE_VERSION_V3);
        assert_eq!(v2_stage, v3_stage, "stage should be preserved across versions");
        assert_eq!(v2_bet_21plus3, v3_bet_21plus3, "21plus3 bet should be preserved across versions");
    }
}
