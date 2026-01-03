//! Single Actor PnL Maximizer
//!
//! Connects to the network and attempts to maximize PnL.
//! Strategy:
//! 1. Register & Fund.
//! 2. Check Leaderboard.
//! 3. Play Baccarat (Banker Bet) aggressively.
//! 4. Monitor PnL.

use clap::Parser;
use commonware_codec::DecodeExt;
use commonware_cryptography::{ed25519::PrivateKey, Signer};
use commonware_math::algebra::Random;
use nullspace_client::{operation_value, Client};
use nullspace_types::{
    casino::GameType,
    execution::{Instruction, Key, Transaction, Value},
    Identity,
};
use rand::{rngs::StdRng, SeedableRng};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tokio::time;
use tracing::{info, warn};

#[derive(Parser, Debug)]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,
}

struct SmartBot {
    keypair: PrivateKey,
    nonce: AtomicU64,
}

impl SmartBot {
    fn new() -> Self {
        let mut rng = StdRng::from_entropy();
        Self {
            keypair: PrivateKey::random(&mut rng),
            nonce: AtomicU64::new(0),
        }
    }

    fn next_nonce(&self) -> u64 {
        self.nonce.fetch_add(1, Ordering::Relaxed)
    }
}

async fn flush_tx(client: &Client, tx: Transaction) {
    if let Err(e) = client.submit_transactions(vec![tx]).await {
        warn!("Tx failed: {}", e);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Parse identity
    let identity_bytes =
        commonware_utils::from_hex(&args.identity).ok_or("Invalid identity hex")?;
    let identity = Identity::decode(&mut identity_bytes.as_slice())?;

    let client = Client::new(&args.url, identity)?;
    let bot = SmartBot::new();

    info!("Starting PnL Maximizer Bot");

    // 1. Register
    let tx = Transaction::sign(
        &bot.keypair,
        bot.next_nonce(),
        Instruction::CasinoRegister {
            name: "MaxPnL".to_string(),
        },
    );
    flush_tx(&client, tx).await;

    // 2. Fund (1M chips)
    let tx = Transaction::sign(
        &bot.keypair,
        bot.next_nonce(),
        Instruction::CasinoDeposit { amount: 1_000_000 },
    );
    flush_tx(&client, tx).await;

    time::sleep(Duration::from_secs(2)).await;

    // 3. Game Loop (High Stakes Baccarat - Banker Bet)
    let mut session_id = 900000;
    let duration = Duration::from_secs(60);
    let start = Instant::now();

    while start.elapsed() < duration {
        let bet = 1000; // High bet
        session_id += 1;

        // Start Baccarat
        let tx = Transaction::sign(
            &bot.keypair,
            bot.next_nonce(),
            Instruction::CasinoStartGame {
                game_type: GameType::Baccarat,
                bet,
                session_id,
            },
        );
        flush_tx(&client, tx).await;

        // Bet Banker (1) - Lowest Edge
        let mut payload = vec![0, 1]; // 0=Bet, 1=Banker
        payload.extend_from_slice(&10u64.to_be_bytes());

        let tx = Transaction::sign(
            &bot.keypair,
            bot.next_nonce(),
            Instruction::CasinoGameMove {
                session_id,
                payload,
            },
        );
        flush_tx(&client, tx).await;

        // Deal
        let tx = Transaction::sign(
            &bot.keypair,
            bot.next_nonce(),
            Instruction::CasinoGameMove {
                session_id,
                payload: vec![1], // Deal
            },
        );
        flush_tx(&client, tx).await;

        // Rate limit manually
        time::sleep(Duration::from_millis(500)).await;

        // Check PnL
        if session_id % 10 == 0 {
            if let Some(lookup) = client
                .query_state(&Key::CasinoPlayer(bot.keypair.public_key()))
                .await?
            {
                if let Some(Value::CasinoPlayer(p)) = operation_value(&lookup.operation) {
                    info!("Current Chips: {}", p.balances.chips);
                }
            }
        }
    }

    info!("Maximizer Finished.");
    Ok(())
}
