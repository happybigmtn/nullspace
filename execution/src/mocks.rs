//! Execution test and simulation helpers.
//!
//! This module provides deterministic mocks and storage harnesses used by unit/integration tests
//! and the simulator. It is feature-gated (`mocks`) and not intended for production use.

use crate::{state_transition, Adb};
use anyhow::Context;
use commonware_consensus::{
    aggregation::types::{Ack, Certificate, Item},
    simplex::types::view_message,
    threshold_simplex::types::seed_namespace,
};
use commonware_cryptography::{
    bls12381::primitives::{
        group::{Private, Share},
        ops,
        variant::{MinSig, Variant},
    },
    ed25519::{PrivateKey, PublicKey},
    sha256::{Digest, Sha256},
    Digestible, Hasher, PrivateKeyExt, Signer,
};
#[cfg(feature = "parallel")]
use commonware_runtime::ThreadPool;
use commonware_runtime::{buffer::PoolRef, Clock, Metrics, Spawner, Storage};
use commonware_storage::{
    adb::{self, keyless},
    translator::EightCap,
};
use commonware_utils::{NZUsize, NZU64};
use nullspace_types::{
    api::Summary,
    execution::{Output, Progress, Seed, Transaction, Value},
    Identity, NAMESPACE,
};
use rand::{rngs::StdRng, SeedableRng};

const TEST_BUFFER_POOL_PAGES: usize = 1024;
const TEST_BUFFER_POOL_PAGE_SIZE: usize = 1024;
const TEST_MMR_ITEMS_PER_BLOB: u64 = 1024;
const TEST_MMR_WRITE_BUFFER: usize = 1024;
const TEST_LOG_ITEMS_PER_SECTION: u64 = 1024;
const TEST_LOG_WRITE_BUFFER: usize = 1024;
const TEST_LOCATIONS_ITEMS_PER_BLOB: u64 = 1024;
const TEST_LOCATIONS_WRITE_BUFFER: usize = 1024;

/// Creates a master keypair for BLS signatures used in consensus
pub fn create_network_keypair() -> (Private, <MinSig as Variant>::Public) {
    let mut rng = StdRng::seed_from_u64(0);
    ops::keypair::<_, MinSig>(&mut rng)
}

/// Creates an account keypair for Ed25519 signatures used by users
pub fn create_account_keypair(seed: u64) -> (PrivateKey, PublicKey) {
    let mut rng = StdRng::seed_from_u64(seed);
    let private = PrivateKey::from_rng(&mut rng);
    let public = private.public_key();
    (private, public)
}

/// Creates a test seed for consensus
pub fn create_seed(network_secret: &Private, view: u64) -> Seed {
    let seed_namespace = seed_namespace(NAMESPACE);
    let message = view_message(view);
    Seed::new(
        view,
        ops::sign_message::<MinSig>(network_secret, Some(&seed_namespace), &message),
    )
}

/// Creates state and events databases for testing
pub async fn create_adbs_result<E: Spawner + Metrics + Storage + Clock>(
    context: &E,
) -> anyhow::Result<(Adb<E, EightCap>, keyless::Keyless<E, Output, Sha256>)> {
    let buffer_pool = PoolRef::new(
        NZUsize!(TEST_BUFFER_POOL_PAGES),
        NZUsize!(TEST_BUFFER_POOL_PAGE_SIZE),
    );

    let state = Adb::init(
        context.with_label("state"),
        adb::any::variable::Config {
            mmr_journal_partition: String::from("state-mmr-journal"),
            mmr_metadata_partition: String::from("state-mmr-metadata"),
            mmr_items_per_blob: NZU64!(TEST_MMR_ITEMS_PER_BLOB),
            mmr_write_buffer: NZUsize!(TEST_MMR_WRITE_BUFFER),
            log_journal_partition: String::from("state-log-journal"),
            log_items_per_section: NZU64!(TEST_LOG_ITEMS_PER_SECTION),
            log_write_buffer: NZUsize!(TEST_LOG_WRITE_BUFFER),
            log_compression: None,
            log_codec_config: (),
            locations_journal_partition: String::from("state-locations-journal"),
            locations_items_per_blob: NZU64!(TEST_LOCATIONS_ITEMS_PER_BLOB),
            translator: EightCap,
            thread_pool: None,
            buffer_pool: buffer_pool.clone(),
        },
    )
    .await
    .context("failed to initialize state ADB")?;

    let events = keyless::Keyless::<_, Output, Sha256>::init(
        context.with_label("events"),
        keyless::Config {
            mmr_journal_partition: String::from("events-mmr-journal"),
            mmr_metadata_partition: String::from("events-mmr-metadata"),
            mmr_items_per_blob: NZU64!(TEST_MMR_ITEMS_PER_BLOB),
            mmr_write_buffer: NZUsize!(TEST_MMR_WRITE_BUFFER),
            log_journal_partition: String::from("events-log-journal"),
            log_items_per_section: NZU64!(TEST_LOG_ITEMS_PER_SECTION),
            log_write_buffer: NZUsize!(TEST_LOG_WRITE_BUFFER),
            log_compression: None,
            log_codec_config: (),
            locations_journal_partition: String::from("events-locations-journal"),
            locations_items_per_blob: NZU64!(TEST_LOCATIONS_ITEMS_PER_BLOB),
            locations_write_buffer: NZUsize!(TEST_LOCATIONS_WRITE_BUFFER),
            thread_pool: None,
            buffer_pool,
        },
    )
    .await
    .context("failed to initialize events Keyless")?;

    Ok((state, events))
}

