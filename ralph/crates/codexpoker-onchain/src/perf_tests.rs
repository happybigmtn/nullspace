//! Performance tests for reveal verification and artifact retrieval.
//!
//! These tests verify that core operations meet performance targets:
//!
//! 1. **Reveal verification throughput**: Validating reveal payloads should
//!    handle > 1000 validations/sec to support real-time gameplay.
//!
//! 2. **Artifact retrieval latency**: Single artifact retrieval should
//!    complete in < 1ms for the in-memory registry.
//!
//! 3. **Batch artifact operations**: Backfill processing should scale
//!    linearly with artifact count.
//!
//! # Running Performance Tests
//!
//! These tests use wall-clock timing with multiple iterations to reduce
//! noise. Run with `--release` for accurate measurements:
//!
//! ```bash
//! cargo test --release perf_tests -- --nocapture
//! ```
//!
//! # Performance Targets
//!
//! | Operation               | Target              | Rationale                    |
//! |-------------------------|---------------------|------------------------------|
//! | Reveal validation       | > 1000/sec          | Real-time gameplay           |
//! | Artifact store          | > 10,000/sec        | Deal setup overhead          |
//! | Artifact get            | > 50,000/sec        | Frequent lookups             |
//! | Backfill (100 items)    | < 10ms              | Restart recovery time        |
//! | Commitment hash         | > 100,000/sec       | Repeated during validation   |

#[cfg(test)]
mod tests {
    use crate::artifact_registry::{ArtifactRegistry, ArtifactType, InMemoryArtifactRegistry};
    use crate::messages::{ActionLogValidator, ConsensusPayload};
    use protocol_messages::{
        ArtifactResponse, DealCommitment, DealCommitmentAck, ProtocolVersion, RevealPhase,
        RevealShare, ScopeBinding, TimelockReveal,
    };
    use std::time::{Duration, Instant};

    // ─────────────────────────────────────────────────────────────────────────────
    // Test Helpers
    // ─────────────────────────────────────────────────────────────────────────────

