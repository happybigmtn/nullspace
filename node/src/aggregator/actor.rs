use crate::{
    aggregator::{ingress::Mailbox, Config, Message},
    backoff::jittered_backoff,
    indexer::Indexer,
};
use bytes::{Buf, BufMut};
use commonware_codec::{
    DecodeExt, Encode, EncodeSize, FixedSize, Read, ReadExt, ReadRangeExt, Write,
};
use commonware_consensus::aggregation::types::{Certificate, Index, Item};
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig,
    ed25519::PublicKey,
    sha256::Digest,
    Digestible,
};
use commonware_p2p::{Receiver, Sender};
use commonware_resolver::{p2p, Resolver};
use commonware_runtime::{Clock, Handle, Metrics, Spawner, Storage};
use commonware_storage::{
    cache,
    journal::contiguous::fixed,
    mmr::Proof,
    ordinal::{self, Ordinal},
    qmdb::{any::unordered::variable, keyless},
    rmap::RMap,
};
use commonware_utils::sequence::U64;
use futures::{
    channel::{mpsc, oneshot},
    join, StreamExt,
};
use nullspace_types::{
    api::Summary,
    api::{
        MAX_EVENTS_PROOF_NODES, MAX_EVENTS_PROOF_OPS, MAX_STATE_PROOF_NODES, MAX_STATE_PROOF_OPS,
    },
    execution::{Output, Progress, Value},
    genesis_digest,
};
use prometheus_client::metrics::{counter::Counter, gauge::Gauge, histogram::Histogram};
use rand::RngCore;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::atomic::AtomicU64,
    time::{Duration, SystemTime},
};
use tracing::{debug, error, info, warn};

const BATCH_ENQUEUE: usize = 20;
const RETRY_DELAY: Duration = Duration::from_secs(10);

const PROOFS_ENCODED_BYTES_BUCKETS: [f64; 14] = [
    1_024.0,     // 1KB
    2_048.0,     // 2KB
    4_096.0,     // 4KB
    8_192.0,     // 8KB
    16_384.0,    // 16KB
    32_768.0,    // 32KB
    65_536.0,    // 64KB
    131_072.0,   // 128KB
    262_144.0,   // 256KB
    524_288.0,   // 512KB
    1_048_576.0, // 1MB
    2_097_152.0, // 2MB
    4_194_304.0, // 4MB
    8_388_608.0, // 8MB
];

type AggregationScheme =
    commonware_consensus::aggregation::scheme::bls12381_threshold::Scheme<PublicKey, MinSig>;
type AggregationCertificate = Certificate<AggregationScheme, Digest>;
type AggregationSignature =
    <AggregationScheme as commonware_cryptography::certificate::Scheme>::Certificate;
type StateOp = variable::Operation<Digest, Value>;
type EventOp = keyless::Operation<Output>;

pub struct Proofs {
    pub state_proof: Proof<Digest>,
    pub state_proof_ops: Vec<StateOp>,
    pub events_proof: Proof<Digest>,
    pub events_proof_ops: Vec<EventOp>,
}

impl Write for Proofs {
    fn write(&self, buf: &mut impl BufMut) {
        self.state_proof.write(buf);
        self.state_proof_ops.write(buf);
        self.events_proof.write(buf);
        self.events_proof_ops.write(buf);
    }
}

impl Read for Proofs {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &()) -> Result<Self, commonware_codec::Error> {
        let state_proof = Proof::<Digest>::read_cfg(reader, &MAX_STATE_PROOF_NODES)?;
        let state_proof_ops = Vec::read_range(reader, 0..=MAX_STATE_PROOF_OPS)?;
        let events_proof = Proof::<Digest>::read_cfg(reader, &MAX_EVENTS_PROOF_NODES)?;
        let events_proof_ops = Vec::read_range(reader, 0..=MAX_EVENTS_PROOF_OPS)?;
        Ok(Self {
            state_proof,
            state_proof_ops,
            events_proof,
            events_proof_ops,
        })
    }
}

impl EncodeSize for Proofs {
    fn encode_size(&self) -> usize {
        self.state_proof.encode_size()
            + self.state_proof_ops.encode_size()
            + self.events_proof.encode_size()
            + self.events_proof_ops.encode_size()
    }
}

