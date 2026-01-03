use commonware_consensus::{
    aggregation::scheme::bls12381_threshold as aggregation_bls12381_threshold,
    simplex::scheme::bls12381_threshold,
    types::Epoch,
    Monitor,
};
use commonware_cryptography::{
    bls12381::primitives::{group, sharing::Sharing, variant::MinSig},
    certificate::Provider,
    ed25519,
};
use commonware_p2p::{Blocker, Manager};
use commonware_runtime::RwLock;
use commonware_utils::ordered::Set;
use futures::{channel::mpsc, SinkExt};
use nullspace_types::Identity;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

/// Manages epoch state and subscribers.
struct EpochManager {
    epoch: Epoch,
    subscribers: Vec<mpsc::Sender<Epoch>>,
}

impl EpochManager {
    fn new() -> Self {
        Self {
            epoch: Epoch::zero(),
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
    scheme: bls12381_threshold::Scheme<ed25519::PublicKey, MinSig>,
    certificate_verifier: bls12381_threshold::Scheme<ed25519::PublicKey, MinSig>,
    aggregation_scheme: aggregation_bls12381_threshold::Scheme<ed25519::PublicKey, MinSig>,
    aggregation_certificate_verifier:
        aggregation_bls12381_threshold::Scheme<ed25519::PublicKey, MinSig>,
    participants: Vec<ed25519::PublicKey>,
    participants_set: Set<ed25519::PublicKey>,
    epoch: AtomicU64,
    epoch_manager: RwLock<EpochManager>,
    peer_subscribers: RwLock<Vec<mpsc::UnboundedSender<(u64, Set<ed25519::PublicKey>, Set<ed25519::PublicKey>)>>>,
}

impl std::fmt::Debug for Supervisor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Supervisor")
            .field("identity", &self.identity)
            .field("participants_len", &self.participants.len())
            .field("epoch", &self.epoch.load(Ordering::Relaxed))
            .finish()
    }
}

impl Supervisor {
    /// Create a new supervisor.
    pub fn new(
        sharing: Sharing<MinSig>,
        mut participants: Vec<ed25519::PublicKey>,
        share: group::Share,
    ) -> Arc<Self> {
        participants.sort();
        let participants_set = Set::try_from(participants.clone())
            .expect("participants must be unique and sorted");
        let identity = sharing.public().clone();
        let aggregation_sharing = sharing.clone();
        let aggregation_share = share.clone();
        let scheme = bls12381_threshold::Scheme::signer(participants_set.clone(), sharing, share)
            .expect("share index must match participant indices");
        let certificate_verifier = bls12381_threshold::Scheme::certificate_verifier(identity.clone());
        let aggregation_scheme =
            aggregation_bls12381_threshold::Scheme::signer(
                participants_set.clone(),
                aggregation_sharing,
                aggregation_share,
            )
                .expect("share index must match participant indices");
        let aggregation_certificate_verifier =
            aggregation_bls12381_threshold::Scheme::certificate_verifier(identity.clone());

        Arc::new(Self {
            identity,
            scheme,
            certificate_verifier,
            aggregation_scheme,
            aggregation_certificate_verifier,
            participants,
            participants_set,
            epoch: AtomicU64::new(0),
            epoch_manager: RwLock::new(EpochManager::new()),
            peer_subscribers: RwLock::new(Vec::new()),
        })
    }

    pub fn identity(&self) -> Identity {
        self.identity.clone()
    }

    async fn notify_peer_set(&self, epoch: Epoch) {
        let peers = self.participants_set.clone();
        let mut subscribers = self.peer_subscribers.write().await;
        let mut i = 0;
        while i < subscribers.len() {
            if subscribers[i]
                .unbounded_send((epoch.get(), peers.clone(), peers.clone()))
                .is_err()
            {
                subscribers.swap_remove(i);
            } else {
                i += 1;
            }
        }
    }
}

/// View-based supervisor for resolver coordination.
#[derive(Clone, Debug)]
pub struct ViewSupervisor {
    inner: Arc<Supervisor>,
}

