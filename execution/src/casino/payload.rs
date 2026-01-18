use super::GameError;

/// Current protocol version for game move payloads.
pub const PROTOCOL_VERSION: u8 = 1;

/// Minimum supported protocol version.
pub const MIN_PROTOCOL_VERSION: u8 = 1;

/// Maximum supported protocol version.
pub const MAX_PROTOCOL_VERSION: u8 = 1;

/// Result of stripping the version header from a payload.
pub struct VersionedPayload<'a> {
    /// The protocol version found in the header.
    pub version: u8,
    /// The payload bytes after the version header.
    pub payload: &'a [u8],
}

/// Strip the version header from a versioned payload.
///
/// Game move payloads may include a 1-byte version header as the first byte.
/// This function validates and strips that header, returning the inner payload.
///
/// Returns `Ok(VersionedPayload)` with the version and inner payload.
/// Returns `Err(GameError::InvalidPayload)` if:
/// - The payload is empty
/// - The version is not supported (outside MIN..=MAX range)
pub fn strip_version_header(payload: &[u8]) -> Result<VersionedPayload<'_>, GameError> {
    if payload.is_empty() {
        return Err(GameError::InvalidPayload);
    }

    let version = payload[0];
    if version < MIN_PROTOCOL_VERSION || version > MAX_PROTOCOL_VERSION {
        return Err(GameError::InvalidPayload);
    }

    Ok(VersionedPayload {
        version,
        payload: &payload[1..],
    })
}

/// Strip version header if present, otherwise pass through unchanged.
///
/// This enables backward compatibility during migration:
/// - If the first byte is a valid protocol version (1), strip it
/// - If the first byte looks like a game opcode (0, or > MAX_PROTOCOL_VERSION), pass through
///
/// This heuristic works because:
/// - Protocol version 1 is the only valid version
/// - Most game opcodes start at 0 (PlaceBet, Hit) or use values > 1
/// - Versioned payloads have version=1 followed by opcode
/// - Unversioned payloads start directly with the opcode
pub fn strip_version_header_compat(payload: &[u8]) -> &[u8] {
    if payload.is_empty() {
        return payload;
    }

    let first_byte = payload[0];

    // If first byte is a valid protocol version AND there's more payload,
    // strip the version header
    if first_byte >= MIN_PROTOCOL_VERSION
        && first_byte <= MAX_PROTOCOL_VERSION
        && payload.len() > 1
    {
        &payload[1..]
    } else {
        // Pass through unchanged (legacy unversioned payload)
        payload
    }
}

pub(crate) fn parse_u64_be(payload: &[u8], offset: usize) -> Result<u64, GameError> {
    let end = offset.saturating_add(8);
    if payload.len() < end {
        return Err(GameError::InvalidPayload);
    }
    let bytes: [u8; 8] = payload[offset..end]
        .try_into()
        .map_err(|_| GameError::InvalidPayload)?;
    Ok(u64::from_be_bytes(bytes))
}

/// Parse the common table-game bet placement payload:
/// `[0, bet_type:u8, number:u8, amount:u64 BE]`.
pub(crate) fn parse_place_bet_payload(payload: &[u8]) -> Result<(u8, u8, u64), GameError> {
    if payload.len() != 11 || payload[0] != 0 {
        return Err(GameError::InvalidPayload);
    }
    let bet_type = payload[1];
    let number = payload[2];
    let amount = parse_u64_be(payload, 3)?;
    Ok((bet_type, number, amount))
}

pub(crate) fn ensure_nonzero_amount(amount: u64) -> Result<(), GameError> {
    if amount == 0 {
        return Err(GameError::InvalidPayload);
    }
    Ok(())
}

pub(crate) fn clamp_bet_amount(amount: u64, max_amount: u64) -> u64 {
    amount.min(max_amount)
}