/// A fixed-size certificate that can be used to store in an ordinal.
pub struct FixedCertificate {
    pub index: Index,
    pub digest: Digest,
    pub signature: AggregationSignature,
}

impl Write for FixedCertificate {
    fn write(&self, buf: &mut impl BufMut) {
        self.index.write(buf);
        self.digest.write(buf);
        self.signature.write(buf);
    }
}

impl Read for FixedCertificate {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &()) -> Result<Self, commonware_codec::Error> {
        let index = Index::read(reader)?;
        let digest = Digest::read(reader)?;
        let signature = AggregationSignature::read(reader)?;
        Ok(Self {
            index,
            digest,
            signature,
        })
    }
}

impl FixedSize for FixedCertificate {
    const SIZE: usize = Index::SIZE + Digest::SIZE + AggregationSignature::SIZE;
}

impl From<AggregationCertificate> for FixedCertificate {
    fn from(certificate: AggregationCertificate) -> Self {
        Self {
            index: certificate.item.index,
            digest: certificate.item.digest,
            signature: certificate.certificate,
        }
    }
}

fn system_time_ms(now: SystemTime) -> i64 {
    match now.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

impl From<FixedCertificate> for AggregationCertificate {
    fn from(fixed_certificate: FixedCertificate) -> Self {
        Self {
            item: Item {
                index: fixed_certificate.index,
                digest: fixed_certificate.digest,
            },
            certificate: fixed_certificate.signature,
        }
    }
}

pub struct Actor<
    R: Storage + Metrics + Clock + Spawner + RngCore + Clone + Send + Sync,
    I: Indexer,
> {
    context: R,
    config: Config<I>,
    inbound: Mailbox,
    mailbox: mpsc::Receiver<Message>,

    waiting: BTreeSet<u64>,
    certificates_processed: Gauge,
}

impl<
        R: Storage + Metrics + Clock + Spawner + RngCore + Clone + Send + Sync,
        I: Indexer,
    > Actor<R, I>
{
    pub fn new(context: R, config: Config<I>) -> (Self, Mailbox) {
        // Create mailbox
        let (sender, mailbox) = mpsc::channel(config.mailbox_size);
        let inbound = Mailbox::new(sender, context.stopped());

        // Create metrics
        let certificates_processed = Gauge::default();
        context.register(
            "certificates_processed",
            "Number of contiguous certificates processed",
            certificates_processed.clone(),
        );

        (
            Self {
                context,
                config,
                inbound: inbound.clone(),
                mailbox,
                waiting: BTreeSet::new(),
                certificates_processed,
            },
            inbound,
        )
    }

    pub fn start(
        self,
        backfill: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
    ) -> Handle<()> {
        let context = self.context.clone();
        context.spawn(move |context| async move {
            let mut actor = self;
            actor.context = context;
            actor.run(backfill).await;
        })
    }

    async fn run(
        mut self,
        backfill: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
    ) {
        // Metrics
        let summary_upload_attempts: Counter<u64, AtomicU64> = Counter::default();
        let summary_upload_failures: Counter<u64, AtomicU64> = Counter::default();
        let summary_uploads_outstanding: Gauge = Gauge::default();
        let summary_upload_lag: Gauge = Gauge::default();
        let summary_upload_last_attempt_ms: Gauge = Gauge::default();
        let aggregation_tip: Gauge = Gauge::default();
        let aggregation_tip_updated_ms: Gauge = Gauge::default();
        self.context.register(
            "summary_upload_attempts_total",
            "Number of attempts to upload summaries to the indexer",
            summary_upload_attempts.clone(),
        );
        self.context.register(
            "summary_upload_failures_total",
            "Number of summary upload failures to the indexer",
            summary_upload_failures.clone(),
        );
        self.context.register(
            "summary_uploads_outstanding",
            "Number of concurrent summary uploads in flight",
            summary_uploads_outstanding.clone(),
        );
        self.context.register(
            "summary_upload_lag",
            "Difference between next upload cursor and last contiguous uploaded summary",
            summary_upload_lag.clone(),
        );
        self.context.register(
            "summary_upload_last_attempt_ms",
            "Unix timestamp (ms) of the last summary upload attempt",
            summary_upload_last_attempt_ms.clone(),
        );
        self.context.register(
            "aggregation_tip",
            "Latest aggregation tip index observed by the aggregator",
            aggregation_tip.clone(),
        );
        self.context.register(
            "aggregation_tip_updated_ms",
            "Unix timestamp (ms) when aggregation_tip was last updated",
            aggregation_tip_updated_ms.clone(),
        );

        // Proof metrics
        let proofs_stored: Counter<u64, AtomicU64> = Counter::default();
        let proofs_stored_bytes: Counter<u64, AtomicU64> = Counter::default();
        let proofs_encoded_size_bytes = Histogram::new(PROOFS_ENCODED_BYTES_BUCKETS.into_iter());
        let proofs_fetch_hits: Counter<u64, AtomicU64> = Counter::default();
        let proofs_fetch_misses: Counter<u64, AtomicU64> = Counter::default();
        let proofs_fetch_errors: Counter<u64, AtomicU64> = Counter::default();
        self.context.register(
            "proofs_stored_total",
            "Number of per-block proof bundles stored in the local cache",
            proofs_stored.clone(),
        );
        self.context.register(
            "proofs_stored_bytes_total",
            "Total encoded bytes of per-block proof bundles stored in the local cache",
            proofs_stored_bytes.clone(),
        );
        self.context.register(
            "proofs_encoded_size_bytes",
            "Histogram of encoded per-block proof bundle sizes (bytes)",
            proofs_encoded_size_bytes.clone(),
        );
        self.context.register(
            "proofs_fetch_hits_total",
            "Number of proof bundle cache reads that returned a value",
            proofs_fetch_hits.clone(),
        );
        self.context.register(
            "proofs_fetch_misses_total",
            "Number of proof bundle cache reads that returned no value (invariant violation)",
            proofs_fetch_misses.clone(),
        );
        self.context.register(
            "proofs_fetch_errors_total",
            "Number of proof bundle cache reads that returned an error",
            proofs_fetch_errors.clone(),
        );

        // Create storage
        let mut cache = match cache::Cache::<_, Proofs>::init(
            self.context.with_label("cache"),
            cache::Config {
                partition: format!("{}-cache", self.config.partition),
                compression: None,
                codec_config: (),
                items_per_blob: self.config.prunable_items_per_blob,
                write_buffer: self.config.write_buffer,
                replay_buffer: self.config.replay_buffer,
                buffer_pool: self.config.buffer_pool.clone(),
            },
        )
        .await
        {
            Ok(cache) => cache,
            Err(err) => {
                error!(?err, "failed to initialize cache");
                return;
            }
        };
        let mut results = match fixed::Journal::init(
            self.context.with_label("results"),
            fixed::Config {
                partition: format!("{}-results", self.config.partition),
                items_per_blob: self.config.persistent_items_per_blob,
                write_buffer: self.config.write_buffer,
                buffer_pool: self.config.buffer_pool,
            },
        )
        .await
        {
            Ok(results) => results,
            Err(err) => {
                error!(?err, "failed to initialize results storage");
                return;
            }
        };
        let mut certificates = match Ordinal::<_, FixedCertificate>::init(
            self.context.with_label("certificates"),
            ordinal::Config {
                partition: format!("{}-certificates", self.config.partition),
                items_per_blob: self.config.persistent_items_per_blob,
                write_buffer: self.config.write_buffer,
                replay_buffer: self.config.replay_buffer,
            },
        )
        .await
        {
            Ok(certificates) => certificates,
            Err(err) => {
                error!(?err, "failed to initialize certificate storage");
                return;
            }
        };

        // Create resolver
        let (resolver_engine, mut resolver) = p2p::Engine::new(
            self.context.with_label("resolver"),
            p2p::Config {
                manager: self.config.supervisor.clone(),
                blocker: self.config.supervisor.clone(),
                consumer: self.inbound.clone(),
                producer: self.inbound.clone(),
                mailbox_size: self.config.mailbox_size,
                me: Some(self.config.public_key.clone()),
                initial: Duration::from_secs(1),
                timeout: Duration::from_secs(2),
                fetch_retry_timeout: Duration::from_secs(10),
                priority_requests: false,
                priority_responses: false,
            },
        );
        resolver_engine.start(backfill);

        // Start by fetching the first missing certificates
        let missing = certificates.missing_items(1, BATCH_ENQUEUE);
        for next in missing {
            self.waiting.insert(next);
            resolver.fetch(next.into()).await;
        }

        // Compute genesis digest
        let genesis_digest = genesis_digest();

        // Track uploads
        let mut uploads_outstanding = 0;
        let mut cursor = cache.first().unwrap_or(1); // start at height 1
        let mut boundary = cursor;
        let mut tracked_uploads = RMap::new();
        info!(cursor, "initial summary cursor");
        summary_uploads_outstanding.set(0);
        summary_upload_lag.set(0);
        summary_upload_last_attempt_ms.set(0);

        // Track pending aggregation work
        let mut proposal_requests: BTreeMap<u64, oneshot::Sender<Digest>> = BTreeMap::new();
        let mut verify_requests: BTreeMap<u64, (Digest, oneshot::Sender<bool>)> = BTreeMap::new();
        loop {
            let Some(message) = self.mailbox.next().await else {
                warn!("mailbox closed");
                break;
            };
            match message {
                Message::Uploaded { index } => {
                    // Decrement uploads outstanding
                    if uploads_outstanding == 0 {
                        warn!(
                            index,
                            "unexpected summary upload completion with no outstanding uploads"
                        );
                    } else {
                        uploads_outstanding -= 1;
                    }
                    summary_uploads_outstanding.set(uploads_outstanding as i64);

                    // Track uploaded index
                    tracked_uploads.insert(index);

                    // Prune proofs up to the uploaded height (contiguous with the boundary)
                    let Some(end_region) = tracked_uploads.next_gap(boundary).0 else {
                        continue;
                    };
                    if end_region > boundary {
                        if let Err(err) = cache.prune(end_region).await {
                            error!(?err, end_region, "failed to prune cache");
                            return;
                        }
                        boundary = end_region;
                        info!(boundary, "updated summary upload marker");
                    }
                    summary_upload_lag.set(cursor.saturating_sub(boundary) as i64);
                }
                Message::Executed {
                    view,
                    height,
                    commitment,
                    result,
                    state_proof,
                    state_proof_ops,
                    events_proof,
                    events_proof_ops,
                    response,
                } => {
                    let proofs = Proofs {
                        state_proof,
                        state_proof_ops,
                        events_proof,
                        events_proof_ops,
                    };
                    let encoded_size = proofs.encode_size();
                    let proofs_stored = proofs_stored.clone();
                    let proofs_stored_bytes = proofs_stored_bytes.clone();
                    let proofs_encoded_size_bytes = proofs_encoded_size_bytes.clone();
                    let cache = &mut cache;

                    // Persist proofs
                    let cache_task = async move {
                        if let Err(err) = cache.put(height, proofs).await {
                            error!(?err, height, "failed to store proofs");
                            return Err(());
                        }
                        if let Err(err) = cache.sync().await {
                            error!(?err, height, "failed to sync proofs");
                            return Err(());
                        }
                        proofs_stored.inc();
                        proofs_stored_bytes.inc_by(encoded_size as u64);
                        proofs_encoded_size_bytes.observe(encoded_size as f64);
                        Ok(())
                    };

                    // Persist progress
                    let result = Progress::new(
                        view,
                        height,
                        commitment,
                        result.state_root,
                        result.state_start_op,
                        result.state_end_op,
                        result.events_root,
                        result.events_start_op,
                        result.events_end_op,
                    );
                    let result_digest = result.digest();
                    let progress_task = async {
                        // Size is the next item to store and the height-th value will be stored at height - 1,
                        // so comparing size() to height is equivalent to checking if the next item stored will be
                        // at height + 1 (i.e. this height has already been processed).
                        let size = results.size();
                        if size == height {
                            warn!(height, "already processed results");
                            return Ok(());
                        }
                        if let Err(err) = results.append(result).await {
                            error!(?err, height, "failed to append result");
                            return Err(());
                        }
                        if let Err(err) = results.sync().await {
                            error!(?err, height, "failed to sync results");
                            return Err(());
                        }
                        Ok(())
                    };
                    let (cache_res, progress_res) = join!(cache_task, progress_task);
                    if cache_res.is_err() || progress_res.is_err() {
                        return;
                    }
                    info!(
                        height,
                        view = view.get(),
                        ?result.state_root,
                        result.state_start_op,
                        result.state_end_op,
                        ?result.events_root,
                        result.events_start_op,
                        result.events_end_op,
                        ?result_digest,
                        "processed block"
                    );

                    // Check if we should clear aggregation requests
                    if let Some(request) = proposal_requests.remove(&height) {
                        debug!(height, view = view.get(), "backfilled aggregation proposal");
                        let _ = request.send(result_digest);
                    }
                    proposal_requests.retain(|index, _| *index > height);
                    if let Some((payload, request)) = verify_requests.remove(&height) {
                        debug!(height, view = view.get(), "backfilled aggregation verify");
                        let _ = request.send(result_digest == payload);
                    }
                    verify_requests.retain(|index, _| *index > height);

                    // Continue processing blocks
                    let _ = response.send(());
                }
                Message::Genesis { response } => {
                    let _ = response.send(genesis_digest);
                }
                Message::Propose { index, response } => {
                    // Fetch item from progress
                    if index == 0 {
                        let _ = response.send(genesis_digest);
                        continue;
                    }
                    let item = index - 1;
                    if let Ok(result) = results.read(item).await {
                        let _ = response.send(result.digest());
                        continue;
                    };

                    // This height may not yet be stored, so we'll wait for it to occur
                    proposal_requests.insert(index, response);
                }
                Message::Verify {
                    index,
                    payload,
                    response,
                } => {
                    if index == 0 {
                        let _ = response.send(genesis_digest == payload);
                        continue;
                    }
                    let item = index - 1;
                    if let Ok(result) = results.read(item).await {
                        let _ = response.send(result.digest() == payload);
                        continue;
                    };

                    // This height may not yet be stored, so we'll wait for it to occur
                    verify_requests.insert(index, (payload, response));
                }
                Message::Certified { certificate } => {
                    self.waiting.remove(&certificate.item.index);

                    let height = certificate.item.index;
                    if height == 0 {
                        continue;
                    }

                    // Skip if already processed
                    if certificates.has(height) {
                        debug!(height, "already processed");
                        continue;
                    }
                    info!(
                        height = certificate.item.index,
                        digest = ?certificate.item.digest,
                        "certified block"
                    );

                    // Store in certificates
                    if let Err(err) = certificates.put(height, certificate.clone().into()).await {
                        error!(?err, height, "failed to store certificate");
                        return;
                    }
                    if let Err(err) = certificates.sync().await {
                        error!(?err, height, "failed to sync certificates");
                        return;
                    }

                    // Cancel resolver
                    if let Some(current_end) = certificates.next_gap(1).0 {
                        self.certificates_processed.set(current_end as i64);
                        let current_end = U64::from(current_end);
                        resolver.retain(move |x| x > &current_end).await;
                    }

                    // Enqueue missing seeds
                    let missing = certificates.missing_items(1, BATCH_ENQUEUE);
                    for next in missing {
                        if !self.waiting.insert(next) {
                            continue;
                        }
                        resolver.fetch(next.into()).await;
                    }
                }
                Message::Tip { index: tip } => {
                    debug!(tip, "new aggregation tip");
                    aggregation_tip.set(tip as i64);
                    aggregation_tip_updated_ms.set(system_time_ms(self.context.current()));
                }
                Message::Deliver {
                    index,
                    certificate,
                    response,
                } => {
                    // Decode certificate
                    let Ok(certificate) =
                        AggregationCertificate::decode(&mut certificate.as_ref())
                    else {
                        let _ = response.send(false);
                        continue;
                    };
                    if certificate.item.index != index {
                        let _ = response.send(false);
                        continue;
                    }

                    // Verify certificate
                    let scheme =
                        AggregationScheme::certificate_verifier(self.config.identity);
                    let verified = {
                        let mut rng = rand::thread_rng();
                        certificate.verify(&mut rng, &scheme, &self.config.namespace)
                    };
                    if !verified {
                        let _ = response.send(false);
                        continue;
                    }

                    // Store in certificates
                    self.waiting.remove(&index);
                    if let Err(err) = certificates.put(index, certificate.clone().into()).await {
                        error!(?err, index, "failed to store certificate");
                        return;
                    }
                    if let Err(err) = certificates.sync().await {
                        error!(?err, index, "failed to sync certificates");
                        return;
                    }

                    // Enqueue missing seeds
                    let missing = certificates.missing_items(1, BATCH_ENQUEUE);
                    for next in missing {
                        if !self.waiting.insert(next) {
                            continue;
                        }
                        resolver.fetch(next.into()).await;
                    }

                    let _ = response.send(true);
                }
                Message::Produce { index, response } => {
                    // Fetch item from certificates
                    let Ok(Some(fixed_certificate)) = certificates.get(index).await else {
                        continue;
                    };
                    let certificate: AggregationCertificate = fixed_certificate.into();
                    let _ = response.send(certificate.encode().into());
                }
            }

            // Attempt to upload any certificates
            //
            // We only delete entires in the cache when they cross the section boundary,
            // so we may re-upload the same height again on restart.
            while uploads_outstanding < self.config.max_uploads_outstanding {
                // Get next certificate
                if !cache.has(cursor) || !certificates.has(cursor) {
                    break;
                }

                // Increment uploads outstanding
                uploads_outstanding += 1;
                summary_uploads_outstanding.set(uploads_outstanding as i64);
                summary_upload_last_attempt_ms.set(system_time_ms(self.context.current()));

                // Get certificate
                let certificate = match certificates.get(cursor).await {
                    Ok(Some(certificate)) => certificate,
                    Ok(None) => {
                        error!(cursor, "certificate missing");
                        return;
                    }
                    Err(err) => {
                        error!(?err, cursor, "failed to fetch certificate");
                        return;
                    }
                };

                // Get result
                let result = match results.read(cursor - 1).await {
                    Ok(result) => result,
                    Err(err) => {
                        error!(?err, cursor, "failed to fetch result");
                        return;
                    }
                };

                // Get proofs
                let proofs = match cache.get(cursor).await {
                    Ok(Some(proofs)) => {
                        proofs_fetch_hits.inc();
                        proofs
                    }
                    Ok(None) => {
                        proofs_fetch_misses.inc();
                        error!(cursor, "proofs missing");
                        return;
                    }
                    Err(err) => {
                        proofs_fetch_errors.inc();
                        error!(?err, cursor, "failed to fetch proofs");
                        return;
                    }
                };

                // Upload the summary to the indexer
                let summary = Summary {
                    progress: result,
                    certificate: certificate.into(),
                    state_proof: proofs.state_proof,
                    state_proof_ops: proofs.state_proof_ops,
                    events_proof: proofs.events_proof,
                    events_proof_ops: proofs.events_proof_ops,
                };
                self.context.with_label("summary_submit").spawn({
                    let indexer = self.config.indexer.clone();
                    let mut channel = self.inbound.clone();
                    let summary_upload_attempts = summary_upload_attempts.clone();
                    let summary_upload_failures = summary_upload_failures.clone();
                    move |mut context| async move {
                        let mut attempts = 0u64;
                        let mut backoff = Duration::from_millis(200);
                        loop {
                            attempts = attempts.saturating_add(1);
                            summary_upload_attempts.inc();
                            match indexer.submit_summary(summary.clone()).await {
                                Ok(()) => break,
                                Err(e) => {
                                    summary_upload_failures.inc();
                                    warn!(?e, cursor, attempts, "failed to upload summary");
                                    let delay = jittered_backoff(&mut context, backoff);
                                    context.sleep(delay).await;
                                    backoff = backoff.saturating_mul(2).min(RETRY_DELAY);
                                }
                            }
                        }
                        debug!(cursor, attempts, "summary uploaded to indexer");
                        channel.uploaded(cursor).await;
                    }
                });

                // Increment cursor
                cursor += 1;
                summary_upload_lag.set(cursor.saturating_sub(boundary) as i64);
            }
        }
    }
}
