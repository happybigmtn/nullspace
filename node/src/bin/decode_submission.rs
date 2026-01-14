use std::{env, fs, io::Read, path::PathBuf};

use commonware_codec::{DecodeExt, ReadExt};
use commonware_cryptography::Digestible;
use hex::FromHex;
use nullspace_types::{api::Submission, Identity};

fn main() -> anyhow::Result<()> {
    let path: PathBuf = env::args()
        .nth(1)
        .map(Into::into)
        .unwrap_or_else(|| "/tmp/sub.body".into());

    let mut data = Vec::new();
    fs::File::open(&path)?.read_to_end(&mut data)?;
    // Submission implements `Decode` with `Cfg = ()`, so the `decode` helper works on any Buf.
    let submission: Submission = Submission::decode(&data[..]).map_err(|e| anyhow::anyhow!(e))?;

    match submission {
        Submission::Seed(seed) => {
            println!("type: Seed");
            println!("{:#?}", seed);
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
            if let Ok(hex_id) = env::var("ID") {
                let id_bytes = <Vec<u8>>::from_hex(hex_id.trim()).expect("bad hex ID");
                let mut buf = &id_bytes[..];
                let id = Identity::read(&mut buf).expect("decode identity");
                println!("verify with ID: {}", hex::encode(id_bytes));
                println!("progress digest: {}", hex::encode(summary.progress.digest().as_ref()));
                println!("cert digest: {}", hex::encode(summary.certificate.item.digest.as_ref()));
                match summary.verify(&id) {
                    Ok(_) => println!("summary verifies ✅"),
                    Err(e) => println!("summary verify failed: {e:?}"),
                }
            }
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
