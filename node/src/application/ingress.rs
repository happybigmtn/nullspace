use commonware_consensus::threshold_simplex::types::{Context, View};
use commonware_consensus::{Automaton, Relay, Reporter};
use commonware_cryptography::sha256::Digest;
use commonware_macros::select;
use commonware_runtime::{signal::Signal, telemetry::metrics::histogram, Clock};
use futures::{
    channel::{mpsc, oneshot},
    SinkExt,
};
use nullspace_types::{genesis_digest, Block, Seed};
use std::sync::Arc;
use thiserror::Error;
use tracing::warn;

/// Messages sent to the application.
pub enum Message<E: Clock> {
    Genesis {
        response: oneshot::Sender<Digest>,
    },
    Propose {
        view: View,
        parent: (View, Digest),
        response: oneshot::Sender<Digest>,
    },
    Ancestry {
        view: View,
        blocks: Arc<[Block]>,
        timer: histogram::Timer<E>,
        response: oneshot::Sender<Digest>,
    },
    Broadcast {
        payload: Digest,
    },
    Verify {
        view: View,
        parent: (View, Digest),
        payload: Digest,
        response: oneshot::Sender<bool>,
    },
    Finalized {
        block: Block,
        response: oneshot::Sender<()>,
    },
    Seeded {
        block: Block,
        seed: Seed,
        timer: histogram::Timer<E>,
        response: oneshot::Sender<()>,
    },
}

/// Mailbox for the application.
#[derive(Clone)]
pub struct Mailbox<E: Clock> {
    sender: mpsc::Sender<Message<E>>,
    stopped: Signal,
}

#[derive(Debug, Error)]
pub enum MailboxError {
    #[error("application mailbox closed")]
    Closed,
    #[error("application request canceled")]
    Canceled,
    #[error("shutdown in progress")]
    ShuttingDown,
}

impl<E: Clock> Mailbox<E> {
    pub(super) fn new(sender: mpsc::Sender<Message<E>>, stopped: Signal) -> Self {
        Self { sender, stopped }
    }

    async fn send(&self, message: Message<E>) -> Result<(), MailboxError> {
        let mut sender = self.sender.clone();
        let mut stopped = self.stopped.clone();
        select! {
            result = sender.send(message) => {
                result.map_err(|_| MailboxError::Closed)
            },
            _ = &mut stopped => {
                Err(MailboxError::ShuttingDown)
            },
        }
    }

    async fn receive<T>(&self, receiver: oneshot::Receiver<T>) -> Result<T, MailboxError> {
        let mut stopped = self.stopped.clone();
        select! {
            result = receiver => {
                result.map_err(|_| MailboxError::Canceled)
            },
            _ = &mut stopped => {
                Err(MailboxError::ShuttingDown)
            },
        }
    }

    pub(super) async fn ancestry(
        &mut self,
        view: View,
        blocks: Arc<[Block]>,
        timer: histogram::Timer<E>,
        response: oneshot::Sender<Digest>,
    ) -> Result<(), MailboxError> {
        self.send(Message::Ancestry {
            view,
            blocks,
            timer,
            response,
        })
        .await
    }

    pub(super) async fn seeded(
        &mut self,
        block: Block,
        seed: Seed,
        timer: histogram::Timer<E>,
        response: oneshot::Sender<()>,
    ) -> Result<(), MailboxError> {
        self.send(Message::Seeded {
            block,
            seed,
            timer,
            response,
        })
        .await
    }
}

impl<E: Clock> Automaton for Mailbox<E> {
    type Digest = Digest;
    type Context = Context<Self::Digest>;

    async fn genesis(&mut self) -> Self::Digest {
        let (response, receiver) = oneshot::channel();
        if let Err(err) = self.send(Message::Genesis { response }).await {
            warn!(
                ?err,
                "application mailbox unavailable; returning genesis digest"
            );
            return genesis_digest();
        }
        match self.receive(receiver).await {
            Ok(digest) => digest,
            Err(err) => {
                warn!(?err, "application request failed; returning genesis digest");
                genesis_digest()
            }
        }
    }

    async fn propose(&mut self, context: Context<Self::Digest>) -> oneshot::Receiver<Self::Digest> {
        // If we linked payloads to their parent, we would include
        // the parent in the `Context` in the payload.
        let (response, receiver) = oneshot::channel();
        if let Err(err) = self
            .send(Message::Propose {
                view: context.view,
                parent: context.parent,
                response,
            })
            .await
        {
            warn!(
                view = context.view,
                ?err,
                "application request failed; proposing parent digest"
            );
            let (fallback_tx, fallback_rx) = oneshot::channel();
            let _ = fallback_tx.send(context.parent.1);
            return fallback_rx;
        }
        receiver
    }

    async fn verify(
        &mut self,
        context: Context<Self::Digest>,
        payload: Self::Digest,
    ) -> oneshot::Receiver<bool> {
        // If we linked payloads to their parent, we would verify
        // the parent included in the payload matches the provided `Context`.
        let (response, receiver) = oneshot::channel();
        if let Err(err) = self
            .send(Message::Verify {
                view: context.view,
                parent: context.parent,
                payload,
                response,
            })
            .await
        {
            warn!(
                view = context.view,
                ?payload,
                ?err,
                "application request failed; verify returns false"
            );
            let (fallback_tx, fallback_rx) = oneshot::channel();
            let _ = fallback_tx.send(false);
            return fallback_rx;
        }
        receiver
    }
}

impl<E: Clock> Relay for Mailbox<E> {
    type Digest = Digest;

    async fn broadcast(&mut self, digest: Self::Digest) {
        if let Err(err) = self.send(Message::Broadcast { payload: digest }).await {
            warn!(
                ?digest,
                ?err,
                "application request failed; broadcast dropped"
            );
        }
    }
}

impl<E: Clock> Reporter for Mailbox<E> {
    type Activity = Block;

    async fn report(&mut self, block: Self::Activity) {
        let (response, receiver) = oneshot::channel();
        if let Err(err) = self.send(Message::Finalized { block, response }).await {
            warn!(?err, "application request failed; finalized dropped");
            return;
        }

        // Wait for the item to be processed (used to increment "save point" in marshal)
        // Note: Result is ignored as the receiver may fail if the system is shutting down
        let _ = self.receive(receiver).await;
    }
}
