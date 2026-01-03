# E04 - Consensus pipeline + seeding (from scratch)

Focus files: `node/src/aggregator/actor.rs`, `node/src/seeder/actor.rs`

Goal: explain how aggregation and seeding actors manage consensus data, proofs, and backfill. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Aggregation
The aggregator gathers signatures and proofs to build certificates. These certificates prove that a block or event was agreed upon.

### 2) Seeding
Seeding distributes randomness (seeds) that the execution engine uses for deterministic RNG. Seeds must be fetched and shared reliably.

### 3) Backfill + retry
Both actors need retry loops because network traffic is lossy and asynchronous.

---

## Limits & management callouts (important)

1) **Proof sizes are explicitly bounded**
- Proof decoding uses constants like `MAX_STATE_PROOF_NODES` and `MAX_EVENTS_PROOF_NODES`.
- If these are too small, valid proofs will be rejected.

2) **Batch sizes and retry delays are fixed**
- Both actors use `BATCH_ENQUEUE = 20` and `RETRY_DELAY = 10s`.
- If the network is large, these may need tuning.

---

## Walkthrough with code excerpts

### 1) Proof encoding limits (aggregator)
```rust
pub struct Proofs {
    pub state_proof: Proof<Digest>,
    pub state_proof_ops: Vec<StateOp>,
    pub events_proof: Proof<Digest>,
    pub events_proof_ops: Vec<EventOp>,
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
```

Why this matters:
- Proof size limits protect the node from oversized or malicious data.

What this code does:
- Defines the proof payload for state and events.
- Decodes proofs with explicit upper bounds.

---

### 2) Seeder storage + resolver initialization
```rust
let mut metadata = match Metadata::<_, U64, u64>::init(
    self.context.with_label("metadata"),
    metadata::Config {
        partition: format!("{}-metadata", self.config.partition_prefix),
        codec_config: (),
    },
)
.await
{
    Ok(metadata) => metadata,
    Err(err) => {
        error!(?err, "failed to initialize metadata");
        return;
    }
};

let mut storage = match Ordinal::init(
    self.context.with_label("seeder"),
    ordinal::Config {
        partition: format!("{}-storage", self.config.partition_prefix),
        items_per_blob: self.config.items_per_blob,
        write_buffer: self.config.write_buffer,
        replay_buffer: self.config.replay_buffer,
    },
)
.await
{
    Ok(storage) => storage,
    Err(err) => {
        error!(?err, "failed to initialize seeder storage");
        return;
    }
};
```

Why this matters:
- Seeds must be persisted and replayable, not just stored in RAM.

What this code does:
- Initializes metadata storage for seeding state.
- Initializes an ordinal store for seed blobs.

---

### 3) Resolver engine for fetching missing data
```rust
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
        fetch_retry_timeout: Duration::from_millis(100),
        priority_requests: false,
        priority_responses: false,
    },
);
resolver_engine.start(backfill);
```

Why this matters:
- Missing seeds must be fetched from peers to keep RNG consistent.

What this code does:
- Starts a resolver engine with retry and timeout settings.
- Connects it to the backfill channel.

---

## Key takeaways
- Aggregators bound proof sizes for safety.
- Seeders persist and fetch random seeds to keep RNG consistent.
- Retry/batch constants are important tuning knobs.

## Next lesson
E05 - Storage, proofs, and persistence: `feynman/lessons/E05-storage-persistence.md`
