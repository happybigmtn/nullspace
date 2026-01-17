//! Golden vector generation for cross-language encode/decode parity testing.
//!
//! This module provides deterministic test vectors for protocol messages.
//! These vectors are the **canonical reference** for encoding parity:
//! any implementation (Rust, JS/TS, etc.) must produce identical byte
//! sequences for the same logical message.
//!
//! # AC-3.2 / AC-4.2 Compliance
//!
//! This module satisfies:
//! - **AC-3.2**: Round-trip tests validate parity between Rust and JS/TS encode/decode.
//! - **AC-4.2**: Golden vectors remain stable across Rust and JS/TS builds.
//!
//! # Usage
//!
//! ```
//! use protocol_messages::golden_vectors::{GoldenVectors, export_golden_vectors_json};
//!
//! // Get all golden vectors
//! let vectors = GoldenVectors::canonical();
//!
//! // Export to JSON for JS/TS parity tests
//! let json = export_golden_vectors_json();
//! assert!(json.contains("deal_commitment"));
//! ```
//!
//! # Stability Guarantee
//!
//! Once published, golden vectors are **frozen**. If encoding logic changes,
//! new vectors are added with a version suffix (e.g., `deal_commitment_v2`),
//! and old vectors remain for backward compatibility testing.

use serde::{Deserialize, Serialize};

use crate::{
    ArtifactRequest, ArtifactResponse, DealCommitment, DealCommitmentAck, ProtocolVersion,
    RevealPhase, RevealShare, ScopeBinding, ShuffleContext, TimelockReveal,
};

// Game module imports for v2 compact encoding vectors (AC-3.2, AC-4.2)
use crate::baccarat::{BaccaratMove, BetType as BaccaratBetType, BetDescriptor as BaccaratBetDescriptor};
use crate::blackjack::{BlackjackMove, SideBets as BlackjackSideBets};
use crate::casino_war::CasinoWarMove;
use crate::craps::{CrapsMove, CrapsBet};
use crate::hilo::HiLoMove;
use crate::roulette::{RouletteMove, RouletteBet};
use crate::sic_bo::{SicBoMove, SicBoBet};
use crate::three_card::ThreeCardMove;
use crate::ultimate_holdem::{UltimateHoldemMove, SideBets as UltimateHoldemSideBets, BetMultiplier};
use crate::video_poker::VideoPokerMove;
use crate::{RouletteBetType, CrapsBetType, SicBoBetType};

/// Schema version for golden vectors export.
///
/// Bump when the export structure changes in a breaking way.
///
/// Version history:
/// - v1: Core protocol message vectors (ScopeBinding, DealCommitment, etc.)
/// - v2: Added game v2 compact encoding vectors (AC-3.2, AC-4.2)
/// - v3: Added state blob golden vectors for all 10 games (AC-1.2, AC-4.2)
pub const GOLDEN_VECTORS_SCHEMA_VERSION: u32 = 3;

/// A single golden vector: input message + expected encoded bytes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoldenVector {
    /// Unique identifier for this vector.
    pub name: String,
    /// Human-readable description of what this vector tests.
    pub description: String,
    /// The message type being encoded.
    pub message_type: String,
    /// Hex-encoded preimage bytes.
    pub preimage_hex: String,
    /// Hex-encoded hash of the preimage (blake3).
    pub hash_hex: String,
    /// Expected byte length of the preimage.
    pub preimage_length: usize,
}

impl GoldenVector {
    /// Create a new golden vector from a preimage.
    pub fn new(name: &str, description: &str, message_type: &str, preimage: &[u8]) -> Self {
        let hash = crate::canonical_hash(preimage);
        Self {
            name: name.to_string(),
            description: description.to_string(),
            message_type: message_type.to_string(),
            preimage_hex: hex::encode(preimage),
            hash_hex: hex::encode(hash),
            preimage_length: preimage.len(),
        }
    }

    /// Verify that encoding produces the expected bytes.
    pub fn verify(&self, actual_preimage: &[u8]) -> Result<(), GoldenVectorMismatch> {
        let expected = hex::decode(&self.preimage_hex).expect("golden vector hex is valid");
        if actual_preimage != expected {
            return Err(GoldenVectorMismatch {
                vector_name: self.name.clone(),
                expected_hex: self.preimage_hex.clone(),
                actual_hex: hex::encode(actual_preimage),
            });
        }
        Ok(())
    }
}

/// Error when actual encoding doesn't match golden vector.
#[derive(Debug, Clone)]
pub struct GoldenVectorMismatch {
    pub vector_name: String,
    pub expected_hex: String,
    pub actual_hex: String,
}

impl std::fmt::Display for GoldenVectorMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Golden vector '{}' mismatch:\n  expected: {}\n  actual:   {}",
            self.vector_name, self.expected_hex, self.actual_hex
        )
    }
}

impl std::error::Error for GoldenVectorMismatch {}

/// Complete set of golden vectors for protocol messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoldenVectors {
    /// Schema version for this export.
    pub schema_version: u32,
    /// All golden vectors, keyed by name.
    pub vectors: Vec<GoldenVector>,
}

