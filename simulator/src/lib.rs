use commonware_consensus::{aggregation::types::Certificate, Viewable};
use commonware_cryptography::{bls12381::primitives::variant::MinSig, sha256::Digest};
use commonware_storage::{
    adb::{create_proof, digests_required_for_proof},
    store::operation::Variable,
};
use nullspace_types::{
    api::{Events, Lookup, Pending, Summary},
    execution::{Progress, Seed, Transaction, Value},
    Identity, Query as ChainQuery,
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::{broadcast, RwLock};

mod api;
pub use api::Api;

mod explorer;
pub use explorer::{AccountActivity, ExplorerBlock, ExplorerState, ExplorerTransaction};
#[cfg(feature = "passkeys")]
mod passkeys;
#[cfg(feature = "passkeys")]
pub use passkeys::{PasskeyChallenge, PasskeyCredential, PasskeySession, PasskeyStore};

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

    explorer: ExplorerState,
    #[cfg(feature = "passkeys")]
    passkeys: PasskeyStore,
}

#[derive(Clone)]
pub struct Simulator {
    identity: Identity,
    state: Arc<RwLock<State>>,
    update_tx: broadcast::Sender<InternalUpdate>,
    mempool_tx: broadcast::Sender<Pending>,
}

impl Simulator {
    pub fn new(identity: Identity) -> Self {
        let (update_tx, _) = broadcast::channel(1024);
        let (mempool_tx, _) = broadcast::channel(1024);
        let state = Arc::new(RwLock::new(State::default()));

        Self {
            identity,
            state,
            update_tx,
            mempool_tx,
        }
    }
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

    pub fn update_subscriber(&self) -> broadcast::Receiver<InternalUpdate> {
        self.update_tx.subscribe()
    }

