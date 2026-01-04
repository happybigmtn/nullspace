use anyhow::Context;
use commonware_codec::DecodeExt;
use nullspace_types::api::Summary;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;
use tracing::{error, warn};

enum PersistRequest {
    Summary(Summary),
}

pub struct SummaryPersistence {
    sender: mpsc::Sender<PersistRequest>,
}

impl SummaryPersistence {
    pub fn load_and_start_sqlite(
        path: &Path,
        max_blocks: Option<usize>,
        buffer_size: usize,
    ) -> anyhow::Result<(Self, Vec<Summary>)> {
        let conn = Connection::open(path).context("open summary persistence db")?;
        init_schema_sqlite(&conn)?;

        let summaries = load_summaries_sqlite(&conn, max_blocks)?;
        drop(conn);

        let (sender, receiver) = mpsc::channel(buffer_size.max(1));
        let path = path.to_path_buf();
        std::thread::spawn(move || {
            persistence_worker(path, receiver);
        });

        Ok((Self { sender }, summaries))
    }

    pub async fn persist_summary(&self, summary: Summary) {
        let request = PersistRequest::Summary(summary);
        if let Err(mpsc::error::TrySendError::Full(_)) = self.sender.try_send(request) {
            warn!("Summary persistence channel full; dropping summary (will be recovered on next boot if nodes still have it)");
        }
    }
}

fn init_schema_sqlite(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS summaries (
             height INTEGER PRIMARY KEY,
             summary_bytes BLOB NOT NULL
         );",
    )
    .context("init summary persistence schema")?;
    Ok(())
}

fn load_summaries_sqlite(
    conn: &Connection,
    max_blocks: Option<usize>,
) -> anyhow::Result<Vec<Summary>> {
    let query = if let Some(limit) = max_blocks {
        format!(
            "SELECT summary_bytes FROM summaries ORDER BY height DESC LIMIT {}",
            limit
        )
    } else {
        "SELECT summary_bytes FROM summaries ORDER BY height ASC".to_string()
    };
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], |row| row.get::<_, Vec<u8>>(0))?;

    let mut summaries = Vec::new();
    for row in rows {
        let bytes = row?;
        let summary = Summary::decode(&mut bytes.as_slice())
            .context("decode summary for persistence")?;
        summaries.push(summary);
    }

    if max_blocks.is_some() {
        summaries.sort_by_key(|s| s.progress.height);
    }

    Ok(summaries)
}

fn persistence_worker(path: PathBuf, mut receiver: mpsc::Receiver<PersistRequest>) {
    let conn = match Connection::open(&path) {
        Ok(conn) => conn,
        Err(err) => {
            error!("Summary persistence open failed: {err}");
            return;
        }
    };

    if let Err(err) = init_schema_sqlite(&conn) {
        error!("Summary persistence init failed: {err}");
        return;
    }

    while let Some(request) = receiver.blocking_recv() {
        let PersistRequest::Summary(summary) = request;
        let bytes = commonware_codec::Encode::encode(&summary).to_vec();
        if let Err(err) = conn.execute(
            "INSERT OR REPLACE INTO summaries (height, summary_bytes) VALUES (?, ?)",
            params![summary.progress.height, bytes],
        ) {
            error!("Summary persistence write failed: {err}");
        }
    }
}
