//! Event encoding utilities for cross-language testing.
//!
//! These functions encode events in the same format that would be emitted to the chain,
//! allowing TypeScript tests to verify they can decode Rust-generated events correctly.

/// Encode a game result event for chain emission.
///
/// Format (little-endian):
/// - session_id: u64 (8 bytes, LE)
/// - game_type: u8 (1 byte)
/// - won: u8 (1 byte, 0=false, 1=true)
/// - payout: u64 (8 bytes, LE)
/// - msg_len: u8 (1 byte)
/// - message: [u8; msg_len]
pub fn encode_game_result(
    session_id: u64,
    game_type: u8,
    won: bool,
    payout: u64,
    message: &str,
) -> Vec<u8> {
    let msg_bytes = message.as_bytes();
    if msg_bytes.len() > 255 {
        panic!("message too long");
    }

    let mut result = Vec::with_capacity(19 + msg_bytes.len());

    // Little-endian encoding to match TypeScript DataView expectations
    result.extend_from_slice(&session_id.to_le_bytes());
    result.push(game_type);
    result.push(if won { 1 } else { 0 });
    result.extend_from_slice(&payout.to_le_bytes());
    result.push(msg_bytes.len() as u8);
    result.extend_from_slice(msg_bytes);

    result
}

/// Encode a card for event payloads.
///
/// Format:
/// - suit: u8 (0=spades, 1=hearts, 2=diamonds, 3=clubs)
/// - rank: u8 (0=A, 1=2, ..., 12=K)
/// - face_up: u8 (0=false, 1=true)
pub fn encode_card(suit: u8, rank: u8, face_up: bool) -> [u8; 3] {
    [suit, rank, if face_up { 1 } else { 0 }]
}

/// Encode a blackjack state update event.
///
/// Format (little-endian):
/// - session_id: u64 (8 bytes, LE)
/// - player_card_count: u8 (1 byte)
/// - player_cards: [Card; player_card_count] (3 bytes each)
/// - dealer_card_count: u8 (1 byte)
/// - dealer_cards: [Card; dealer_card_count] (3 bytes each)
/// - player_total: u8 (1 byte)
/// - dealer_total: u8 (1 byte)
/// - stage: u8 (1 byte: 0=betting, 1=playing, 2=dealer_turn, 3=complete)
/// - action_flags: u8 (1 byte: bit0=canHit, bit1=canStand, bit2=canDouble, bit3=canSplit)
pub fn encode_blackjack_state(
    session_id: u64,
    player_cards: &[(u8, u8, bool)], // (suit, rank, face_up)
    dealer_cards: &[(u8, u8, bool)],
    player_total: u8,
    dealer_total: u8,
    stage: u8,
    can_hit: bool,
    can_stand: bool,
    can_double: bool,
    can_split: bool,
) -> Vec<u8> {
    if player_cards.len() > 255 || dealer_cards.len() > 255 {
        panic!("too many cards");
    }

    let mut result = Vec::new();

    // Session ID (little-endian)
    result.extend_from_slice(&session_id.to_le_bytes());

    // Player cards
    result.push(player_cards.len() as u8);
    for (suit, rank, face_up) in player_cards {
        result.extend_from_slice(&encode_card(*suit, *rank, *face_up));
    }

    // Dealer cards
    result.push(dealer_cards.len() as u8);
    for (suit, rank, face_up) in dealer_cards {
        result.extend_from_slice(&encode_card(*suit, *rank, *face_up));
    }

    // Game state
    result.push(player_total);
    result.push(dealer_total);
    result.push(stage);

    // Action flags (bit field)
    let mut flags = 0u8;
    if can_hit {
        flags |= 0x01;
    }
    if can_stand {
        flags |= 0x02;
    }
    if can_double {
        flags |= 0x04;
    }
    if can_split {
        flags |= 0x08;
    }
    result.push(flags);

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_game_result_encoding() {
        let encoded = encode_game_result(
            42,          // session_id
            2,           // game_type (blackjack)
            true,        // won
            500,         // payout
            "Blackjack!" // message
        );

        // Verify structure
        assert_eq!(encoded.len(), 19 + 10); // 19 header + 10 byte message

        // Verify little-endian session ID
        assert_eq!(&encoded[0..8], &42u64.to_le_bytes());

        // Verify game type
        assert_eq!(encoded[8], 2);

        // Verify won flag
        assert_eq!(encoded[9], 1);

        // Verify little-endian payout
        assert_eq!(&encoded[10..18], &500u64.to_le_bytes());

        // Verify message length
        assert_eq!(encoded[18], 10);

        // Verify message content
        assert_eq!(&encoded[19..29], b"Blackjack!");
    }

    #[test]
    fn test_card_encoding() {
        // Hearts King face up
        let card = encode_card(1, 12, true);
        assert_eq!(card, [1, 12, 1]);

        // Spades Ace face down
        let card = encode_card(0, 0, false);
        assert_eq!(card, [0, 0, 0]);
    }

    #[test]
    fn test_blackjack_state_encoding() {
        let encoded = encode_blackjack_state(
            7,                              // session_id
            &[(0, 0, true)],               // player: spades A faceUp
            &[(2, 9, false)],              // dealer: diamonds 10 faceDown
            21,                             // player_total
            10,                             // dealer_total
            1,                              // stage (playing)
            true,                           // can_hit
            true,                           // can_stand
            false,                          // can_double
            true,                           // can_split
        );

        // Verify structure: 8 + 1 + 3 + 1 + 3 + 4 = 20 bytes
        assert_eq!(encoded.len(), 20);

        // Verify little-endian session ID
        assert_eq!(&encoded[0..8], &7u64.to_le_bytes());

        // Verify player card count
        assert_eq!(encoded[8], 1);

        // Verify player card (spades A faceUp)
        assert_eq!(&encoded[9..12], &[0, 0, 1]);

        // Verify dealer card count
        assert_eq!(encoded[12], 1);

        // Verify dealer card (diamonds 10 faceDown)
        assert_eq!(&encoded[13..16], &[2, 9, 0]);

        // Verify totals
        assert_eq!(encoded[16], 21); // player_total
        assert_eq!(encoded[17], 10); // dealer_total

        // Verify stage
        assert_eq!(encoded[18], 1); // playing

        // Verify action flags: 0b1011 = canHit | canStand | canSplit
        assert_eq!(encoded[19], 0b1011);
    }

    #[test]
    fn test_game_result_win() {
        let encoded = encode_game_result(100, 0, true, 1000, "Winner!");

        // Export as hex for golden vectors
        let hex: String = encoded.iter().map(|b| format!("{:02x}", b)).collect();
        println!("Game result win hex: {}", hex);
    }

    #[test]
    fn test_game_result_loss() {
        let encoded = encode_game_result(200, 1, false, 0, "Better luck next time");

        let hex: String = encoded.iter().map(|b| format!("{:02x}", b)).collect();
        println!("Game result loss hex: {}", hex);
    }
}
