use bytes::Bytes;
use commonware_consensus::{
    aggregation::types::{Activity, Certificate, Index},
    types::{Epoch, View},
    Automaton, Reporter,
};
use commonware_cryptography::{bls12381::primitives::variant::MinSig, sha256::Digest};
use commonware_macros::select;
use commonware_resolver::{p2p::Producer, Consumer};
use commonware_runtime::signal::Signal;
use commonware_storage::{
    mmr::Proof,
    qmdb::{any::unordered::variable, keyless},
};
use commonware_utils::sequence::U64;
use futures::{
    channel::{mpsc, oneshot},
    SinkExt,
};
use nullspace_execution::state_transition::StateTransitionResult;
use nullspace_types::{
    execution::{Output, Value},
    genesis_digest,
};
use tracing::warn;

type AggregationScheme =
    commonware_consensus::aggregation::scheme::bls12381_threshold::Scheme<
        commonware_cryptography::ed25519::PublicKey,
        MinSig,
    >;
type AggregationCertificate = Certificate<AggregationScheme, Digest>;
type StateOp = variable::Operation<Digest, Value>;
type EventOp = keyless::Operation<Output>;

pub enum Message {
    Executed {
        view: View,
        height: u64,
        commitment: Digest,
        result: StateTransitionResult,
        state_proof: Proof<Digest>,
        state_proof_ops: Vec<StateOp>,
        events_proof: Proof<Digest>,
        events_proof_ops: Vec<EventOp>,
        response: oneshot::Sender<()>,
    },
    Genesis {
        response: oneshot::Sender<Digest>,
    },
    Propose {
        index: Index,
        response: oneshot::Sender<Digest>,
    },
    Verify {
        index: Index,
        payload: Digest,
        response: oneshot::Sender<bool>,
    },
    Tip {
        index: Index,
    },
    Certified {
        certificate: AggregationCertificate,
    },
    Deliver {
        index: Index,
        certificate: Bytes,
        response: oneshot::Sender<bool>,
    },
    Produce {
        index: Index,
        response: oneshot::Sender<Bytes>,
    },
    Uploaded {
        index: Index,
    },
}

#[derive(Clone)]
pub struct Mailbox {
    sender: mpsc::Sender<Message>,
    stopped: Signal,
}

impl Mailbox {
    pub(super) fn new(sender: mpsc::Sender<Message>, stopped: Signal) -> Self {
        Self { sender, stopped }
    }

    pub(super) async fn uploaded(&mut self, index: Index) {
        let mut sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = sender.send(Message::Uploaded { index }) => {
                if result.is_err() {
                    warn!(index, "aggregator mailbox closed; uploaded dropped");
                }
            },
            _ = &mut stopped => {
                warn!(index, "aggregator shutting down; uploaded dropped");
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn executed(
        &mut self,
        view: View,
        height: u64,
        commitment: Digest,
        result: StateTransitionResult,
        state_proof: Proof<Digest>,
        state_proof_ops: Vec<StateOp>,
        events_proof: Proof<Digest>,
        events_proof_ops: Vec<EventOp>,
        response: oneshot::Sender<()>,
    ) {
        let mut sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = sender.send(Message::Executed { view, height, commitment, result, state_proof, state_proof_ops, events_proof, events_proof_ops, response }) => {
                if result.is_err() {
                warn!(view = view.get(), height, "aggregator mailbox closed; executed dropped");
                }
            },
            _ = &mut stopped => {
                warn!(view = view.get(), height, "aggregator shutting down; executed dropped");
            }
        }
    }
}

impl Automaton for Mailbox {
    type Digest = Digest;
    type Context = Index;

    async fn genesis(&mut self, _epoch: Epoch) -> Self::Digest {
        let (response, receiver) = oneshot::channel();
        let mut sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = sender.send(Message::Genesis { response }) => {
                if result.is_err() {
                    warn!("aggregator mailbox closed; returning genesis digest");
                    return genesis_digest();
                }
            },
            _ = &mut stopped => {
                warn!("aggregator shutting down; returning genesis digest");
                return genesis_digest();
            }
        }
        receiver.await.unwrap_or_else(|_| {
            warn!("aggregator actor dropped genesis response; returning genesis digest");
            genesis_digest()
        })
    }

