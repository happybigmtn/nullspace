//! Height handling edge case tests for determinism (DET-1).
//!
//! These tests verify that the state transition function correctly handles:
//! - No-op behavior when height <= state_height (idempotency)
//! - Gap rejection when height jumps (e.g., state_height + 2)
//! - Recovery sequences followed by normal execution
//!
//! These are critical for ensuring that crash recovery and replay scenarios
//! produce deterministic results without silently skipping blocks or double-applying.

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
    use nullspace_types::NAMESPACE;

    #[test]
    fn test_height_equal_to_state_height_is_noop() {
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

            // Execute height=1 normally
            let seed = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );
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

            assert_eq!(result1.executed_transactions, 1);
            let state_root_after_first = result1.state_root;
            let events_root_after_first = result1.events_root;

            // Re-execute height=1 (same as state_height)
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

            // Should be a no-op: no transactions executed, roots unchanged
            assert_eq!(result2.executed_transactions, 0);
            assert_eq!(result2.state_root, state_root_after_first);
            assert_eq!(result2.events_root, events_root_after_first);
            assert_eq!(result2.state_start_op, result2.state_end_op);
            assert_eq!(result2.events_start_op, result2.events_end_op);
            assert!(result2.processed_nonces.is_empty());

            // Verify state height is still 1
            let state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height, 1);
        });
    }

    #[test]
    fn test_height_less_than_state_height_is_noop() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Execute heights 1, 2, 3
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            for height in 1..=3 {
                let tx = Transaction::sign(
                    &private,
                    height - 1,
                    Instruction::CasinoRegister {
                        name: format!("Player{}", height),
                    },
                );
                let seed = create_seed(&network_secret, height);
                state_transition::execute_state_transition(
                    &mut state,
                    &mut events,
                    network_identity,
                    height,
                    seed,
                    vec![tx],
                    #[cfg(feature = "parallel")]
                    pool.clone(),
                )
                .await
                .expect("execution should succeed");
            }

            let state_root_after_3 = state.root();
            let events_root_after_3 = events.root();

            // Try to execute height=2 (which is < state_height=3)
            let tx = Transaction::sign(
                &private,
                99, // Doesn't matter, won't be executed
                Instruction::CasinoRegister {
                    name: "OldPlayer".to_string(),
                },
            );
            let seed = create_seed(&network_secret, 2);
            let result = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                2, // height < state_height (3)
                seed,
                vec![tx],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("execution should be no-op");

            // Should be a no-op
            assert_eq!(result.executed_transactions, 0);
            assert_eq!(result.state_root, state_root_after_3);
            assert_eq!(result.events_root, events_root_after_3);
            assert!(result.processed_nonces.is_empty());

            // Verify state height is still 3
            let state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height, 3);
        });
    }

    #[test]
    fn test_height_gap_is_rejected() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Execute height=1
            let tx1 = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );
            let seed1 = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed1,
                vec![tx1],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("height=1 should succeed");

            // Try to execute height=3 (gap: state_height + 2)
            let tx3 = Transaction::sign(
                &private,
                1,
                Instruction::CasinoRegister {
                    name: "Player3".to_string(),
                },
            );
            let seed3 = create_seed(&network_secret, 3);
            let result = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                3, // Gap: state_height=1, expected=2, requested=3
                seed3,
                vec![tx3],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await;

            // Should fail with non-sequential height error
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("non-sequential height"),
                "error should mention non-sequential height, got: {}",
                err
            );
            assert!(
                err.contains("state_height=1"),
                "error should mention state_height=1, got: {}",
                err
            );
            assert!(
                err.contains("expected=2"),
                "error should mention expected=2, got: {}",
                err
            );
            assert!(
                err.contains("requested=3"),
                "error should mention requested=3, got: {}",
                err
            );

            // Verify state height is still 1
            let state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height, 1);
        });
    }

    #[test]
    fn test_recovery_followed_by_normal_execution() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Execute height=1 normally
            let tx1 = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );
            let seed1 = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed1,
                vec![tx1],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("height=1 should succeed");

            // Simulate crash during height=2: commit events but not state
            let tx2 = Transaction::sign(
                &private,
                1,
                Instruction::CasinoRegister {
                    name: "Player2".to_string(),
                },
            );
            let seed2 = create_seed(&network_secret, 2);

            let events_start_op = u64::from(events.op_count());
            let mut layer = crate::Layer::new(&state, network_identity, NAMESPACE, seed2.clone());
            let (outputs, _) = layer
                .execute(
                    #[cfg(feature = "parallel")]
                    pool.clone(),
                    vec![tx2.clone()],
                )
                .await
                .expect("execute layer");

            for output in outputs {
                events.append(output).await.expect("append output");
            }
            events
                .commit(Some(nullspace_types::execution::Output::Commit {
                    height: 2,
                    start: events_start_op,
                }))
                .await
                .expect("commit events");

            // Verify state is still at height=1, events at height=2
            let state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height, 1, "state should still be at height 1");

            let events_metadata = events.get_metadata().await.expect("read events metadata");
            let events_height = match events_metadata {
                Some(nullspace_types::execution::Output::Commit { height, start: _ }) => height,
                _ => 0,
            };
            assert_eq!(events_height, 2, "events should be at height 2");

            // Recovery: re-execute height=2 (should recover state)
            let recovery_result = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                2,
                seed2,
                vec![tx2],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("recovery should succeed");

            assert!(recovery_result.executed_transactions > 0);
            let state_height_after_recovery = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height_after_recovery, 2, "state should now be at height 2");

            // Normal execution: height=3
            let tx3 = Transaction::sign(
                &private,
                2,
                Instruction::CasinoRegister {
                    name: "Player3".to_string(),
                },
            );
            let seed3 = create_seed(&network_secret, 3);
            let normal_result = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                3,
                seed3,
                vec![tx3],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("normal execution after recovery should succeed");

            assert!(normal_result.executed_transactions > 0);
            let final_state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(final_state_height, 3, "state should be at height 3");
        });
    }

    #[test]
    fn test_multiple_recovery_attempts_are_idempotent() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Execute height=1 normally
            let tx1 = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );
            let seed1 = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed1,
                vec![tx1],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("height=1 should succeed");

            // Simulate crash: commit events but not state for height=2
            let tx2 = Transaction::sign(
                &private,
                1,
                Instruction::CasinoRegister {
                    name: "Player2".to_string(),
                },
            );
            let seed2 = create_seed(&network_secret, 2);

            let events_start_op = u64::from(events.op_count());
            let mut layer = crate::Layer::new(&state, network_identity, NAMESPACE, seed2.clone());
            let (outputs, _) = layer
                .execute(
                    #[cfg(feature = "parallel")]
                    pool.clone(),
                    vec![tx2.clone()],
                )
                .await
                .expect("execute layer");

            for output in outputs {
                events.append(output).await.expect("append output");
            }
            events
                .commit(Some(nullspace_types::execution::Output::Commit {
                    height: 2,
                    start: events_start_op,
                }))
                .await
                .expect("commit events");

            // First recovery attempt
            let recovery1 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                2,
                seed2.clone(),
                vec![tx2.clone()],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("first recovery should succeed");

            let state_root_after_first = recovery1.state_root;
            let events_root_after_first = recovery1.events_root;

            // Second recovery attempt (should be no-op since state is now at height 2)
            let recovery2 = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                2,
                seed2,
                vec![tx2],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("second recovery should be no-op");

            // Should be idempotent
            assert_eq!(recovery2.executed_transactions, 0);
            assert_eq!(recovery2.state_root, state_root_after_first);
            assert_eq!(recovery2.events_root, events_root_after_first);

            let final_state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(final_state_height, 2);
        });
    }

    #[test]
    fn test_height_zero_on_fresh_state() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            // Verify fresh state has height=0
            let state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height, 0);

            // Execute height=1 (first block)
            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "FirstPlayer".to_string(),
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
            .expect("height=1 on fresh state should succeed");

            let final_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|v| match v {
                    Value::Commit { height, start: _ } => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(final_height, 1);
        });
    }

    #[test]
    fn test_large_height_gap_is_rejected() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);

            // Execute height=1
            let tx1 = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "Player1".to_string(),
                },
            );
            let seed1 = create_seed(&network_secret, 1);
            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );
            state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1,
                seed1,
                vec![tx1],
                #[cfg(feature = "parallel")]
                pool.clone(),
            )
            .await
            .expect("height=1 should succeed");

            // Try to execute height=1000 (huge gap)
            let tx_huge = Transaction::sign(
                &private,
                1,
                Instruction::CasinoRegister {
                    name: "FuturePlayer".to_string(),
                },
            );
            let seed_huge = create_seed(&network_secret, 1000);
            let result = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                1000,
                seed_huge,
                vec![tx_huge],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await;

            // Should fail
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(err.contains("non-sequential height"));
            assert!(err.contains("requested=1000"));
        });
    }
}