    pub fn mempool_subscriber(&self) -> broadcast::Receiver<Pending> {
        self.mempool_tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use commonware_codec::Encode;
    use commonware_cryptography::{Hasher, Sha256};
    use commonware_runtime::{deterministic::Runner, Runner as _};
    use commonware_storage::store::operation::{Keyless, Variable};
    use nullspace_execution::mocks::{
        create_account_keypair, create_adbs, create_network_keypair, create_seed, execute_block,
    };
    use nullspace_types::{
        api::{Events, Update},
        execution::{Event, Instruction, Key, Output, Transaction, Value},
    };

    #[tokio::test]
    async fn test_submit_seed() {
        let (network_secret, network_identity) = create_network_keypair();
        let simulator = Simulator::new(network_identity);
        let mut update_stream = simulator.update_subscriber();

        // Submit seed
        let seed = create_seed(&network_secret, 1);
        simulator.submit_seed(seed.clone()).await;
        let received_update = update_stream.recv().await.unwrap();
        match received_update {
            InternalUpdate::Seed(received_seed) => assert_eq!(received_seed, seed),
            _ => panic!("Expected seed update"),
        }
        assert_eq!(
            simulator.query_seed(&ChainQuery::Latest).await,
            Some(seed.clone())
        );
        assert_eq!(
            simulator.query_seed(&ChainQuery::Index(1)).await,
            Some(seed)
        );

        // Submit another seed
        let seed = create_seed(&network_secret, 3);
        simulator.submit_seed(seed.clone()).await;
        let received_update = update_stream.recv().await.unwrap();
        match received_update {
            InternalUpdate::Seed(received_seed) => assert_eq!(received_seed, seed),
            _ => panic!("Expected seed update"),
        }
        assert_eq!(
            simulator.query_seed(&ChainQuery::Latest).await,
            Some(seed.clone())
        );
        assert_eq!(simulator.query_seed(&ChainQuery::Index(2)).await, None);
        assert_eq!(
            simulator.query_seed(&ChainQuery::Index(3)).await,
            Some(seed.clone())
        );
    }

    #[tokio::test]
    async fn test_submit_transaction() {
        let (_, network_identity) = create_network_keypair();
        let simulator = Simulator::new(network_identity);
        let mut mempool_rx = simulator.mempool_subscriber();

        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            1,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        simulator.submit_transactions(vec![tx.clone()]);

        let received_txs = mempool_rx.recv().await.unwrap();
        assert_eq!(received_txs.transactions.len(), 1);
        let received_tx = &received_txs.transactions[0];
        assert_eq!(received_tx.public, tx.public);
        assert_eq!(received_tx.nonce, tx.nonce);
    }

    #[test]
    fn test_submit_summary() {
        let executor = Runner::default();
        executor.start(|context| async move {
            // Initialize databases
            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Simulator::new(network_identity);
            let (mut state, mut events) = create_adbs(&context).await;

            // Create mock transaction - register a casino player
            let (private, public) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );

            // Create summary using helper
            let (_, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                vec![tx],
            )
            .await;

            // Verify the summary
            let (state_digests, events_digests) = summary
                .verify(&network_identity)
                .expect("Summary verification failed");

            // Submit events
            let mut update_stream = simulator.update_subscriber();
            simulator
                .submit_events(summary.clone(), events_digests)
                .await;

            // Wait for events
            let update_recv = update_stream.recv().await.unwrap();
            match update_recv {
                InternalUpdate::Events(events_recv, _) => {
                    events_recv.verify(&network_identity).unwrap();
                    assert_eq!(events_recv.events_proof, summary.events_proof);
                    assert_eq!(events_recv.events_proof_ops, summary.events_proof_ops);
                }
                _ => panic!("Expected events update"),
            }

            // Submit state
            simulator.submit_state(summary.clone(), state_digests).await;

            // Query for state
            let account_key = Sha256::hash(&Key::Account(public.clone()).encode());
            let lookup = simulator.query_state(&account_key).await.unwrap();
            lookup.verify(&network_identity).unwrap();
            let Variable::Update(_, Value::Account(account)) = lookup.operation else {
                panic!("account not found");
            };
            assert_eq!(account.nonce, 1);

            // Query for non-existent account
            let (_, other_public) = create_account_keypair(2);
            let other_key = Sha256::hash(&Key::Account(other_public).encode());
            assert!(simulator.query_state(&other_key).await.is_none());
        });
    }

    #[test]
    fn test_filtered_events() {
        let executor = Runner::default();
        executor.start(|context| async move {
            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Simulator::new(network_identity);
            let (mut state, mut events) = create_adbs(&context).await;

            // Create multiple accounts
            let (private1, public1) = create_account_keypair(1);
            let (private2, _public2) = create_account_keypair(2);
            let (private3, _public3) = create_account_keypair(3);

            // Create transactions from all accounts - register casino players
            let txs = vec![
                Transaction::sign(
                    &private1,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player1".to_string(),
                    },
                ),
                Transaction::sign(
                    &private2,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player2".to_string(),
                    },
                ),
                Transaction::sign(
                    &private3,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player3".to_string(),
                    },
                ),
            ];

            // Execute block
            let (_, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                txs,
            )
            .await;

            // Submit the summary
            let (state_digests, events_digests) = summary.verify(&network_identity).unwrap();
            simulator
                .submit_events(summary.clone(), events_digests.clone())
                .await;
            simulator.submit_state(summary.clone(), state_digests).await;

            // Store original count before moving
            let original_ops_count = summary.events_proof_ops.len();

            let events = Events {
                progress: summary.progress,
                certificate: summary.certificate,
                events_proof: summary.events_proof,
                events_proof_ops: summary.events_proof_ops,
            };

            // Apply filter
            let filtered = crate::api::filter_updates_for_account(events, events_digests, &public1)
                .await
                .unwrap();

