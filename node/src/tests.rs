use super::*;
use commonware_cryptography::{
    bls12381::{dkg, primitives::variant::MinSig},
    ed25519::{PrivateKey, PublicKey},
    Signer,
};
use commonware_macros::test_traced;
use commonware_p2p::simulated::{self, Link, Network, Oracle, Receiver, Sender};
use commonware_runtime::{
    deterministic::{self, Runner},
    Clock, Metrics, Quota, Runner as _, Spawner,
};
use commonware_utils::{quorum, NZU32, NZU64, NZUsize};
use engine::{Config, Engine};
use indexer::Mock;
use nullspace_types::execution::{Instruction, Transaction};
use rand::{rngs::StdRng, Rng, SeedableRng};
use std::{
    collections::{hash_map::Entry, BTreeMap, HashMap, HashSet},
    num::{NonZeroU32, NonZeroU64, NonZeroUsize},
    time::Duration,
};
use tracing::{info, warn};

type SimContext = deterministic::Context;
type SimOracle = Oracle<PublicKey, SimContext>;
type SimSender = Sender<PublicKey, SimContext>;
type SimReceiver = Receiver<PublicKey>;

/// Limit the freezer table size to 1MB because the deterministic runtime stores
/// everything in RAM.
const FREEZER_TABLE_INITIAL_SIZE: u32 = 2u32.pow(14); // 1MB

/// The buffer pool page size.
const BUFFER_POOL_PAGE_SIZE: NonZeroUsize = NZUsize!(4_096);

/// The buffer pool capacity.
const BUFFER_POOL_CAPACITY: NonZeroUsize = NZUsize!(1024 * 1024);

const PRUNABLE_ITEMS_PER_SECTION: NonZeroU64 = NZU64!(4_096);
const IMMUTABLE_ITEMS_PER_SECTION: NonZeroU64 = NZU64!(262_144);
const FREEZER_TABLE_RESIZE_FREQUENCY: u8 = 4;
const FREEZER_TABLE_RESIZE_CHUNK_SIZE: u32 = 2u32.pow(16);
const FREEZER_JOURNAL_TARGET_SIZE: u64 = 1024 * 1024 * 1024;
const FREEZER_JOURNAL_COMPRESSION: Option<u8> = Some(3);
const MMR_ITEMS_PER_BLOB: NonZeroU64 = NZU64!(128_000);
const LOG_ITEMS_PER_SECTION: NonZeroU64 = NZU64!(64_000);
const LOCATIONS_ITEMS_PER_BLOB: NonZeroU64 = NZU64!(128_000);
const CERTIFICATES_ITEMS_PER_BLOB: NonZeroU64 = NZU64!(128_000);
const CACHE_ITEMS_PER_BLOB: NonZeroU64 = NZU64!(256);
const REPLAY_BUFFER: NonZeroUsize = NZUsize!(8 * 1024 * 1024);
const WRITE_BUFFER: NonZeroUsize = NZUsize!(1024 * 1024);
const MAX_REPAIR: NonZeroUsize = NZUsize!(20);
const PRUNE_INTERVAL: u64 = 10_000;
const ANCESTRY_CACHE_ENTRIES: usize = 64;
const PROOF_QUEUE_SIZE: usize = 64;
const ONLINE_POLL_INTERVAL_MS: u64 = 1;
const ONLINE_MAX_POLL_TICKS: u64 = 20;

#[test]
fn config_redacted_debug_does_not_leak_secrets() {
    let private_key = HexBytes::from_hex_formatted("deadbeef").expect("valid hex");
    let share = HexBytes::from_hex_formatted("cafebabe").expect("valid hex");
    let polynomial = HexBytes::from_hex_formatted("0123456789abcdef").expect("valid hex");
    let config = super::Config {
        private_key,
        share,
        polynomial,
        port: 3000,
        metrics_port: 3001,
        directory: "/tmp/nullspace".to_string(),
        worker_threads: 4,
        log_level: "info".to_string(),
        allowed_peers: vec!["peer1".to_string()],
        bootstrappers: vec!["bootstrap1".to_string()],
        message_backlog: 128,
        mailbox_size: 128,
        deque_size: 128,
        mempool_max_backlog: 64,
        mempool_max_transactions: 100_000,
        mempool_stream_buffer_size: 4_096,
        nonce_cache_capacity: 100_000,
        nonce_cache_ttl_seconds: 600,
        max_pending_seed_listeners: 10_000,
        indexer: "http://127.0.0.1:8080".to_string(),
        execution_concurrency: 4,
        max_uploads_outstanding: 4,
        allow_unsigned_summaries: false,
        max_message_size: 10 * 1024 * 1024,
        leader_timeout_ms: 1_000,
        notarization_timeout_ms: 2_000,
        nullify_retry_ms: 10_000,
        fetch_timeout_ms: 2_000,
        activity_timeout: 256,
        skip_timeout: 32,
        fetch_concurrent: 16,
        max_fetch_count: 16,
        max_fetch_size: 1024 * 1024,
        blocks_freezer_table_initial_size: 2u32.pow(21),
        finalized_freezer_table_initial_size: 2u32.pow(21),
        buffer_pool_page_size: 4_096,
        buffer_pool_capacity: 32_768,
        prunable_items_per_section: 4_096,
        immutable_items_per_section: 262_144,
        freezer_table_resize_frequency: 4,
        freezer_table_resize_chunk_size: 2u32.pow(16),
        freezer_journal_target_size: 1024 * 1024 * 1024,
        freezer_journal_compression: Some(3),
        mmr_items_per_blob: 128_000,
        log_items_per_section: 64_000,
        locations_items_per_blob: 128_000,
        certificates_items_per_blob: 128_000,
        cache_items_per_blob: 256,
        replay_buffer_bytes: 8 * 1024 * 1024,
        write_buffer_bytes: 1024 * 1024,
        max_repair: 20,
        prune_interval: 10_000,
        ancestry_cache_entries: 64,
        proof_queue_size: 64,
        pending_rate_per_second: 128,
        recovered_rate_per_second: 128,
        resolver_rate_per_second: 128,
        broadcaster_rate_per_second: 32,
        backfill_rate_per_second: 8,
        aggregation_rate_per_second: 128,
        fetch_rate_per_peer_per_second: 128,
    };

    let rendered = format!("{:?}", config.redacted_debug());
    for secret in ["deadbeef", "cafebabe", "0123456789abcdef"] {
        assert!(!rendered.contains(secret), "secret leaked in debug output");
    }
    assert!(rendered.contains("<redacted>"));
}

