//! Integration tests for ledger reconciliation (AC-7.1).
//!
//! These tests verify that deposit and withdrawal flows update the ledger
//! and reflect on-chain balances correctly.

#[cfg(test)]
#[cfg(feature = "bridge")]
mod tests {
    use crate::layer::Layer;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use crate::state::State;
    use anyhow::Result;
    use commonware_codec::Encode;
    use commonware_cryptography::ed25519::PublicKey;
    use nullspace_types::casino::{
        LedgerEntryType, LedgerState, Player, PlayerBalances, PlayerModifiers, PlayerProfile,
        PlayerSessionState, PlayerTournamentState, ReconciliationStatus,
    };
    use nullspace_types::execution::{Event, Instruction, Key, Output, Transaction, Value};
    use std::collections::HashMap;
    use std::sync::Once;

    static INIT_ADMIN: Once = Once::new();

    /// Set up environment for admin tests. The admin key is created from seed 0.
    fn setup_admin_env() {
        INIT_ADMIN.call_once(|| {
            let (_, admin_public) = create_account_keypair(0);
            let hex = admin_public.encode().iter().map(|b| format!("{:02x}", b)).collect::<String>();
            std::env::set_var("CASINO_ADMIN_PUBLIC_KEY_HEX", hex);
        });
    }

    /// In-memory state for testing Layer execution directly.
    struct MockState {
        data: HashMap<Key, Value>,
    }

    impl MockState {
        fn new() -> Self {
            Self {
                data: HashMap::new(),
            }
        }

        fn with_player(mut self, public: &PublicKey, chips: u64) -> Self {
            let player = Player {
                nonce: 0,
                profile: PlayerProfile {
                    name: "TestPlayer".to_string(),
                    rank: 0,
                    is_kyc_verified: false,
                    created_ts: 0,
                },
                balances: PlayerBalances {
                    chips,
                    vusdt_balance: 0,
                    freeroll_credits: 0,
                    freeroll_credits_locked: 0,
                    freeroll_credits_unlock_start_ts: 0,
                    freeroll_credits_unlock_end_ts: 0,
                },
                modifiers: PlayerModifiers::default(),
                tournament: PlayerTournamentState::default(),
                session: PlayerSessionState::default(),
            };
            self.data
                .insert(Key::CasinoPlayer(public.clone()), Value::CasinoPlayer(player));
            self
        }

        fn with_policy(mut self, policy: nullspace_types::casino::PolicyState) -> Self {
            self.data.insert(Key::Policy, Value::Policy(policy));
            self
        }
    }

    impl State for MockState {
        async fn get(&self, key: Key) -> Result<Option<Value>> {
            Ok(self.data.get(&key).cloned())
        }

        async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
            self.data.insert(key, value);
            Ok(())
        }