pub(crate) fn clamp_and_validate_amount(
    amount: u64,
    max_amount: u64,
) -> Result<u64, GameError> {
    let clamped = clamp_bet_amount(amount, max_amount);
    ensure_nonzero_amount(clamped)?;
    Ok(clamped)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_place_bet_payload, parse_u64_be, strip_version_header, strip_version_header_compat,
        MAX_PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION,
    };
    use crate::casino::GameError;
    use serde_json::Value;

    fn load_vectors() -> Value {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../packages/protocol/test/fixtures/golden-vectors.json"
        ));
        serde_json::from_str(raw).expect("golden vectors JSON should parse")
    }

    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        let normalized = hex.trim();
        assert!(
            normalized.len() % 2 == 0,
            "hex string length must be even"
        );
        (0..normalized.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&normalized[i..i + 2], 16).expect("hex"))
            .collect()
    }

    #[test]
    fn golden_vectors_match_payload_parsing() {
        let vectors = load_vectors();

        // Protocol version from golden vectors (first byte is version prefix)
        let expected_version: u8 = vectors
            .get("protocolVersion")
            .and_then(|v| v.as_u64())
            .expect("protocolVersion missing") as u8;

        let blackjack_moves = vectors
            .get("blackjackMoves")
            .and_then(|v| v.as_array())
            .expect("blackjackMoves array missing");
        for entry in blackjack_moves {
            let move_name = entry
                .get("move")
                .and_then(|v| v.as_str())
                .expect("blackjack move name missing");
            let hex = entry
                .get("hex")
                .and_then(|v| v.as_str())
                .expect("blackjack hex missing");
            let payload = hex_to_bytes(hex);
            let expected_opcode = match move_name {
                "hit" => 0,
                "stand" => 1,
                "double" => 2,
                "split" => 3,
                "deal" => 4,
                "surrender" => 7,
                _ => panic!("unexpected blackjack move: {move_name}"),
            };
            assert_eq!(payload, vec![expected_version, expected_opcode], "blackjack {move_name} opcode mismatch");
        }

        let roulette_moves = vectors
            .get("rouletteMoves")
            .and_then(|v| v.as_array())
            .expect("rouletteMoves array missing");
        for entry in roulette_moves {
            let move_name = entry
                .get("move")
                .and_then(|v| v.as_str())
                .expect("roulette move name missing");
            let hex = entry
                .get("hex")
                .and_then(|v| v.as_str())
                .expect("roulette hex missing");
            let payload = hex_to_bytes(hex);
            let expected_opcode = match move_name {
                "spin" => 1,
                "clear_bets" => 2,
                _ => panic!("unexpected roulette move: {move_name}"),
            };
            assert_eq!(payload, vec![expected_version, expected_opcode], "roulette {move_name} opcode mismatch");
        }

        let roulette_bets = vectors
            .get("rouletteBets")
            .and_then(|v| v.as_array())
            .expect("rouletteBets array missing");
        for entry in roulette_bets {
            let hex = entry
                .get("hex")
                .and_then(|v| v.as_str())
                .expect("roulette bet hex missing");
            let payload = hex_to_bytes(hex);
            // Skip version byte prefix when parsing bet payload
            assert_eq!(payload[0], expected_version, "roulette bet version mismatch");
            let (bet_type, number, amount) =
                parse_place_bet_payload(&payload[1..]).expect("roulette bet payload");
            let expected_type = entry.get("betType").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
            let expected_number = entry.get("number").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
            let expected_amount = entry
                .get("amount")
                .and_then(|v| v.as_str())
                .expect("roulette bet amount missing")
                .parse::<u64>()
                .expect("roulette bet amount parse");
            assert_eq!(bet_type, expected_type, "roulette bet type mismatch");
            assert_eq!(number, expected_number, "roulette bet number mismatch");
            assert_eq!(amount, expected_amount, "roulette bet amount mismatch");
        }

        let craps_moves = vectors
            .get("crapsMoves")
            .and_then(|v| v.as_array())
            .expect("crapsMoves array missing");
        for entry in craps_moves {
            let move_name = entry
                .get("move")
                .and_then(|v| v.as_str())
                .expect("craps move name missing");
            let hex = entry
                .get("hex")
                .and_then(|v| v.as_str())
                .expect("craps hex missing");
            let payload = hex_to_bytes(hex);
            let expected_opcode = match move_name {
                "roll" => 2,
                "clear_bets" => 3,
                _ => panic!("unexpected craps move: {move_name}"),
            };
            assert_eq!(payload, vec![expected_version, expected_opcode], "craps {move_name} opcode mismatch");
        }

        let craps_place = vectors
            .get("crapsPlaceBets")
            .and_then(|v| v.as_array())
            .expect("crapsPlaceBets array missing");
        for entry in craps_place {
            let hex = entry
                .get("hex")
                .and_then(|v| v.as_str())
                .expect("craps bet hex missing");
            let payload = hex_to_bytes(hex);
            // Skip version byte prefix when parsing bet payload
            assert_eq!(payload[0], expected_version, "craps bet version mismatch");
            let (bet_type, target, amount) =
                parse_place_bet_payload(&payload[1..]).expect("craps bet payload");
            let expected_type = entry.get("betType").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
            let expected_target = entry.get("target").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
            let expected_amount = entry
                .get("amount")
                .and_then(|v| v.as_str())
                .expect("craps bet amount missing")
                .parse::<u64>()
                .expect("craps bet amount parse");
            assert_eq!(bet_type, expected_type, "craps bet type mismatch");
            assert_eq!(target, expected_target, "craps bet target mismatch");
            assert_eq!(amount, expected_amount, "craps bet amount mismatch");
        }

        let craps_odds = vectors
            .get("crapsAddOdds")
            .and_then(|v| v.as_array())
            .expect("crapsAddOdds array missing");
        for entry in craps_odds {
            let hex = entry
                .get("hex")
                .and_then(|v| v.as_str())
                .expect("craps add odds hex missing");
            let payload = hex_to_bytes(hex);
            // Version (1) + opcode (1) + amount (8) = 10 bytes
            assert_eq!(payload.len(), 10, "craps add odds length mismatch");
            assert_eq!(payload[0], expected_version, "craps add odds version mismatch");
            assert_eq!(payload[1], 1, "craps add odds opcode mismatch");
            let amount = parse_u64_be(&payload, 2).expect("craps add odds amount parse");
            let expected_amount = entry
                .get("amount")
                .and_then(|v| v.as_str())
                .expect("craps add odds amount missing")
                .parse::<u64>()
                .expect("craps add odds amount parse");
            assert_eq!(amount, expected_amount, "craps add odds amount mismatch");
        }
    }

    #[test]
    fn test_protocol_version_constants() {
        assert_eq!(PROTOCOL_VERSION, 1);
        assert_eq!(MIN_PROTOCOL_VERSION, 1);
        assert_eq!(MAX_PROTOCOL_VERSION, 1);
    }

    #[test]
    fn test_strip_version_header_valid() {
        // Version 1 payload: [1, 4] (deal in blackjack)
        let payload = vec![1u8, 4];
        let result = strip_version_header(&payload).expect("should strip version");
        assert_eq!(result.version, 1);
        assert_eq!(result.payload, &[4u8]);
    }

    #[test]
    fn test_strip_version_header_empty() {
        let payload: Vec<u8> = vec![];
        assert!(matches!(
            strip_version_header(&payload),
            Err(GameError::InvalidPayload)
        ));
    }

    #[test]
    fn test_strip_version_header_unsupported_version() {
        // Version 0 is below minimum
        let payload = vec![0u8, 4];
        assert!(matches!(
            strip_version_header(&payload),
            Err(GameError::InvalidPayload)
        ));

        // Version 2 is above maximum
        let payload = vec![2u8, 4];
        assert!(matches!(
            strip_version_header(&payload),
            Err(GameError::InvalidPayload)
        ));
    }

    #[test]
    fn test_strip_version_header_compat_versioned() {
        // Version 1 payload should be stripped
        let payload = vec![1u8, 4, 5, 6];
        let result = strip_version_header_compat(&payload);
        assert_eq!(result, &[4u8, 5, 6]);
    }

    #[test]
    fn test_strip_version_header_compat_unversioned() {
        // Payload starting with 0 (typical opcode) should pass through
        let payload = vec![0u8, 1, 2, 3];
        let result = strip_version_header_compat(&payload);
        assert_eq!(result, &[0u8, 1, 2, 3]);

        // Payload starting with 2+ (above max version) should pass through
        let payload = vec![2u8, 0, 0];
        let result = strip_version_header_compat(&payload);
        assert_eq!(result, &[2u8, 0, 0]);
    }

    #[test]
    fn test_strip_version_header_compat_empty() {
        let payload: Vec<u8> = vec![];
        let result = strip_version_header_compat(&payload);
        assert!(result.is_empty());
    }

    #[test]
    fn test_strip_version_header_compat_single_byte() {
        // Single byte version=1 with no payload should pass through (not enough data)
        let payload = vec![1u8];
        let result = strip_version_header_compat(&payload);
        assert_eq!(result, &[1u8]);

        // Single byte opcode should pass through
        let payload = vec![4u8];
        let result = strip_version_header_compat(&payload);
        assert_eq!(result, &[4u8]);
    }
}
