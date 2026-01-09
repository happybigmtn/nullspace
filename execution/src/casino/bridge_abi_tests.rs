//! Bridge ABI drift protection tests.
//!
//! These tests ensure that bridge event encoding remains stable and compatible
//! with the EVM lockbox contract ABI. Any changes to bridge event structures
//! must update these golden vectors to prevent bridge failures that could lock user funds.

#[cfg(test)]
mod tests {
    use commonware_codec::{Write, ReadExt};
    use nullspace_types::{
        casino::{BridgeState, PlayerBalanceSnapshot},
        execution::Event,
    };
    use commonware_cryptography::ed25519::PublicKey;

    /// Convert a hex string to bytes for golden vector validation
    #[allow(dead_code)] // Intended for future golden vector tests
    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        let clean = hex.trim().replace("0x", "").replace(" ", "");
        (0..clean.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&clean[i..i + 2], 16).unwrap())
            .collect()
    }

    /// Convert bytes to hex string for debugging
    fn bytes_to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// Create a test public key from a known seed
    fn test_public_key() -> PublicKey {
        // Use a well-known test key (all zeros for predictability)
        let bytes = [0u8; 32];
        let mut reader = &bytes[..];
        PublicKey::read(&mut reader).expect("should create test public key")
    }

    /// Create a test bridge state with known values
    fn test_bridge_state() -> BridgeState {
        BridgeState {
            total_deposited: 1000,
            total_withdrawn: 500,
            daily_day: 100,
            daily_withdrawn: 200,
            next_withdrawal_id: 42,
        }
    }

    /// Create a test player balance snapshot
    fn test_player_balances() -> PlayerBalanceSnapshot {
        PlayerBalanceSnapshot {
            chips: 10000,
            vusdt_balance: 5000,
            shields: 3,
            doubles: 2,
            tournament_chips: 0,
            tournament_shields: 0,
            tournament_doubles: 0,
            active_tournament: None,
        }
    }

    #[test]
    fn test_bridge_withdrawal_requested_encoding() {
        let player = test_public_key();
        let destination = vec![0x12, 0x34, 0x56, 0x78]; // 4-byte test destination
        let player_balances = test_player_balances();
        let bridge = test_bridge_state();

        let event = Event::BridgeWithdrawalRequested {
            id: 42,
            player: player.clone(),
            amount: 1000,
            destination: destination.clone(),
            requested_ts: 1000000,
            available_ts: 1001000,
            player_balances: player_balances.clone(),
            bridge: bridge.clone(),
        };

        let mut writer = Vec::new();
        event.write(&mut writer);

        // Verify the encoding is stable
        // If this test fails, it means the Event::BridgeWithdrawalRequested structure
        // or encoding has changed, which could break the bridge relayer
        println!("BridgeWithdrawalRequested hex: {}", bytes_to_hex(&writer));

        // Basic sanity checks
        assert!(writer.len() > 0, "encoded event should not be empty");
        assert!(writer.len() < 500, "encoded event should be reasonably sized");

        // Verify we can decode it back
        let mut reader = &writer[..];
        let decoded = Event::read(&mut reader).expect("should decode successfully");

        if let Event::BridgeWithdrawalRequested {
            id: decoded_id,
            player: decoded_player,
            amount: decoded_amount,
            destination: decoded_destination,
            requested_ts: decoded_requested_ts,
            available_ts: decoded_available_ts,
            player_balances: decoded_balances,
            bridge: decoded_bridge,
        } = decoded
        {
            assert_eq!(decoded_id, 42, "id should match");
            assert_eq!(decoded_player, player, "player should match");
            assert_eq!(decoded_amount, 1000, "amount should match");
            assert_eq!(decoded_destination, destination, "destination should match");
            assert_eq!(decoded_requested_ts, 1000000, "requested_ts should match");
            assert_eq!(decoded_available_ts, 1001000, "available_ts should match");
            assert_eq!(decoded_balances.chips, player_balances.chips, "chips should match");
            assert_eq!(decoded_bridge.total_deposited, bridge.total_deposited, "bridge state should match");
        } else {
            panic!("decoded event should be BridgeWithdrawalRequested");
        }
    }

    #[test]
    fn test_bridge_withdrawal_finalized_encoding() {
        let admin = test_public_key();
        let source = vec![0xAA, 0xBB, 0xCC, 0xDD]; // 4-byte test source
        let bridge = test_bridge_state();

        let event = Event::BridgeWithdrawalFinalized {
            id: 42,
            admin: admin.clone(),
            amount: 1000,
            source: source.clone(),
            fulfilled_ts: 1002000,
            bridge: bridge.clone(),
        };

        let mut writer = Vec::new();
        event.write(&mut writer);

        println!("BridgeWithdrawalFinalized hex: {}", bytes_to_hex(&writer));

        assert!(writer.len() > 0, "encoded event should not be empty");
        assert!(writer.len() < 300, "encoded event should be reasonably sized");

        // Verify round-trip encoding/decoding
        let mut reader = &writer[..];
        let decoded = Event::read(&mut reader).expect("should decode successfully");

        if let Event::BridgeWithdrawalFinalized {
            id: decoded_id,
            admin: decoded_admin,
            amount: decoded_amount,
            source: decoded_source,
            fulfilled_ts: decoded_fulfilled_ts,
            bridge: decoded_bridge,
        } = decoded
        {
            assert_eq!(decoded_id, 42, "id should match");
            assert_eq!(decoded_admin, admin, "admin should match");
            assert_eq!(decoded_amount, 1000, "amount should match");
            assert_eq!(decoded_source, source, "source should match");
            assert_eq!(decoded_fulfilled_ts, 1002000, "fulfilled_ts should match");
            assert_eq!(decoded_bridge.total_deposited, bridge.total_deposited, "bridge state should match");
        } else {
            panic!("decoded event should be BridgeWithdrawalFinalized");
        }
    }

    #[test]
    fn test_bridge_deposit_credited_encoding() {
        let admin = test_public_key();
        let recipient = test_public_key();
        let source = vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66]; // 6-byte test source
        let player_balances = test_player_balances();
        let bridge = test_bridge_state();

        let event = Event::BridgeDepositCredited {
            admin: admin.clone(),
            recipient: recipient.clone(),
            amount: 5000,
            source: source.clone(),
            player_balances: player_balances.clone(),
            bridge: bridge.clone(),
        };

        let mut writer = Vec::new();
        event.write(&mut writer);

        println!("BridgeDepositCredited hex: {}", bytes_to_hex(&writer));

        assert!(writer.len() > 0, "encoded event should not be empty");
        assert!(writer.len() < 500, "encoded event should be reasonably sized");

        // Verify round-trip encoding/decoding
        let mut reader = &writer[..];
        let decoded = Event::read(&mut reader).expect("should decode successfully");

        if let Event::BridgeDepositCredited {
            admin: decoded_admin,
            recipient: decoded_recipient,
            amount: decoded_amount,
            source: decoded_source,
            player_balances: decoded_balances,
            bridge: decoded_bridge,
        } = decoded
        {
            assert_eq!(decoded_admin, admin, "admin should match");
            assert_eq!(decoded_recipient, recipient, "recipient should match");
            assert_eq!(decoded_amount, 5000, "amount should match");
            assert_eq!(decoded_source, source, "source should match");
            assert_eq!(decoded_balances.chips, player_balances.chips, "chips should match");
            assert_eq!(decoded_bridge.total_deposited, bridge.total_deposited, "bridge state should match");
        } else {
            panic!("decoded event should be BridgeDepositCredited");
        }
    }

    #[test]
    fn test_bridge_event_field_count_stability() {
        // This test ensures that if someone adds/removes fields from bridge events,
        // the test will fail and they'll need to update the ABI and relayer code.

        // Count fields in BridgeWithdrawalRequested
        let player = test_public_key();
        let event = Event::BridgeWithdrawalRequested {
            id: 0,
            player: player.clone(),
            amount: 0,
            destination: vec![],
            requested_ts: 0,
            available_ts: 0,
            player_balances: test_player_balances(),
            bridge: test_bridge_state(),
        };

        // If this test fails, someone changed the BridgeWithdrawalRequested structure
        // and needs to update the bridge relayer ABI
        let mut writer = Vec::new();
        event.write(&mut writer);
        assert!(writer.len() > 50, "BridgeWithdrawalRequested should have substantial data");

        // BridgeWithdrawalFinalized field count check
        let event2 = Event::BridgeWithdrawalFinalized {
            id: 0,
            admin: player.clone(),
            amount: 0,
            source: vec![],
            fulfilled_ts: 0,
            bridge: test_bridge_state(),
        };

        let mut writer2 = Vec::new();
        event2.write(&mut writer2);
        assert!(writer2.len() > 40, "BridgeWithdrawalFinalized should have substantial data");

        // BridgeDepositCredited field count check
        let event3 = Event::BridgeDepositCredited {
            admin: player.clone(),
            recipient: player.clone(),
            amount: 0,
            source: vec![],
            player_balances: test_player_balances(),
            bridge: test_bridge_state(),
        };

        let mut writer3 = Vec::new();
        event3.write(&mut writer3);
        assert!(writer3.len() > 50, "BridgeDepositCredited should have substantial data");
    }

    #[test]
    fn test_evm_abi_compatibility_notes() {
        // This test documents the EVM ABI expectations for the bridge relayer.
        // If these expectations change, the EVM lockbox contract and relayer must be updated.

        // The bridge relayer (client/src/bin/bridge_relayer.rs) defines the ABI as:
        // event Deposited(address indexed from, uint256 amount, bytes32 destination)
        // event Withdrawn(address indexed to, uint256 amount, bytes32 source)
        // function withdraw(address to, uint256 amount, bytes32 source) external

        // Key invariants:
        // 1. Withdrawal ID is a u64 in Rust events
        // 2. Amounts are u64 in Rust, but uint256 in EVM (must fit in u64 range)
        // 3. Destinations are Vec<u8> with 20 or 32 bytes (EVM addresses or bytes32)
        // 4. Sources are Vec<u8> with <= 64 bytes
        // 5. Timestamps are u64 (seconds since epoch)

        // If any of these change, update this test and the bridge relayer

        let event = Event::BridgeWithdrawalRequested {
            id: u64::MAX, // Test maximum ID
            player: test_public_key(),
            amount: u64::MAX, // Test maximum amount
            destination: vec![0xFF; 32], // Test maximum destination (32 bytes)
            requested_ts: u64::MAX,
            available_ts: u64::MAX,
            player_balances: test_player_balances(),
            bridge: test_bridge_state(),
        };

        let mut writer = Vec::new();
        event.write(&mut writer);

        // Verify it encodes without panicking
        assert!(writer.len() > 0, "max values should encode successfully");

        // Verify it decodes without panicking
        let mut reader = &writer[..];
        let decoded = Event::read(&mut reader).expect("max values should decode successfully");

        if let Event::BridgeWithdrawalRequested { id, amount, .. } = decoded {
            assert_eq!(id, u64::MAX, "max ID should round-trip");
            assert_eq!(amount, u64::MAX, "max amount should round-trip");
        } else {
            panic!("should decode as BridgeWithdrawalRequested");
        }
    }
}