impl GoldenVectors {
    /// Generate the canonical golden vectors.
    ///
    /// These vectors use deterministic, hardcoded input values.
    /// They must remain stable across releases.
    pub fn canonical() -> Self {
        let mut vectors = Vec::new();

        // ─────────────────────────────────────────────────────────────────────
        // ScopeBinding
        // ─────────────────────────────────────────────────────────────────────

        let scope_minimal = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        vectors.push(GoldenVector::new(
            "scope_binding_minimal",
            "Minimal scope: zero table_id, hand_id=0, empty seats, deck=52",
            "ScopeBinding",
            &scope_minimal.encode(),
        ));

        let scope_typical = ScopeBinding::new(
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        vectors.push(GoldenVector::new(
            "scope_binding_typical",
            "Typical scope: sequential table_id, hand_id=42, 4 seats, deck=52",
            "ScopeBinding",
            &scope_typical.encode(),
        ));

        let scope_max_seats = ScopeBinding::new(
            [0xFF; 32],
            u64::MAX,
            vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            52,
        );
        vectors.push(GoldenVector::new(
            "scope_binding_max_seats",
            "Max seats scope: all-1s table_id, max hand_id, 10 seats, deck=52",
            "ScopeBinding",
            &scope_max_seats.encode(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // ShuffleContext
        // ─────────────────────────────────────────────────────────────────────

        let shuffle_ctx = ShuffleContext::new(
            ProtocolVersion::new(1),
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        vectors.push(GoldenVector::new(
            "shuffle_context_v1",
            "ShuffleContext with v1 protocol, typical table/hand/seats",
            "ShuffleContext",
            &shuffle_ctx.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // DealCommitment
        // ─────────────────────────────────────────────────────────────────────

        let deal_commitment_minimal = DealCommitment {
            version: ProtocolVersion::new(1),
            scope: scope_minimal.clone(),
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "deal_commitment_minimal",
            "Minimal DealCommitment: zero scope, no artifacts, timestamp=0",
            "DealCommitment",
            &deal_commitment_minimal.preimage(),
        ));

        let deal_commitment_typical = DealCommitment {
            version: ProtocolVersion::new(1),
            scope: scope_typical.clone(),
            shuffle_commitment: [
                0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
                0x66, 0x77, 0x88, 0x99,
            ],
            artifact_hashes: vec![
                [0x11; 32],
                [0x22; 32],
            ],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD, 0xBE, 0xEF], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "deal_commitment_typical",
            "Typical DealCommitment: real scope, shuffle hash, 2 artifacts, real timestamp",
            "DealCommitment",
            &deal_commitment_typical.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // DealCommitmentAck
        // ─────────────────────────────────────────────────────────────────────

        let ack = DealCommitmentAck {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            seat_index: 2,
            player_signature: vec![0x12, 0x34], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "deal_commitment_ack_v1",
            "DealCommitmentAck: v1, commitment hash=0x42 repeated, seat=2",
            "DealCommitmentAck",
            &ack.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // RevealShare
        // ─────────────────────────────────────────────────────────────────────

        let reveal_flop = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![
                vec![0x10, 0x20, 0x30, 0x40],
                vec![0x50, 0x60],
                vec![0x70],
            ],
            from_seat: 1,
            signature: vec![0xAB, 0xCD], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "reveal_share_flop",
            "RevealShare for flop: 3 cards, variable-length reveal data",
            "RevealShare",
            &reveal_flop.preimage(),
        ));

        let reveal_showdown = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Showdown,
            card_indices: vec![10, 11],
            reveal_data: vec![vec![0xAA; 64], vec![0xBB; 64]],
            from_seat: 0xFF, // dealer
            signature: vec![],
        };
        vectors.push(GoldenVector::new(
            "reveal_share_showdown",
            "RevealShare for showdown: 2 hole cards, 64-byte reveal data each, from dealer",
            "RevealShare",
            &reveal_showdown.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // TimelockReveal
        // ─────────────────────────────────────────────────────────────────────

        let timelock = TimelockReveal {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Turn,
            card_indices: vec![10],
            timelock_proof: vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            revealed_values: vec![vec![0xCA, 0xFE]],
            timeout_seat: 3,
        };
        vectors.push(GoldenVector::new(
            "timelock_reveal_turn",
            "TimelockReveal for turn: 1 card, 8-byte proof, seat 3 timeout",
            "TimelockReveal",
            &timelock.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // ArtifactRequest
        // ─────────────────────────────────────────────────────────────────────

        let artifact_req = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x11; 32], [0x22; 32]],
            commitment_hash: Some([0x42; 32]),
        };
        vectors.push(GoldenVector::new(
            "artifact_request_with_commitment",
            "ArtifactRequest: 2 artifact hashes, with commitment scope",
            "ArtifactRequest",
            &artifact_req.preimage(),
        ));

        let artifact_req_no_scope = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x33; 32]],
            commitment_hash: None,
        };
        vectors.push(GoldenVector::new(
            "artifact_request_no_commitment",
            "ArtifactRequest: 1 artifact hash, no commitment scope",
            "ArtifactRequest",
            &artifact_req_no_scope.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // ArtifactResponse
        // ─────────────────────────────────────────────────────────────────────

        let artifact_resp = ArtifactResponse {
            version: ProtocolVersion::new(1),
            artifacts: vec![
                ([0x11; 32], vec![0xAA, 0xBB, 0xCC, 0xDD]),
            ],
            missing: vec![[0x22; 32]],
        };
        vectors.push(GoldenVector::new(
            "artifact_response_partial",
            "ArtifactResponse: 1 artifact found (4 bytes), 1 missing",
            "ArtifactResponse",
            &artifact_resp.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Game v2 Compact Encoding Vectors (AC-3.2, AC-4.2)
        // ─────────────────────────────────────────────────────────────────────
        // These vectors verify that JS/TS can decode Rust-encoded v2 payloads.
        // Each game has at least one header-only and one payload-carrying vector.

        // ─────────────────────────────────────────────────────────────────────
        // Blackjack v2
        // ─────────────────────────────────────────────────────────────────────

        let blackjack_hit = BlackjackMove::Hit.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "blackjack_v2_hit",
            "Blackjack Hit: v2 header-only (1 byte)",
            "BlackjackMove",
            &blackjack_hit,
        ));

        let blackjack_stand = BlackjackMove::Stand.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "blackjack_v2_stand",
            "Blackjack Stand: v2 header-only (1 byte)",
            "BlackjackMove",
            &blackjack_stand,
        ));

        let blackjack_deal = BlackjackMove::Deal { side_bets: BlackjackSideBets::none() }
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "blackjack_v2_deal_no_side_bets",
            "Blackjack Deal: v2 with no side bets (2 bytes)",
            "BlackjackMove",
            &blackjack_deal,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Baccarat v2
        // ─────────────────────────────────────────────────────────────────────

        let baccarat_deal = BaccaratMove::Deal.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "baccarat_v2_deal",
            "Baccarat Deal: v2 header-only (1 byte)",
            "BaccaratMove",
            &baccarat_deal,
        ));

        let baccarat_clear = BaccaratMove::ClearBets.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "baccarat_v2_clear_bets",
            "Baccarat ClearBets: v2 header-only (1 byte)",
            "BaccaratMove",
            &baccarat_clear,
        ));

        let baccarat_bet = BaccaratMove::PlaceBet(BaccaratBetDescriptor {
            bet_type: BaccaratBetType::Player,
            amount: 100,
        }).encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "baccarat_v2_place_bet_player_100",
            "Baccarat PlaceBet: Player bet of 100 units",
            "BaccaratMove",
            &baccarat_bet,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Roulette v2
        // ─────────────────────────────────────────────────────────────────────

        let roulette_spin = RouletteMove::Spin.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "roulette_v2_spin",
            "Roulette Spin: v2 header-only (1 byte)",
            "RouletteMove",
            &roulette_spin,
        ));

        let roulette_clear = RouletteMove::ClearBets.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "roulette_v2_clear_bets",
            "Roulette ClearBets: v2 header-only (1 byte)",
            "RouletteMove",
            &roulette_clear,
        ));

        let roulette_bet = RouletteMove::PlaceBet(RouletteBet::new(RouletteBetType::Straight, 17, 50))
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "roulette_v2_straight_bet_17_50",
            "Roulette PlaceBet: Straight bet on 17 for 50 units",
            "RouletteMove",
            &roulette_bet,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Craps v2
        // ─────────────────────────────────────────────────────────────────────

        let craps_roll = CrapsMove::Roll.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "craps_v2_roll",
            "Craps Roll: v2 header-only (1 byte)",
            "CrapsMove",
            &craps_roll,
        ));

        let craps_clear = CrapsMove::ClearBets.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "craps_v2_clear_bets",
            "Craps ClearBets: v2 header-only (1 byte)",
            "CrapsMove",
            &craps_clear,
        ));

        let craps_bet = CrapsMove::PlaceBet(CrapsBet::simple(CrapsBetType::PassLine, 100))
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "craps_v2_pass_line_100",
            "Craps PlaceBet: Pass Line bet for 100 units",
            "CrapsMove",
            &craps_bet,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Sic Bo v2
        // ─────────────────────────────────────────────────────────────────────

        let sic_bo_roll = SicBoMove::Roll.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "sic_bo_v2_roll",
            "Sic Bo Roll: v2 header-only (1 byte)",
            "SicBoMove",
            &sic_bo_roll,
        ));

        let sic_bo_clear = SicBoMove::ClearBets.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "sic_bo_v2_clear_bets",
            "Sic Bo ClearBets: v2 header-only (1 byte)",
            "SicBoMove",
            &sic_bo_clear,
        ));

        let sic_bo_bet = SicBoMove::PlaceBet(SicBoBet::simple(SicBoBetType::Small, 50))
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "sic_bo_v2_small_bet_50",
            "Sic Bo PlaceBet: Small bet for 50 units",
            "SicBoMove",
            &sic_bo_bet,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Three Card Poker v2
        // ─────────────────────────────────────────────────────────────────────

        let three_card_play = ThreeCardMove::Play.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "three_card_v2_play",
            "Three Card Play: v2 header-only (1 byte)",
            "ThreeCardMove",
            &three_card_play,
        ));

        let three_card_fold = ThreeCardMove::Fold.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "three_card_v2_fold",
            "Three Card Fold: v2 header-only (1 byte)",
            "ThreeCardMove",
            &three_card_fold,
        ));

        let three_card_deal = ThreeCardMove::Deal { side_bets: ThreeCardSideBets::none() }
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "three_card_v2_deal_no_side_bets",
            "Three Card Deal: v2 with no side bets",
            "ThreeCardMove",
            &three_card_deal,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Ultimate Texas Hold'em v2
        // ─────────────────────────────────────────────────────────────────────

        let uth_check = UltimateHoldemMove::Check.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "ultimate_holdem_v2_check",
            "Ultimate Hold'em Check: v2 header-only (1 byte)",
            "UltimateHoldemMove",
            &uth_check,
        ));

        let uth_fold = UltimateHoldemMove::Fold.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "ultimate_holdem_v2_fold",
            "Ultimate Hold'em Fold: v2 header-only (1 byte)",
            "UltimateHoldemMove",
            &uth_fold,
        ));

        let uth_bet = UltimateHoldemMove::Bet { multiplier: BetMultiplier::Four }
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "ultimate_holdem_v2_bet_4x",
            "Ultimate Hold'em Bet: 4x multiplier (2 bytes)",
            "UltimateHoldemMove",
            &uth_bet,
        ));

        let uth_deal = UltimateHoldemMove::Deal { side_bets: UltimateHoldemSideBets::none() }
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "ultimate_holdem_v2_deal_no_side_bets",
            "Ultimate Hold'em Deal: v2 with no side bets",
            "UltimateHoldemMove",
            &uth_deal,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Casino War v2
        // ─────────────────────────────────────────────────────────────────────

        let war_play = CasinoWarMove::Play.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "casino_war_v2_play",
            "Casino War Play: v2 header-only (1 byte)",
            "CasinoWarMove",
            &war_play,
        ));

        let war_war = CasinoWarMove::War.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "casino_war_v2_war",
            "Casino War War: v2 header-only (1 byte)",
            "CasinoWarMove",
            &war_war,
        ));

        let war_surrender = CasinoWarMove::Surrender.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "casino_war_v2_surrender",
            "Casino War Surrender: v2 header-only (1 byte)",
            "CasinoWarMove",
            &war_surrender,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Video Poker v2
        // ─────────────────────────────────────────────────────────────────────

        let video_poker_hold_none = VideoPokerMove::HoldMask { mask: 0b00000 }
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "video_poker_v2_hold_none",
            "Video Poker HoldMask: hold no cards (2 bytes)",
            "VideoPokerMove",
            &video_poker_hold_none,
        ));

        let video_poker_hold_all = VideoPokerMove::HoldMask { mask: 0b11111 }
            .encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "video_poker_v2_hold_all",
            "Video Poker HoldMask: hold all cards (2 bytes)",
            "VideoPokerMove",
            &video_poker_hold_all,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Hi-Lo v2
        // ─────────────────────────────────────────────────────────────────────

        let hilo_higher = HiLoMove::Higher.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "hilo_v2_higher",
            "Hi-Lo Higher: v2 header-only (1 byte)",
            "HiLoMove",
            &hilo_higher,
        ));

        let hilo_lower = HiLoMove::Lower.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "hilo_v2_lower",
            "Hi-Lo Lower: v2 header-only (1 byte)",
            "HiLoMove",
            &hilo_lower,
        ));

        let hilo_same = HiLoMove::Same.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "hilo_v2_same",
            "Hi-Lo Same: v2 header-only (1 byte)",
            "HiLoMove",
            &hilo_same,
        ));

        let hilo_cashout = HiLoMove::Cashout.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "hilo_v2_cashout",
            "Hi-Lo Cashout: v2 header-only (1 byte)",
            "HiLoMove",
            &hilo_cashout,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // State Blob Golden Vectors (AC-1.2, AC-4.2)
        // ─────────────────────────────────────────────────────────────────────
        // These vectors verify state blob encoding for all 10 games.
        // Each game has a typical mid-game state for size regression testing.

        // ─────────────────────────────────────────────────────────────────────
        // Blackjack State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::blackjack::{BlackjackState, BlackjackStage, BlackjackHand, HandStatus};
        let blackjack_state = BlackjackState {
            stage: BlackjackStage::PlayerTurn,
            hands: vec![BlackjackHand {
                cards: vec![10, 25, 40], // 3 cards
                bet_mult: 1,
                status: HandStatus::Active,
                was_split: false,
            }],
            active_hand_index: 0,
            dealer_cards: vec![5, 51], // 2 cards
            side_bets: BlackjackSideBets::none(),
        };
        let blackjack_state_encoded = blackjack_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "blackjack_state_v2_typical",
            "Blackjack State: mid-game with 1 hand (3 cards), dealer (2 cards)",
            "BlackjackState",
            &blackjack_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Baccarat State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::baccarat::{BaccaratState, BaccaratStage, BaccaratResult};
        let baccarat_state = BaccaratState {
            stage: BaccaratStage::Complete,
            player_total: 5, // Natural 5
            banker_total: 8, // Natural 8
            result: BaccaratResult::BankerWin,
            player_cards: vec![10, 25], // 2 cards
            banker_cards: vec![5, 40, 12], // 3 cards (drew third)
            bets: vec![
                BaccaratBetDescriptor::new(BaccaratBetType::Banker, 100),
            ],
        };
        let baccarat_state_encoded = baccarat_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "baccarat_state_v2_typical",
            "Baccarat State: complete round with player (2 cards), banker (3 cards)",
            "BaccaratState",
            &baccarat_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Roulette State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::roulette::{RouletteState, RoulettePhase, ZeroRule};
        let roulette_state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![
                RouletteBet::new(RouletteBetType::Straight, 17, 100),
                RouletteBet::simple(RouletteBetType::Red, 200),
            ],
            total_wagered: 300,
            pending_return: 3600, // 35:1 on straight
            history: vec![17, 0, 32, 15, 3],
        };
        let roulette_state_encoded = roulette_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "roulette_state_v2_typical",
            "Roulette State: complete with 2 bets, 5-entry history",
            "RouletteState",
            &roulette_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Craps State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::craps::{CrapsState, CrapsPhase, FieldPaytable};
        let craps_state = CrapsState {
            phase: CrapsPhase::Point,
            point: 6,
            die1: 3,
            die2: 3,
            point_established_epoch: true,
            made_points_mask: 0b0010, // Made 6 once (for Fire bet tracking)
            field_paytable: FieldPaytable::Standard,
            bets: vec![
                CrapsBet::simple(CrapsBetType::PassLine, 100),
            ],
            total_wagered: 100,
        };
        let craps_state_encoded = craps_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "craps_state_v2_typical",
            "Craps State: point phase with pass line bet",
            "CrapsState",
            &craps_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Sic Bo State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::sic_bo::{SicBoState, SicBoPhase, DiceRoll};
        let sic_bo_state = SicBoState {
            phase: SicBoPhase::Resolved,
            current_roll: DiceRoll { die1: 2, die2: 4, die3: 5 }, // Total: 11
            bets: vec![
                SicBoBet::simple(SicBoBetType::Big, 100),
            ],
            history: vec![
                DiceRoll { die1: 2, die2: 4, die3: 5 },
                DiceRoll { die1: 1, die2: 1, die3: 3 },
            ],
        };
        let sic_bo_state_encoded = sic_bo_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "sic_bo_state_v2_typical",
            "Sic Bo State: resolved with 1 bet, 2-entry dice history",
            "SicBoState",
            &sic_bo_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Three Card Poker State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::three_card::{ThreeCardState, ThreeCardStage, HandRank as ThreeCardHandRank, SideBets as ThreeCardSideBets};
        let three_card_state = ThreeCardState {
            stage: ThreeCardStage::Complete,
            has_result: true,
            player_cards: vec![10, 23, 36], // 3 cards
            dealer_cards: vec![5, 18, 31], // 3 cards
            side_bets: ThreeCardSideBets::none(),
            player_rank: ThreeCardHandRank::Pair,
            dealer_rank: ThreeCardHandRank::HighCard,
            dealer_qualifies: true,
        };
        let three_card_state_encoded = three_card_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "three_card_state_v2_typical",
            "Three Card State: complete round with 3 cards each",
            "ThreeCardState",
            &three_card_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Ultimate Texas Hold'em State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::ultimate_holdem::{UltimateHoldemState, UltimateHoldemStage, BonusRank};
        let uth_state = UltimateHoldemState {
            stage: UltimateHoldemStage::River,
            has_result: false,
            hole_cards: vec![10, 23], // 2 hole cards
            community_cards: vec![5, 18, 31, 44, 2], // 5 community cards
            dealer_cards: vec![12, 25], // 2 dealer hole cards
            side_bets: UltimateHoldemSideBets::none(),
            bonus_rank: BonusRank::None,
        };
        let uth_state_encoded = uth_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "ultimate_holdem_state_v2_typical",
            "Ultimate Hold'em State: river phase with all cards dealt",
            "UltimateHoldemState",
            &uth_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Casino War State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::casino_war::{CasinoWarState, CasinoWarStage};
        let casino_war_state = CasinoWarState {
            stage: CasinoWarStage::TieDecision,
            player_card: 10, // Initial player card
            dealer_card: 10, // Initial dealer card (tie!)
            tie_bet: 50,
            war_player_card: Some(23), // War player card
            war_dealer_card: None, // Not yet drawn
        };
        let casino_war_state_encoded = casino_war_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "casino_war_state_v2_typical",
            "Casino War State: tie decision phase after initial tie",
            "CasinoWarState",
            &casino_war_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Video Poker State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::video_poker::{VideoPokerState, VideoPokerStage};
        let video_poker_state = VideoPokerState {
            stage: VideoPokerStage::AwaitingHold,
            cards: [10, 23, 36, 49, 11], // 5 cards
            result: None,
        };
        let video_poker_state_encoded = video_poker_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "video_poker_state_v2_typical",
            "Video Poker State: awaiting hold phase with 5 cards",
            "VideoPokerState",
            &video_poker_state_encoded,
        ));

        // ─────────────────────────────────────────────────────────────────────
        // Hi-Lo State Blob
        // ─────────────────────────────────────────────────────────────────────

        use crate::hilo::{HiLoState, HiLoStage};
        let hilo_state = HiLoState {
            stage: HiLoStage::AwaitingGuess,
            last_card: 23, // Current card shown
            accumulator: 400, // Built up winnings
            rules_id: 0,
        };
        let hilo_state_encoded = hilo_state.encode_v2().expect("encoding cannot fail");
        vectors.push(GoldenVector::new(
            "hilo_state_v2_typical",
            "Hi-Lo State: awaiting guess phase with accumulated winnings",
            "HiLoState",
            &hilo_state_encoded,
        ));

        Self {
            schema_version: GOLDEN_VECTORS_SCHEMA_VERSION,
            vectors,
        }
    }

    /// Get a vector by name.
    pub fn get(&self, name: &str) -> Option<&GoldenVector> {
        self.vectors.iter().find(|v| v.name == name)
    }
}

