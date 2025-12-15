use commonware_codec::Encode;
use commonware_consensus::{
    aggregation::types::Epoch, threshold_simplex::types::View, Monitor, Supervisor as Su,
    ThresholdSupervisor as TSu,
};
use commonware_cryptography::{
    bls12381::{
        dkg::ops::evaluate_all,
        primitives::{
            group,
            poly::{self, Poly},
            variant::MinSig,
        },
    },
    ed25519,
};
use commonware_resolver::p2p;
use commonware_runtime::RwLock;
use futures::{channel::mpsc, SinkExt};
use nullspace_types::{leader_index, Evaluation, Identity, Signature};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

macro_rules! impl_threshold_supervisor_traits {
    ($ty:ident, $index:ty) => {
        impl Su for $ty {
            type Index = $index;
            type PublicKey = ed25519::PublicKey;

            fn leader(&self, _: Self::Index) -> Option<Self::PublicKey> {
                // Both ThresholdSimplex and Aggregation use `ThresholdSupervisor::leader(index, seed)`.
                // Return `None` so accidental calls don't panic.
                None
            }

            fn participants(&self, _: Self::Index) -> Option<&Vec<Self::PublicKey>> {
                Some(&self.inner.participants)
            }

            fn is_participant(&self, _: Self::Index, candidate: &Self::PublicKey) -> Option<u32> {
                self.inner.participants_map.get(candidate).cloned()
            }
        }

        impl TSu for $ty {
            type Seed = Signature;
            type Identity = Identity;
            type Polynomial = Vec<Evaluation>;
            type Share = group::Share;

            fn leader(&self, _: Self::Index, seed: Self::Seed) -> Option<Self::PublicKey> {
                let seed_bytes = seed.encode();
                let index = leader_index(seed_bytes.as_ref(), self.inner.participants.len());
                Some(self.inner.participants[index].clone())
            }

            fn identity(&self) -> &Self::Identity {
                &self.inner.identity
            }

            fn polynomial(&self, _: Self::Index) -> Option<&Self::Polynomial> {
                Some(&self.inner.polynomial)
            }

            fn share(&self, _: Self::Index) -> Option<&Self::Share> {
                Some(&self.inner.share)
            }
        }
    };
}

/// Manages epoch state and subscribers.
struct EpochManager {
    epoch: Epoch,
    subscribers: Vec<mpsc::Sender<Epoch>>,
}

impl EpochManager {
    fn new() -> Self {
        Self {
            epoch: 0,
            subscribers: Vec::new(),
        }
    }

    async fn update(&mut self, epoch: Epoch) {
        // Update epoch
        self.epoch = epoch;

        // Notify all subscribers
        let mut i = 0;
        while i < self.subscribers.len() {
            if self.subscribers[i].send(epoch).await.is_err() {
                // Remove disconnected subscriber
                self.subscribers.swap_remove(i);
            } else {
                i += 1;
            }
        }
    }

    async fn subscribe(&mut self) -> (Epoch, mpsc::Receiver<Epoch>) {
        let (tx, rx) = mpsc::channel(1);
        self.subscribers.push(tx);
        (self.epoch, rx)
    }
}

/// Core supervisor data shared between View and Epoch supervisors.
pub struct Supervisor {
    identity: Identity,
    polynomial: Vec<Evaluation>,
    participants: Vec<ed25519::PublicKey>,
    participants_map: HashMap<ed25519::PublicKey, u32>,
    share: group::Share,
    epoch: AtomicU64,
    epoch_manager: RwLock<EpochManager>,
}

impl Supervisor {
    /// Create a new supervisor.
    pub fn new(
        polynomial: Poly<Evaluation>,
        mut participants: Vec<ed25519::PublicKey>,
        share: group::Share,
    ) -> Arc<Self> {
        // Setup participants
        participants.sort();
        let mut participants_map = HashMap::new();
        for (index, validator) in participants.iter().enumerate() {
            participants_map.insert(validator.clone(), index as u32);
        }
        let identity = *poly::public::<MinSig>(&polynomial);
        let polynomial = evaluate_all::<MinSig>(&polynomial, participants.len() as u32);

        // Return supervisor
        Arc::new(Self {
            identity,
            polynomial,
            participants,
            participants_map,
            share,
            epoch: AtomicU64::new(0),
            epoch_manager: RwLock::new(EpochManager::new()),
        })
    }
}

/// View-based [Supervisor] for [commonware_consensus::threshold_simplex].
#[derive(Clone)]
pub struct ViewSupervisor {
    inner: Arc<Supervisor>,
}

impl ViewSupervisor {
    pub fn new(supervisor: Arc<Supervisor>) -> Self {
        Self { inner: supervisor }
    }
}

impl p2p::Coordinator for ViewSupervisor {
    type PublicKey = ed25519::PublicKey;

    fn peers(&self) -> &Vec<Self::PublicKey> {
        &self.inner.participants
    }

    fn peer_set_id(&self) -> u64 {
        self.inner.epoch.load(Ordering::Acquire)
    }
}

impl_threshold_supervisor_traits!(ViewSupervisor, View);

/// Epoch-based [Supervisor] for [commonware_consensus::aggregation].
#[derive(Clone)]
pub struct EpochSupervisor {
    inner: Arc<Supervisor>,
}

impl EpochSupervisor {
    pub fn new(supervisor: Arc<Supervisor>) -> Self {
        Self { inner: supervisor }
    }

    pub async fn update(&self, epoch: Epoch) {
        self.inner.epoch.store(epoch, Ordering::Release);
        self.inner.epoch_manager.write().await.update(epoch).await;
    }
}

impl_threshold_supervisor_traits!(EpochSupervisor, Epoch);

impl Monitor for EpochSupervisor {
    type Index = Epoch;

    async fn subscribe(&mut self) -> (Self::Index, mpsc::Receiver<Self::Index>) {
        self.inner.epoch_manager.write().await.subscribe().await
    }
}
