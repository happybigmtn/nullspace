use commonware_consensus::{aggregation::types::Certificate, Viewable};
use commonware_cryptography::{bls12381::primitives::variant::MinSig, sha256::Digest};
use commonware_storage::{
    adb::{create_proof, digests_required_for_proof},
    store::operation::Variable,
};
use nullspace_types::{
    api::{Events, Lookup, Pending, Summary},
    execution::{Progress, Seed, Transaction, Value},
    Query as ChainQuery,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use tokio::sync::broadcast;

#[cfg(feature = "passkeys")]
use crate::PasskeyStore;
use crate::{ExplorerState, Simulator};

#[derive(Clone)]
#[allow(clippy::large_enum_variant)]
pub enum InternalUpdate {
    Seed(Seed),
    Events(Events, Vec<(u64, Digest)>),
}

#[derive(Default)]
pub struct State {
    seeds: BTreeMap<u64, Seed>,

    nodes: BTreeMap<u64, Digest>,
    leaves: BTreeMap<u64, Variable<Digest, Value>>,
    #[allow(clippy::type_complexity)]
    keys: HashMap<Digest, BTreeMap<u64, (u64, Variable<Digest, Value>)>>,
    progress: BTreeMap<u64, (Progress, Certificate<MinSig, Digest>)>,

    submitted_events: HashSet<u64>,
    submitted_state: HashSet<u64>,

    pub(super) explorer: ExplorerState,
    #[cfg(feature = "passkeys")]
    pub(super) passkeys: PasskeyStore,
}

impl Simulator {
    pub async fn submit_seed(&self, seed: Seed) {
        {
            let mut state = self.state.write().await;
            if state.seeds.insert(seed.view(), seed.clone()).is_some() {
                return;
            }
        } // Release lock before broadcasting
        if let Err(e) = self.update_tx.send(InternalUpdate::Seed(seed)) {
            tracing::warn!("Failed to broadcast seed update (no subscribers): {}", e);
        }
    }

    pub fn submit_transactions(&self, transactions: Vec<Transaction>) {
        if let Err(e) = self.mempool_tx.send(Pending { transactions }) {
            tracing::warn!("Failed to broadcast transactions (no subscribers): {}", e);
        }
    }

    pub async fn submit_state(&self, summary: Summary, inner: Vec<(u64, Digest)>) {
        let mut state = self.state.write().await;
        if !state.submitted_state.insert(summary.progress.height) {
            return;
        }

        // Store node digests
        for (pos, digest) in inner {
            state.nodes.insert(pos, digest);
        }

        // Store leaves
        let start_loc = summary.progress.state_start_op;
        for (i, value) in summary.state_proof_ops.into_iter().enumerate() {
            // Store in leaves
            let loc = start_loc + i as u64;
            state.leaves.insert(loc, value.clone());

            // Store in keys
            match value {
                Variable::Update(key, value) => {
                    state
                        .keys
                        .entry(key)
                        .or_default()
                        .insert(summary.progress.height, (loc, Variable::Update(key, value)));
                }
                Variable::Delete(key) => {
                    state
                        .keys
                        .entry(key)
                        .or_default()
                        .insert(summary.progress.height, (loc, Variable::Delete(key)));
                }
                _ => {}
            }
        }

        // Store progress at height to build proofs
        state.progress.insert(
            summary.progress.height,
            (summary.progress, summary.certificate),
        );
    }

    pub async fn submit_events(&self, summary: Summary, events_digests: Vec<(u64, Digest)>) {
        let height = summary.progress.height;

        // Check if already submitted before acquiring lock
        {
            let mut state = self.state.write().await;
            if !state.submitted_events.insert(height) {
                return;
            }
        } // Release lock before broadcasting

        // Index blocks/transactions for explorer consumers
        self.index_block_from_summary(&summary.progress, &summary.events_proof_ops)
            .await;

        // Broadcast events with digests for efficient filtering
        if let Err(e) = self.update_tx.send(InternalUpdate::Events(
            Events {
                progress: summary.progress,
                certificate: summary.certificate,
                events_proof: summary.events_proof,
                events_proof_ops: summary.events_proof_ops,
            },
            events_digests,
        )) {
            tracing::warn!("Failed to broadcast events update (no subscribers): {}", e);
        }
    }

    pub async fn query_state(&self, key: &Digest) -> Option<Lookup> {
        self.try_query_state(key).await
    }

    async fn try_query_state(&self, key: &Digest) -> Option<Lookup> {
        let state = self.state.read().await;

        let key_history = match state.keys.get(key) {
            Some(key_history) => key_history,
            None => return None,
        };
        let (height, operation) = match key_history.last_key_value() {
            Some((height, operation)) => (height, operation),
            None => return None,
        };
        let (loc, Variable::Update(_, value)) = operation else {
            return None;
        };

        // Get progress and certificate
        let (progress, certificate) = match state.progress.get(height) {
            Some(value) => value,
            None => return None,
        };

        // Get required nodes
        let required_digest_positions =
            digests_required_for_proof::<Digest>(progress.state_end_op, *loc, *loc);
        let required_digests = required_digest_positions
            .iter()
            .filter_map(|pos| state.nodes.get(pos).cloned())
            .collect::<Vec<_>>();

        // Verify we got all required digests
        if required_digests.len() != required_digest_positions.len() {
            tracing::error!(
                "Missing node digests: expected {}, got {}",
                required_digest_positions.len(),
                required_digests.len()
            );
            return None;
        }

        // Construct proof
        let proof = create_proof(progress.state_end_op, required_digests);

        Some(Lookup {
            progress: *progress,
            certificate: certificate.clone(),
            proof,
            location: *loc,
            operation: Variable::Update(*key, value.clone()),
        })
    }

    pub async fn query_seed(&self, query: &ChainQuery) -> Option<Seed> {
        self.try_query_seed(query).await
    }

    async fn try_query_seed(&self, query: &ChainQuery) -> Option<Seed> {
        let state = self.state.read().await;
        match query {
            ChainQuery::Latest => state.seeds.last_key_value().map(|(_, seed)| seed.clone()),
            ChainQuery::Index(index) => state.seeds.get(index).cloned(),
        }
    }

    pub fn update_subscriber(&self) -> broadcast::Receiver<crate::InternalUpdate> {
        self.update_tx.subscribe()
    }

    pub fn mempool_subscriber(&self) -> broadcast::Receiver<Pending> {
        self.mempool_tx.subscribe()
    }
}
