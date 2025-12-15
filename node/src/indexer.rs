#[cfg(test)]
use commonware_consensus::{threshold_simplex::types::View, Viewable};
use commonware_cryptography::ed25519::Batch;
use commonware_cryptography::BatchVerifier;
#[cfg(test)]
use commonware_runtime::RwLock;
use commonware_runtime::Spawner;
use commonware_runtime::{Clock, Handle, Metrics};
use futures::channel::mpsc;
use futures::{SinkExt, Stream, StreamExt};
use nullspace_types::api::Pending;
#[cfg(test)]
use nullspace_types::execution::Transaction;
use nullspace_types::{api::Summary, Seed};
#[cfg(test)]
use nullspace_types::{Identity, NAMESPACE};
use prometheus_client::metrics::counter::Counter;
use rand::{CryptoRng, Rng};
use std::future::Future;
#[cfg(test)]
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use std::{
    pin::Pin,
    sync::atomic::AtomicU64,
    task::{Context, Poll},
    time::Duration,
};
use tracing::{error, info, warn};

/// Delay between reconnection attempts when tx_stream fails
const TX_STREAM_RECONNECT_DELAY: Duration = Duration::from_secs(10);

/// Buffer size for the tx_stream channel
const TX_STREAM_BUFFER_SIZE: usize = 1_024;

fn jittered_backoff(rng: &mut impl Rng, backoff: Duration) -> Duration {
    let backoff_ms = backoff.as_millis() as u64;
    if backoff_ms <= 1 {
        return backoff;
    }

    // "Equal jitter": delay is in [backoff/2, backoff].
    let half_ms = backoff_ms / 2;
    let jitter_ms = rng.gen_range(0..=half_ms);
    Duration::from_millis(half_ms.saturating_add(jitter_ms))
}