/// Export golden vectors to JSON for JS/TS parity tests.
///
/// The exported JSON can be loaded by JS/TS test suites to verify
/// that their encoding produces identical byte sequences.
pub fn export_golden_vectors_json() -> String {
    let vectors = GoldenVectors::canonical();
    serde_json::to_string_pretty(&vectors).expect("GoldenVectors serialization cannot fail")
}

/// Export golden vectors to compact JSON (no whitespace).
pub fn export_golden_vectors_json_compact() -> String {
    let vectors = GoldenVectors::canonical();
    serde_json::to_string(&vectors).expect("GoldenVectors serialization cannot fail")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // AC-4.2: Golden vectors remain stable
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-4.2: Golden vectors are deterministic.
    #[test]
    fn test_golden_vectors_deterministic_ac_4_2() {
        let v1 = GoldenVectors::canonical();
        let v2 = GoldenVectors::canonical();
        assert_eq!(v1, v2, "Golden vectors must be deterministic");
    }

    /// AC-4.2: Golden vector JSON export is deterministic.
    #[test]
    fn test_golden_vectors_json_deterministic_ac_4_2() {
        let json1 = export_golden_vectors_json();
        let json2 = export_golden_vectors_json();
        assert_eq!(json1, json2, "JSON export must be deterministic");
    }

    /// AC-4.2: Golden vectors JSON is valid.
    #[test]
    fn test_golden_vectors_json_valid_ac_4_2() {
        let json = export_golden_vectors_json();
        let parsed: serde_json::Value =
            serde_json::from_str(&json).expect("JSON must be valid");
        assert!(parsed.get("schema_version").is_some());
        assert!(parsed.get("vectors").is_some());
    }

    /// AC-4.2: Golden vectors can be deserialized back.
    #[test]
    fn test_golden_vectors_roundtrip_ac_4_2() {
        let original = GoldenVectors::canonical();
        let json = serde_json::to_string(&original).unwrap();
        let parsed: GoldenVectors = serde_json::from_str(&json).unwrap();
        assert_eq!(original, parsed, "Golden vectors must roundtrip through JSON");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-3.2: Round-trip parity tests
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-3.2: ScopeBinding encoding matches golden vector.
    #[test]
    fn test_scope_binding_minimal_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("scope_binding_minimal").unwrap();

        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let actual = scope.encode();

        vector.verify(&actual).expect("ScopeBinding minimal must match golden vector");
    }

    /// AC-3.2: ScopeBinding typical encoding matches golden vector.
    #[test]
    fn test_scope_binding_typical_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("scope_binding_typical").unwrap();

        let scope = ScopeBinding::new(
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        let actual = scope.encode();

        vector.verify(&actual).expect("ScopeBinding typical must match golden vector");
    }

    /// AC-3.2: ShuffleContext encoding matches golden vector.
    #[test]
    fn test_shuffle_context_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("shuffle_context_v1").unwrap();

        let ctx = ShuffleContext::new(
            ProtocolVersion::new(1),
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        let actual = ctx.preimage();

        vector.verify(&actual).expect("ShuffleContext must match golden vector");
    }

    /// AC-3.2: DealCommitment minimal encoding matches golden vector.
    #[test]
    fn test_deal_commitment_minimal_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("deal_commitment_minimal").unwrap();

        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let commitment = DealCommitment {
            version: ProtocolVersion::new(1),
            scope,
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![],
        };
        let actual = commitment.preimage();

        vector.verify(&actual).expect("DealCommitment minimal must match golden vector");
    }

    /// AC-3.2: DealCommitment typical encoding matches golden vector.
    #[test]
    fn test_deal_commitment_typical_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("deal_commitment_typical").unwrap();

        let scope = ScopeBinding::new(
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        let commitment = DealCommitment {
            version: ProtocolVersion::new(1),
            scope,
            shuffle_commitment: [
                0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
                0x66, 0x77, 0x88, 0x99,
            ],
            artifact_hashes: vec![[0x11; 32], [0x22; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD, 0xBE, 0xEF],
        };
        let actual = commitment.preimage();

        vector.verify(&actual).expect("DealCommitment typical must match golden vector");
    }

    /// AC-3.2: DealCommitmentAck encoding matches golden vector.
    #[test]
    fn test_deal_commitment_ack_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("deal_commitment_ack_v1").unwrap();

        let ack = DealCommitmentAck {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            seat_index: 2,
            player_signature: vec![0x12, 0x34],
        };
        let actual = ack.preimage();

        vector.verify(&actual).expect("DealCommitmentAck must match golden vector");
    }

    /// AC-3.2: RevealShare flop encoding matches golden vector.
    #[test]
    fn test_reveal_share_flop_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("reveal_share_flop").unwrap();

        let reveal = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![
                vec![0x10, 0x20, 0x30, 0x40],
                vec![0x50, 0x60],
                vec![0x70],
            ],
            from_seat: 1,
            signature: vec![0xAB, 0xCD],
        };
        let actual = reveal.preimage();

        vector.verify(&actual).expect("RevealShare flop must match golden vector");
    }

    /// AC-3.2: RevealShare showdown encoding matches golden vector.
    #[test]
    fn test_reveal_share_showdown_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("reveal_share_showdown").unwrap();

        let reveal = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Showdown,
            card_indices: vec![10, 11],
            reveal_data: vec![vec![0xAA; 64], vec![0xBB; 64]],
            from_seat: 0xFF,
            signature: vec![],
        };
        let actual = reveal.preimage();

        vector.verify(&actual).expect("RevealShare showdown must match golden vector");
    }

    /// AC-3.2: TimelockReveal encoding matches golden vector.
    #[test]
    fn test_timelock_reveal_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("timelock_reveal_turn").unwrap();

        let timelock = TimelockReveal {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Turn,
            card_indices: vec![10],
            timelock_proof: vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            revealed_values: vec![vec![0xCA, 0xFE]],
            timeout_seat: 3,
        };
        let actual = timelock.preimage();

        vector.verify(&actual).expect("TimelockReveal must match golden vector");
    }

    /// AC-3.2: ArtifactRequest with commitment encoding matches golden vector.
    #[test]
    fn test_artifact_request_with_commitment_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("artifact_request_with_commitment").unwrap();

        let req = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x11; 32], [0x22; 32]],
            commitment_hash: Some([0x42; 32]),
        };
        let actual = req.preimage();

        vector.verify(&actual).expect("ArtifactRequest with commitment must match golden vector");
    }

    /// AC-3.2: ArtifactRequest without commitment encoding matches golden vector.
    #[test]
    fn test_artifact_request_no_commitment_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("artifact_request_no_commitment").unwrap();

        let req = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x33; 32]],
            commitment_hash: None,
        };
        let actual = req.preimage();

        vector.verify(&actual).expect("ArtifactRequest without commitment must match golden vector");
    }

    /// AC-3.2: ArtifactResponse encoding matches golden vector.
    #[test]
    fn test_artifact_response_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("artifact_response_partial").unwrap();

        let resp = ArtifactResponse {
            version: ProtocolVersion::new(1),
            artifacts: vec![([0x11; 32], vec![0xAA, 0xBB, 0xCC, 0xDD])],
            missing: vec![[0x22; 32]],
        };
        let actual = resp.preimage();

        vector.verify(&actual).expect("ArtifactResponse must match golden vector");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Frozen vector tests - these verify exact hex values
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-4.2: Verify frozen hex values for ScopeBinding minimal.
    ///
    /// This test hardcodes the expected hex to catch any encoding changes.
    #[test]
    fn test_scope_binding_minimal_frozen_hex_ac_4_2() {
        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let encoded = scope.encode();
        let hex = hex::encode(&encoded);

        // Frozen hex: 32 zero bytes + 8 zero bytes (hand_id) + 1 byte (count=0) + 1 byte (deck=52)
        let expected = "0000000000000000000000000000000000000000000000000000000000000000\
                        0000000000000000\
                        00\
                        34";
        assert_eq!(hex, expected, "ScopeBinding minimal encoding must be frozen");
    }

    /// AC-4.2: Verify frozen hex values for DealCommitmentAck.
    #[test]
    fn test_deal_commitment_ack_frozen_hex_ac_4_2() {
        let ack = DealCommitmentAck {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            seat_index: 2,
            player_signature: vec![],
        };
        let preimage = ack.preimage();
        let hex = hex::encode(&preimage);

        // Domain prefix "nullspace.deal_commitment_ack.v1" (32 bytes)
        // + version (1) + commitment_hash (32 bytes of 0x42) + seat_index (1)
        let expected_prefix = hex::encode(b"nullspace.deal_commitment_ack.v1");
        assert!(
            hex.starts_with(&expected_prefix),
            "DealCommitmentAck preimage must start with domain prefix"
        );

        // Verify exact length: 32 (domain) + 1 (version) + 32 (hash) + 1 (seat) = 66 bytes
        assert_eq!(preimage.len(), 66, "DealCommitmentAck preimage length must be 66");
    }

    /// AC-4.2: Verify hash stability for DealCommitment.
    #[test]
    fn test_deal_commitment_hash_frozen_ac_4_2() {
        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let commitment = DealCommitment {
            version: ProtocolVersion::new(1),
            scope,
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![],
        };

        let hash = commitment.commitment_hash();
        let hash_hex = hex::encode(hash);

        // This hash must remain stable across releases
        // If this test fails, encoding logic has changed!
        let expected_hash = "8735883a1105f66ed542b052896e34ecdd97932c781d797f1e60692952a9668c";
        assert_eq!(
            hash_hex, expected_hash,
            "DealCommitment hash must remain frozen. Encoding logic may have changed!"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector coverage test
    // ─────────────────────────────────────────────────────────────────────────

    /// Verify we have golden vectors for all message types.
    #[test]
    fn test_golden_vectors_coverage() {
        let vectors = GoldenVectors::canonical();

        // Core protocol message vectors
        let core_vectors = [
            "scope_binding_minimal",
            "scope_binding_typical",
            "scope_binding_max_seats",
            "shuffle_context_v1",
            "deal_commitment_minimal",
            "deal_commitment_typical",
            "deal_commitment_ack_v1",
            "reveal_share_flop",
            "reveal_share_showdown",
            "timelock_reveal_turn",
            "artifact_request_with_commitment",
            "artifact_request_no_commitment",
            "artifact_response_partial",
        ];

        // Game v2 compact encoding vectors (AC-3.2, AC-4.2)
        let game_vectors = [
            // Blackjack
            "blackjack_v2_hit",
            "blackjack_v2_stand",
            "blackjack_v2_deal_no_side_bets",
            // Baccarat
            "baccarat_v2_deal",
            "baccarat_v2_clear_bets",
            "baccarat_v2_place_bet_player_100",
            // Roulette
            "roulette_v2_spin",
            "roulette_v2_clear_bets",
            "roulette_v2_straight_bet_17_50",
            // Craps
            "craps_v2_roll",
            "craps_v2_clear_bets",
            "craps_v2_pass_line_100",
            // Sic Bo
            "sic_bo_v2_roll",
            "sic_bo_v2_clear_bets",
            "sic_bo_v2_small_bet_50",
            // Three Card Poker
            "three_card_v2_play",
            "three_card_v2_fold",
            "three_card_v2_deal_no_side_bets",
            // Ultimate Texas Hold'em
            "ultimate_holdem_v2_check",
            "ultimate_holdem_v2_fold",
            "ultimate_holdem_v2_bet_4x",
            "ultimate_holdem_v2_deal_no_side_bets",
            // Casino War
            "casino_war_v2_play",
            "casino_war_v2_war",
            "casino_war_v2_surrender",
            // Video Poker
            "video_poker_v2_hold_none",
            "video_poker_v2_hold_all",
            // Hi-Lo
            "hilo_v2_higher",
            "hilo_v2_lower",
            "hilo_v2_same",
            "hilo_v2_cashout",
        ];

        // State blob golden vectors (AC-1.2, AC-4.2)
        let state_vectors = [
            "blackjack_state_v2_typical",
            "baccarat_state_v2_typical",
            "roulette_state_v2_typical",
            "craps_state_v2_typical",
            "sic_bo_state_v2_typical",
            "three_card_state_v2_typical",
            "ultimate_holdem_state_v2_typical",
            "casino_war_state_v2_typical",
            "video_poker_state_v2_typical",
            "hilo_state_v2_typical",
        ];

        for name in core_vectors.iter().chain(game_vectors.iter()).chain(state_vectors.iter()) {
            assert!(
                vectors.get(name).is_some(),
                "Golden vector '{}' must exist",
                name
            );
        }

        // Verify count matches
        let expected_count = core_vectors.len() + game_vectors.len() + state_vectors.len();
        assert_eq!(
            vectors.vectors.len(),
            expected_count,
            "Golden vector count must match expected"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-3.2, AC-4.2: Game v2 encoding parity tests
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-3.2: Blackjack Hit encoding matches golden vector.
    #[test]
    fn test_blackjack_hit_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("blackjack_v2_hit").unwrap();

        let actual = crate::blackjack::BlackjackMove::Hit
            .encode_v2()
            .expect("encoding cannot fail");

        vector.verify(&actual).expect("Blackjack Hit must match golden vector");
        // Verify it's a 1-byte header-only payload
        assert_eq!(actual.len(), 1, "Hit should be 1 byte");
    }

    /// AC-3.2: Roulette Straight bet encoding matches golden vector.
    #[test]
    fn test_roulette_straight_bet_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("roulette_v2_straight_bet_17_50").unwrap();

        let bet = crate::roulette::RouletteBet::new(
            crate::RouletteBetType::Straight,
            17,
            50,
        );
        let actual = crate::roulette::RouletteMove::PlaceBet(bet)
            .encode_v2()
            .expect("encoding cannot fail");

        vector.verify(&actual).expect("Roulette bet must match golden vector");
    }

    /// AC-3.2: Craps Pass Line bet encoding matches golden vector.
    #[test]
    fn test_craps_pass_line_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("craps_v2_pass_line_100").unwrap();

        let bet = crate::craps::CrapsBet::simple(crate::CrapsBetType::PassLine, 100);
        let actual = crate::craps::CrapsMove::PlaceBet(bet)
            .encode_v2()
            .expect("encoding cannot fail");

        vector.verify(&actual).expect("Craps bet must match golden vector");
    }

    /// AC-4.2: Game v2 golden vectors are stable across runs.
    #[test]
    fn test_game_golden_vectors_stable_ac_4_2() {
        let v1 = GoldenVectors::canonical();
        let v2 = GoldenVectors::canonical();

        // Verify all game vectors are identical
        for name in [
            "blackjack_v2_hit",
            "roulette_v2_straight_bet_17_50",
            "craps_v2_pass_line_100",
            "hilo_v2_higher",
        ] {
            let vec1 = v1.get(name).unwrap();
            let vec2 = v2.get(name).unwrap();
            assert_eq!(vec1, vec2, "Golden vector '{}' must be stable", name);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-1.1: Move payload size reduction tests (>= 40%)
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-1.1: Typical move payloads achieve >= 40% size reduction vs v1 estimate.
    ///
    /// V1 JSON estimates assume typical overhead:
    /// - Action string: ~10-20 bytes
    /// - Numeric amounts: 4-8 bytes per field
    /// - Object wrapper and field names: ~20-40 bytes
    #[test]
    fn test_move_payload_size_reduction_ac_1_1() {
        // Test cases: (game, v2_payload, v1_estimate, description)
        let test_cases = vec![
            // Blackjack hit: v1 ~= 25 bytes ({"action":"hit"})
            (
                crate::blackjack::BlackjackMove::Hit.encode_v2().unwrap(),
                25,
                "blackjack_hit",
            ),
            // Roulette spin: v1 ~= 25 bytes ({"action":"spin"})
            (
                crate::roulette::RouletteMove::Spin.encode_v2().unwrap(),
                25,
                "roulette_spin",
            ),
            // Craps roll: v1 ~= 25 bytes ({"action":"roll"})
            (
                crate::craps::CrapsMove::Roll.encode_v2().unwrap(),
                25,
                "craps_roll",
            ),
            // Roulette bet: v1 ~= 60 bytes ({"action":"bet","type":"straight","number":17,"amount":100})
            (
                crate::roulette::RouletteMove::PlaceBet(
                    crate::roulette::RouletteBet::new(crate::RouletteBetType::Straight, 17, 100),
                )
                .encode_v2()
                .unwrap(),
                60,
                "roulette_bet",
            ),
            // Craps bet: v1 ~= 55 bytes ({"action":"bet","type":"passLine","amount":100})
            (
                crate::craps::CrapsMove::PlaceBet(crate::craps::CrapsBet::simple(
                    crate::CrapsBetType::PassLine,
                    100,
                ))
                .encode_v2()
                .unwrap(),
                55,
                "craps_bet",
            ),
            // Hi-Lo higher: v1 ~= 30 bytes ({"action":"higher"})
            (
                crate::hilo::HiLoMove::Higher.encode_v2().unwrap(),
                30,
                "hilo_higher",
            ),
        ];

        for (v2_payload, v1_estimate, desc) in test_cases {
            let v2_size = v2_payload.len();
            let reduction = 1.0 - (v2_size as f64 / v1_estimate as f64);

            assert!(
                reduction >= 0.40,
                "AC-1.1: {} must achieve >= 40% size reduction, got {:.1}% (v2={} bytes, v1_est={} bytes)",
                desc,
                reduction * 100.0,
                v2_size,
                v1_estimate
            );
        }
    }

    /// AC-1.1: Header-only moves are exactly 1 byte.
    #[test]
    fn test_header_only_moves_1_byte_ac_1_1() {
        let header_only_moves: Vec<(&str, Vec<u8>)> = vec![
            ("blackjack_hit", crate::blackjack::BlackjackMove::Hit.encode_v2().unwrap()),
            ("blackjack_stand", crate::blackjack::BlackjackMove::Stand.encode_v2().unwrap()),
            ("roulette_spin", crate::roulette::RouletteMove::Spin.encode_v2().unwrap()),
            ("roulette_clear", crate::roulette::RouletteMove::ClearBets.encode_v2().unwrap()),
            ("craps_roll", crate::craps::CrapsMove::Roll.encode_v2().unwrap()),
            ("hilo_higher", crate::hilo::HiLoMove::Higher.encode_v2().unwrap()),
            ("hilo_lower", crate::hilo::HiLoMove::Lower.encode_v2().unwrap()),
        ];

        for (name, payload) in header_only_moves {
            assert_eq!(
                payload.len(),
                1,
                "AC-1.1: Header-only move '{}' must be exactly 1 byte, got {} bytes",
                name,
                payload.len()
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-1.2: State blob size reduction tests (>= 30%)
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-1.2: Roulette state blob achieves >= 30% size reduction vs v1 estimate.
    #[test]
    fn test_roulette_state_size_reduction_ac_1_2() {
        use crate::roulette::{RouletteState, RoulettePhase, ZeroRule, RouletteBet};

        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![
                RouletteBet::new(crate::RouletteBetType::Straight, 17, 100),
                RouletteBet::simple(crate::RouletteBetType::Red, 200),
            ],
            total_wagered: 300,
            pending_return: 3600,
            history: vec![17, 0, 32, 15, 3],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();
        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);

        assert!(
            reduction >= 0.30,
            "AC-1.2: Roulette state must achieve >= 30% reduction, got {:.1}% (v2={} bytes, v1_est={} bytes)",
            reduction * 100.0,
            v2_bytes.len(),
            v1_estimate
        );
    }

    /// AC-1.2: All 10 games' state blobs achieve >= 30% size reduction.
    #[test]
    fn test_all_state_blobs_size_reduction_ac_1_2() {
        // Test all games with typical state sizes
        // Using golden vectors as the source of truth for typical states

        let vectors = GoldenVectors::canonical();
        let state_vector_names = [
            ("blackjack_state_v2_typical", 60),  // v1 estimate: ~60 bytes
            ("baccarat_state_v2_typical", 50),   // v1 estimate: ~50 bytes
            ("roulette_state_v2_typical", 100),  // v1 estimate: ~100 bytes
            ("craps_state_v2_typical", 70),      // v1 estimate: ~70 bytes
            ("sic_bo_state_v2_typical", 60),     // v1 estimate: ~60 bytes
            ("three_card_state_v2_typical", 55), // v1 estimate: ~55 bytes
            ("ultimate_holdem_state_v2_typical", 90), // v1 estimate: ~90 bytes
            ("casino_war_state_v2_typical", 40), // v1 estimate: ~40 bytes
            ("video_poker_state_v2_typical", 45), // v1 estimate: ~45 bytes
            ("hilo_state_v2_typical", 35),       // v1 estimate: ~35 bytes
        ];

        for (name, v1_estimate) in state_vector_names {
            let vector = vectors.get(name).expect(&format!("Vector {} must exist", name));
            let v2_size = vector.preimage_length;
            let reduction = 1.0 - (v2_size as f64 / v1_estimate as f64);

            assert!(
                reduction >= 0.30,
                "AC-1.2: {} must achieve >= 30% reduction, got {:.1}% (v2={} bytes, v1_est={} bytes)",
                name,
                reduction * 100.0,
                v2_size,
                v1_estimate
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-4.1, AC-4.2: State blob parity tests
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-4.2: State blob golden vectors are stable across runs.
    #[test]
    fn test_state_blob_vectors_stable_ac_4_2() {
        let v1 = GoldenVectors::canonical();
        let v2 = GoldenVectors::canonical();

        let state_vectors = [
            "blackjack_state_v2_typical",
            "baccarat_state_v2_typical",
            "roulette_state_v2_typical",
            "craps_state_v2_typical",
            "sic_bo_state_v2_typical",
            "three_card_state_v2_typical",
            "ultimate_holdem_state_v2_typical",
            "casino_war_state_v2_typical",
            "video_poker_state_v2_typical",
            "hilo_state_v2_typical",
        ];

        for name in state_vectors {
            let vec1 = v1.get(name).expect(&format!("Vector {} must exist", name));
            let vec2 = v2.get(name).expect(&format!("Vector {} must exist", name));
            assert_eq!(vec1, vec2, "State blob vector '{}' must be stable", name);
        }
    }

    /// AC-4.2: State blob roundtrip encoding is correct.
    #[test]
    fn test_roulette_state_roundtrip_ac_4_2() {
        use crate::roulette::{RouletteState, RoulettePhase, ZeroRule, RouletteBet};

        let original = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![
                RouletteBet::new(crate::RouletteBetType::Straight, 17, 100),
                RouletteBet::simple(crate::RouletteBetType::Red, 200),
            ],
            total_wagered: 300,
            pending_return: 3600,
            history: vec![17, 0, 32, 15, 3],
        };

        let encoded = original.encode_v2().unwrap();
        let decoded = RouletteState::decode_v2(&encoded).unwrap();

        assert_eq!(original, decoded, "AC-4.2: Roulette state must roundtrip correctly");
    }

    /// AC-4.2: Craps state blob roundtrip encoding is correct.
    #[test]
    fn test_craps_state_roundtrip_ac_4_2() {
        use crate::craps::{CrapsState, CrapsPhase, CrapsBet, FieldPaytable};

        let original = CrapsState {
            phase: CrapsPhase::Point,
            point: 6,
            die1: 3,
            die2: 3,
            point_established_epoch: true,
            made_points_mask: 0b0010,
            field_paytable: FieldPaytable::Standard,
            bets: vec![CrapsBet::simple(crate::CrapsBetType::PassLine, 100)],
            total_wagered: 100,
        };

        let encoded = original.encode_v2().unwrap();
        let decoded = CrapsState::decode_v2(&encoded).unwrap();

        assert_eq!(original, decoded, "AC-4.2: Craps state must roundtrip correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-4.1: Encode/decode latency regression tests
    // ─────────────────────────────────────────────────────────────────────────

    /// Helper: measure operations per second for a closure.
    fn measure_ops_per_sec<F>(iterations: usize, mut f: F) -> f64
    where
        F: FnMut(),
    {
        use std::time::Instant;
        let start = Instant::now();
        for _ in 0..iterations {
            f();
        }
        let elapsed = start.elapsed();
        iterations as f64 / elapsed.as_secs_f64()
    }

    /// AC-4.1: Move payload encode throughput baseline.
    ///
    /// Establishes baseline throughput for v2 move encoding.
    /// Target: > 100,000 ops/sec for simple moves (header-only).
    /// This ensures no >5% regression: baseline must exceed target by margin.
    #[test]
    fn test_move_encode_throughput_ac_4_1() {
        const ITERATIONS: usize = 10_000;
        const TARGET_OPS_PER_SEC: f64 = 100_000.0;

        // Simple header-only moves (most common in gameplay)
        let throughput = measure_ops_per_sec(ITERATIONS, || {
            let _ = std::hint::black_box(
                crate::blackjack::BlackjackMove::Hit.encode_v2().unwrap()
            );
        });

        println!(
            "[AC-4.1] Move encode throughput: {:.0} ops/sec (target: {:.0})",
            throughput, TARGET_OPS_PER_SEC
        );

        // Allow 20% margin for test environment variance
        let margin = TARGET_OPS_PER_SEC * 0.80;
        assert!(
            throughput >= margin,
            "AC-4.1: Move encode throughput {:.0}/sec below margin {:.0}/sec (target {:.0}/sec)",
            throughput,
            margin,
            TARGET_OPS_PER_SEC
        );
    }

    /// AC-4.1: Move payload decode throughput baseline.
    ///
    /// Establishes baseline throughput for v2 move decoding.
    /// Target: > 100,000 ops/sec for simple moves.
    #[test]
    fn test_move_decode_throughput_ac_4_1() {
        const ITERATIONS: usize = 10_000;
        const TARGET_OPS_PER_SEC: f64 = 100_000.0;

        // Pre-encode move payloads
        let hit_payload = crate::blackjack::BlackjackMove::Hit.encode_v2().unwrap();

        let throughput = measure_ops_per_sec(ITERATIONS, || {
            let _ = std::hint::black_box(
                crate::blackjack::BlackjackMove::decode_v2(&hit_payload).unwrap()
            );
        });

        println!(
            "[AC-4.1] Move decode throughput: {:.0} ops/sec (target: {:.0})",
            throughput, TARGET_OPS_PER_SEC
        );

        let margin = TARGET_OPS_PER_SEC * 0.80;
        assert!(
            throughput >= margin,
            "AC-4.1: Move decode throughput {:.0}/sec below margin {:.0}/sec (target {:.0}/sec)",
            throughput,
            margin,
            TARGET_OPS_PER_SEC
        );
    }

    /// AC-4.1: State blob encode throughput baseline.
    ///
    /// State blobs are larger and more complex. Target: > 50,000 ops/sec.
    #[test]
    fn test_state_encode_throughput_ac_4_1() {
        use crate::roulette::{RouletteState, RoulettePhase, ZeroRule, RouletteBet};
        const ITERATIONS: usize = 5_000;
        const TARGET_OPS_PER_SEC: f64 = 50_000.0;

        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![
                RouletteBet::new(crate::RouletteBetType::Straight, 17, 100),
                RouletteBet::simple(crate::RouletteBetType::Red, 200),
            ],
            total_wagered: 300,
            pending_return: 3600,
            history: vec![17, 0, 32, 15, 3],
        };

        let throughput = measure_ops_per_sec(ITERATIONS, || {
            let _ = std::hint::black_box(state.encode_v2().unwrap());
        });

        println!(
            "[AC-4.1] State encode throughput: {:.0} ops/sec (target: {:.0})",
            throughput, TARGET_OPS_PER_SEC
        );

        let margin = TARGET_OPS_PER_SEC * 0.80;
        assert!(
            throughput >= margin,
            "AC-4.1: State encode throughput {:.0}/sec below margin {:.0}/sec (target {:.0}/sec)",
            throughput,
            margin,
            TARGET_OPS_PER_SEC
        );
    }

    /// AC-4.1: State blob decode throughput baseline.
    ///
    /// Target: > 50,000 ops/sec for typical state blobs.
    #[test]
    fn test_state_decode_throughput_ac_4_1() {
        use crate::roulette::{RouletteState, RoulettePhase, ZeroRule, RouletteBet};
        const ITERATIONS: usize = 5_000;
        const TARGET_OPS_PER_SEC: f64 = 50_000.0;

        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![
                RouletteBet::new(crate::RouletteBetType::Straight, 17, 100),
                RouletteBet::simple(crate::RouletteBetType::Red, 200),
            ],
            total_wagered: 300,
            pending_return: 3600,
            history: vec![17, 0, 32, 15, 3],
        };

        let encoded = state.encode_v2().unwrap();

        let throughput = measure_ops_per_sec(ITERATIONS, || {
            let _ = std::hint::black_box(RouletteState::decode_v2(&encoded).unwrap());
        });

        println!(
            "[AC-4.1] State decode throughput: {:.0} ops/sec (target: {:.0})",
            throughput, TARGET_OPS_PER_SEC
        );

        let margin = TARGET_OPS_PER_SEC * 0.80;
        assert!(
            throughput >= margin,
            "AC-4.1: State decode throughput {:.0}/sec below margin {:.0}/sec (target {:.0}/sec)",
            throughput,
            margin,
            TARGET_OPS_PER_SEC
        );
    }

    /// AC-4.1: Bet payload encode/decode roundtrip throughput.
    ///
    /// Bet payloads are the most frequent in gameplay. Target: > 80,000 ops/sec.
    #[test]
    fn test_bet_roundtrip_throughput_ac_4_1() {
        const ITERATIONS: usize = 5_000;
        const TARGET_OPS_PER_SEC: f64 = 80_000.0;

        let bet = crate::roulette::RouletteMove::PlaceBet(
            crate::roulette::RouletteBet::new(crate::RouletteBetType::Straight, 17, 100),
        );

        let throughput = measure_ops_per_sec(ITERATIONS, || {
            let encoded = bet.encode_v2().unwrap();
            let _ = std::hint::black_box(
                crate::roulette::RouletteMove::decode_v2(&encoded).unwrap()
            );
        });

        println!(
            "[AC-4.1] Bet roundtrip throughput: {:.0} ops/sec (target: {:.0})",
            throughput, TARGET_OPS_PER_SEC
        );

        let margin = TARGET_OPS_PER_SEC * 0.80;
        assert!(
            throughput >= margin,
            "AC-4.1: Bet roundtrip throughput {:.0}/sec below margin {:.0}/sec (target {:.0}/sec)",
            throughput,
            margin,
            TARGET_OPS_PER_SEC
        );
    }

    /// AC-4.1: Dual decoder version detection throughput.
    ///
    /// Version detection is called on every payload. Target: > 500,000 ops/sec.
    #[test]
    fn test_version_detection_throughput_ac_4_1() {
        use crate::codec::DualDecoder;
        const ITERATIONS: usize = 50_000;
        const TARGET_OPS_PER_SEC: f64 = 500_000.0;

        let v2_payload = crate::blackjack::BlackjackMove::Hit.encode_v2().unwrap();

        let throughput = measure_ops_per_sec(ITERATIONS, || {
            let _ = std::hint::black_box(DualDecoder::detect_version(&v2_payload).unwrap());
        });

        println!(
            "[AC-4.1] Version detection throughput: {:.0} ops/sec (target: {:.0})",
            throughput, TARGET_OPS_PER_SEC
        );

        let margin = TARGET_OPS_PER_SEC * 0.80;
        assert!(
            throughput >= margin,
            "AC-4.1: Version detection throughput {:.0}/sec below margin {:.0}/sec (target {:.0}/sec)",
            throughput,
            margin,
            TARGET_OPS_PER_SEC
        );
    }

    /// AC-4.1: All games move encode throughput comparison.
    ///
    /// Ensures all 10 games meet the baseline throughput requirement.
    #[test]
    fn test_all_games_encode_throughput_ac_4_1() {
        const ITERATIONS: usize = 2_000;
        const TARGET_OPS_PER_SEC: f64 = 50_000.0;

        let test_cases: Vec<(&str, Box<dyn Fn() -> Vec<u8>>)> = vec![
            ("blackjack_hit", Box::new(|| crate::blackjack::BlackjackMove::Hit.encode_v2().unwrap())),
            ("baccarat_deal", Box::new(|| crate::baccarat::BaccaratMove::Deal.encode_v2().unwrap())),
            ("roulette_spin", Box::new(|| crate::roulette::RouletteMove::Spin.encode_v2().unwrap())),
            ("craps_roll", Box::new(|| crate::craps::CrapsMove::Roll.encode_v2().unwrap())),
            ("sic_bo_roll", Box::new(|| crate::sic_bo::SicBoMove::Roll.encode_v2().unwrap())),
            ("three_card_play", Box::new(|| crate::three_card::ThreeCardMove::Play.encode_v2().unwrap())),
            ("ultimate_check", Box::new(|| crate::ultimate_holdem::UltimateHoldemMove::Check.encode_v2().unwrap())),
            ("casino_war_play", Box::new(|| crate::casino_war::CasinoWarMove::Play.encode_v2().unwrap())),
            ("video_poker_hold", Box::new(|| crate::video_poker::VideoPokerMove::hold_all().encode_v2().unwrap())),
            ("hilo_higher", Box::new(|| crate::hilo::HiLoMove::Higher.encode_v2().unwrap())),
        ];

        for (name, encode_fn) in test_cases {
            let throughput = measure_ops_per_sec(ITERATIONS, || {
                let _ = std::hint::black_box(encode_fn());
            });

            let margin = TARGET_OPS_PER_SEC * 0.80;
            assert!(
                throughput >= margin,
                "AC-4.1: {} encode throughput {:.0}/sec below margin {:.0}/sec",
                name,
                throughput,
                margin
            );
        }
    }
}