pub async fn create_adbs<E: Spawner + Metrics + Storage + Clock>(
    context: &E,
) -> (Adb<E, EightCap>, keyless::Keyless<E, Output, Sha256>) {
    create_adbs_result(context)
        .await
        .expect("failed to initialize test databases")
}

/// Helper to create a summary with transactions
pub async fn execute_block_result<E: Spawner + Metrics + Storage + Clock>(
    network_secret: &Private,
    network_identity: Identity,
    state: &mut Adb<E, EightCap>,
    events: &mut keyless::Keyless<E, Output, Sha256>,
    view: u64,
    txs: Vec<Transaction>,
) -> anyhow::Result<(Seed, Summary)> {
    // Get height from state
    let current_height = state
        .get_metadata()
        .await
        .context("failed to read state metadata")?
        .and_then(|(_, v)| match v {
            Some(Value::Commit { height, start: _ }) => Some(height),
            _ => None,
        })
        .unwrap_or(0);
    let height = current_height + 1;

    // Create seed
    let seed = create_seed(network_secret, view);

    // Execute state transition
    #[cfg(feature = "parallel")]
    let pool = ThreadPool::new(
        rayon::ThreadPoolBuilder::new()
            .num_threads(1)
            .build()
            .context("failed to create execution pool")?,
    );
    let result = state_transition::execute_state_transition(
        state,
        events,
        network_identity,
        height,
        seed.clone(),
        txs,
        #[cfg(feature = "parallel")]
        pool,
    )
    .await
    .context("state transition failed")?;

    // Sync results
    state.sync().await.context("failed to sync state")?;
    events.sync().await.context("failed to sync events")?;

    // Generate proofs
    let state_proof_ops = result.state_end_op - result.state_start_op;
    let (state_proof, state_proof_ops) = state
        .historical_proof(result.state_end_op, result.state_start_op, state_proof_ops)
        .await
        .context("failed to generate state historical proof")?;
    let events_proof_ops = result.events_end_op - result.events_start_op;
    let (events_proof, events_proof_ops) = events
        .historical_proof(
            result.events_end_op,
            result.events_start_op,
            NZU64!(events_proof_ops),
        )
        .await
        .context("failed to generate events historical proof")?;

    // Create progress
    let progress = Progress::new(
        view,
        height,
        Sha256::hash(&height.to_be_bytes()),
        result.state_root,
        result.state_start_op,
        result.state_end_op,
        result.events_root,
        result.events_start_op,
        result.events_end_op,
    );

    // Create certificate
    let item = Item {
        index: height,
        digest: progress.digest(),
    };
    let ack = Ack::<MinSig, Digest>::sign(
        NAMESPACE,
        0,
        &Share {
            index: 0,
            private: network_secret.clone(),
        },
        item.clone(),
    );
    let certificate = Certificate::<MinSig, Digest> {
        item,
        signature: ack.signature.value,
    };

    // Create summary
    Ok((
        seed,
        Summary {
            progress,
            certificate,
            state_proof,
            state_proof_ops,
            events_proof,
            events_proof_ops,
        },
    ))
}