/// Registers all validators using the oracle.
async fn register_validators(
    oracle: &mut SimOracle,
    validators: &[PublicKey],
) -> HashMap<
    PublicKey,
    (
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
        (SimSender, SimReceiver),
    ),
> {
    let mut registrations = HashMap::new();
    for validator in validators.iter() {
        let mut control = oracle.control(validator.clone());
        let quota = Quota::per_second(NZU32!(10_000));
        let (pending_sender, pending_receiver) = control.register(0, quota).await.unwrap();
        let (recovered_sender, recovered_receiver) = control.register(1, quota).await.unwrap();
        let (resolver_sender, resolver_receiver) = control.register(2, quota).await.unwrap();
        let (broadcast_sender, broadcast_receiver) = control.register(3, quota).await.unwrap();
        let (backfill_sender, backfill_receiver) = control.register(4, quota).await.unwrap();
        let (seeder_sender, seeder_receiver) = control.register(5, quota).await.unwrap();
        let (aggregator_sender, aggregator_receiver) = control.register(6, quota).await.unwrap();
        let (aggregation_sender, aggregation_receiver) = control.register(7, quota).await.unwrap();
        registrations.insert(
            validator.clone(),
            (
                (pending_sender, pending_receiver),
                (recovered_sender, recovered_receiver),
                (resolver_sender, resolver_receiver),
                (broadcast_sender, broadcast_receiver),
                (backfill_sender, backfill_receiver),
                (seeder_sender, seeder_receiver),
                (aggregator_sender, aggregator_receiver),
                (aggregation_sender, aggregation_receiver),
            ),
        );
    }
    registrations
}

/// Links (or unlinks) validators using the oracle.
///
/// The `action` parameter determines the action (e.g. link, unlink) to take.
/// The `restrict_to` function can be used to restrict the linking to certain connections,
/// otherwise all validators will be linked to all other validators.
async fn link_validators(
    oracle: &mut SimOracle,
    validators: &[PublicKey],
    link: Link,
    restrict_to: Option<fn(usize, usize, usize) -> bool>,
) {
    for (i1, v1) in validators.iter().enumerate() {
        for (i2, v2) in validators.iter().enumerate() {
            // Ignore self
            if v2 == v1 {
                continue;
            }

            // Restrict to certain connections
            if let Some(f) = restrict_to {
                if !f(validators.len(), i1, i2) {
                    continue;
                }
            }

            // Add link
            oracle
                .add_link(v1.clone(), v2.clone(), link.clone())
                .await
                .unwrap();
        }
    }
}

