//! Apply a block's transactions to state and events.
//!
//! The state transition pipeline is designed to be re-runnable for crash recovery: event logs may
//! be committed ahead of state, and re-executing should converge to the same result.

use crate::{Adb, Layer, State};
use anyhow::{anyhow, Context as _};
use commonware_cryptography::{ed25519::PublicKey, sha256::Digest, Sha256};
#[cfg(feature = "parallel")]
use commonware_runtime::ThreadPool;
use commonware_runtime::{Clock, Metrics, Spawner, Storage};
use commonware_storage::{adb::keyless, mmr::hasher::Standard, translator::Translator};
use nullspace_types::{
    execution::{Output, Seed, Transaction, Value},
    Identity, NAMESPACE,
};
use std::collections::BTreeMap;

/// Result of executing a block's state transition
pub struct StateTransitionResult {
    pub state_root: Digest,
    pub state_start_op: u64,
    pub state_end_op: u64,
    pub events_root: Digest,
    pub events_start_op: u64,
    pub events_end_op: u64,
    /// Map of public keys to their next expected nonce after processing
    pub processed_nonces: BTreeMap<PublicKey, u64>,
}

/// Execute state transition for a block
///
/// This function processes all transactions in a block, updating both state and events
/// databases. It handles transaction nonce validation, execution, and persistence.
/// Only processes the block if it's the next expected height.
///
/// Returns the resulting state and events roots along with their operation counts,
/// plus a map of processed public keys to their next expected nonces.
pub async fn execute_state_transition<S: Spawner + Storage + Clock + Metrics, T: Translator>(
    state: &mut Adb<S, T>,
    events: &mut keyless::Keyless<S, Output, Sha256>,
    identity: Identity,
    height: u64,
    seed: Seed,
    transactions: Vec<Transaction>,
    #[cfg(feature = "parallel")] pool: ThreadPool,
) -> anyhow::Result<StateTransitionResult> {
    let state_height = state
        .get_metadata()
        .await
        .context("read state metadata")?
        .and_then(|(_, v)| match v {
            Some(Value::Commit { height, start: _ }) => Some(height),
            _ => None,
        })
        .unwrap_or(0);

    let (events_height, events_commit_start, events_commit_loc) = match events
        .get_metadata()
        .await
        .context("read events metadata")?
    {
        None => (0, 0, None),
        Some((loc, Some(Output::Commit { height, start }))) => (height, start, Some(loc)),
        Some((loc, Some(_))) => {
            return Err(anyhow!(
                "unexpected events metadata at loc {loc} (expected Output::Commit)"
            ));
        }
        Some((loc, None)) => {
            return Err(anyhow!(
                "missing events metadata at loc {loc} (expected Output::Commit)"
            ));
        }
    };

    // If this is not the next expected height, either treat as a no-op (already processed),
    // or fail (height gap) to avoid silently skipping blocks.
    if height <= state_height {
        let mut mmr_hasher = Standard::<Sha256>::new();
        let state_op = state.op_count();
        let events_op = events.op_count();
        return Ok(StateTransitionResult {
            state_root: state.root(&mut mmr_hasher),
            state_start_op: state_op,
            state_end_op: state_op,
            events_root: events.root(&mut mmr_hasher),
            events_start_op: events_op,
            events_end_op: events_op,
            processed_nonces: BTreeMap::new(),
        });
    }

    let expected_next_height = state_height.saturating_add(1);
    if height != expected_next_height {
        return Err(anyhow!(
            "non-sequential height: state_height={state_height}, expected={expected_next_height}, requested={height}"
        ));
    }

    debug_assert_eq!(height, state_height + 1);

    // Execute next block, or recover from a partial commit (events committed but state not).
    let mut processed_nonces = BTreeMap::new();
    let state_start_op;
    let events_start_op;
    match events_height {
        h if h == state_height => {
            // Normal sequential execution.
            state_start_op = state.op_count();
            events_start_op = events.op_count();

            let mut layer = Layer::new(state, identity, NAMESPACE, seed);
            let (outputs, nonces) = layer
                .execute(
                    #[cfg(feature = "parallel")]
                    pool,
                    transactions,
                )
                .await
                .with_context(|| format!("execute layer (height={height})"))?;
            processed_nonces.extend(nonces);

            // Events must be committed before state, otherwise a crash could wedge on restart.
            for output in outputs.into_iter() {
                events
                    .append(output)
                    .await
                    .with_context(|| format!("append event output (height={height})"))?;
            }
            events
                .commit(Some(Output::Commit {
                    height,
                    start: events_start_op,
                }))
                .await
                .with_context(|| format!("commit events (height={height})"))?;

            // Apply state once we've committed events (can't regenerate after state updated).
            state
                .apply(layer.commit())
                .await
                .with_context(|| format!("apply state changes (height={height})"))?;
            state
                .commit(Some(Value::Commit {
                    height,
                    start: state_start_op,
                }))
                .await
                .with_context(|| format!("commit state (height={height})"))?;
        }
        h if h == height => {
            // Crash recovery: events are committed for `height`, but state is still at `height - 1`.
            let events_commit_loc = events_commit_loc.ok_or_else(|| {
                anyhow!("missing events commit loc during recovery (height={height})")
            })?;
            if events.op_count() != events_commit_loc + 1 {
                return Err(anyhow!(
                    "events op_count mismatch during recovery (op_count={}, commit_loc={events_commit_loc})",
                    events.op_count()
                ));
            }

            state_start_op = state.op_count();
            events_start_op = events_commit_start;
            let existing_output_count = events_commit_loc
                .checked_sub(events_start_op)
                .ok_or_else(|| {
                    anyhow!(
                        "events commit start beyond commit loc (start={events_start_op}, commit_loc={events_commit_loc})"
                    )
                })?;

            let mut layer = Layer::new(state, identity, NAMESPACE, seed);
            let (outputs, nonces) = layer
                .execute(
                    #[cfg(feature = "parallel")]
                    pool,
                    transactions,
                )
                .await
                .with_context(|| format!("execute layer (recovery, height={height})"))?;
            processed_nonces.extend(nonces);

            if outputs.len() as u64 != existing_output_count {
                return Err(anyhow!(
                    "events output count mismatch during recovery (existing={existing_output_count}, reexecuted={})",
                    outputs.len()
                ));
            }

            for (i, output) in outputs.iter().enumerate() {
                let loc = events_start_op + i as u64;
                let existing = events
                    .get(loc)
                    .await
                    .with_context(|| format!("read existing events output (loc={loc})"))?
                    .ok_or_else(|| anyhow!("missing existing events output at loc {loc}"))?;
                if existing != *output {
                    return Err(anyhow!(
                        "events output mismatch during recovery at loc {loc}"
                    ));
                }
            }

            // Commit state only (events are already committed).
            state
                .apply(layer.commit())
                .await
                .with_context(|| format!("apply state changes (recovery, height={height})"))?;
            state
                .commit(Some(Value::Commit {
                    height,
                    start: state_start_op,
                }))
                .await
                .with_context(|| format!("commit state (recovery, height={height})"))?;
        }
        _ => {
            return Err(anyhow!(
                "state/events height mismatch (state={state_height}, events={events_height}, requested={height})"
            ));
        }
    }

    // Compute roots
    let mut mmr_hasher = Standard::<Sha256>::new();
    let state_root = state.root(&mut mmr_hasher);
    let state_end_op = state.op_count();
    let events_root = events.root(&mut mmr_hasher);
    let events_end_op = events.op_count();

    Ok(StateTransitionResult {
        state_root,
        state_start_op,
        state_end_op,
        events_root,
        events_start_op,
        events_end_op,
        processed_nonces,
    })
}
