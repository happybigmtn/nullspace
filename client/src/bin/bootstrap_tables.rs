use anyhow::{Context, Result};
use commonware_codec::{Encode, ReadExt};
use commonware_cryptography::ed25519::PrivateKey;
use commonware_cryptography::Signer;
use nullspace_types::{
    api::Submission,
    casino::{GameType, GlobalTableConfig},
    execution::{Instruction, Transaction},
};
use reqwest::Client;
use serde::Deserialize;

const ADMIN_PRIV_HEX: &str = "b09e8077db829b08141f280fd3f25fdb4aec39adeb95e836081704896aa03bac";
const DEFAULT_BASE_URL: &str = "https://indexer.testnet.regenesis.dev";

#[derive(Deserialize)]
struct AccountResp {
    nonce: u64,
    balance: u64,
}

fn load_admin_key() -> Result<PrivateKey> {
    let bytes = commonware_utils::from_hex(ADMIN_PRIV_HEX)
        .context("decode admin hex")?;
    let mut slice = bytes.as_slice();
    let key = PrivateKey::read(&mut slice)?;
    Ok(key)
}

fn base_url() -> String {
    std::env::var("BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    let admin_priv = load_admin_key()?;
    let admin_pub = admin_priv.public_key();
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
    println!("Admin nonce on chain: {}", account.nonce);

    let games = [
        GameType::Baccarat,
        GameType::Blackjack,
        GameType::CasinoWar,
        GameType::Craps,
        GameType::VideoPoker,
        GameType::HiLo,
        GameType::Roulette,
        GameType::SicBo,
        GameType::ThreeCard,
        GameType::UltimateHoldem,
    ];

    let mut nonce = account.nonce;
    let mut txs = Vec::new();
    for game in games {
        let cfg = GlobalTableConfig {
            game_type: game,
            betting_ms: 20_000,
            lock_ms: 2_000,
            payout_ms: 4_000,
            cooldown_ms: 4_000,
            min_bet: 5,
            max_bet: 1_000,
            max_bets_per_round: 100,
        };
        txs.push(Transaction::sign(
            &admin_priv,
            nonce,
            Instruction::GlobalTableInit { config: cfg },
        ));

        nonce += 1;
        txs.push(Transaction::sign(
            &admin_priv,
            nonce,
            Instruction::GlobalTableOpenRound { game_type: game },
        ));

        nonce += 1;
    }

    let submission = Submission::Transactions(txs);
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
    } else {
        println!("Submitted bootstrap transactions");
    }

    Ok(())
}
