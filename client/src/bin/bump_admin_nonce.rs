use anyhow::{Context, Result};
use commonware_codec::{Encode, ReadExt};
use commonware_cryptography::ed25519::PrivateKey;
use commonware_cryptography::Signer;
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction},
};
use reqwest::Client;
use serde::Deserialize;

const DEFAULT_BASE_URL: &str = "https://indexer.testnet.regenesis.dev";

#[derive(Deserialize)]
struct AccountResp {
    nonce: u64,
    balance: u64,
}

fn load_priv_from_env() -> Result<PrivateKey> {
    let hex = std::env::var("ADMIN_PRIV_HEX")
        .or_else(|_| std::env::var("GATEWAY_LIVE_TABLE_ADMIN_KEY"))
        .context("ADMIN_PRIV_HEX env var required")?;
    let bytes =
        commonware_utils::from_hex(hex.trim_start_matches("0x")).context("decode admin priv")?;
    let mut slice = bytes.as_slice();
    let key = PrivateKey::read(&mut slice)?;
    Ok(key)
}

fn base_url() -> String {
    std::env::var("BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    let admin_priv = load_priv_from_env()?;
    let admin_pub = admin_priv.public_key();
    println!(
        "Bumping admin nonce for {}",
        commonware_utils::hex(admin_pub.encode().as_ref())
    );

    let client = Client::builder().build()?;
    let base_url = base_url();

    let pub_hex = commonware_utils::hex(admin_pub.encode().as_ref());
    let account: AccountResp = client
        .get(format!("{base_url}/account/{pub_hex}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    println!("Current nonce: {}", account.nonce);

    let tx = Transaction::sign(
        &admin_priv,
        account.nonce,
        Instruction::CasinoRegister {
            name: "AdminNonceBump".to_string(),
        },
    );
    let submission = Submission::Transactions(vec![tx]);
    let body = submission.encode().to_vec();

    let resp = client
        .post(format!("{base_url}/submit"))
        .header("Content-Type", "application/octet-stream")
        .body(body)
        .send()
        .await?;
    println!("Submit status: {}", resp.status());
    if !resp.status().is_success() {
        println!("Body: {:?}", resp.text().await?);
    }
    Ok(())
}