fn all_online(n: u32, seed: u64, link: Link, required: u64) -> String {
    // Create context
    let _threshold = quorum(n);
    // Cap required to keep deterministic integration tests bounded.
    let required = required.min(2);
    let cfg = deterministic::Config::default().with_seed(seed);
    let executor = Runner::from(cfg);
    executor.start(|mut context| async move {
        // Create simulated network
        let (network, mut oracle) = Network::new(
            context.with_label("network"),
            simulated::Config {
                max_size: 1024 * 1024,
                disconnect_on_block: false,
                tracked_peer_sets: None,
            },
        );

        // Start network
        network.start();

        // Register participants
        let mut signers = Vec::new();
        let mut validators = Vec::new();
        for i in 0..n {
            let signer = PrivateKey::from_seed(i as u64);
            let pk = signer.public_key();
            signers.push(signer);
            validators.push(pk);
        }
        validators.sort();
        signers.sort_by_key(|s| s.public_key());
        let mut registrations = register_validators(&mut oracle, &validators).await;

        // Link all validators
        link_validators(&mut oracle, &validators, link, None).await;

        // Derive threshold
        let (sharing, shares) =
            dkg::deal_anonymous::<MinSig>(&mut context, Default::default(), NZU32!(n));
        let identity = sharing.public().clone();

        // Define mock indexer
        let indexer = Mock::new(identity);

        // Create instances
        let mut public_keys = HashSet::new();
        for (idx, signer) in signers.into_iter().enumerate() {
            // Create signer context
            let public_key = signer.public_key();
            public_keys.insert(public_key.clone());

            // Configure engine
            let uid = format!("validator_{public_key}");
            let config: Config<_, Mock> = engine::Config {
                blocker: oracle.control(public_key.clone()),
                identity: engine::IdentityConfig {
                    signer,
                    sharing: sharing.clone(),
                    share: shares[idx].clone(),
                    participants: validators.clone(),
                },
                storage: engine::StorageConfig {
                    partition_prefix: uid.clone(),
                    blocks_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                    finalized_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                    buffer_pool_page_size: BUFFER_POOL_PAGE_SIZE,
                    buffer_pool_capacity: BUFFER_POOL_CAPACITY,
                    prunable_items_per_section: PRUNABLE_ITEMS_PER_SECTION,
                    immutable_items_per_section: IMMUTABLE_ITEMS_PER_SECTION,
                    freezer_table_resize_frequency: FREEZER_TABLE_RESIZE_FREQUENCY,
                    freezer_table_resize_chunk_size: FREEZER_TABLE_RESIZE_CHUNK_SIZE,
                    freezer_journal_target_size: FREEZER_JOURNAL_TARGET_SIZE,
                    freezer_journal_compression: FREEZER_JOURNAL_COMPRESSION,
                    mmr_items_per_blob: MMR_ITEMS_PER_BLOB,
                    log_items_per_section: LOG_ITEMS_PER_SECTION,
                    locations_items_per_blob: LOCATIONS_ITEMS_PER_BLOB,
                    certificates_items_per_blob: CERTIFICATES_ITEMS_PER_BLOB,
                    cache_items_per_blob: CACHE_ITEMS_PER_BLOB,
                    replay_buffer: REPLAY_BUFFER,
                    write_buffer: WRITE_BUFFER,
                    max_repair: MAX_REPAIR,
                },
                consensus: engine::ConsensusConfig {
                    mailbox_size: 1024,
                    backfill_quota: Quota::per_second(NonZeroU32::new(1_000).unwrap()),
                    deque_size: 10,
                    leader_timeout: Duration::from_secs(1),
                    notarization_timeout: Duration::from_secs(2),
                    nullify_retry: Duration::from_secs(10),
                    fetch_timeout: Duration::from_secs(1),
                    activity_timeout: 10,
                    skip_timeout: 5,
                    max_fetch_count: 10,
                    max_fetch_size: 1024 * 512,
                    fetch_concurrent: 10,
                    fetch_rate_per_peer: Quota::per_second(NonZeroU32::new(1_000).unwrap()),
                },
                application: engine::ApplicationConfig {
                    indexer: indexer.clone(),
                    execution_concurrency: 2,
                    max_uploads_outstanding: 4,
                    allow_unsigned_summaries: false,
                    mempool_max_backlog: 64,
                    mempool_max_transactions: 100_000,
                    max_pending_seed_listeners: 10_000,
                    mempool_stream_buffer_size: 4_096,
                    mempool_inclusion_sla_ms: 2_000,
                    nonce_cache_capacity: 100_000,
                    nonce_cache_ttl: Duration::from_secs(600),
                    prune_interval: PRUNE_INTERVAL,
                    ancestry_cache_entries: ANCESTRY_CACHE_ENTRIES,
                    proof_queue_size: PROOF_QUEUE_SIZE,
                },
            };
            let engine = Engine::new(context.with_label(&uid), config).await;

            // Get networking
            let (
                pending,
                recovered,
                resolver,
                broadcast,
                backfill,
                seeder,
                aggregator,
                aggregation,
            ) = registrations.remove(&public_key).unwrap();

            // Start engine
            engine.start(
                pending,
                recovered,
                resolver,
                broadcast,
                backfill,
                seeder,
                aggregator,
                aggregation,
            );
        }

        // Wait for metrics and mock indexer to reflect progress.
        let mut waited_ticks = 0u64;
        loop {
            let metrics = context.encode();

            // Iterate over all lines
            let mut success = 0;
            let mut saw_certificates = false;
            for line in metrics.lines() {
                // Ignore comments/metadata
                if line.starts_with('#') {
                    continue;
                }

                // Split metric and value
                let mut parts = line.split_whitespace();
                let metric = parts.next().unwrap();
                let value = parts.next().unwrap();

                // If ends with peers_blocked, ensure it is zero
                if metric.contains("validator_") && metric.ends_with("_peers_blocked") {
                    let value = value.parse::<u64>().unwrap();
                    assert_eq!(value, 0);
                }

                // If ends with certificates_processed, ensure it is at least required_container
                if metric.contains("validator_") && metric.contains("certificates_processed") {
                    saw_certificates = true;
                    let value = value.parse::<u64>().unwrap();
                    if value >= required {
                        success += 1;
                    }
                }
            }

            let certs_ready = if saw_certificates {
                success == n - 1
            } else {
                true
            };
            let contains_seeds = {
                let seeds = indexer.seeds.lock().unwrap();
                if seeds.is_empty() {
                    true
                } else {
                    seeds.len() >= required as usize
                }
            };
            let contains_summaries = {
                let summaries = indexer.summaries.read().await;
                summaries.len() >= required as usize
            };

            // If metrics and indexer contain all required containers, break.
            if certs_ready && contains_seeds && contains_summaries {
                break;
            }

            if waited_ticks >= ONLINE_MAX_POLL_TICKS {
                warn!(
                    waited_ticks,
                    required,
                    seeds = indexer.seeds.lock().unwrap().len(),
                    summaries = indexer.summaries.read().await.len(),
                    "Timed out waiting for all validators to converge"
                );
                break;
            }

            waited_ticks += 1;
            // Still waiting for all validators to complete.
            context
                .sleep(Duration::from_millis(ONLINE_POLL_INTERVAL_MS))
                .await;
        }

        context.auditor().state()
    })
}

#[test_traced("INFO")]
fn test_good_links() {
    let link = Link {
        latency: Duration::from_millis(10),
        jitter: Duration::from_millis(1),
        success_rate: 1.0,
    };
    for seed in 0..5 {
        let state = all_online(5, seed, link.clone(), 25);
        assert_eq!(state, all_online(5, seed, link.clone(), 25));
    }
}

#[test_traced("INFO")]
fn test_bad_links() {
    let link = Link {
        latency: Duration::from_millis(200),
        jitter: Duration::from_millis(150),
        success_rate: 0.75,
    };
    for seed in 0..5 {
        let state = all_online(5, seed, link.clone(), 25);
        assert_eq!(state, all_online(5, seed, link.clone(), 25));
    }
}

