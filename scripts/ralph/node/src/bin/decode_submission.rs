use std::{env, fs, io::Read, path::PathBuf};

use commonware_codec::DecodeExt;
use nullspace_types::api::Submission;

fn main() -> anyhow::Result<()> {
    let path: PathBuf = env::args()
        .nth(1)
        .map(Into::into)
        .unwrap_or_else(|| "/tmp/sub.body".into());

    let mut data = Vec::new();
    fs::File::open(&path)?.read_to_end(&mut data)?;
    let mut slice = &data[..];
    let submission: Submission = slice.read().map_err(|e| anyhow::anyhow!(e))?;

    match submission {
        Submission::Seed(seed) => {
            println!("type: Seed");
            println!("view: {}", seed.view());
            println!("cert public keys: {}", seed.certificates().len());
        }
        Submission::Summary(summary) => {
            println!("type: Summary");
            println!("view: {}", summary.progress.view.get());
            println!("height: {}", summary.progress.height);
            println!(
                "state_ops: {} events_ops: {}",
                summary.state_proof_ops.len(),
                summary.events_proof_ops.len()
            );
            println!(
                "cert signers: {}",
                summary.progress_certificate.public_keys().len()
            );
        }
        Submission::Transactions(txs) => {
            println!("type: Transactions");
            println!("txs: {}", txs.len());
            if let Some(first) = txs.first() {
                println!("first nonce: {}", first.nonce);
            }
        }
    }

    Ok(())
}