pub async fn execute_block<E: Spawner + Metrics + Storage + Clock>(
    network_secret: &Private,
    network_identity: Identity,
    state: &mut Adb<E, EightCap>,
    events: &mut keyless::Keyless<E, Output, Sha256>,
    view: u64,
    txs: Vec<Transaction>,
) -> (Seed, Summary) {
    execute_block_result(network_secret, network_identity, state, events, view, txs)
        .await
        .expect("execute_block failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use commonware_codec::{DecodeExt, Encode, EncodeSize, Error};
    use commonware_runtime::deterministic::Runner;
    use commonware_runtime::Runner as _;
    use nullspace_types::api::{Events, FilteredEvents, MAX_EVENTS_PROOF_OPS, MAX_STATE_PROOF_OPS};
    use nullspace_types::execution::Instruction;

    #[test]
    fn test_seed_codec_roundtrip() {
        let (network_secret, network_identity) = create_network_keypair();
        for view in [0u64, 1, 2, 10, 123, 1_000_000] {
            let seed = create_seed(&network_secret, view);
            let decoded = Seed::decode(seed.encode().as_ref()).expect("seed decode failed");
            assert_eq!(seed, decoded);
            assert!(decoded.verify(NAMESPACE, &network_identity));
        }
    }

    #[test]
    fn test_summary_codec_roundtrip_and_verify() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;
            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );

            let (_seed, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1,
                vec![tx],
            )
            .await;

            let decoded =
                Summary::decode(summary.encode().as_ref()).expect("summary decode failed");
            assert_eq!(summary, decoded);
            decoded
                .verify(&network_identity)
                .expect("summary verify failed");
        });
    }

    #[test]
    fn test_summary_decode_rejects_oversized_state_ops_len() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );
            let (_seed, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1,
                vec![tx],
            )
            .await;

            let encoded = summary.encode();
            let state_ops_len_offset = summary.progress.encode_size()
                + summary.certificate.encode_size()
                + summary.state_proof.encode_size();
            let old_len = summary.state_proof_ops.len();
            let old_len_bytes = old_len.encode();
            let new_len_bytes = (MAX_STATE_PROOF_OPS + 1).encode();

            assert!(
                state_ops_len_offset + old_len_bytes.len() <= encoded.len(),
                "state ops length prefix out of bounds"
            );
            assert_eq!(
                &encoded[state_ops_len_offset..state_ops_len_offset + old_len_bytes.len()],
                old_len_bytes.as_ref(),
                "unexpected state ops length encoding"
            );

            let mut mutated = Vec::with_capacity(
                encoded.len().saturating_sub(old_len_bytes.len()) + new_len_bytes.len(),
            );
            mutated.extend_from_slice(&encoded[..state_ops_len_offset]);
            mutated.extend_from_slice(new_len_bytes.as_ref());
            mutated.extend_from_slice(&encoded[state_ops_len_offset + old_len_bytes.len()..]);

            assert!(matches!(
                Summary::decode(mutated.as_ref()),
                Err(Error::InvalidLength(_))
            ));
        });
    }

    #[test]
    fn test_summary_decode_rejects_oversized_events_ops_len() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );
            let (_seed, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1,
                vec![tx],
            )
            .await;

            let encoded = summary.encode();
            let events_ops_len_offset = summary.progress.encode_size()
                + summary.certificate.encode_size()
                + summary.state_proof.encode_size()
                + summary.state_proof_ops.encode_size()
                + summary.events_proof.encode_size();
            let old_len = summary.events_proof_ops.len();
            let old_len_bytes = old_len.encode();
            let new_len_bytes = (MAX_EVENTS_PROOF_OPS + 1).encode();

            assert!(
                events_ops_len_offset + old_len_bytes.len() <= encoded.len(),
                "events ops length prefix out of bounds"
            );
            assert_eq!(
                &encoded[events_ops_len_offset..events_ops_len_offset + old_len_bytes.len()],
                old_len_bytes.as_ref(),
                "unexpected events ops length encoding"
            );

            let mut mutated = Vec::with_capacity(
                encoded.len().saturating_sub(old_len_bytes.len()) + new_len_bytes.len(),
            );
            mutated.extend_from_slice(&encoded[..events_ops_len_offset]);
            mutated.extend_from_slice(new_len_bytes.as_ref());
            mutated.extend_from_slice(&encoded[events_ops_len_offset + old_len_bytes.len()..]);

            assert!(matches!(
                Summary::decode(mutated.as_ref()),
                Err(Error::InvalidLength(_))
            ));
        });
    }

    #[test]
    fn test_events_decode_rejects_oversized_ops_len() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events_db) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );
            let (_seed, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events_db,
                1,
                vec![tx],
            )
            .await;

            let events = Events {
                progress: summary.progress,
                certificate: summary.certificate.clone(),
                events_proof: summary.events_proof.clone(),
                events_proof_ops: summary.events_proof_ops.clone(),
            };

            let encoded = events.encode();
            let ops_len_offset = events.progress.encode_size()
                + events.certificate.encode_size()
                + events.events_proof.encode_size();
            let old_len = events.events_proof_ops.len();
            let old_len_bytes = old_len.encode();
            let new_len_bytes = (MAX_EVENTS_PROOF_OPS + 1).encode();

            assert!(
                ops_len_offset + old_len_bytes.len() <= encoded.len(),
                "events ops length prefix out of bounds"
            );
            assert_eq!(
                &encoded[ops_len_offset..ops_len_offset + old_len_bytes.len()],
                old_len_bytes.as_ref(),
                "unexpected events ops length encoding"
            );

            let mut mutated = Vec::with_capacity(
                encoded.len().saturating_sub(old_len_bytes.len()) + new_len_bytes.len(),
            );
            mutated.extend_from_slice(&encoded[..ops_len_offset]);
            mutated.extend_from_slice(new_len_bytes.as_ref());
            mutated.extend_from_slice(&encoded[ops_len_offset + old_len_bytes.len()..]);

            assert!(matches!(
                Events::decode(mutated.as_ref()),
                Err(Error::InvalidLength(_))
            ));
        });
    }

    #[test]
    fn test_filtered_events_decode_rejects_oversized_ops_len() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events_db) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );
            let (_seed, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events_db,
                1,
                vec![tx],
            )
            .await;

            let events = FilteredEvents {
                progress: summary.progress,
                certificate: summary.certificate.clone(),
                events_proof: summary.events_proof.clone(),
                events_proof_ops: Vec::new(),
            };

            let encoded = events.encode();
            let ops_len_offset = events.progress.encode_size()
                + events.certificate.encode_size()
                + events.events_proof.encode_size();
            let old_len = events.events_proof_ops.len();
            let old_len_bytes = old_len.encode();
            let new_len_bytes = (MAX_EVENTS_PROOF_OPS + 1).encode();

            assert!(
                ops_len_offset + old_len_bytes.len() <= encoded.len(),
                "filtered events ops length prefix out of bounds"
            );
            assert_eq!(
                &encoded[ops_len_offset..ops_len_offset + old_len_bytes.len()],
                old_len_bytes.as_ref(),
                "unexpected filtered events ops length encoding"
            );

            let mut mutated = Vec::with_capacity(
                encoded.len().saturating_sub(old_len_bytes.len()) + new_len_bytes.len(),
            );
            mutated.extend_from_slice(&encoded[..ops_len_offset]);
            mutated.extend_from_slice(new_len_bytes.as_ref());
            mutated.extend_from_slice(&encoded[ops_len_offset + old_len_bytes.len()..]);

            assert!(matches!(
                FilteredEvents::decode(mutated.as_ref()),
                Err(Error::InvalidLength(_))
            ));
        });
    }

    #[test]
    fn test_state_transition_recovers_after_events_only_commit() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );

            let view = 1;
            let height = 1;
            let seed = create_seed(&network_secret, view);

            // Simulate a crash after committing `events` but before committing `state`.
            let events_start_op = events.op_count();
            let mut layer = crate::Layer::new(&state, network_identity, NAMESPACE, seed.clone());

            #[cfg(feature = "parallel")]
            let pool = ThreadPool::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(1)
                    .build()
                    .expect("failed to create execution pool"),
            );

            let (outputs, _) = layer
                .execute(
                    #[cfg(feature = "parallel")]
                    pool.clone(),
                    vec![tx.clone()],
                )
                .await
                .expect("execute layer");

            for output in outputs {
                events.append(output).await.expect("append output");
            }
            events
                .commit(Some(Output::Commit {
                    height,
                    start: events_start_op,
                }))
                .await
                .expect("commit events");

            let events_op_count_before = events.op_count();

            // Now rerun the state transition; it should detect the partial-commit and recover.
            let result = state_transition::execute_state_transition(
                &mut state,
                &mut events,
                network_identity,
                height,
                seed,
                vec![tx],
                #[cfg(feature = "parallel")]
                pool,
            )
            .await
            .expect("recovery state transition failed");

            assert!(result.state_end_op > result.state_start_op);
            assert_eq!(result.events_start_op, events_start_op);
            assert_eq!(result.events_end_op, events_op_count_before);
            assert_eq!(events.op_count(), events_op_count_before);

            let state_height = state
                .get_metadata()
                .await
                .expect("read state metadata")
                .and_then(|(_, v)| match v {
                    Some(Value::Commit { height, start: _ }) => Some(height),
                    _ => None,
                })
                .unwrap_or(0);
            assert_eq!(state_height, height);
        });
    }
}
