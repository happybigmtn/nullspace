use crate::{Error, Result};
use commonware_codec::ReadExt;
use futures_util::{task::AtomicWaker, Stream as FutStream, StreamExt};
use nullspace_types::{
    api::{Events, Update},
    Identity, Seed, NAMESPACE,
};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::mpsc;
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};
use tracing::{debug, error, trace, warn};

const DEFAULT_CHANNEL_CAPACITY: usize = 1024;

struct LossyChannel<T> {
    capacity: usize,
    queue: Mutex<VecDeque<T>>,
    closed: AtomicBool,
    waker: AtomicWaker,
}

#[derive(Clone)]
struct LossySender<T> {
    inner: Arc<LossyChannel<T>>,
}

struct LossyReceiver<T> {
    inner: Arc<LossyChannel<T>>,
}

fn lossy_channel<T>(capacity: usize) -> (LossySender<T>, LossyReceiver<T>) {
    let inner = Arc::new(LossyChannel {
        capacity,
        queue: Mutex::new(VecDeque::with_capacity(capacity)),
        closed: AtomicBool::new(false),
        waker: AtomicWaker::new(),
    });
    (
        LossySender {
            inner: inner.clone(),
        },
        LossyReceiver { inner },
    )
}

impl<T> LossySender<T> {
    fn push(&self, item: T) -> bool {
        if self.inner.closed.load(Ordering::Acquire) {
            return false;
        }
        let mut queue = self
            .inner
            .queue
            .lock()
            .expect("lossy channel mutex poisoned");
        if queue.len() == self.inner.capacity {
            queue.pop_front();
        }
        queue.push_back(item);
        drop(queue);
        self.inner.waker.wake();
        true
    }

    fn close(&self) {
        self.inner.closed.store(true, Ordering::Release);
        self.inner.waker.wake();
    }
}

impl<T> LossyReceiver<T> {
    fn pop_front(&mut self) -> Option<T> {
        let mut queue = self
            .inner
            .queue
            .lock()
            .expect("lossy channel mutex poisoned");
        queue.pop_front()
    }

    fn poll_recv(&mut self, cx: &mut std::task::Context<'_>) -> std::task::Poll<Option<T>> {
        if let Some(item) = self.pop_front() {
            return std::task::Poll::Ready(Some(item));
        }
        if self.inner.closed.load(Ordering::Acquire) {
            return std::task::Poll::Ready(None);
        }

        self.inner.waker.register(cx.waker());

        if let Some(item) = self.pop_front() {
            return std::task::Poll::Ready(Some(item));
        }
        if self.inner.closed.load(Ordering::Acquire) {
            return std::task::Poll::Ready(None);
        }
        std::task::Poll::Pending
    }
}

enum StreamReceiver<T> {
    Lossless(mpsc::Receiver<Result<T>>),
    Lossy(LossyReceiver<Result<T>>),
}

/// Stream of events from the WebSocket connection
pub struct Stream<T: ReadExt + Send + Sync + 'static> {
    receiver: StreamReceiver<T>,
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
                        trace!(
                            message_type,
                            len = initial_len,
                            "received websocket message"
                        );
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

    fn spawn_reader_lossy<S, V>(
        ws: WebSocketStream<S>,
        tx: LossySender<Result<T>>,
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
                        trace!(
                            message_type,
                            len = initial_len,
                            "received websocket message"
                        );
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
                                    if !tx.push(Err(err)) {
                                        break;
                                    }
                                    continue;
                                }
                                if !tx.push(Ok(event)) {
                                    break;
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
                                if !tx.push(Err(err)) {
                                    break;
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        debug!("WebSocket closed");
                        let _ = tx.push(Err(Error::ConnectionClosed));
                        break;
                    }
                    Ok(_) => {} // Ignore other message types
                    Err(e) => {
                        error!("WebSocket error: {}", e);
                        let _ = tx.push(Err(e.into()));
                        break;
                    }
                }
            }
            tx.close();
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
            receiver: StreamReceiver::Lossless(rx),
            _handle: handle,
        }
    }

    pub(crate) fn new_lossy_with_capacity<S>(ws: WebSocketStream<S>, capacity: usize) -> Self
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let capacity = Self::capacity_or_default(capacity);
        let (tx, rx) = lossy_channel(capacity);
        let handle = Self::spawn_reader_lossy(ws, tx, |_| Ok(()));

        Self {
            receiver: StreamReceiver::Lossy(rx),
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
            receiver: StreamReceiver::Lossless(rx),
            _handle: handle,
        }
    }

    pub(crate) fn new_lossy_with_verifier_with_capacity<S>(
        ws: WebSocketStream<S>,
        identity: Identity,
        capacity: usize,
    ) -> Self
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        T: Verifiable,
    {
        let capacity = Self::capacity_or_default(capacity);
        let (tx, rx) = lossy_channel(capacity);

        let handle = Self::spawn_reader_lossy(ws, tx, move |event| {
            if event.verify(&identity) {
                Ok(())
            } else {
                Err(Error::InvalidSignature)
            }
        });

        Self {
            receiver: StreamReceiver::Lossy(rx),
            _handle: handle,
        }
    }

    /// Receive the next event from the stream
    pub async fn next(&mut self) -> Option<Result<T>> {
        futures_util::StreamExt::next(self).await
    }
}

impl<T: ReadExt + Send + Sync + 'static> FutStream for Stream<T> {
    type Item = Result<T>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        match &mut self.receiver {
            StreamReceiver::Lossless(receiver) => receiver.poll_recv(cx),
            StreamReceiver::Lossy(receiver) => receiver.poll_recv(cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::future::poll_fn;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn lossy_channel_drops_oldest_when_full() {
        let (tx, mut rx) = lossy_channel::<u8>(2);
        assert!(tx.push(1));
        assert!(tx.push(2));
        assert!(tx.push(3));

        let first = poll_fn(|cx| rx.poll_recv(cx)).await;
        let second = poll_fn(|cx| rx.poll_recv(cx)).await;

        assert_eq!(first, Some(2));
        assert_eq!(second, Some(3));
    }

    #[tokio::test]
    async fn lossy_channel_wakes_and_closes() {
        let (tx, mut rx) = lossy_channel::<u8>(1);
        tokio::spawn(async move {
            sleep(Duration::from_millis(10)).await;
            tx.push(42);
            tx.close();
        });

        let first = poll_fn(|cx| rx.poll_recv(cx)).await;
        let second = poll_fn(|cx| rx.poll_recv(cx)).await;

        assert_eq!(first, Some(42));
        assert_eq!(second, None);
    }
}
