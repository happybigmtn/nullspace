//! Admin recovery pool tooling for Commonware.

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use commonware_codec::{DecodeExt, ReadExt};
use commonware_cryptography::{
    ed25519::{PrivateKey, PublicKey},
    Signer,
};
use commonware_utils::from_hex;
use nullspace_client::Client;
use nullspace_types::{
    execution::{Instruction, Key, Transaction, Value},
    Identity,
};
use std::env;
use tracing::info;

#[derive(Parser, Debug)]
#[command(author, version, about = "Admin recovery pool tooling")]
struct Args {
    /// Nullspace simulator base URL (http(s)://host:port)
    #[arg(long, default_value = "http://localhost:8080")]
    url: String,

    /// Network identity hex (for verifying simulator responses)
    #[arg(long)]
    identity: String,

    /// Admin private key hex
    #[arg(long)]
    admin_key: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Fund the on-chain recovery pool accounting (vUSDT units).
    Fund {
        amount: u64,
    },
    /// Retire debt for a specific vault.
    Retire {
        target: String,
        amount: u64,
    },
    /// Retire debt for the worst LTV vault.
    RetireWorst {
        amount: u64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let args = Args::parse();
    let identity = decode_identity(&args.identity)?;
    let client = Client::new(&args.url, identity)?;

    let admin_key = require_arg_or_env(args.admin_key, "CASINO_ADMIN_PRIVATE_KEY_HEX")?;
    let admin_private = decode_admin_key(&admin_key)?;
    let admin_public = admin_private.public_key();

    let nonce = fetch_nonce(&client, &admin_public).await?;

    let instruction = match args.command {
        Command::Fund { amount } => Instruction::FundRecoveryPool { amount },
        Command::Retire { target, amount } => {
            let target_key = decode_public_key(&target)?;
            Instruction::RetireVaultDebt {
                target: target_key,
                amount,
            }
        }
        Command::RetireWorst { amount } => Instruction::RetireWorstVaultDebt { amount },
    };

    let tx = Transaction::sign(&admin_private, nonce, instruction);
    client
        .submit_transactions(vec![tx])
        .await
        .context("Failed to submit recovery pool transaction")?;

    info!(nonce, "Recovery pool transaction submitted");
    Ok(())
}

fn decode_identity(hex_str: &str) -> Result<Identity> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid identity hex"))?;
    let identity = Identity::decode(&mut bytes.as_slice()).context("Failed to decode identity")?;
    Ok(identity)
}

fn require_arg_or_env(value: Option<String>, env_key: &str) -> Result<String> {
    if let Some(value) = value {
        return Ok(value);
    }
    env::var(env_key).map_err(|_| anyhow!("Missing {env_key} (flag or env var)"))
}

fn decode_admin_key(hex_str: &str) -> Result<PrivateKey> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid admin private key hex"))?;
    let mut buf: &[u8] = bytes.as_slice();
    let key = PrivateKey::read(&mut buf).context("Failed to decode admin key")?;
    if !buf.is_empty() {
        return Err(anyhow!("Unexpected trailing bytes in admin key"));
    }
    Ok(key)
}

fn decode_public_key(hex_str: &str) -> Result<PublicKey> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid public key hex"))?;
    let mut buf: &[u8] = bytes.as_slice();
    let key = PublicKey::read(&mut buf).context("Failed to decode public key")?;
    if !buf.is_empty() {
        return Err(anyhow!("Unexpected trailing bytes in public key"));
    }
    Ok(key)
}

async fn fetch_nonce(client: &Client, public: &PublicKey) -> Result<u64> {
    let lookup = client.query_state(&Key::Account(public.clone())).await?;
    let nonce = match lookup.and_then(|lookup| lookup.operation.value().cloned()) {
        Some(Value::Account(account)) => account.nonce,
        _ => 0,
    };
    Ok(nonce)
}
