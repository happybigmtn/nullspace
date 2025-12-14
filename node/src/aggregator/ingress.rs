use bytes::Bytes;
use commonware_consensus::{
    aggregation::types::{Activity, Certificate, Index},
    threshold_simplex::types::View,
    Automaton, Reporter,
};
use commonware_cryptography::{bls12381::primitives::variant::MinSig, sha256::Digest};
use commonware_resolver::{p2p::Producer, Consumer};
use commonware_storage::{
    mmr::verification::Proof,
    store::operation::{Keyless, Variable},
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

pub enum Message {
    Executed {
        view: View,
        height: u64,
        commitment: Digest,
        result: StateTransitionResult,
        state_proof: Proof<Digest>,
        state_proof_ops: Vec<Variable<Digest, Value>>,
        events_proof: Proof<Digest>,
        events_proof_ops: Vec<Keyless<Output>>,
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
        certificate: Certificate<MinSig, Digest>,
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
}

impl Mailbox {
    pub(super) fn new(sender: mpsc::Sender<Message>) -> Self {
        Self { sender }
    }

    pub(super) async fn uploaded(&mut self, index: Index) {
        if self.sender.send(Message::Uploaded { index }).await.is_err() {
            warn!(index, "aggregator mailbox closed; uploaded dropped");
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
        state_proof_ops: Vec<Variable<Digest, Value>>,
        events_proof: Proof<Digest>,
        events_proof_ops: Vec<Keyless<Output>>,
        response: oneshot::Sender<()>,
    ) {
        if self
            .sender
            .send(Message::Executed {
                view,
                height,
                commitment,
                result,
                state_proof,
                state_proof_ops,
                events_proof,
                events_proof_ops,
                response,
            })
            .await
            .is_err()
        {
            warn!(view, height, "aggregator mailbox closed; executed dropped");
        }
    }
}

impl Automaton for Mailbox {
    type Digest = Digest;
    type Context = Index;

    async fn genesis(&mut self) -> Self::Digest {
        let (response, receiver) = oneshot::channel();
        if self
            .sender
            .send(Message::Genesis { response })
            .await
            .is_err()
        {
            warn!("aggregator mailbox closed; returning genesis digest");
            return genesis_digest();
        }
        receiver.await.unwrap_or_else(|_| {
            warn!("aggregator actor dropped genesis response; returning genesis digest");
            genesis_digest()
        })
    }

    async fn propose(&mut self, context: Self::Context) -> oneshot::Receiver<Self::Digest> {
        let (response, receiver) = oneshot::channel();
        if self
            .sender
            .send(Message::Propose {
                index: context,
                response,
            })
            .await
            .is_err()
        {
            warn!(
                index = context,
                "aggregator mailbox closed; propose returns genesis digest"
            );
            let (fallback_tx, fallback_rx) = oneshot::channel();
            let _ = fallback_tx.send(genesis_digest());
            return fallback_rx;
        }
        receiver
    }

    async fn verify(
        &mut self,
        context: Self::Context,
        payload: Self::Digest,
    ) -> oneshot::Receiver<bool> {
        let (response, receiver) = oneshot::channel();
        if self
            .sender
            .send(Message::Verify {
                index: context,
                payload,
                response,
            })
            .await
            .is_err()
        {
            warn!(
                index = context,
                ?payload,
                "aggregator mailbox closed; verify returns false"
            );
            let (fallback_tx, fallback_rx) = oneshot::channel();
            let _ = fallback_tx.send(false);
            return fallback_rx;
        }
        receiver
    }
}

impl Reporter for Mailbox {
    type Activity = Activity<MinSig, Digest>;

    async fn report(&mut self, activity: Self::Activity) {
        match activity {
            Activity::Certified(certificate) => {
                if self
                    .sender
                    .send(Message::Certified { certificate })
                    .await
                    .is_err()
                {
                    warn!("aggregator mailbox closed; certified dropped");
                }
            }
            Activity::Tip(index) => {
                if self.sender.send(Message::Tip { index }).await.is_err() {
                    warn!(index, "aggregator mailbox closed; tip dropped");
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
        if self
            .sender
            .send(Message::Deliver {
                index: key.into(),
                certificate: value,
                response: sender,
            })
            .await
            .is_err()
        {
            warn!("aggregator mailbox closed; deliver failed");
            return true; // default to true to avoid blocking
        }
        receiver.await.unwrap_or(true) // default to true to avoid blocking
    }

    async fn failed(&mut self, _: Self::Key, _: Self::Failure) {
        // We don't need to do anything on failure, the resolver will retry.
    }
}

impl Producer for Mailbox {
    type Key = U64;

    async fn produce(&mut self, key: Self::Key) -> oneshot::Receiver<Bytes> {
        let (sender, receiver) = oneshot::channel();
        if self
            .sender
            .send(Message::Produce {
                index: key.into(),
                response: sender,
            })
            .await
            .is_err()
        {
            warn!("aggregator mailbox closed; produce dropped");
        }
        receiver
    }
}
