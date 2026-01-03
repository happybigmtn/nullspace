//! Apply a block's transactions to state and events.
//!
//! The state transition pipeline is designed to be re-runnable for crash recovery: event logs may
//! be committed ahead of state, and re-executing should converge to the same result.

use crate::{Adb, Layer, State};
use anyhow::{anyhow, Context as _};
use commonware_cryptography::{ed25519::PublicKey, sha256::Digest, Sha256};
use futures::executor::block_on;
#[cfg(feature = "parallel")]
use commonware_runtime::ThreadPool;
use commonware_runtime::{Clock, Metrics, Spawner, Storage};
use commonware_storage::mmr::{mem::Clean, Location};
use commonware_storage::qmdb::keyless;
use commonware_storage::qmdb::store::CleanStore as _;
use commonware_storage::translator::Translator;
use nullspace_types::{
    execution::{Key, Output, Seed, Transaction, Value},
    Identity, NAMESPACE,
};
use std::collections::BTreeMap;

type EventsDb<S> = keyless::Keyless<S, Output, Sha256, Clean<Digest>>;

struct StateView<'a, S: State> {
    inner: &'a mut S,
}

impl<'a, S: State> StateView<'a, S> {
    fn new(inner: &'a mut S) -> Self {
        Self { inner }
    }
}

// StateView holds an exclusive mutable reference, but it is only ever used within a single task.
// Marking it Sync allows &StateView to be Send for async execution without sharing across threads.
unsafe impl<'a, S: State + Send> Sync for StateView<'a, S> {}

impl<'a, S: State + Send> State for StateView<'a, S> {
    async fn get(&self, key: Key) -> anyhow::Result<Option<Value>> {
        block_on(self.inner.get(key))
    }

    async fn insert(&mut self, key: Key, value: Value) -> anyhow::Result<()> {
        block_on(self.inner.insert(key, value))
    }

    async fn delete(&mut self, key: Key) -> anyhow::Result<()> {
        block_on(self.inner.delete(key))
    }
}

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
pub async fn execute_state_transition<S, T>(
    state: &mut Adb<S, T>,
    events: &mut EventsDb<S>,
    identity: Identity,
    height: u64,
    seed: Seed,
    transactions: Vec<Transaction>,
    #[cfg(feature = "parallel")] pool: ThreadPool,
) -> anyhow::Result<StateTransitionResult>
where
    S: Spawner + Storage + Clock + Metrics + Send + Sync,
    T: Translator + Send + Sync + 'static,
    T::Key: Send + Sync + 'static,
{
    let state_height = block_on(state.get_metadata())
        .context("read state metadata")?
        .and_then(|v| match v {
            Value::Commit { height, start: _ } => Some(height),
            _ => None,
        })
        .unwrap_or(0);

    let (events_height, events_commit_start, events_commit_loc) =
        match block_on(events.get_metadata()).context("read events metadata")? {
            None => (0, 0, None),
            Some(Output::Commit { height, start }) => (height, start, Some(events.last_commit_loc())),
            Some(_) => {
                return Err(anyhow!(
                    "unexpected events metadata at last commit (expected Output::Commit)"
                ));
            }
        };

    // If this is not the next expected height, either treat as a no-op (already processed),
    // or fail (height gap) to avoid silently skipping blocks.
    if height <= state_height {
        let state_op = u64::from(state.op_count());
        let events_op = u64::from(events.op_count());
        return Ok(StateTransitionResult {
            state_root: state.root(),
            state_start_op: state_op,
            state_end_op: state_op,
            events_root: events.root(),
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
            state_start_op = u64::from(state.op_count());
            events_start_op = u64::from(events.op_count());

            let (outputs, nonces, changes) = {
                let state_view = StateView::new(state);
                let mut layer = Layer::new(&state_view, identity, NAMESPACE, seed);
                let (outputs, nonces) = layer
                    .execute(
                        #[cfg(feature = "parallel")]
                        pool,
                        transactions,
                    )
                    .await
                    .with_context(|| format!("execute layer (height={height})"))?;
                let changes = layer.commit();
                (outputs, nonces, changes)
            };
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
                .apply(changes)
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
            let events_commit_loc_u64 = u64::from(events_commit_loc);
            if u64::from(events.op_count()) != events_commit_loc_u64 + 1 {
                return Err(anyhow!(
                    "events op_count mismatch during recovery (op_count={}, commit_loc={events_commit_loc})",
                    events.op_count()
                ));
            }

            state_start_op = u64::from(state.op_count());
            events_start_op = events_commit_start;
            let existing_output_count = events_commit_loc_u64
                .checked_sub(events_start_op)
                .ok_or_else(|| {
                    anyhow!(
                        "events commit start beyond commit loc (start={events_start_op}, commit_loc={events_commit_loc})"
                    )
                })?;

            let (outputs, nonces, changes) = {
                let state_view = StateView::new(state);
                let mut layer = Layer::new(&state_view, identity, NAMESPACE, seed);
                let (outputs, nonces) = layer
                    .execute(
                        #[cfg(feature = "parallel")]
                        pool,
                        transactions,
                    )
                    .await
                    .with_context(|| format!("execute layer (recovery, height={height})"))?;
                let changes = layer.commit();
                (outputs, nonces, changes)
            };
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
                    .get(Location::from(loc))
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
                .apply(changes)
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
    let state_root = state.root();
    let state_end_op = u64::from(state.op_count());
    let events_root = events.root();
    let events_end_op = u64::from(events.op_count());

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