        async fn delete(&mut self, key: Key) -> Result<()> {
            self.data.remove(&key);
            Ok(())
        }
    }

    fn test_policy() -> nullspace_types::casino::PolicyState {
        nullspace_types::casino::PolicyState {
            bridge_paused: false,
            bridge_daily_limit: 1_000_000,
            bridge_daily_limit_per_account: 100_000,
            bridge_delay_secs: 60,
            bridge_min_withdraw: 100,
            bridge_max_withdraw: 50_000,
            ..Default::default()
        }
    }

    /// AC-7.1: Test that withdrawal request creates a ledger entry.
    #[tokio::test]
    async fn test_withdrawal_request_creates_ledger_entry() {
        let (network_secret, network_identity) = create_network_keypair();
        let (private, public) = create_account_keypair(1);
        let seed = create_seed(&network_secret, 1);

        let state = MockState::new()
            .with_player(&public, 10_000)
            .with_policy(test_policy());

        let mut layer = Layer::new(&state, network_identity, b"test", seed);

        let tx = Transaction::sign(
            &private,
            0,
            Instruction::BridgeWithdraw {
                amount: 1000,
                destination: vec![0xAB; 20], // Valid 20-byte EVM address
            },
        );

        let (outputs, _) = layer.execute(vec![tx]).await.expect("execute should succeed");

        // Find the BridgeWithdrawalRequested event
        let withdrawal_event = outputs.iter().find_map(|o| match o {
            Output::Event(Event::BridgeWithdrawalRequested { id, amount, .. }) => {
                Some((*id, *amount))
            }
            _ => None,
        });
        assert!(
            withdrawal_event.is_some(),
            "Should have BridgeWithdrawalRequested event"
        );
        let (withdrawal_id, amount) = withdrawal_event.unwrap();
        assert_eq!(amount, 1000, "Withdrawal amount should be 1000");

        // Verify ledger state was created
        let pending = layer.commit();
        let ledger_state = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerState,
                crate::state::Status::Update(Value::LedgerState(state)),
            ) => Some(state.clone()),
            _ => None,
        });
        assert!(ledger_state.is_some(), "Should have LedgerState");
        let ledger = ledger_state.unwrap();
        assert_eq!(ledger.next_entry_id, 1, "Should have created one entry");
        assert_eq!(
            ledger.total_withdrawal_requests, 1000,
            "Should track withdrawal request total"
        );
        assert_eq!(
            ledger.pending_reconciliation_count, 1,
            "Should have one pending reconciliation"
        );

        // Verify ledger entry was created
        let ledger_entry = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerEntry(0),
                crate::state::Status::Update(Value::LedgerEntry(entry)),
            ) => Some(entry.clone()),
            _ => None,
        });
        assert!(ledger_entry.is_some(), "Should have LedgerEntry(0)");
        let entry = ledger_entry.unwrap();
        assert_eq!(entry.id, 0, "Entry ID should be 0");
        assert_eq!(
            entry.entry_type,
            LedgerEntryType::WithdrawalRequest,
            "Entry type should be WithdrawalRequest"
        );
        assert_eq!(entry.player, public, "Entry player should match");
        assert_eq!(entry.amount, 1000, "Entry amount should be 1000");
        assert_eq!(
            entry.reconciliation_status,
            ReconciliationStatus::Pending,
            "Status should be Pending"
        );
        assert_eq!(
            entry.withdrawal_id,
            Some(withdrawal_id),
            "Should link to withdrawal"
        );
        assert_eq!(
            entry.balance_after, 9000,
            "Balance after should be reduced by withdrawal"
        );
    }

    /// AC-7.1: Test that deposit creates a ledger entry.
    #[tokio::test]
    async fn test_deposit_creates_ledger_entry() {
        setup_admin_env();

        let (network_secret, network_identity) = create_network_keypair();
        let (admin_private, admin_public) = create_account_keypair(0);
        let (_, recipient_public) = create_account_keypair(1);
        let seed = create_seed(&network_secret, 1);

        let mut state = MockState::new()
            .with_player(&recipient_public, 5_000)
            .with_policy(test_policy());
        // Add admin account for nonce tracking
        state.data.insert(Key::Account(admin_public), Value::Account(Default::default()));

        let mut layer = Layer::new(&state, network_identity, b"test", seed);

        let tx = Transaction::sign(
            &admin_private,
            0,
            Instruction::BridgeDeposit {
                recipient: recipient_public.clone(),
                amount: 2000,
                source: vec![0xCD; 32], // Valid 32-byte tx hash
            },
        );

        let (outputs, _) = layer.execute(vec![tx]).await.expect("execute should succeed");

        // Find the BridgeDepositCredited event
        let deposit_event = outputs.iter().find_map(|o| match o {
            Output::Event(Event::BridgeDepositCredited { amount, .. }) => Some(*amount),
            _ => None,
        });
        assert!(
            deposit_event.is_some(),
            "Should have BridgeDepositCredited event"
        );
        assert_eq!(deposit_event.unwrap(), 2000, "Deposit amount should be 2000");

        // Verify ledger state was created
        let pending = layer.commit();
        let ledger_state = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerState,
                crate::state::Status::Update(Value::LedgerState(state)),
            ) => Some(state.clone()),
            _ => None,
        });
        assert!(ledger_state.is_some(), "Should have LedgerState");
        let ledger = ledger_state.unwrap();
        assert_eq!(ledger.next_entry_id, 1, "Should have created one entry");
        assert_eq!(
            ledger.total_deposits, 2000,
            "Should track deposit total"
        );
        assert_eq!(
            ledger.pending_reconciliation_count, 1,
            "Should have one pending reconciliation"
        );

        // Verify ledger entry was created
        let ledger_entry = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerEntry(0),
                crate::state::Status::Update(Value::LedgerEntry(entry)),
            ) => Some(entry.clone()),
            _ => None,
        });
        assert!(ledger_entry.is_some(), "Should have LedgerEntry(0)");
        let entry = ledger_entry.unwrap();
        assert_eq!(entry.id, 0, "Entry ID should be 0");
        assert_eq!(
            entry.entry_type,
            LedgerEntryType::Deposit,
            "Entry type should be Deposit"
        );
        assert_eq!(entry.player, recipient_public, "Entry player should match");
        assert_eq!(entry.amount, 2000, "Entry amount should be 2000");
        assert_eq!(
            entry.reconciliation_status,
            ReconciliationStatus::Pending,
            "Status should be Pending"
        );
        assert_eq!(entry.withdrawal_id, None, "Deposit should have no withdrawal_id");
        assert_eq!(
            entry.balance_after, 7000,
            "Balance after should be increased by deposit"
        );
    }

    /// AC-7.1: Test that withdrawal fulfillment creates a Verified ledger entry.
    #[tokio::test]
    async fn test_withdrawal_fulfillment_creates_verified_entry() {
        setup_admin_env();

        let (network_secret, network_identity) = create_network_keypair();
        let (admin_private, admin_public) = create_account_keypair(0);
        let (_player_private, player_public) = create_account_keypair(1);
        let seed = create_seed(&network_secret, 100); // Higher view for delay

        // Set up state with player, policy, and pre-existing withdrawal
        let mut state = MockState::new()
            .with_player(&player_public, 10_000)
            .with_policy(test_policy());
        // Add admin account for nonce tracking
        state.data.insert(Key::Account(admin_public), Value::Account(Default::default()));

        // Create a withdrawal that's already past its delay
        let withdrawal = nullspace_types::casino::BridgeWithdrawal {
            id: 0,
            player: player_public.clone(),
            amount: 1000,
            destination: vec![0xAB; 20],
            requested_ts: 0,
            available_ts: 0, // Already available
            fulfilled: false,
        };
        state.data.insert(
            Key::BridgeWithdrawal(0),
            Value::BridgeWithdrawal(withdrawal),
        );

        // Pre-populate ledger state as if withdrawal request was already made
        let ledger = LedgerState {
            next_entry_id: 1,
            total_deposits: 0,
            total_withdrawal_requests: 1000,
            total_withdrawals_fulfilled: 0,
            pending_reconciliation_count: 1,
            failed_reconciliation_count: 0,
            last_reconciled_id: 0,
            last_reconciliation_ts: 0,
        };
        state.data.insert(Key::LedgerState, Value::LedgerState(ledger));

        let mut layer = Layer::new(&state, network_identity, b"test", seed);

        let tx = Transaction::sign(
            &admin_private,
            0,
            Instruction::FinalizeBridgeWithdrawal {
                withdrawal_id: 0,
                source: vec![0xEF; 32], // EVM tx hash
            },
        );

        let (outputs, _) = layer.execute(vec![tx]).await.expect("execute should succeed");

        // Find the BridgeWithdrawalFinalized event
        let finalized_event = outputs.iter().find_map(|o| match o {
            Output::Event(Event::BridgeWithdrawalFinalized { id, amount, .. }) => {
                Some((*id, *amount))
            }
            _ => None,
        });
        assert!(
            finalized_event.is_some(),
            "Should have BridgeWithdrawalFinalized event"
        );
        let (id, amount) = finalized_event.unwrap();
        assert_eq!(id, 0, "Withdrawal ID should be 0");
        assert_eq!(amount, 1000, "Withdrawal amount should be 1000");

        // Verify ledger state was updated
        let pending = layer.commit();
        let ledger_state = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerState,
                crate::state::Status::Update(Value::LedgerState(state)),
            ) => Some(state.clone()),
            _ => None,
        });
        assert!(ledger_state.is_some(), "Should have LedgerState");
        let ledger = ledger_state.unwrap();
        assert_eq!(ledger.next_entry_id, 2, "Should have created second entry");
        assert_eq!(
            ledger.total_withdrawals_fulfilled, 1000,
            "Should track fulfilled total"
        );
        assert_eq!(
            ledger.pending_reconciliation_count, 0,
            "Should decrement pending count"
        );
        assert_eq!(
            ledger.last_reconciled_id, 1,
            "Should update last reconciled ID"
        );

        // Verify ledger entry was created with Verified status
        let ledger_entry = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerEntry(1),
                crate::state::Status::Update(Value::LedgerEntry(entry)),
            ) => Some(entry.clone()),
            _ => None,
        });
        assert!(ledger_entry.is_some(), "Should have LedgerEntry(1)");
        let entry = ledger_entry.unwrap();
        assert_eq!(entry.id, 1, "Entry ID should be 1");
        assert_eq!(
            entry.entry_type,
            LedgerEntryType::WithdrawalFulfilled,
            "Entry type should be WithdrawalFulfilled"
        );
        assert_eq!(entry.amount, 1000, "Entry amount should be 1000");
        assert_eq!(
            entry.reconciliation_status,
            ReconciliationStatus::Verified,
            "Status should be Verified"
        );
        assert_eq!(
            entry.withdrawal_id,
            Some(0),
            "Should link to original withdrawal"
        );
    }

    /// AC-7.1: Test ledger totals accumulate correctly across multiple operations.
    #[tokio::test]
    async fn test_ledger_totals_accumulate() {
        setup_admin_env();

        let (network_secret, network_identity) = create_network_keypair();
        let (admin_private, admin_public) = create_account_keypair(0);
        let (player_private, player_public) = create_account_keypair(1);
        let seed = create_seed(&network_secret, 1);

        let mut state = MockState::new()
            .with_player(&player_public, 50_000)
            .with_policy(test_policy());
        // Add admin account for nonce tracking
        state.data.insert(Key::Account(admin_public), Value::Account(Default::default()));

        let mut layer = Layer::new(&state, network_identity, b"test", seed);

        // Execute deposit
        let deposit_tx = Transaction::sign(
            &admin_private,
            0,
            Instruction::BridgeDeposit {
                recipient: player_public.clone(),
                amount: 5000,
                source: vec![0x11; 32],
            },
        );

        // Execute withdrawal
        let withdraw_tx = Transaction::sign(
            &player_private,
            0,
            Instruction::BridgeWithdraw {
                amount: 2000,
                destination: vec![0x22; 20],
            },
        );

        // Execute both in sequence
        let (_, _) = layer
            .execute(vec![deposit_tx, withdraw_tx])
            .await
            .expect("execute should succeed");

        // Verify ledger state totals
        let pending = layer.commit();
        let ledger_state = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerState,
                crate::state::Status::Update(Value::LedgerState(state)),
            ) => Some(state.clone()),
            _ => None,
        });
        assert!(ledger_state.is_some(), "Should have LedgerState");
        let ledger = ledger_state.unwrap();
        assert_eq!(ledger.next_entry_id, 2, "Should have created two entries");
        assert_eq!(ledger.total_deposits, 5000, "Should track deposit total");
        assert_eq!(
            ledger.total_withdrawal_requests, 2000,
            "Should track withdrawal request total"
        );
        assert_eq!(
            ledger.pending_reconciliation_count, 2,
            "Should have two pending reconciliations"
        );

        // Verify both ledger entries exist
        let entry_count = pending
            .iter()
            .filter(|(k, _)| matches!(k, Key::LedgerEntry(_)))
            .count();
        assert_eq!(entry_count, 2, "Should have two ledger entries");
    }

    /// Test that ledger entries preserve chain_ref (EVM tx hash / address).
    #[tokio::test]
    async fn test_ledger_entry_preserves_chain_ref() {
        let (network_secret, network_identity) = create_network_keypair();
        let (private, public) = create_account_keypair(1);
        let seed = create_seed(&network_secret, 1);

        let state = MockState::new()
            .with_player(&public, 10_000)
            .with_policy(test_policy());

        let mut layer = Layer::new(&state, network_identity, b"test", seed);

        let destination = vec![0xDE; 20]; // Valid 20-byte address

        let tx = Transaction::sign(
            &private,
            0,
            Instruction::BridgeWithdraw {
                amount: 500,
                destination: destination.clone(),
            },
        );

        let (_, _) = layer.execute(vec![tx]).await.expect("execute should succeed");

        // Verify chain_ref is preserved in ledger entry
        let pending = layer.commit();
        let ledger_entry = pending.iter().find_map(|(k, v)| match (k, v) {
            (
                Key::LedgerEntry(0),
                crate::state::Status::Update(Value::LedgerEntry(entry)),
            ) => Some(entry.clone()),
            _ => None,
        });
        assert!(ledger_entry.is_some(), "Should have LedgerEntry");
        let entry = ledger_entry.unwrap();
        assert_eq!(
            entry.chain_ref, destination,
            "chain_ref should match destination"
        );
    }
}
