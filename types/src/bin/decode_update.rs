use bytes::Buf;
use commonware_codec::{EncodeSize, ReadExt};
use commonware_utils::from_hex_formatted;
use nullspace_types::api::Update;
use std::env;

fn main() {
    let hex = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: decode_update <hex>");
        std::process::exit(1);
    });

    let bytes = match from_hex_formatted(hex.trim()) {
        Some(bytes) => bytes,
        None => {
            eprintln!("invalid hex string");
            std::process::exit(1);
        }
    };

    let mut buf = bytes.as_slice();
    let start_remaining = buf.remaining();

    let update = match Update::read(&mut buf) {
        Ok(update) => update,
        Err(err) => {
            eprintln!("decode error: {err}");
            std::process::exit(1);
        }
    };

    let end_remaining = buf.remaining();
    println!("decoded update: {} bytes consumed", start_remaining - end_remaining);
    println!("remaining bytes: {end_remaining}");

    match update {
        Update::Events(events) => {
            println!("kind: Events");
            println!("progress: view={}, height={}", events.progress.view.get(), events.progress.height);
            println!("progress size: {}", events.progress.encode_size());
            println!("certificate size: {}", events.certificate.encode_size());
            println!("certificate item index: {}", events.certificate.item.index);
            println!("events proof size: {}", events.events_proof.encode_size());
            println!("events proof digests: {}", events.events_proof.digests.len());
            println!("events proof mmr size: {}", events.events_proof.size.as_u64());
            println!("events ops len: {}", events.events_proof_ops.len());
            println!("events ops size: {}", events.events_proof_ops.encode_size());
            println!(
                "total expected size (tag+parts): {}",
                1 + events.progress.encode_size()
                    + events.certificate.encode_size()
                    + events.events_proof.encode_size()
                    + events.events_proof_ops.encode_size()
            );
        }
        Update::FilteredEvents(events) => {
            println!("kind: FilteredEvents");
            println!("progress: view={}, height={}", events.progress.view.get(), events.progress.height);
            println!("progress size: {}", events.progress.encode_size());
            println!("certificate size: {}", events.certificate.encode_size());
            println!("certificate item index: {}", events.certificate.item.index);
            println!("events proof size: {}", events.events_proof.encode_size());
            println!("events proof digests: {}", events.events_proof.digests.len());
            println!("events proof mmr size: {}", events.events_proof.size.as_u64());
            println!("events ops len: {}", events.events_proof_ops.len());
            println!("events ops size: {}", events.events_proof_ops.encode_size());
            println!(
                "total expected size (tag+parts): {}",
                1 + events.progress.encode_size()
                    + events.certificate.encode_size()
                    + events.events_proof.encode_size()
                    + events.events_proof_ops.encode_size()
            );
        }
        Update::Seed(_) => {
            println!("kind: Seed");
        }
    }
}