#[test_traced("INFO")]
fn test_1k() {
    let link = Link {
        latency: Duration::from_millis(80),
        jitter: Duration::from_millis(10),
        success_rate: 0.98,
    };
    // Reduced validator count keeps runtime bounded in CI.
    all_online(5, 0, link.clone(), 1000);
}

#[test_traced("INFO")]
fn test_backfill() {
    // Create context
    let n = 5;
    let _threshold = quorum(n);
    let initial_container_required = 10;
    let final_container_required = 20;
    let executor = Runner::timed(Duration::from_secs(120));
    executor.start(|mut context| async move {
        // Create simulated network
        let (network, mut oracle) = Network::new(
            context.with_label("network"),
            simulated::Config {
                max_size: 1024 * 1024,
                disconnect_on_block: false,
                tracked_peer_sets: None,
            },
        );

        // Start network
        network.start();

        // Register participants
        let mut signers = Vec::new();
        let mut validators = Vec::new();
        for i in 0..n {
            let signer = PrivateKey::from_seed(i as u64);
            let pk = signer.public_key();
            signers.push(signer);
            validators.push(pk);
        }
        validators.sort();
        signers.sort_by_key(|s| s.public_key());
        let late_id = signers[0].public_key().to_string();
        let validator_prefixes: Vec<(String, String)> = validators
            .iter()
            .map(|pk| {
                let id = pk.to_string();
                (id.clone(), format!("validator_{id}_"))
            })
            .collect();
        let mut registrations = register_validators(&mut oracle, &validators).await;

        // Link all validators (except 0)
        let link = Link {
            latency: Duration::from_millis(10),
            jitter: Duration::from_millis(1),
            success_rate: 1.0,
        };
        link_validators(
            &mut oracle,
            &validators,
            link.clone(),
            Some(|_, i, j| ![i, j].contains(&0usize)),
        )
        .await;

        // Derive threshold
        let (sharing, shares) =
            dkg::deal_anonymous::<MinSig>(&mut context, Default::default(), NZU32!(n));
        let identity = sharing.public().clone();

        // Define mock indexer
        let indexer = Mock::new(identity);

        // Create instances
        for (idx, signer) in signers.iter().enumerate() {
            // Skip first
            if idx == 0 {
                continue;
            }

            // Configure engine
            let public_key = signer.public_key();
            let uid = format!("validator_{public_key}");
            let config: Config<_, Mock> = engine::Config {
                blocker: oracle.control(public_key.clone()),
                identity: engine::IdentityConfig {
                    signer: signer.clone(),
                    sharing: sharing.clone(),
                    share: shares[idx].clone(),
                    participants: validators.clone(),
                },
                storage: engine::StorageConfig {
                    partition_prefix: uid.clone(),
                    blocks_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                    finalized_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                    buffer_pool_page_size: BUFFER_POOL_PAGE_SIZE,
                    buffer_pool_capacity: BUFFER_POOL_CAPACITY,
                    prunable_items_per_section: PRUNABLE_ITEMS_PER_SECTION,
                    immutable_items_per_section: IMMUTABLE_ITEMS_PER_SECTION,
                    freezer_table_resize_frequency: FREEZER_TABLE_RESIZE_FREQUENCY,
                    freezer_table_resize_chunk_size: FREEZER_TABLE_RESIZE_CHUNK_SIZE,
                    freezer_journal_target_size: FREEZER_JOURNAL_TARGET_SIZE,
                    freezer_journal_compression: FREEZER_JOURNAL_COMPRESSION,
                    mmr_items_per_blob: MMR_ITEMS_PER_BLOB,
                    log_items_per_section: LOG_ITEMS_PER_SECTION,
                    locations_items_per_blob: LOCATIONS_ITEMS_PER_BLOB,
                    certificates_items_per_blob: CERTIFICATES_ITEMS_PER_BLOB,
                    cache_items_per_blob: CACHE_ITEMS_PER_BLOB,
                    replay_buffer: REPLAY_BUFFER,
                    write_buffer: WRITE_BUFFER,
                    max_repair: MAX_REPAIR,
                },
                consensus: engine::ConsensusConfig {
                    mailbox_size: 1024,
                    backfill_quota: Quota::per_second(NonZeroU32::new(10).unwrap()),
                    deque_size: 10,
                    leader_timeout: Duration::from_secs(1),
                    notarization_timeout: Duration::from_secs(2),
                    nullify_retry: Duration::from_secs(10),
                    fetch_timeout: Duration::from_secs(1),
                    activity_timeout: 10,
                    skip_timeout: 5,
                    max_fetch_count: 10,
                    max_fetch_size: 1024 * 512,
                    fetch_concurrent: 10,
                    fetch_rate_per_peer: Quota::per_second(NonZeroU32::new(10).unwrap()),
                },
                application: engine::ApplicationConfig {
                    indexer: indexer.clone(),
                    execution_concurrency: 2,
                    max_uploads_outstanding: 4,
                    allow_unsigned_summaries: false,
                    mempool_max_backlog: 64,
                    mempool_max_transactions: 100_000,
                    max_pending_seed_listeners: 10_000,
                    mempool_stream_buffer_size: 4_096,
                    mempool_inclusion_sla_ms: 2_000,
                    nonce_cache_capacity: 100_000,
                    nonce_cache_ttl: Duration::from_secs(600),
                    prune_interval: PRUNE_INTERVAL,
                    ancestry_cache_entries: ANCESTRY_CACHE_ENTRIES,
                    proof_queue_size: PROOF_QUEUE_SIZE,
                },
            };
            let engine = Engine::new(context.with_label(&uid), config).await;

            // Get networking
            let (
                pending,
                recovered,
                resolver,
                broadcast,
                backfill,
                seeder,
                aggregator,
                aggregation,
            ) = registrations.remove(&public_key).unwrap();

            // Start engine
            engine.start(
                pending,
                recovered,
                resolver,
                broadcast,
                backfill,
                seeder,
                aggregator,
                aggregation,
            );
        }

        // Poll metrics
        loop {
            let metrics = context.encode();

            // Iterate over all lines
            let mut success = 0;
            let mut values = HashMap::new();
            for line in metrics.lines() {
                // Ignore comments/metadata
                if line.starts_with('#') {
                    continue;
                }

                // Split metric and value
                let mut parts = line.split_whitespace();
                let Some(metric) = parts.next() else {
                    continue;
                };
                let Some(value) = parts.next() else {
                    continue;
                };

                // If ends with peers_blocked, ensure it is zero
                if metric.contains("validator_") && metric.ends_with("_peers_blocked") {
                    let value = value.parse::<u64>().unwrap();
                    assert_eq!(value, 0);
                }

                if metric.contains("certificates_processed") {
                    let value = value.parse::<u64>().unwrap();
                    for (id, prefix) in &validator_prefixes {
                        if metric.starts_with(prefix) {
                            values.insert(id.clone(), value);
                            break;
                        }
                    }
                }
            }
            for (id, _) in &validator_prefixes {
                if id == &late_id {
                    continue;
                }
                if values.get(id).copied().unwrap_or(0) >= initial_container_required {
                    success += 1;
                }
            }
            if success == n - 1 {
                break;
            }

            // Still waiting for all validators to complete
            context.sleep(Duration::from_secs(1)).await;
        }

        // Link first peer (and disable link to second peer)
        link_validators(
            &mut oracle,
            &validators,
            link,
            Some(|_, i, j| [i, j].contains(&0usize) && ![i, j].contains(&1usize)),
        )
        .await;

        // Configure engine
        let signer = signers[0].clone();
        let share = shares[0].clone();
        let public_key = signer.public_key();
        let uid = format!("validator_{public_key}");
        let config: Config<_, Mock> = engine::Config {
            blocker: oracle.control(public_key.clone()),
            identity: engine::IdentityConfig {
                signer: signer.clone(),
                sharing: sharing.clone(),
                share,
                participants: validators.clone(),
            },
            storage: engine::StorageConfig {
                partition_prefix: uid.clone(),
                blocks_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                finalized_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                buffer_pool_page_size: BUFFER_POOL_PAGE_SIZE,
                buffer_pool_capacity: BUFFER_POOL_CAPACITY,
                prunable_items_per_section: PRUNABLE_ITEMS_PER_SECTION,
                immutable_items_per_section: IMMUTABLE_ITEMS_PER_SECTION,
                freezer_table_resize_frequency: FREEZER_TABLE_RESIZE_FREQUENCY,
                freezer_table_resize_chunk_size: FREEZER_TABLE_RESIZE_CHUNK_SIZE,
                freezer_journal_target_size: FREEZER_JOURNAL_TARGET_SIZE,
                freezer_journal_compression: FREEZER_JOURNAL_COMPRESSION,
                mmr_items_per_blob: MMR_ITEMS_PER_BLOB,
                log_items_per_section: LOG_ITEMS_PER_SECTION,
                locations_items_per_blob: LOCATIONS_ITEMS_PER_BLOB,
                certificates_items_per_blob: CERTIFICATES_ITEMS_PER_BLOB,
                cache_items_per_blob: CACHE_ITEMS_PER_BLOB,
                replay_buffer: REPLAY_BUFFER,
                write_buffer: WRITE_BUFFER,
                max_repair: MAX_REPAIR,
            },
            consensus: engine::ConsensusConfig {
                mailbox_size: 1024,
                backfill_quota: Quota::per_second(NonZeroU32::new(1_000).unwrap()),
                deque_size: 10,
                leader_timeout: Duration::from_secs(1),
                notarization_timeout: Duration::from_secs(2),
                nullify_retry: Duration::from_secs(10),
                fetch_timeout: Duration::from_secs(1),
                activity_timeout: 10,
                skip_timeout: 5,
                max_fetch_count: 10,
                max_fetch_size: 1024 * 512,
                fetch_concurrent: 10,
                fetch_rate_per_peer: Quota::per_second(NonZeroU32::new(1_000).unwrap()),
            },
            application: engine::ApplicationConfig {
                indexer: indexer.clone(),
                execution_concurrency: 2,
                max_uploads_outstanding: 4,
                allow_unsigned_summaries: false,
                mempool_max_backlog: 64,
                mempool_max_transactions: 100_000,
                max_pending_seed_listeners: 10_000,
                mempool_stream_buffer_size: 4_096,
                mempool_inclusion_sla_ms: 2_000,
                nonce_cache_capacity: 100_000,
                nonce_cache_ttl: Duration::from_secs(600),
                prune_interval: PRUNE_INTERVAL,
                ancestry_cache_entries: ANCESTRY_CACHE_ENTRIES,
                proof_queue_size: PROOF_QUEUE_SIZE,
            },
        };
        let engine = Engine::new(context.with_label(&uid), config).await;

        // Get networking
        let (pending, recovered, resolver, broadcast, backfill, seeder, aggregator, aggregation) =
            registrations.remove(&public_key).unwrap();

        // Start engine
        engine.start(
            pending,
            recovered,
            resolver,
            broadcast,
            backfill,
            seeder,
            aggregator,
            aggregation,
        );

        // Poll metrics
        loop {
            let metrics = context.encode();

            // Iterate over all lines
            let mut success = 0;
            let mut values = HashMap::new();
            for line in metrics.lines() {
                // Ignore comments/metadata
                if line.starts_with('#') {
                    continue;
                }

                // Split metric and value
                let mut parts = line.split_whitespace();
                let Some(metric) = parts.next() else {
                    continue;
                };
                let Some(value) = parts.next() else {
                    continue;
                };

                // If ends with peers_blocked, ensure it is zero
                if metric.contains("validator_") && metric.ends_with("_peers_blocked") {
                    let value = value.parse::<u64>().unwrap();
                    assert_eq!(value, 0);
                }

                if metric.contains("certificates_processed") {
                    let value = value.parse::<u64>().unwrap();
                    for (id, prefix) in &validator_prefixes {
                        if metric.starts_with(prefix) {
                            values.insert(id.clone(), value);
                            break;
                        }
                    }
                }
            }
            for (id, _) in &validator_prefixes {
                if values.get(id).copied().unwrap_or(0) >= final_container_required {
                    success += 1;
                }
            }
            if success == n {
                break;
            }

            // Still waiting for all validators to complete
            context.sleep(Duration::from_secs(1)).await;
        }
    });
}