/// Trait for interacting with an indexer.
pub trait Indexer: Clone + Send + Sync + 'static {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Upload a seed to the indexer.
    fn submit_seed(&self, seed: Seed) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Get a stream of transactions from the indexer.
    fn listen_mempool(
        &self,
    ) -> impl Future<
        Output = Result<impl Stream<Item = Result<Pending, Self::Error>> + Send, Self::Error>,
    > + Send;

    /// Upload result
    fn submit_summary(
        &self,
        summary: Summary,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

/// A mock indexer implementation for testing.
#[cfg(test)]
#[derive(Clone)]
pub struct Mock {
    pub identity: Identity,
    pub seeds: Arc<Mutex<HashMap<View, Seed>>>,
    #[allow(clippy::type_complexity)]
    pub summaries: Arc<RwLock<Vec<(u64, Summary)>>>,
    #[allow(clippy::type_complexity)]
    pub tx_sender: Arc<Mutex<Vec<mpsc::UnboundedSender<Result<Pending, std::io::Error>>>>>,
}

#[cfg(test)]
impl Mock {
    pub fn new(identity: Identity) -> Self {
        Self {
            identity,
            seeds: Arc::new(Mutex::new(HashMap::new())),
            summaries: Arc::new(RwLock::new(Vec::new())),
            tx_sender: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn submit_tx(&self, tx: Transaction) {
        let mut senders = self.tx_sender.lock().unwrap();
        senders.retain(|sender| {
            sender
                .unbounded_send(Ok(Pending {
                    transactions: vec![tx.clone()],
                }))
                .is_ok()
        });
    }
}

#[cfg(test)]
impl Indexer for Mock {
    type Error = std::io::Error;

    async fn submit_seed(&self, seed: Seed) -> Result<(), Self::Error> {
        // Verify the seed
        assert!(seed.verify(NAMESPACE, &self.identity));

        // Store the seed
        let mut seeds = self.seeds.lock().unwrap();
        seeds.insert(seed.view(), seed);
        Ok(())
    }

    async fn listen_mempool(
        &self,
    ) -> Result<impl Stream<Item = Result<Pending, Self::Error>>, Self::Error> {
        let (tx, rx) = mpsc::unbounded();
        self.tx_sender.lock().unwrap().push(tx);
        Ok(rx)
    }

    async fn submit_summary(&self, summary: Summary) -> Result<(), Self::Error> {
        // Verify the summary
        assert!(summary.verify(&self.identity).is_ok());

        // Store the summary
        let mut summaries = self.summaries.write().await;
        summaries.push((summary.progress.height, summary));

        Ok(())
    }
}

impl Indexer for nullspace_client::Client {
    type Error = nullspace_client::Error;

    async fn submit_seed(&self, seed: Seed) -> Result<(), Self::Error> {
        self.submit_seed(seed).await
    }

    async fn listen_mempool(
        &self,
    ) -> Result<impl Stream<Item = Result<Pending, Self::Error>>, Self::Error> {
        self.connect_mempool().await
    }

    async fn submit_summary(&self, summary: Summary) -> Result<(), Self::Error> {
        self.submit_summary(summary).await
    }
}

/// A stream that wraps the indexer's listen_mempool with automatic reconnection
pub struct ReconnectingStream<I>
where
    I: Indexer,
{
    rx: mpsc::Receiver<Result<Pending, I::Error>>,
    _handle: Handle<()>,
}

impl<I> ReconnectingStream<I>
where
    I: Indexer,
{
    pub fn new<E>(context: E, indexer: I) -> Self
    where
        E: Spawner + Clock + Rng + CryptoRng + Metrics,
    {
        let context = context.with_label("mempool_stream");
        let connect_attempts: Counter<u64, AtomicU64> = Counter::default();
        let connect_failures: Counter<u64, AtomicU64> = Counter::default();
        let connect_success: Counter<u64, AtomicU64> = Counter::default();
        let stream_failures: Counter<u64, AtomicU64> = Counter::default();
        let invalid_batches: Counter<u64, AtomicU64> = Counter::default();
        let forwarded_batches: Counter<u64, AtomicU64> = Counter::default();
        context.register(
            "connect_attempts_total",
            "Number of attempts to connect to the indexer mempool websocket",
            connect_attempts.clone(),
        );
        context.register(
            "connect_failures_total",
            "Number of failures while connecting to the indexer mempool websocket",
            connect_failures.clone(),
        );
        context.register(
            "connect_success_total",
            "Number of successful connections to the indexer mempool websocket",
            connect_success.clone(),
        );
        context.register(
            "stream_failures_total",
            "Number of websocket read/stream failures on the indexer mempool websocket",
            stream_failures.clone(),
        );
        context.register(
            "invalid_batches_total",
            "Number of invalid Pending batches dropped from the indexer mempool stream",
            invalid_batches.clone(),
        );
        context.register(
            "forwarded_batches_total",
            "Number of Pending batches forwarded from the indexer mempool stream",
            forwarded_batches.clone(),
        );

        // Spawn background task that manages connections
        let (mut tx, rx) = mpsc::channel(TX_STREAM_BUFFER_SIZE);
        let handle = context.spawn({
            move |mut context| async move {
                let mut backoff = Duration::from_millis(200);
                loop {
                    // Try to connect
                    connect_attempts.inc();
                    match indexer.listen_mempool().await {
                        Ok(stream) => {
                            connect_success.inc();
                            info!("connected to mempool stream");
                            let mut stream = Box::pin(stream);
                            backoff = Duration::from_millis(200);

                            // Forward transactions until stream fails
                            while let Some(result) = stream.next().await {
                                match result {
                                    Ok(pending) => {
                                        // Batch verify transactions
                                        let mut batcher = Batch::new();
                                        for tx in &pending.transactions {
                                            tx.verify_batch(&mut batcher);
                                        }
                                        if !batcher.verify(&mut context) {
                                            warn!("received invalid transaction from indexer");
                                            invalid_batches.inc();
                                            continue;
                                        }

                                        // Pass to receiver
                                        if tx.send(Ok(pending)).await.is_err() {
                                            warn!("receiver dropped");
                                            return;
                                        }
                                        forwarded_batches.inc();
                                    }
                                    Err(e) => {
                                        stream_failures.inc();
                                        error!(?e, "mempool stream error");
                                        break;
                                    }
                                }
                            }

                            warn!("mempool stream ended");
                        }
                        Err(e) => {
                            connect_failures.inc();
                            error!(?e, "failed to connect mempool stream");
                        }
                    }

                    // Wait before reconnecting
                    let delay = jittered_backoff(&mut context, backoff);
                    context.sleep(delay).await;
                    backoff = backoff.saturating_mul(2).min(TX_STREAM_RECONNECT_DELAY);
                }
            }
        });

        Self {
            rx,
            _handle: handle,
        }
    }
}

impl<I> Stream for ReconnectingStream<I>
where
    I: Indexer,
{
    type Item = Result<Pending, I::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.rx).poll_next(cx)
    }
}

/// A wrapper indexer that provides automatic reconnection for mempool stream
#[derive(Clone)]
pub struct ReconnectingIndexer<I, E>
where
    I: Indexer,
    E: Rng + CryptoRng + Spawner + Clock + Metrics + Clone,
{
    inner: I,
    context: E,
}

impl<I, E> ReconnectingIndexer<I, E>
where
    I: Indexer,
    E: Rng + CryptoRng + Spawner + Clock + Metrics + Clone,
{
    pub fn new(context: E, inner: I) -> Self {
        Self { inner, context }
    }
}

impl<I, E> Indexer for ReconnectingIndexer<I, E>
where
    I: Indexer,
    E: Rng + CryptoRng + Spawner + Clock + Metrics + Clone + Send + Sync + 'static,
{
    type Error = I::Error;

    async fn submit_seed(&self, seed: Seed) -> Result<(), Self::Error> {
        self.inner.submit_seed(seed).await
    }

    async fn listen_mempool(
        &self,
    ) -> Result<impl Stream<Item = Result<Pending, Self::Error>> + Send, Self::Error> {
        Ok(ReconnectingStream::new(
            self.context.clone(),
            self.inner.clone(),
        ))
    }

    async fn submit_summary(&self, summary: Summary) -> Result<(), Self::Error> {
        self.inner.submit_summary(summary).await
    }
}
