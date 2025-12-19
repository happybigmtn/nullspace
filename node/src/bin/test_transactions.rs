//! Test transaction submission to the consensus network
//!
//! Usage: cargo run --bin test-transactions -- --url http://localhost:8080 --count 5

use clap::Parser;
use commonware_codec::Encode;
use commonware_cryptography::{ed25519::PrivateKey, PrivateKeyExt, Signer};
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction},
};
use reqwest::Client;
use std::time::Duration;

#[derive(Parser, Debug)]
#[command(name = "test-transactions")]
#[command(about = "Submit test transactions to the consensus network")]
struct Args {
    /// Simulator/indexer URL
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    /// Number of test transactions to submit
    #[arg(short, long, default_value_t = 5)]
    count: u32,

    /// Base seed for generating test keys
    #[arg(short, long, default_value_t = 1000)]
    seed: u64,

    /// Delay between transactions in milliseconds
    #[arg(short, long, default_value_t = 100)]
    delay_ms: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let client = Client::new();

    println!("Testing transaction submission");
    println!("  URL: {}", args.url);
    println!("  Transactions: {}", args.count);
    println!();

    // First, check health
    let health_url = format!("{}/healthz", args.url);
    let resp = client.get(&health_url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("Health check failed: {}", resp.status());
    }
    println!("Health check passed");

    // Submit transactions
    let submit_url = format!("{}/submit", args.url);
    let mut successful = 0;
    let mut failed = 0;

    for i in 0..args.count {
        // Generate a unique signer for each transaction
        let signer = PrivateKey::from_seed(args.seed + i as u64);
        let public_key = signer.public_key();

        // Create a casino registration transaction
        let tx = Transaction::sign(
            &signer,
            0, // nonce
            Instruction::CasinoRegister {
                name: format!("TestPlayer{}", i),
            },
        );

        // Encode as Submission::Transactions
        let submission = Submission::Transactions(vec![tx]);
        let encoded = submission.encode().to_vec();

        // Submit
        let resp = client
            .post(&submit_url)
            .body(encoded)
            .header("Content-Type", "application/octet-stream")
            .send()
            .await?;

        if resp.status().is_success() {
            println!(
                "  [{}] Submitted CasinoRegister for TestPlayer{} (pubkey: {}...)",
                i,
                i,
                &commonware_utils::hex(&public_key.encode())[..16]
            );
            successful += 1;
        } else {
            println!(
                "  [{}] Failed to submit: {} - {}",
                i,
                resp.status(),
                resp.text().await.unwrap_or_default()
            );
            failed += 1;
        }

        // Small delay between transactions
        if args.delay_ms > 0 && i < args.count - 1 {
            tokio::time::sleep(Duration::from_millis(args.delay_ms)).await;
        }
    }

    println!();
    println!("=== Results ===");
    println!("  Successful: {}", successful);
    println!("  Failed: {}", failed);

    // Now let's submit some more diverse transactions
    println!();
    println!("Submitting additional transaction types...");

    // Create a player and do deposit + game
    let player_signer = PrivateKey::from_seed(args.seed + 100);
    let player_pub = player_signer.public_key();

    // 1. Register
    let register_tx = Transaction::sign(
        &player_signer,
        0,
        Instruction::CasinoRegister {
            name: "CasinoTestPlayer".to_string(),
        },
    );

    // 2. Deposit chips
    let deposit_tx = Transaction::sign(
        &player_signer,
        1,
        Instruction::CasinoDeposit { amount: 10000 },
    );

    // Submit both
    let batch = Submission::Transactions(vec![register_tx, deposit_tx]);
    let encoded = batch.encode().to_vec();

    let resp = client
        .post(&submit_url)
        .body(encoded)
        .header("Content-Type", "application/octet-stream")
        .send()
        .await?;

    if resp.status().is_success() {
        println!(
            "  Submitted Register + Deposit batch for CasinoTestPlayer (pubkey: {}...)",
            &commonware_utils::hex(&player_pub.encode())[..16]
        );
    } else {
        println!(
            "  Failed to submit batch: {} - {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        );
    }

    println!();
    println!("Transaction submission test complete!");
    println!("Check the network logs for block finalization.");

    Ok(())
}