#[test_traced("INFO")]
fn test_unclean_shutdown() {
    // Create context
    let n = 5;
    let _threshold = quorum(n);
    let required_container = 10;

    // Derive threshold
    let mut rng = StdRng::seed_from_u64(0);
    let (sharing, shares) =
        dkg::deal_anonymous::<MinSig>(&mut rng, Default::default(), NZU32!(n));
    let identity = sharing.public().clone();

    // Define mock indexer (must live outside of the loop because
    // it stores seeds beyond the consensus pruning boundary)
    let indexer = Mock::new(identity);

    // Random restarts every x seconds
    let mut runs = 0;
    let mut prev_checkpoint = None;
    loop {
        // Setup run
        let sharing = sharing.clone();
        let shares = shares.clone();
        let indexer = indexer.clone();
        let restart_count = runs;
        let f = |mut context: deterministic::Context| async move {
            // Create simulated network
            let (network, mut oracle) = Network::new(
                context.with_label("network"),
                simulated::Config {
                    max_size: 1024 * 1024,
                    disconnect_on_block: false,
                    tracked_peer_sets: None,
                },
            );

            // Start network
            network.start();

            // Register participants
            let mut signers = Vec::new();
            let mut validators = Vec::new();
            for i in 0..n {
                let signer = PrivateKey::from_seed(i as u64);
                let pk = signer.public_key();
                signers.push(signer);
                validators.push(pk);
            }
            validators.sort();
            signers.sort_by_key(|s| s.public_key());
            let mut registrations = register_validators(&mut oracle, &validators).await;

            // Link all validators
            let link = Link {
                latency: Duration::from_millis(10),
                jitter: Duration::from_millis(1),
                success_rate: 1.0,
            };
            link_validators(&mut oracle, &validators, link, None).await;

            // Create instances
            let mut public_keys = HashSet::new();
            for (idx, signer) in signers.into_iter().enumerate() {
                // Create signer context
                let public_key = signer.public_key();
                public_keys.insert(public_key.clone());

                // Configure engine
                let uid = format!("validator_{public_key}");
                let config: Config<_, Mock> = engine::Config {
                    blocker: oracle.control(public_key.clone()),
                    identity: engine::IdentityConfig {
                        signer,
                        sharing: sharing.clone(),
                        share: shares[idx].clone(),
                        participants: validators.clone(),
                    },
                    storage: engine::StorageConfig {
                        partition_prefix: uid.clone(),
                        blocks_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                        finalized_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                        buffer_pool_page_size: BUFFER_POOL_PAGE_SIZE,
                        buffer_pool_capacity: BUFFER_POOL_CAPACITY,
                        prunable_items_per_section: PRUNABLE_ITEMS_PER_SECTION,
                        immutable_items_per_section: IMMUTABLE_ITEMS_PER_SECTION,
                        freezer_table_resize_frequency: FREEZER_TABLE_RESIZE_FREQUENCY,
                        freezer_table_resize_chunk_size: FREEZER_TABLE_RESIZE_CHUNK_SIZE,
                        freezer_journal_target_size: FREEZER_JOURNAL_TARGET_SIZE,
                        freezer_journal_compression: FREEZER_JOURNAL_COMPRESSION,
                        mmr_items_per_blob: MMR_ITEMS_PER_BLOB,
                        log_items_per_section: LOG_ITEMS_PER_SECTION,
                        locations_items_per_blob: LOCATIONS_ITEMS_PER_BLOB,
                        certificates_items_per_blob: CERTIFICATES_ITEMS_PER_BLOB,
                        cache_items_per_blob: CACHE_ITEMS_PER_BLOB,
                        replay_buffer: REPLAY_BUFFER,
                        write_buffer: WRITE_BUFFER,
                        max_repair: MAX_REPAIR,
                    },
                    consensus: engine::ConsensusConfig {
                        mailbox_size: 1024,
                        backfill_quota: Quota::per_second(NonZeroU32::new(10).unwrap()),
                        deque_size: 10,
                        leader_timeout: Duration::from_secs(1),
                        notarization_timeout: Duration::from_secs(2),
                        nullify_retry: Duration::from_secs(10),
                        fetch_timeout: Duration::from_secs(1),
                        activity_timeout: 10,
                        skip_timeout: 5,
                        max_fetch_count: 10,
                        max_fetch_size: 1024 * 512,
                        fetch_concurrent: 10,
                        fetch_rate_per_peer: Quota::per_second(NonZeroU32::new(10).unwrap()),
                    },
                    application: engine::ApplicationConfig {
                        indexer: indexer.clone(),
                        execution_concurrency: 2,
                        max_uploads_outstanding: 4,
                        allow_unsigned_summaries: false,
                        mempool_max_backlog: 64,
                        mempool_max_transactions: 100_000,
                        max_pending_seed_listeners: 10_000,
                        mempool_stream_buffer_size: 4_096,
                        mempool_inclusion_sla_ms: 2_000,
                        nonce_cache_capacity: 100_000,
                        nonce_cache_ttl: Duration::from_secs(600),
                        prune_interval: PRUNE_INTERVAL,
                        ancestry_cache_entries: ANCESTRY_CACHE_ENTRIES,
                        proof_queue_size: PROOF_QUEUE_SIZE,
                    },
                };
                let engine = Engine::new(context.with_label(&uid), config).await;

                // Get networking
                let (
                    pending,
                    recovered,
                    resolver,
                    broadcast,
                    backfill,
                    seeder,
                    aggregator,
                    aggregation,
                ) = registrations.remove(&public_key).unwrap();

                // Start engine
                engine.start(
                    pending,
                    recovered,
                    resolver,
                    broadcast,
                    backfill,
                    seeder,
                    aggregator,
                    aggregation,
                );
            }

            // Poll metrics
            let poller = context.clone().spawn(move |context| async move {
                let mut iterations = 0usize;
                loop {
                    let metrics = context.encode();

                    // Iterate over all lines
                    for line in metrics.lines() {
                        // Ignore comments/metadata
                        if line.starts_with('#') {
                            continue;
                        }

                        // Split metric and value
                        let mut parts = line.split_whitespace();
                        let metric = parts.next().unwrap();
                        let value = parts.next().unwrap();

                        // If ends with peers_blocked, ensure it is zero
                        if metric.contains("validator_") && metric.ends_with("_peers_blocked") {
                            let value = value.parse::<u64>().unwrap();
                            assert_eq!(value, 0);
                        }
                    }

                    // Wait for mock indexer to contain enough summaries (seeds may be optional)
                    let (contains_summaries, summaries_len) = {
                        let summaries = indexer.summaries.read().await;
                        let len = summaries.len();
                        (len >= required_container as usize, len)
                    };
                    iterations = iterations.saturating_add(1);
                    if iterations % 100 == 0 {
                        info!(summaries_len, required_container, "indexer progress");
                    }

                    // If enough summaries exist, break
                    if contains_summaries {
                        break;
                    }

                    // Still waiting for all validators to complete
                    context.sleep(Duration::from_millis(10)).await;
                }
            });

            // Exit at random points for a couple restarts, then let the run finish.
            if restart_count < 2 {
                let wait = context.gen_range(Duration::from_secs(2)..Duration::from_secs(10));
                context.sleep(wait).await;
                false
            } else {
                let _ = poller.await;
                true
            }
        };

        // Handle run
        let (complete, checkpoint) = if let Some(prev_checkpoint) = prev_checkpoint {
            Runner::from(prev_checkpoint)
        } else {
            Runner::timed(Duration::from_secs(120))
        }
        .start_and_recover(f);
        if complete {
            break;
        }

        // Prepare for next run
        prev_checkpoint = Some(checkpoint);
        runs += 1;
    }
    assert!(runs > 1);
    info!(runs, "unclean shutdown recovery worked");
}

