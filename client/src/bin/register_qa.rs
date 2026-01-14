use anyhow::{Context, Result};
use commonware_codec::ReadExt;
use commonware_codec::Encode;
use commonware_cryptography::ed25519::PrivateKey;
use commonware_cryptography::Signer;
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction},
};
use reqwest::Client;
use serde::Deserialize;

const QA_PRIV_HEX: &str = "2dbc3152d0b482c2802930aba4e51fb9121a39dcd5432b1a76490be5c27f7ce8";
const DEFAULT_BASE_URL: &str = "https://indexer.testnet.regenesis.dev";

#[derive(Deserialize)]
struct AccountResp {
    nonce: u64,
    balance: u64,
}

fn load_qa_key() -> Result<PrivateKey> {
    let bytes = commonware_utils::from_hex(QA_PRIV_HEX)
        .context("decode QA priv")?;
    let mut slice = bytes.as_slice();
    let key = PrivateKey::read(&mut slice)?;
    Ok(key)
}

fn base_url() -> String {
    std::env::var("BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    let qa_priv = load_qa_key()?;
    let qa_pub = qa_priv.public_key();
    println!("Registering QA player {}", commonware_utils::hex(qa_pub.encode().as_ref()));

    let client = Client::builder().build()?;
    let base_url = base_url();

    let pub_hex = commonware_utils::hex(qa_pub.encode().as_ref());
    let account: AccountResp = client
        .get(format!("{base_url}/account/{pub_hex}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    println!("QA nonce on chain: {}", account.nonce);

    let tx = Transaction::sign(
        &qa_priv,
        account.nonce,
        Instruction::CasinoRegister {
            name: "QA_Player".to_string(),
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
