use crate::{Error, Result};
use commonware_codec::ReadExt;
use futures_util::{Stream as FutStream, StreamExt};
use nullspace_types::{
    api::{Events, Update},
    Identity, Seed, NAMESPACE,
};
use tokio::sync::mpsc;
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};
use tracing::{debug, error, trace, warn};

const DEFAULT_CHANNEL_CAPACITY: usize = 1024;

/// Stream of events from the WebSocket connection
pub struct Stream<T: ReadExt + Send + Sync + 'static> {
    receiver: mpsc::Receiver<Result<T>>,
    _handle: tokio::task::JoinHandle<()>,
}

impl<T: ReadExt + Send + Sync + 'static> Drop for Stream<T> {
    fn drop(&mut self) {
        self._handle.abort();
    }
}

/// Trait for verifying consensus messages
pub trait Verifiable {
    fn verify(&self, identity: &Identity) -> bool;
}

impl Verifiable for Seed {
    fn verify(&self, identity: &Identity) -> bool {
        self.verify(NAMESPACE, identity)
    }
}

impl Verifiable for Events {
    fn verify(&self, identity: &Identity) -> bool {
        self.verify(identity).is_ok()
    }
}

impl Verifiable for Update {
    fn verify(&self, identity: &Identity) -> bool {
        match self {
            Update::Seed(seed) => seed.verify(NAMESPACE, identity),
            Update::Events(events) => events.verify(identity).is_ok(),
            Update::FilteredEvents(events) => events.verify(identity).is_ok(),
        }
    }
}

impl<T: ReadExt + Send + Sync + 'static> Stream<T> {
    fn capacity_or_default(capacity: usize) -> usize {
        if capacity == 0 {
            DEFAULT_CHANNEL_CAPACITY
        } else {
            capacity
        }
    }

    fn spawn_reader<S, V>(
        ws: WebSocketStream<S>,
        tx: mpsc::Sender<Result<T>>,
        verify: V,
    ) -> tokio::task::JoinHandle<()>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        V: Fn(&T) -> Result<()> + Send + 'static,
    {
        tokio::spawn(async move {
            let mut ws = ws;
            let message_type = std::any::type_name::<T>();
            while let Some(msg) = ws.next().await {
                match msg {
                    Ok(Message::Binary(data)) => {
                        let initial_len = data.len();
                        trace!(message_type, len = initial_len, "received websocket message");
                        let mut buf = data.as_slice();
                        match T::read(&mut buf) {
                            Ok(event) => {
                                let remaining = buf.len();
                                if remaining != 0 {
                                    debug!(
                                        message_type,
                                        len = initial_len,
                                        remaining,
                                        "decoded websocket message with trailing bytes"
                                    );
                                }
                                if let Err(err) = verify(&event) {
                                    warn!(
                                        message_type,
                                        len = initial_len,
                                        error = ?err,
                                        "failed to verify consensus message"
                                    );
                                    if tx.send(Err(err)).await.is_err() {
                                        break;
                                    }
                                    continue;
                                }
                                if tx.send(Ok(event)).await.is_err() {
                                    break; // Receiver dropped
                                }
                            }
                            Err(e) => {
                                let remaining = buf.len();
                                let consumed = initial_len.saturating_sub(remaining);
                                warn!(
                                    message_type,
                                    len = initial_len,
                                    consumed,
                                    remaining,
                                    error = %e,
                                    "failed to decode websocket message"
                                );
                                let err = Error::InvalidData(e);
                                if tx.send(Err(err)).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        debug!("WebSocket closed");
                        let _ = tx.send(Err(Error::ConnectionClosed)).await;
                        break;
                    }
                    Ok(_) => {} // Ignore other message types
                    Err(e) => {
                        error!("WebSocket error: {}", e);
                        let _ = tx.send(Err(e.into())).await;
                        break;
                    }
                }
            }
        })
    }

    pub(crate) fn new<S>(ws: WebSocketStream<S>) -> Self
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        Self::new_with_capacity(ws, DEFAULT_CHANNEL_CAPACITY)
    }

    pub(crate) fn new_with_capacity<S>(ws: WebSocketStream<S>, capacity: usize) -> Self
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let capacity = Self::capacity_or_default(capacity);
        let (tx, rx) = mpsc::channel(capacity);

        let handle = Self::spawn_reader(ws, tx, |_| Ok(()));

        Self {
            receiver: rx,
            _handle: handle,
        }
    }

    pub(crate) fn new_with_verifier<S>(ws: WebSocketStream<S>, identity: Identity) -> Self
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        T: Verifiable,
    {
        Self::new_with_verifier_with_capacity(ws, identity, DEFAULT_CHANNEL_CAPACITY)
    }

    pub(crate) fn new_with_verifier_with_capacity<S>(
        ws: WebSocketStream<S>,
        identity: Identity,
        capacity: usize,
    ) -> Self
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        T: Verifiable,
    {
        let capacity = Self::capacity_or_default(capacity);
        let (tx, rx) = mpsc::channel(capacity);

        let handle = Self::spawn_reader(ws, tx, move |event| {
            if event.verify(&identity) {
                Ok(())
            } else {
                Err(Error::InvalidSignature)
            }
        });

        Self {
            receiver: rx,
            _handle: handle,
        }
    }

    /// Receive the next event from the stream
    pub async fn next(&mut self) -> Option<Result<T>> {
        self.receiver.recv().await
    }
}

impl<T: ReadExt + Send + Sync + 'static> FutStream for Stream<T> {
    type Item = Result<T>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.receiver.poll_recv(cx)
    }
}