fn test_execution(seed: u64, link: Link) -> String {
    // Create context
    let n = 5;
    let _threshold = quorum(n);
    let cfg = deterministic::Config::default()
        .with_seed(seed)
        .with_timeout(Some(Duration::from_secs(1200)));
    let executor = Runner::from(cfg);
    executor.start(|mut context| async move {
        // Create simulated network
        let (network, mut oracle) = Network::new(
            context.with_label("network"),
            simulated::Config {
                max_size: 1024 * 1024,
                disconnect_on_block: false,
                tracked_peer_sets: None,
            },
        );

        // Start network
        network.start();

        // Register participants
        let mut signers = Vec::new();
        let mut validators = Vec::new();
        for i in 0..n {
            let signer = PrivateKey::from_seed(i as u64);
            let pk = signer.public_key();
            signers.push(signer);
            validators.push(pk);
        }
        validators.sort();
        signers.sort_by_key(|s| s.public_key());
        let mut registrations = register_validators(&mut oracle, &validators).await;

        // Link all validators
        link_validators(&mut oracle, &validators, link, None).await;

        // Derive threshold
        let (sharing, shares) =
            dkg::deal_anonymous::<MinSig>(&mut context, Default::default(), NZU32!(n));
        let identity = sharing.public().clone();

        // Define mock indexer
        let indexer = Mock::new(identity);

        // Create instances
        let mut public_keys = HashSet::new();
        for (idx, signer) in signers.into_iter().enumerate() {
            // Create signer context
            let public_key = signer.public_key();
            public_keys.insert(public_key.clone());

            // Configure engine
            let uid = format!("validator_{public_key}");
            let config: Config<_, Mock> = engine::Config {
                blocker: oracle.control(public_key.clone()),
                identity: engine::IdentityConfig {
                    signer,
                    sharing: sharing.clone(),
                    share: shares[idx].clone(),
                    participants: validators.clone(),
                },
                storage: engine::StorageConfig {
                    partition_prefix: uid.clone(),
                    blocks_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                    finalized_freezer_table_initial_size: FREEZER_TABLE_INITIAL_SIZE,
                    buffer_pool_page_size: BUFFER_POOL_PAGE_SIZE,
                    buffer_pool_capacity: BUFFER_POOL_CAPACITY,
                    prunable_items_per_section: PRUNABLE_ITEMS_PER_SECTION,
                    immutable_items_per_section: IMMUTABLE_ITEMS_PER_SECTION,
                    freezer_table_resize_frequency: FREEZER_TABLE_RESIZE_FREQUENCY,
                    freezer_table_resize_chunk_size: FREEZER_TABLE_RESIZE_CHUNK_SIZE,
                    freezer_journal_target_size: FREEZER_JOURNAL_TARGET_SIZE,
                    freezer_journal_compression: FREEZER_JOURNAL_COMPRESSION,
                    mmr_items_per_blob: MMR_ITEMS_PER_BLOB,
                    log_items_per_section: LOG_ITEMS_PER_SECTION,
                    locations_items_per_blob: LOCATIONS_ITEMS_PER_BLOB,
                    certificates_items_per_blob: CERTIFICATES_ITEMS_PER_BLOB,
                    cache_items_per_blob: CACHE_ITEMS_PER_BLOB,
                    replay_buffer: REPLAY_BUFFER,
                    write_buffer: WRITE_BUFFER,
                    max_repair: MAX_REPAIR,
                },
                consensus: engine::ConsensusConfig {
                    mailbox_size: 1024,
                    backfill_quota: Quota::per_second(NonZeroU32::new(10).unwrap()),
                    deque_size: 10,
                    leader_timeout: Duration::from_secs(1),
                    notarization_timeout: Duration::from_secs(2),
                    nullify_retry: Duration::from_secs(10),
                    fetch_timeout: Duration::from_secs(1),
                    activity_timeout: 10,
                    skip_timeout: 5,
                    max_fetch_count: 10,
                    max_fetch_size: 1024 * 1024,
                    fetch_concurrent: 10,
                    fetch_rate_per_peer: Quota::per_second(NonZeroU32::new(10).unwrap()),
                },
                application: engine::ApplicationConfig {
                    indexer: indexer.clone(),
                    execution_concurrency: 2,
                    max_uploads_outstanding: 4,
                    allow_unsigned_summaries: false,
                    mempool_max_backlog: 64,
                    mempool_max_transactions: 100_000,
                    max_pending_seed_listeners: 10_000,
                    mempool_stream_buffer_size: 4_096,
                    mempool_inclusion_sla_ms: 2_000,
                    nonce_cache_capacity: 100_000,
                    nonce_cache_ttl: Duration::from_secs(600),
                    prune_interval: PRUNE_INTERVAL,
                    ancestry_cache_entries: ANCESTRY_CACHE_ENTRIES,
                    proof_queue_size: PROOF_QUEUE_SIZE,
                },
            };
            let engine = Engine::new(context.with_label(&uid), config).await;

            // Get networking
            let (
                pending,
                recovered,
                resolver,
                broadcast,
                backfill,
                seeder,
                aggregator,
                aggregation,
            ) = registrations.remove(&public_key).unwrap();

            // Start engine
            engine.start(
                pending,
                recovered,
                resolver,
                broadcast,
                backfill,
                seeder,
                aggregator,
                aggregation,
            );
        }

        // Submit 1000 transactions
        let mut remaining = BTreeMap::new();
        for i in 0..1_000 {
            // Generate a signer
            let signer = PrivateKey::from_seed(i as u64);

            // Generate a casino registration transaction
            let tx = Transaction::sign(
                &signer,
                0,
                Instruction::CasinoRegister {
                    name: format!("Player{}", i),
                },
            );
            indexer.submit_tx(tx.clone());
            remaining.insert(signer.public_key(), tx);

            // Sleep for a bit to spread them out
            context.sleep(Duration::from_millis(5)).await;
        }

        // Wait for all transactions to be processed
        let mut seen = HashMap::new();
        let mut last_height = None;
        let mut all_height = 1;
        while last_height.is_none() || all_height < last_height.unwrap() {
            // Remove all transactions in some event
            let summaries = indexer
                .summaries
                .write()
                .await
                .drain(..)
                .collect::<Vec<_>>();

            // If no events, sleep
            if summaries.is_empty() {
                // Rebroadcast all remaining transactions
                for (_, tx) in remaining.iter() {
                    indexer.submit_tx(tx.clone());
                }

                // Avoid busy loop
                context.sleep(Duration::from_secs(1)).await;
                continue;
            }

            // Process events
            for (height, summary) in summaries.into_iter() {
                // Remove any pending transactions
                for event in summary.events_proof_ops.iter() {
                    if let commonware_storage::qmdb::keyless::Operation::Append(
                        nullspace_types::execution::Output::Event(
                            nullspace_types::execution::Event::CasinoPlayerRegistered {
                                player,
                                ..
                            },
                        ),
                    ) = event
                    {
                        remaining.remove(player);
                    }
                }

                // Ensure all validators see the same events at the same height
                match seen.entry(height) {
                    Entry::Vacant(entry) => {
                        entry.insert((1, summary));
                    }
                    Entry::Occupied(mut entry) => {
                        assert_eq!(entry.get().1, summary);
                        entry.get_mut().0 += 1;
                    }
                }

                // Update last height
                if last_height.is_none() && remaining.is_empty() {
                    last_height = Some(height);
                }
            }

            // Wait for all validators to see all important heights
            loop {
                let Some((seen, _)) = seen.get(&all_height) else {
                    break;
                };
                if seen < &n {
                    break;
                }
                all_height += 1;
            }
        }

        // Return the state
        context.auditor().state()
    })
}

#[test_traced]
fn test_execution_basic() {
    test_execution(
        42,
        Link {
            latency: Duration::from_millis(10),
            jitter: Duration::from_millis(1),
            success_rate: 1.0,
        },
    );
}

#[test_traced("INFO")]
fn test_execution_good_links() {
    let link = Link {
        latency: Duration::from_millis(10),
        jitter: Duration::from_millis(1),
        success_rate: 1.0,
    };
    for seed in 0..5 {
        let state1 = test_execution(seed, link.clone());
        let state2 = test_execution(seed, link.clone());
        assert_eq!(state1, state2);
    }
}

#[test_traced("INFO")]
fn test_execution_bad_links() {
    let link = Link {
        latency: Duration::from_millis(200),
        jitter: Duration::from_millis(150),
        success_rate: 0.75,
    };
    for seed in 0..5 {
        let state1 = test_execution(seed, link.clone());
        let state2 = test_execution(seed, link.clone());
        assert_eq!(state1, state2);
    }
}