    async fn propose(&mut self, context: Self::Context) -> oneshot::Receiver<Self::Digest> {
        let (response, receiver) = oneshot::channel();
        let mut sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = sender.send(Message::Propose { index: context, response }) => {
                if result.is_err() {
                    warn!(index = context, "aggregator mailbox closed; propose returns genesis digest");
                    let (fallback_tx, fallback_rx) = oneshot::channel();
                    let _ = fallback_tx.send(genesis_digest());
                    return fallback_rx;
                }
            },
            _ = &mut stopped => {
                warn!(index = context, "aggregator shutting down; propose returns genesis digest");
                let (fallback_tx, fallback_rx) = oneshot::channel();
                let _ = fallback_tx.send(genesis_digest());
                return fallback_rx;
            }
        }
        receiver
    }

    async fn verify(
        &mut self,
        context: Self::Context,
        payload: Self::Digest,
    ) -> oneshot::Receiver<bool> {
        let (response, receiver) = oneshot::channel();
        let mut sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = sender.send(Message::Verify { index: context, payload, response }) => {
                if result.is_err() {
                    warn!(index = context, ?payload, "aggregator mailbox closed; verify returns false");
                    let (fallback_tx, fallback_rx) = oneshot::channel();
                    let _ = fallback_tx.send(false);
                    return fallback_rx;
                }
            },
            _ = &mut stopped => {
                warn!(index = context, ?payload, "aggregator shutting down; verify returns false");
                let (fallback_tx, fallback_rx) = oneshot::channel();
                let _ = fallback_tx.send(false);
                return fallback_rx;
            }
        }
        receiver
    }
}

impl Reporter for Mailbox {
    type Activity = Activity<AggregationScheme, Digest>;

    async fn report(&mut self, activity: Self::Activity) {
        match activity {
            Activity::Certified(certificate) => {
                let mut sender = self.sender.clone();
                let mut stopped = self.stopped.clone();
                select! {
                    result = sender.send(Message::Certified { certificate }) => {
                        if result.is_err() {
                            warn!("aggregator mailbox closed; certified dropped");
                        }
                    },
                    _ = &mut stopped => {
                        warn!("aggregator shutting down; certified dropped");
                    }
                }
            }
            Activity::Tip(index) => {
                let mut sender = self.sender.clone();
                let mut stopped = self.stopped.clone();
                select! {
                    result = sender.send(Message::Tip { index }) => {
                        if result.is_err() {
                            warn!(index, "aggregator mailbox closed; tip dropped");
                        }
                    },
                    _ = &mut stopped => {
                        warn!(index, "aggregator shutting down; tip dropped");
                    }
                }
            }
            _ => {}
        }
    }
}

impl Consumer for Mailbox {
    type Key = U64;
    type Value = Bytes;
    type Failure = ();

    async fn deliver(&mut self, key: Self::Key, value: Self::Value) -> bool {
        let (sender, receiver) = oneshot::channel();
        {
            let mut mailbox_sender = self.sender.clone();
            let mut stopped = self.stopped.clone();
            select! {
                result = mailbox_sender.send(Message::Deliver { index: key.into(), certificate: value, response: sender }) => {
                    if result.is_err() {
                        warn!("aggregator mailbox closed; deliver failed");
                        return false;
                    }
                },
                _ = &mut stopped => {
                    return false;
                }
            }
        }
        let mut stopped = self.stopped.clone();
        select! {
            result = receiver => { result.unwrap_or(false) },
            _ = &mut stopped => { false },
        }
    }

    async fn failed(&mut self, _: Self::Key, _: Self::Failure) {
        // We don't need to do anything on failure, the resolver will retry.
    }
}

impl Producer for Mailbox {
    type Key = U64;

    async fn produce(&mut self, key: Self::Key) -> oneshot::Receiver<Bytes> {
        let (sender, receiver) = oneshot::channel();
        let mut mailbox_sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = mailbox_sender.send(Message::Produce { index: key.into(), response: sender }) => {
                if result.is_err() {
                    warn!("aggregator mailbox closed; produce dropped");
                }
            },
            _ = &mut stopped => {}
        }
        receiver
    }
}