            // Verify filtered events
            match filtered {
                Update::FilteredEvents(filtered_events) => {
                    // Count how many events are included
                    let included_count = filtered_events.events_proof_ops.len();

                    // Verify we only have events related to account1
                    for (_loc, op) in &filtered_events.events_proof_ops {
                        if let Keyless::Append(Output::Event(Event::CasinoPlayerRegistered {
                            player,
                            ..
                        })) = op
                        {
                            assert_eq!(
                                player, &public1,
                                "Filtered events should only contain account1"
                            );
                        }
                    }

                    // We should have filtered out events for account2 and account3
                    assert!(
                        included_count > 0,
                        "Should have at least one included event"
                    );
                    assert!(
                        included_count < original_ops_count,
                        "Should have filtered out some events"
                    );

                    // Verify the proof still validates with multi-proof verification
                    filtered_events
                        .verify(&network_identity)
                        .expect("Multi-proof verification should pass");
                }
                _ => panic!("Expected FilteredEvents"),
            }
        });
    }

    #[test]
    fn test_multiple_transactions_per_block() {
        let executor = Runner::default();
        executor.start(|context| async move {
            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Simulator::new(network_identity);
            let (mut state, mut events) = create_adbs(&context).await;

            // Create multiple accounts
            let accounts: Vec<_> = (0..5).map(create_account_keypair).collect();

            // Block 1: Multiple casino registrations in a single block
            let txs1: Vec<_> = accounts
                .iter()
                .enumerate()
                .map(|(i, (private, _))| {
                    Transaction::sign(
                        private,
                        0,
                        Instruction::CasinoRegister {
                            name: format!("Player{}", i),
                        },
                    )
                })
                .collect();

            let (_, summary1) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                txs1.clone(),
            )
            .await;

            // Verify and submit
            let (state_digests1, events_digests1) = summary1
                .verify(&network_identity)
                .expect("Summary 1 verification failed");
            simulator
                .submit_events(summary1.clone(), events_digests1)
                .await;
            simulator
                .submit_state(summary1.clone(), state_digests1)
                .await;

            // Verify height was inferred correctly (should be 1)
            assert_eq!(summary1.progress.height, 1);

            // Query each account to verify they were created
            for (_, public) in accounts.iter() {
                let account_key = Sha256::hash(&Key::Account(public.clone()).encode());
                let lookup = simulator.query_state(&account_key).await.unwrap();
                lookup.verify(&network_identity).unwrap();
                let Variable::Update(_, Value::Account(account)) = lookup.operation else {
                    panic!("Account not found for {public:?}");
                };
                assert_eq!(account.nonce, 1);
            }

            // Block 2: Deposit chips to subset of accounts
            let txs2: Vec<_> = accounts
                .iter()
                .take(3)
                .map(|(private, _)| {
                    Transaction::sign(private, 1, Instruction::CasinoDeposit { amount: 1000 })
                })
                .collect();

            let (_, summary2) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                5, // view
                txs2,
            )
            .await;

            // Verify and submit
            let (state_digests2, events_digests2) = summary2
                .verify(&network_identity)
                .expect("Summary 2 verification failed");
            simulator
                .submit_events(summary2.clone(), events_digests2)
                .await;
            simulator
                .submit_state(summary2.clone(), state_digests2)
                .await;

            // Verify height was inferred correctly (should be 2)
            assert_eq!(summary2.progress.height, 2);

            // Query accounts to verify nonce updates
            for (i, (_, public)) in accounts.iter().enumerate() {
                let account_key = Sha256::hash(&Key::Account(public.clone()).encode());
                let lookup = simulator.query_state(&account_key).await.unwrap();
                lookup.verify(&network_identity).unwrap();
                let Variable::Update(_, Value::Account(account)) = lookup.operation else {
                    panic!("Account not found for {public:?}");
                };
                // First 3 accounts should have nonce 2, others still 1
                let expected_nonce = if i < 3 { 2 } else { 1 };
                assert_eq!(account.nonce, expected_nonce);
            }
        });
    }
}
