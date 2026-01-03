# L48 - Explorer persistence worker (from scratch)

Focus file: `simulator/src/explorer_persistence.rs`

Goal: explain how explorer data is persisted to SQLite/Postgres, how retention is enforced, and how backpressure is handled. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Explorer persistence
Explorer data is derived from the chain. Persisting it allows restarts without losing history.

### 2) Backpressure
Persistence runs in the background. If the queue is full, the system either blocks or drops updates.

### 3) Private database enforcement
For safety, Postgres must be on a private network unless explicitly overridden.

---

## Limits & management callouts (important)

1) **Backpressure policy matters**
- `ExplorerPersistenceBackpressure::Block` can stall indexing if the DB is slow.
- `Drop` avoids stalls but loses explorer data.

2) **Retention uses max blocks**
- `max_blocks` prunes old explorer data.
- If set too low, historical queries will be missing.

3) **Public Postgres is blocked by default**
- You must set `EXPLORER_PERSISTENCE_ALLOW_PUBLIC=1` to allow public hosts.

---

## Walkthrough with code excerpts

### 1) Enforcing private Postgres
```rust
fn validate_postgres_url(url: &str) -> anyhow::Result<()> {
    if allow_public_postgres() {
        return Ok(());
    }

    let parsed = Url::parse(url).context("parse postgres url")?;
    let scheme = parsed.scheme();
    if scheme != "postgres" && scheme != "postgresql" {
        bail!("postgres url must start with postgres:// or postgresql://");
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("postgres url missing host"))?;
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Ok(());
        }
        bail!("postgres host is public; set EXPLORER_PERSISTENCE_ALLOW_PUBLIC=1 to override");
    }

    if allow_postgres_hostname() {
        return Ok(());
    }

    bail!("postgres host must be a private IP; set EXPLORER_PERSISTENCE_ALLOW_HOSTNAME=1 to allow hostnames");
}
```

Why this matters:
- Explorer persistence should not be reachable on the public internet by default.

What this code does:
- Validates the URL scheme.
- Rejects public IPs unless explicitly allowed.
- Allows private IPs and localhost by default.

---

### 2) Persisting blocks with backpressure
```rust
pub async fn persist_block(
    &self,
    progress: Progress,
    ops: Vec<keyless::Operation<Output>>,
    indexed_at_ms: u64,
) {
    let request = PersistRequest::Block(PersistedBlock {
        progress,
        ops,
        indexed_at_ms,
    });
    match self.sender.try_send(request) {
        Ok(()) => {
            self.metrics.inc_queue_depth();
        }
        Err(mpsc::error::TrySendError::Full(request)) => {
            self.metrics.inc_queue_backpressure();
            match self.backpressure {
                ExplorerPersistenceBackpressure::Block => match self.sender.send(request).await {
                    Ok(()) => self.metrics.inc_queue_depth(),
                    Err(err) => {
                        self.metrics.inc_queue_dropped();
                        warn!("Failed to enqueue explorer persistence update: {err}");
                    }
                },
                ExplorerPersistenceBackpressure::Drop => {
                    self.metrics.inc_queue_dropped();
                    warn!(
                        "Dropping explorer persistence update due to backpressure (buffer full)"
                    );
                }
            }
        }
        Err(mpsc::error::TrySendError::Closed(_)) => {
            self.metrics.inc_queue_dropped();
            warn!("Explorer persistence channel closed");
        }
    }
}
```

Why this matters:
- This is where the system decides to block or drop when persistence falls behind.

What this code does:
- Tries to enqueue a persistence request without blocking.
- If the queue is full, either blocks or drops based on the configured policy.
- Tracks metrics for depth, backpressure, and drops.

---

### 3) Loading persisted data into memory
```rust
fn load_into_sqlite(
    conn: &Connection,
    explorer: &mut ExplorerState,
    max_blocks: Option<usize>,
    metrics: &ExplorerMetrics,
) -> anyhow::Result<()> {
    let query = if max_blocks.is_some() {
        "SELECT height, progress, indexed_at_ms FROM explorer_blocks ORDER BY height DESC LIMIT ?"
    } else {
        "SELECT height, progress, indexed_at_ms FROM explorer_blocks ORDER BY height ASC"
    };
    let mut stmt = conn.prepare(query)?;
    let rows = if let Some(limit) = max_blocks {
        stmt.query_map([limit as u64], map_row)?
    } else {
        stmt.query_map([], map_row)?
    };

    let mut blocks = Vec::new();
    for row in rows {
        let (height, progress_bytes, indexed_at_ms) = row?;
        let progress = Progress::decode(&mut progress_bytes.as_slice())
            .context("decode progress for explorer persistence")?;
        let ops = load_ops_sqlite(conn, height)?;
        blocks.push(PersistedBlock { progress, ops, indexed_at_ms });
    }

    if max_blocks.is_some() {
        blocks.sort_by_key(|block| block.progress.height);
    }

    for block in blocks {
        apply_block_indexing(
            explorer,
            &block.progress,
            &block.ops,
            block.indexed_at_ms,
            metrics,
        );
    }

    Ok(())
}
```

Why this matters:
- On startup, explorer state must be rebuilt from disk.

What this code does:
- Reads persisted blocks from SQLite.
- Reconstructs in-memory explorer state by replaying indexed blocks.

---

## Key takeaways
- Explorer persistence is optional but crucial for multi-node setups.
- Backpressure policy controls correctness vs availability tradeoffs.
- Postgres URLs are validated to avoid public exposure.

## Next lesson
L49 - Simulator passkey dev endpoints: `feynman/lessons/L49-simulator-passkeys.md`