    fn test_scope() -> ScopeBinding {
        ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52)
    }

    fn test_deal_commitment() -> DealCommitment {
        DealCommitment {
            version: ProtocolVersion::current(),
            scope: test_scope(),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![[3u8; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD],
        }
    }

    /// Create a validator with commitment and all acks received.
    fn setup_validator_with_acks() -> (ActionLogValidator, [u8; 32]) {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();
        let seats = dc.scope.seat_order.clone();

        let mut validator = ActionLogValidator::new();
        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        for seat in seats {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .unwrap();
        }

        (validator, commitment_hash)
    }

    /// Measure elapsed time for an operation, returning (result, duration).
    fn time_op<F, T>(op: F) -> (T, Duration)
    where
        F: FnOnce() -> T,
    {
        let start = Instant::now();
        let result = op();
        let elapsed = start.elapsed();
        (result, elapsed)
    }

    /// Run an operation multiple times and return (total_ops, total_duration).
    fn bench_op<F>(iterations: usize, mut op: F) -> (usize, Duration)
    where
        F: FnMut(),
    {
        let start = Instant::now();
        for _ in 0..iterations {
            op();
        }
        let elapsed = start.elapsed();
        (iterations, elapsed)
    }

    fn ops_per_sec(ops: usize, duration: Duration) -> f64 {
        ops as f64 / duration.as_secs_f64()
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Reveal Verification Performance
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Reveal validation throughput.
    ///
    /// Measures how many reveal payloads can be validated per second.
    /// Target: > 1000/sec for real-time gameplay.
    #[test]
    fn perf_reveal_validation_throughput() {
        const ITERATIONS: usize = 1000;
        const TARGET_OPS_PER_SEC: f64 = 1000.0;

        // Setup: we need to reset the validator each time since reveals
        // are state-dependent. We'll measure validation setup + validation.
        let mut total_duration = Duration::ZERO;

        for i in 0..ITERATIONS {
            let (mut validator, commitment_hash) = setup_validator_with_acks();

            // Enter reveal phase
            validator
                .enter_reveal_only_phase(RevealPhase::Preflop)
                .unwrap();

            let reveal = RevealShare {
                version: ProtocolVersion::current(),
                commitment_hash,
                phase: RevealPhase::Preflop,
                card_indices: vec![0, 1],
                reveal_data: vec![vec![i as u8; 32], vec![(i + 1) as u8; 32]],
                from_seat: 0,
                signature: vec![0xAB; 64],
            };

            let (result, duration) = time_op(|| {
                validator.validate(&ConsensusPayload::RevealShare(reveal))
            });

            assert!(result.is_ok(), "validation should succeed");
            total_duration += duration;
        }

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_reveal_validation_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "reveal validation throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    /// Test: Timelock reveal validation throughput.
    ///
    /// Timelock reveals involve more validation (proof verification).
    /// Uses the no-op verifier to isolate validation overhead.
    #[test]
    fn perf_timelock_validation_throughput() {
        const ITERATIONS: usize = 1000;
        const TARGET_OPS_PER_SEC: f64 = 500.0; // Lower target due to more complex validation

        let mut total_duration = Duration::ZERO;

        for i in 0..ITERATIONS {
            let (mut validator, commitment_hash) = setup_validator_with_acks();

            // Enter reveal phase (without timeout tracking for immediate acceptance)
            validator
                .enter_reveal_only_phase(RevealPhase::Preflop)
                .unwrap();

            let timelock = TimelockReveal {
                version: ProtocolVersion::current(),
                commitment_hash,
                phase: RevealPhase::Preflop,
                card_indices: vec![0, 1],
                timelock_proof: vec![i as u8; 128], // Realistic proof size
                revealed_values: vec![vec![0x01; 32], vec![0x02; 32]],
                timeout_seat: 0,
            };

            let (result, duration) = time_op(|| {
                validator.validate(&ConsensusPayload::TimelockReveal(timelock))
            });

            assert!(result.is_ok(), "timelock validation should succeed");
            total_duration += duration;
        }

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_timelock_validation_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "timelock validation throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    /// Test: Commitment hash computation throughput.
    ///
    /// Commitment hashes are computed frequently during validation.
    /// Target: > 50,000/sec in debug, > 100,000/sec in release.
    #[test]
    fn perf_commitment_hash_throughput() {
        const ITERATIONS: usize = 10_000;
        // Conservative target for debug builds; release will be ~10x faster
        const TARGET_OPS_PER_SEC: f64 = 50_000.0;

        let commitment = test_deal_commitment();

        let (_, total_duration) = bench_op(ITERATIONS, || {
            let _hash = commitment.commitment_hash();
            std::hint::black_box(_hash);
        });

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_commitment_hash_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "commitment hash throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Artifact Registry Performance
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Artifact store throughput.
    ///
    /// Measures how many artifacts can be stored per second.
    /// Target: > 10,000/sec for efficient deal setup.
    #[test]
    fn perf_artifact_store_throughput() {
        const ITERATIONS: usize = 10_000;
        const TARGET_OPS_PER_SEC: f64 = 10_000.0;
        const ARTIFACT_SIZE: usize = 256; // Typical encryption key size

        let mut registry = InMemoryArtifactRegistry::new();

        let (_, total_duration) = bench_op(ITERATIONS, || {
            // Use varying data to avoid deduplication
            let data = vec![registry.count() as u8; ARTIFACT_SIZE];
            let _hash = registry
                .store(&data, ArtifactType::EncryptionKey, "dealer", 1700000000000)
                .expect("store should succeed");
        });

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_artifact_store_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "artifact store throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    /// Test: Artifact retrieval throughput.
    ///
    /// Measures how many artifacts can be retrieved per second.
    /// Target: > 50,000/sec for frequent lookups during validation.
    #[test]
    fn perf_artifact_get_throughput() {
        const ARTIFACT_COUNT: usize = 1000;
        const ITERATIONS: usize = 10_000;
        const TARGET_OPS_PER_SEC: f64 = 50_000.0;
        const ARTIFACT_SIZE: usize = 256;

        let mut registry = InMemoryArtifactRegistry::new();
        let mut hashes = Vec::with_capacity(ARTIFACT_COUNT);

        // Pre-populate registry
        for i in 0..ARTIFACT_COUNT {
            let data = vec![i as u8; ARTIFACT_SIZE];
            let hash = registry
                .store(&data, ArtifactType::EncryptionKey, "dealer", 0)
                .expect("store should succeed");
            hashes.push(hash);
        }

        let mut idx = 0;
        let (_, total_duration) = bench_op(ITERATIONS, || {
            let hash = &hashes[idx % ARTIFACT_COUNT];
            let _result = registry.get(hash).expect("get should succeed");
            idx += 1;
        });

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_artifact_get_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "artifact get throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    /// Test: Artifact `contains` check throughput.
    ///
    /// Existence checks should be faster than full retrieval.
    /// Target: > 100,000/sec.
    #[test]
    fn perf_artifact_contains_throughput() {
        const ARTIFACT_COUNT: usize = 1000;
        const ITERATIONS: usize = 50_000;
        const TARGET_OPS_PER_SEC: f64 = 100_000.0;
        const ARTIFACT_SIZE: usize = 256;

        let mut registry = InMemoryArtifactRegistry::new();
        let mut hashes = Vec::with_capacity(ARTIFACT_COUNT);

        // Pre-populate registry
        for i in 0..ARTIFACT_COUNT {
            let data = vec![i as u8; ARTIFACT_SIZE];
            let hash = registry
                .store(&data, ArtifactType::EncryptionKey, "dealer", 0)
                .expect("store should succeed");
            hashes.push(hash);
        }

        let mut idx = 0;
        let (_, total_duration) = bench_op(ITERATIONS, || {
            let hash = &hashes[idx % ARTIFACT_COUNT];
            let _exists = registry.contains(hash);
            std::hint::black_box(_exists);
            idx += 1;
        });

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_artifact_contains_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "artifact contains throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    /// Test: Artifact commitment index lookup throughput.
    ///
    /// Looking up artifacts by commitment is common during deal validation.
    /// Target: > 50,000/sec.
    #[test]
    fn perf_artifact_commitment_lookup_throughput() {
        const COMMITMENT_COUNT: usize = 100;
        const ARTIFACTS_PER_COMMITMENT: usize = 5;
        const ITERATIONS: usize = 10_000;
        const TARGET_OPS_PER_SEC: f64 = 50_000.0;
        const ARTIFACT_SIZE: usize = 256;

        let mut registry = InMemoryArtifactRegistry::new();
        let mut commitment_hashes = Vec::with_capacity(COMMITMENT_COUNT);

        // Pre-populate registry with artifacts grouped by commitment
        for c in 0..COMMITMENT_COUNT {
            let commitment_hash = [c as u8; 32];
            commitment_hashes.push(commitment_hash);

            for a in 0..ARTIFACTS_PER_COMMITMENT {
                let data = vec![(c * 100 + a) as u8; ARTIFACT_SIZE];
                registry
                    .store_for_commitment(
                        &data,
                        ArtifactType::EncryptionKey,
                        "dealer",
                        0,
                        commitment_hash,
                    )
                    .expect("store should succeed");
            }
        }

        let mut idx = 0;
        let (_, total_duration) = bench_op(ITERATIONS, || {
            let commitment = &commitment_hashes[idx % COMMITMENT_COUNT];
            let _artifacts = registry.get_by_commitment(commitment);
            std::hint::black_box(_artifacts);
            idx += 1;
        });

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_artifact_commitment_lookup_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "commitment lookup throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Backfill Performance
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Backfill response processing latency.
    ///
    /// Measures time to process a backfill response with 100 artifacts.
    /// Target: < 10ms for reasonable restart recovery time.
    #[test]
    fn perf_backfill_processing_latency() {
        const ARTIFACT_COUNT: usize = 100;
        const ARTIFACT_SIZE: usize = 256;
        const TARGET_LATENCY_MS: u64 = 10;
        const ITERATIONS: usize = 100;

        // Prepare backfill response with valid artifacts
        let mut artifacts = Vec::with_capacity(ARTIFACT_COUNT);
        for i in 0..ARTIFACT_COUNT {
            let data = vec![i as u8; ARTIFACT_SIZE];
            let hash: [u8; 32] = blake3::hash(&data).into();
            artifacts.push((hash, data));
        }

        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts,
            missing: vec![],
        };

        let mut total_duration = Duration::ZERO;

        for _ in 0..ITERATIONS {
            // Fresh registry for each iteration
            let mut registry = InMemoryArtifactRegistry::new();

            let (result, duration) = time_op(|| {
                registry.process_backfill_response(&response, 1700000000000)
            });

            assert_eq!(result.stored.len(), ARTIFACT_COUNT);
            assert!(result.is_complete());
            total_duration += duration;
        }

        let avg_duration = total_duration / ITERATIONS as u32;
        println!(
            "[perf_backfill_processing_latency] {} artifacts: avg {:?} (target: <{}ms)",
            ARTIFACT_COUNT, avg_duration, TARGET_LATENCY_MS
        );

        assert!(
            avg_duration < Duration::from_millis(TARGET_LATENCY_MS),
            "backfill latency {:?} exceeds target {}ms",
            avg_duration,
            TARGET_LATENCY_MS
        );
    }

    /// Test: Backfill scaling with artifact count.
    ///
    /// Verifies that processing time scales roughly linearly with artifact count.
    #[test]
    fn perf_backfill_scaling() {
        const ARTIFACT_SIZE: usize = 256;
        const COUNTS: [usize; 4] = [10, 50, 100, 200];
        const ITERATIONS: usize = 50;

        let mut results = Vec::with_capacity(COUNTS.len());

        for &count in &COUNTS {
            // Prepare backfill response
            let mut artifacts = Vec::with_capacity(count);
            for i in 0..count {
                let data = vec![i as u8; ARTIFACT_SIZE];
                let hash: [u8; 32] = blake3::hash(&data).into();
                artifacts.push((hash, data));
            }

            let response = ArtifactResponse {
                version: ProtocolVersion::current(),
                artifacts,
                missing: vec![],
            };

            let mut total_duration = Duration::ZERO;
            for _ in 0..ITERATIONS {
                let mut registry = InMemoryArtifactRegistry::new();
                let (_, duration) = time_op(|| {
                    registry.process_backfill_response(&response, 0)
                });
                total_duration += duration;
            }

            let avg_duration = total_duration / ITERATIONS as u32;
            results.push((count, avg_duration));
        }

        println!("[perf_backfill_scaling] Results:");
        for (count, duration) in &results {
            println!("  {} artifacts: {:?}", count, duration);
        }

        // Verify roughly linear scaling (no worse than 3x expected)
        // Time for 200 should be < 6x time for 10 (allowing for overhead)
        let (count_10, time_10) = results[0];
        let (count_200, time_200) = results[3];

        let scaling_factor = (count_200 as f64) / (count_10 as f64); // 20x
        let time_ratio = time_200.as_nanos() as f64 / time_10.as_nanos() as f64;

        println!(
            "  Scaling: {}x items, {:.1}x time (expected: ~{:.0}x)",
            scaling_factor, time_ratio, scaling_factor
        );

        // Allow 3x overhead factor for smaller workloads
        let max_allowed_ratio = scaling_factor * 3.0;
        assert!(
            time_ratio < max_allowed_ratio,
            "backfill scaling appears superlinear: {:.1}x time for {:.0}x items",
            time_ratio,
            scaling_factor
        );
    }

    /// Test: Find missing artifacts throughput.
    ///
    /// Measures how quickly we can identify missing hashes.
    /// Note: Target is conservative to pass in debug builds; release builds
    /// will be significantly faster.
    #[test]
    fn perf_find_missing_throughput() {
        const STORED_COUNT: usize = 1000;
        const QUERY_COUNT: usize = 100;
        const ITERATIONS: usize = 1000;
        const TARGET_OPS_PER_SEC: f64 = 1_000.0; // Conservative for debug builds
        const ARTIFACT_SIZE: usize = 256;

        let mut registry = InMemoryArtifactRegistry::new();
        let mut stored_hashes = Vec::with_capacity(STORED_COUNT);

        // Pre-populate registry
        for i in 0..STORED_COUNT {
            let data = vec![i as u8; ARTIFACT_SIZE];
            let hash = registry
                .store(&data, ArtifactType::EncryptionKey, "dealer", 0)
                .expect("store should succeed");
            stored_hashes.push(hash);
        }

        // Create query with mix of present and missing hashes
        let mut query_hashes = Vec::with_capacity(QUERY_COUNT);
        for i in 0..QUERY_COUNT {
            if i < QUERY_COUNT / 2 {
                // Present
                query_hashes.push(stored_hashes[i % STORED_COUNT]);
            } else {
                // Missing
                query_hashes.push([255 - i as u8; 32]);
            }
        }

        let (_, total_duration) = bench_op(ITERATIONS, || {
            let _missing = registry.find_missing(&query_hashes);
            std::hint::black_box(_missing);
        });

        let throughput = ops_per_sec(ITERATIONS, total_duration);
        println!(
            "[perf_find_missing_throughput] {} ops in {:?} = {:.0} ops/sec (target: {:.0})",
            ITERATIONS, total_duration, throughput, TARGET_OPS_PER_SEC
        );

        assert!(
            throughput >= TARGET_OPS_PER_SEC,
            "find_missing throughput {:.0}/sec below target {:.0}/sec",
            throughput,
            TARGET_OPS_PER_SEC
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Full Validation Path Performance
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Full deal setup to reveal validation path.
    ///
    /// Measures end-to-end performance of a complete deal cycle.
    #[test]
    fn perf_full_deal_cycle() {
        const ITERATIONS: usize = 100;
        const TARGET_CYCLE_MS: u64 = 5; // Each full cycle should complete in < 5ms

        let mut total_duration = Duration::ZERO;

        for _ in 0..ITERATIONS {
            let (_, duration) = time_op(|| {
                // 1. Create and validate deal commitment
                let dc = test_deal_commitment();
                let commitment_hash = dc.commitment_hash();
                let seats = dc.scope.seat_order.clone();

                let mut validator = ActionLogValidator::new();
                validator
                    .validate(&ConsensusPayload::DealCommitment(dc))
                    .expect("commitment validation");

                // 2. Validate all acks
                for seat in seats {
                    let ack = DealCommitmentAck {
                        version: ProtocolVersion::current(),
                        commitment_hash,
                        seat_index: seat,
                        player_signature: vec![],
                    };
                    validator
                        .validate(&ConsensusPayload::DealCommitmentAck(ack))
                        .expect("ack validation");
                }

                // 3. Enter reveal phase and validate reveal
                validator
                    .enter_reveal_only_phase(RevealPhase::Preflop)
                    .expect("enter reveal phase");

                let reveal = RevealShare {
                    version: ProtocolVersion::current(),
                    commitment_hash,
                    phase: RevealPhase::Preflop,
                    card_indices: vec![0, 1],
                    reveal_data: vec![vec![0x01; 32], vec![0x02; 32]],
                    from_seat: 0,
                    signature: vec![],
                };
                validator
                    .validate(&ConsensusPayload::RevealShare(reveal))
                    .expect("reveal validation");
            });

            total_duration += duration;
        }

        let avg_duration = total_duration / ITERATIONS as u32;
        println!(
            "[perf_full_deal_cycle] avg cycle time: {:?} (target: <{}ms)",
            avg_duration, TARGET_CYCLE_MS
        );

        assert!(
            avg_duration < Duration::from_millis(TARGET_CYCLE_MS),
            "full deal cycle {:?} exceeds target {}ms",
            avg_duration,
            TARGET_CYCLE_MS
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Memory and Allocation Tests
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Artifact registry memory usage stays bounded.
    ///
    /// Verifies that storing many artifacts doesn't cause unexpected memory growth.
    /// Each artifact has unique content to avoid deduplication.
    #[test]
    fn perf_artifact_memory_bounded() {
        const ARTIFACT_COUNT: usize = 10_000;
        const ARTIFACT_SIZE: usize = 256;
        const EXPECTED_TOTAL_SIZE: usize = ARTIFACT_COUNT * ARTIFACT_SIZE;

        let mut registry = InMemoryArtifactRegistry::new();

        for i in 0..ARTIFACT_COUNT {
            // Create unique data for each artifact to avoid deduplication.
            // Use index bytes spread across the artifact.
            let mut data = vec![0u8; ARTIFACT_SIZE];
            let i_bytes = (i as u64).to_le_bytes();
            data[..8].copy_from_slice(&i_bytes);
            data[128..136].copy_from_slice(&i_bytes);

            registry
                .store(&data, ArtifactType::EncryptionKey, "dealer", 0)
                .expect("store should succeed");
        }

        let reported_size = registry.total_size();

        println!(
            "[perf_artifact_memory_bounded] {} artifacts ({} bytes data): reported {} bytes",
            ARTIFACT_COUNT, EXPECTED_TOTAL_SIZE, reported_size
        );

        assert_eq!(
            reported_size, EXPECTED_TOTAL_SIZE,
            "registry reports incorrect total size"
        );

        // The registry only tracks data size, not metadata overhead.
        // This test ensures the reported size matches expected data size.
        assert_eq!(registry.count(), ARTIFACT_COUNT);
    }

    /// Test: Commitment hash is consistent across many computations.
    ///
    /// Verifies hash stability under repeated computation.
    #[test]
    fn perf_commitment_hash_stability() {
        const ITERATIONS: usize = 10_000;

        let commitment = test_deal_commitment();
        let expected_hash = commitment.commitment_hash();

        for i in 0..ITERATIONS {
            let hash = commitment.commitment_hash();
            assert_eq!(
                hash, expected_hash,
                "hash mismatch at iteration {}",
                i
            );
        }

        println!(
            "[perf_commitment_hash_stability] {} iterations: all hashes consistent",
            ITERATIONS
        );
    }
}