impl ViewSupervisor {
    pub fn new(supervisor: Arc<Supervisor>) -> Self {
        Self { inner: supervisor }
    }

    pub fn scheme(&self) -> bls12381_threshold::Scheme<ed25519::PublicKey, MinSig> {
        self.inner.scheme.clone()
    }
}

impl Manager for ViewSupervisor {
    type PublicKey = ed25519::PublicKey;
    type Peers = Set<ed25519::PublicKey>;

    async fn update(&mut self, id: u64, peers: Self::Peers) {
        let mut subscribers = self.inner.peer_subscribers.write().await;
        let mut i = 0;
        while i < subscribers.len() {
            if subscribers[i]
                .unbounded_send((id, peers.clone(), peers.clone()))
                .is_err()
            {
                subscribers.swap_remove(i);
            } else {
                i += 1;
            }
        }
    }

    async fn peer_set(&mut self, _id: u64) -> Option<Set<Self::PublicKey>> {
        Some(self.inner.participants_set.clone())
    }

    async fn subscribe(
        &mut self,
    ) -> mpsc::UnboundedReceiver<(u64, Set<Self::PublicKey>, Set<Self::PublicKey>)> {
        let (sender, receiver) = mpsc::unbounded();
        let id = self.inner.epoch.load(Ordering::Acquire);
        let peers = self.inner.participants_set.clone();
        let _ = sender.unbounded_send((id, peers.clone(), peers.clone()));
        self.inner.peer_subscribers.write().await.push(sender);
        receiver
    }
}

impl Blocker for ViewSupervisor {
    type PublicKey = ed25519::PublicKey;

    async fn block(&mut self, _peer: Self::PublicKey) {}
}

/// Epoch-based supervisor for aggregation and marshal.
#[derive(Clone)]
pub struct EpochSupervisor {
    inner: Arc<Supervisor>,
}

impl EpochSupervisor {
    pub fn new(supervisor: Arc<Supervisor>) -> Self {
        Self { inner: supervisor }
    }

    pub fn scheme(&self) -> bls12381_threshold::Scheme<ed25519::PublicKey, MinSig> {
        self.inner.scheme.clone()
    }

    pub async fn update(&self, epoch: Epoch) {
        self.inner.epoch.store(epoch.get(), Ordering::Release);
        self.inner.epoch_manager.write().await.update(epoch).await;
        self.inner.notify_peer_set(epoch).await;
    }
}

/// Epoch-based supervisor for aggregation certificates.
#[derive(Clone)]
pub struct AggregationSupervisor {
    inner: Arc<Supervisor>,
}

impl AggregationSupervisor {
    pub fn new(supervisor: Arc<Supervisor>) -> Self {
        Self { inner: supervisor }
    }
}

impl Provider for AggregationSupervisor {
    type Scope = Epoch;
    type Scheme = aggregation_bls12381_threshold::Scheme<ed25519::PublicKey, MinSig>;

    fn scoped(&self, _scope: Self::Scope) -> Option<Arc<Self::Scheme>> {
        Some(Arc::new(self.inner.aggregation_scheme.clone()))
    }

    fn all(&self) -> Option<Arc<Self::Scheme>> {
        Some(Arc::new(
            self.inner.aggregation_certificate_verifier.clone(),
        ))
    }
}

impl Provider for EpochSupervisor {
    type Scope = Epoch;
    type Scheme = bls12381_threshold::Scheme<ed25519::PublicKey, MinSig>;

    fn scoped(&self, _scope: Self::Scope) -> Option<Arc<Self::Scheme>> {
        Some(Arc::new(self.inner.scheme.clone()))
    }

    fn all(&self) -> Option<Arc<Self::Scheme>> {
        Some(Arc::new(self.inner.certificate_verifier.clone()))
    }
}

impl Monitor for EpochSupervisor {
    type Index = Epoch;

    async fn subscribe(&mut self) -> (Self::Index, mpsc::Receiver<Self::Index>) {
        self.inner.epoch_manager.write().await.subscribe().await
    }
}
