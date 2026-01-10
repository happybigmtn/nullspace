use commonware_codec::{Encode, ReadExt};
use commonware_utils::{from_hex_formatted, hex};
use nullspace_types::api::Pending;
use std::env;

fn main() {
    let hex_str = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: decode_pending <hex>");
        std::process::exit(1);
    });

    let bytes = match from_hex_formatted(hex_str.trim()) {
        Some(bytes) => bytes,
        None => {
            eprintln!("invalid hex string");
            std::process::exit(1);
        }
    };

    let mut buf = bytes.as_slice();
    let pending = match Pending::read(&mut buf) {
        Ok(pending) => pending,
        Err(err) => {
            eprintln!("decode error: {err}");
            std::process::exit(1);
        }
    };

    println!("transactions: {}", pending.transactions.len());
    for (idx, tx) in pending.transactions.iter().enumerate() {
        println!(
            "tx[{idx}] nonce={} public={} instruction={:?}",
            tx.nonce,
            hex(&tx.public.encode()),
            tx.instruction
        );
    }
    println!("remaining bytes: {}", buf.len());
}
