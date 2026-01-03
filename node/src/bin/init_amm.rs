//! Initialize the AMM pool with initial liquidity
//!
//! Usage: cargo run --bin init-amm -- --url http://localhost:8080
//!
//! This script:
//! 1. Registers a "LiquidityProvider" account
//! 2. Deposits chips via faucet
//! 3. Creates a vault and borrows vUSDT
//! 4. Adds liquidity to the AMM pool

use clap::Parser;
use commonware_codec::Encode;
use commonware_cryptography::{ed25519::PrivateKey, Signer};
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction},
};
use reqwest::Client;
use std::time::Duration;

/// Seed for the LP provider account (fixed for reproducibility)
const LP_PROVIDER_SEED: u64 = 0xABCDEF123456;

/// Initial amounts for AMM seeding
const INITIAL_RNG_AMOUNT: u64 = 100_000;
const INITIAL_VUSDT_AMOUNT: u64 = 100_000;
const FAUCET_AMOUNT: u64 = 500_000; // Enough for collateral + liquidity
const MAX_LTV_BPS: u64 = 3_000;

#[derive(Parser, Debug)]
#[command(name = "init-amm")]
#[command(about = "Initialize AMM pool with liquidity")]
struct Args {
    /// Simulator/indexer URL
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,
}

async fn submit_transactions(
    client: &Client,
    url: &str,
    txs: Vec<Transaction>,
    label: &str,
) -> anyhow::Result<()> {
    let submission = Submission::Transactions(txs);
    let encoded = submission.encode().to_vec();

    let resp = client
        .post(format!("{}/submit", url))
        .body(encoded)
        .header("Content-Type", "application/octet-stream")
        .send()
        .await?;

    if resp.status().is_success() {
        println!("  ✓ {}", label);
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to submit {}: {} - {}", label, status, text)
    }
}

async fn wait_for_block(client: &Client, url: &str) -> anyhow::Result<()> {
    // Wait for the transaction to be included in a block
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify health
    let resp = client.get(format!("{}/healthz", url)).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("Health check failed after transaction");
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let client = Client::new();

    println!("Initializing AMM Pool");
    println!("  URL: {}", args.url);
    println!();

    // Check health first
    let health_url = format!("{}/healthz", args.url);
    let resp = client.get(&health_url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("Health check failed: {}", resp.status());
    }
    println!("✓ Network is healthy");
    println!();

    // Create LP provider signer with fixed seed
    let lp_signer = PrivateKey::from_seed(LP_PROVIDER_SEED);
    let lp_public = lp_signer.public_key();
    println!(
        "LP Provider: {}...",
        &commonware_utils::hex(&lp_public.encode())[..16]
    );
    println!();

    // Step 1: Register LP provider
    println!("Step 1: Register LP provider account");
    let tx_register = Transaction::sign(
        &lp_signer,
        0,
        Instruction::CasinoRegister {
            name: "LiquidityProvider".to_string(),
        },
    );
    submit_transactions(&client, &args.url, vec![tx_register], "Registered LiquidityProvider").await?;
    wait_for_block(&client, &args.url).await?;

    // Step 2: Deposit chips via faucet
    println!("Step 2: Deposit chips via faucet");
    let tx_deposit = Transaction::sign(
        &lp_signer,
        1,
        Instruction::CasinoDeposit { amount: FAUCET_AMOUNT },
    );
    submit_transactions(&client, &args.url, vec![tx_deposit], &format!("Deposited {} chips", FAUCET_AMOUNT)).await?;
    wait_for_block(&client, &args.url).await?;

    // Step 3: Create vault
    println!("Step 3: Create vault for borrowing vUSDT");
    let tx_create_vault = Transaction::sign(&lp_signer, 2, Instruction::CreateVault);
    submit_transactions(&client, &args.url, vec![tx_create_vault], "Created vault").await?;
    wait_for_block(&client, &args.url).await?;

    // Step 4: Deposit collateral (default 30% LTV for new accounts)
    let collateral_amount =
        (INITIAL_VUSDT_AMOUNT * 10_000 + MAX_LTV_BPS - 1) / MAX_LTV_BPS;
    println!("Step 4: Deposit {} RNG as collateral", collateral_amount);
    let tx_deposit_collateral = Transaction::sign(
        &lp_signer,
        3,
        Instruction::DepositCollateral { amount: collateral_amount },
    );
    submit_transactions(&client, &args.url, vec![tx_deposit_collateral], &format!("Deposited {} collateral", collateral_amount)).await?;
    wait_for_block(&client, &args.url).await?;

    // Step 5: Borrow vUSDT
    println!("Step 5: Borrow {} vUSDT", INITIAL_VUSDT_AMOUNT);
    let tx_borrow = Transaction::sign(
        &lp_signer,
        4,
        Instruction::BorrowUSDT { amount: INITIAL_VUSDT_AMOUNT },
    );
    submit_transactions(&client, &args.url, vec![tx_borrow], &format!("Borrowed {} vUSDT", INITIAL_VUSDT_AMOUNT)).await?;
    wait_for_block(&client, &args.url).await?;

    // Step 6: Add liquidity to AMM
    println!("Step 6: Add liquidity ({} RNG + {} vUSDT)", INITIAL_RNG_AMOUNT, INITIAL_VUSDT_AMOUNT);
    let tx_add_liquidity = Transaction::sign(
        &lp_signer,
        5,
        Instruction::AddLiquidity {
            rng_amount: INITIAL_RNG_AMOUNT,
            usdt_amount: INITIAL_VUSDT_AMOUNT,
        },
    );
    submit_transactions(&client, &args.url, vec![tx_add_liquidity], &format!("Added liquidity: {} RNG + {} vUSDT", INITIAL_RNG_AMOUNT, INITIAL_VUSDT_AMOUNT)).await?;
    wait_for_block(&client, &args.url).await?;

    println!();
    println!("=== AMM Initialization Complete ===");
    println!("  Initial RNG Reserve:   {}", INITIAL_RNG_AMOUNT);
    println!("  Initial vUSDT Reserve: {}", INITIAL_VUSDT_AMOUNT);
    println!("  Initial Price:         1 RNG = 1 vUSDT");
    println!();
    println!("The AMM is now ready for swaps!");

    Ok(())
}
