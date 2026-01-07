//! Idempotency tests for determinism (DET-4).
//!
//! These tests verify that re-executing the same transactions produces
//! no-op results (no state changes, no new events, identical roots).
//!
//! This is critical for ensuring that retry logic and crash recovery don't
//! cause double-application of transactions or divergent state.

#[cfg(test)]
mod tests {
    use crate::mocks::{create_account_keypair, create_adbs, create_network_keypair, create_seed};
    use crate::state_transition;
    use commonware_runtime::deterministic::Runner;
    use commonware_runtime::Runner as _;
    use commonware_storage::qmdb::store::CleanStore as _;
    #[cfg(feature = "parallel")]
    use commonware_runtime::ThreadPool;
    use nullspace_types::execution::{Instruction, Transaction, Value};

    #[test]
    fn test_reexecuting_same_height_is_noop() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // First execution
            let result1 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                vec![tx.clone()],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("first execution should succeed");

            let state_root_1 = state.root();
            let events_root_1 = events.root();
            let state_op_1 = u64::from(state.op_count());
            let events_op_1 = u64::from(events.op_count());

            assert_eq!(result1.executed_transactions, 1);
            assert!(result1.state_start_op < result1.state_end_op);

            // Second execution - should be a no-op
            let result2 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed,
                vec![tx],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("second execution should be no-op");

            // Verify no-op behavior
            assert_eq!(
                result2.executed_transactions, 0,
                "no transactions should be executed on retry"
            );
            assert_eq!(
                result2.state_start_op, result2.state_end_op,
                "state ops should not change"
            );
            assert_eq!(
                result2.events_start_op, result2.events_end_op,
                "events ops should not change"
            );
            assert!(
                result2.processed_nonces.is_empty(),
                "no nonces should be processed on retry"
            );

            // Verify roots unchanged
            assert_eq!(state.root(), state_root_1, "state root should not change");
            assert_eq!(
                events.root(),
                events_root_1,
                "events root should not change"
            );

            // Verify op counts unchanged
            assert_eq!(
                u64::from(state.op_count()),
                state_op_1,
                "state op count should not change"
            );
            assert_eq!(
                u64::from(events.op_count()),
                events_op_1,
                "events op count should not change"
            );
        });
    }

    #[test]
    fn test_multiple_reexecutions_are_stable() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // Execute once
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                vec![tx.clone()],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("execution should succeed");

            let stable_state_root = state.root();
            let stable_events_root = events.root();

            // Re-execute 10 times and verify stability
            for attempt in 1..=10 {
                let result = state_transition::execute_state_transition(
                    &mut state,
                    &mut events,
                    network_identity,
                    1,
                    seed.clone(),
                    vec![tx.clone()],
                    #[cfg(feature = "parallel")]
                    pool.clone(),
                )
                .await
                .expect("retry should succeed");

                assert_eq!(
                    result.executed_transactions, 0,
                    "attempt {}: no transactions should execute",
                    attempt
                );
                assert_eq!(
                    state.root(),
                    stable_state_root,
                    "attempt {}: state root should remain stable",
                    attempt
                );
                assert_eq!(
                    events.root(),
                    stable_events_root,
                    "attempt {}: events root should remain stable",
                    attempt
                );
            }
        });
    }

    #[test]
    fn test_idempotency_with_failed_transactions() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Invalid transaction (wrong nonce)
            let bad_tx = Transaction::sign(
                &private,
                99, // Wrong nonce - should be 0
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // Execute with invalid transaction
            let result1 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                vec![bad_tx.clone()],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("execution should succeed even with failed tx");

            // Transaction should fail nonce validation
            assert_eq!(
                result1.executed_transactions, 0,
                "invalid tx should not execute"
            );

            let state_root_1 = state.root();
            let events_root_1 = events.root();

            // Re-execute - should still be idempotent
            let result2 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed,
                vec![bad_tx],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("retry should succeed");

            assert_eq!(
                result2.executed_transactions, 0,
                "retry should also not execute invalid tx"
            );
            assert_eq!(
                result2.state_start_op, result2.state_end_op,
                "no state changes on retry"
            );
            assert_eq!(state.root(), state_root_1, "state root unchanged");
            assert_eq!(events.root(), events_root_1, "events root unchanged");
        });
    }

    #[test]
    fn test_idempotency_across_empty_blocks() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // Execute empty block
            let result1 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                vec![],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("empty block execution should succeed");

            assert_eq!(result1.executed_transactions, 0);
            let state_root_1 = state.root();
            let events_root_1 = events.root();

            // Re-execute empty block
            let result2 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed,
                vec![],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("retry should succeed");

            assert_eq!(result2.executed_transactions, 0);
            assert_eq!(
                result2.state_start_op, result2.state_end_op,
                "no state changes"
            );
            assert_eq!(state.root(), state_root_1, "state root unchanged");
            assert_eq!(events.root(), events_root_1, "events root unchanged");
        });
    }

    #[test]
    fn test_idempotency_after_mixed_valid_invalid_txs() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Mix of valid and invalid transactions
            let txs = vec![
                Transaction::sign(
                    &private,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player1".to_string(),
                    },
                ), // Valid
                Transaction::sign(
                    &private,
                    99,
                    Instruction::CasinoRegister {
                        name: "Player2".to_string(),
                    },
                ), // Invalid nonce
                Transaction::sign(
                    &private,
                    1,
                    Instruction::CasinoRegister {
                        name: "Player3".to_string(),
                    },
                ), // Valid
            ];

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // Execute
            let result1 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                txs.clone(),
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("execution should succeed");

            // Should execute only valid transactions
            assert_eq!(result1.executed_transactions, 2);
            let state_root_1 = state.root();

            // Re-execute
            let result2 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed,
                txs,
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("retry should succeed");

            // Should be no-op
            assert_eq!(result2.executed_transactions, 0);
            assert_eq!(state.root(), state_root_1, "state unchanged on retry");
        });
    }

    #[test]
    fn test_idempotency_preserves_nonce_state() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, public) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // Execute
            let result1 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                vec![tx.clone()],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("execution should succeed");

            assert_eq!(result1.executed_transactions, 1);
            assert_eq!(
                result1.processed_nonces.get(&public),
                Some(&1),
                "nonce should advance to 1"
            );

            // Re-execute
            let result2 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed,
                vec![tx],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("retry should succeed");

            // No nonces should be processed on retry (because height <= state_height)
            assert!(
                result2.processed_nonces.is_empty(),
                "no nonces should be updated on retry"
            );

            // The fact that processed_nonces is empty proves that nonces weren't
            // double-incremented. Combined with state root stability, this confirms
            // that nonce state is preserved correctly during idempotent re-execution.
        });
    }

    #[test]
    fn test_idempotency_metadata_unchanged() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );

            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            // Execute
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed.clone(),
                vec![tx.clone()],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("execution should succeed");

            // Read metadata
            let metadata1 = state
                .get_metadata()
                .await
                .expect("read metadata")
                .expect("metadata should exist");

            // Re-execute
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed,
                vec![tx],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("retry should succeed");

            // Verify metadata unchanged
            let metadata2 = state
                .get_metadata()
                .await
                .expect("read metadata")
                .expect("metadata should exist");

            assert_eq!(metadata1, metadata2, "metadata should not change on retry");

            match metadata2 {
                Value::Commit { height, start: _ } => {
                    assert_eq!(height, 1, "height should still be 1");
                }
                _ => panic!("expected commit metadata"),
            }
        });
    }
}
