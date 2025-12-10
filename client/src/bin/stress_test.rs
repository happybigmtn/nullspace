//! Bot stress test - simulates multiple concurrent casino bots
//!
//! Usage:
//!   cargo run --release --bin stress-test -- --identity <IDENTITY_HEX> [OPTIONS]
//!
//! Options:
//!   -u, --url            Node URL (default: http://localhost:8080)
//!   -i, --identity       Validator identity hex (required)
//!   -n, --num-bots       Number of bots to spawn (default: 100)
//!   -g, --games-per-bot  Games per bot to play (default: 10)
//!   -d, --delay-ms       Delay between games in ms (default: 100)

use nullspace_client::Client;
use nullspace_types::{
    casino::GameType,
    execution::{Instruction, Transaction},
    Identity,
};
use clap::Parser;
use commonware_codec::DecodeExt;
use commonware_cryptography::{ed25519::PrivateKey, PrivateKeyExt};
use rand::{rngs::StdRng, Rng, SeedableRng};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tracing::info;

#[derive(Parser, Debug)]
#[command(author, version, about = "Bot stress test for casino games")]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(short, long, default_value = "100")]
    num_bots: usize,

    #[arg(short, long, default_value = "10")]
    games_per_bot: usize,

    #[arg(short, long, default_value = "100")]
    delay_ms: u64,
}

/// Bot state tracking
struct BotState {
    keypair: PrivateKey,
    name: String,
    nonce: AtomicU64,
    session_counter: AtomicU64,
    games_played: AtomicU64,
    games_won: AtomicU64,
    games_lost: AtomicU64,
}

impl BotState {
    fn new(id: usize, rng: &mut StdRng) -> Self {
        let keypair = PrivateKey::from_rng(rng);
        Self {
            keypair,
            name: format!("Bot{:04}", id),
            nonce: AtomicU64::new(0),
            session_counter: AtomicU64::new(id as u64 * 1_000_000),
            games_played: AtomicU64::new(0),
            games_won: AtomicU64::new(0),
            games_lost: AtomicU64::new(0),
        }
    }

    fn next_nonce(&self) -> u64 {
        self.nonce.fetch_add(1, Ordering::Relaxed)
    }

    fn next_session_id(&self) -> u64 {
        self.session_counter.fetch_add(1, Ordering::Relaxed)
    }

    fn record_game(&self, won: bool) {
        self.games_played.fetch_add(1, Ordering::Relaxed);
        if won {
            self.games_won.fetch_add(1, Ordering::Relaxed);
        } else {
            self.games_lost.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Global metrics
struct Metrics {
    transactions_submitted: AtomicU64,
    transactions_success: AtomicU64,
    transactions_failed: AtomicU64,
    total_latency_ms: AtomicU64,
}

impl Metrics {
    fn new() -> Self {
        Self {
            transactions_submitted: AtomicU64::new(0),
            transactions_success: AtomicU64::new(0),
            transactions_failed: AtomicU64::new(0),
            total_latency_ms: AtomicU64::new(0),
        }
    }

    fn record_submit(&self, success: bool, latency_ms: u64) {
        self.transactions_submitted.fetch_add(1, Ordering::Relaxed);
        if success {
            self.transactions_success.fetch_add(1, Ordering::Relaxed);
        } else {
            self.transactions_failed.fetch_add(1, Ordering::Relaxed);
        }
        self.total_latency_ms.fetch_add(latency_ms, Ordering::Relaxed);
    }

    fn print_summary(&self, elapsed: Duration) {
        let submitted = self.transactions_submitted.load(Ordering::Relaxed);
        let success = self.transactions_success.load(Ordering::Relaxed);
        let failed = self.transactions_failed.load(Ordering::Relaxed);
        let total_latency = self.total_latency_ms.load(Ordering::Relaxed);

        let tps = if elapsed.as_secs() > 0 {
            submitted as f64 / elapsed.as_secs_f64()
        } else {
            0.0
        };

        let avg_latency = if submitted > 0 {
            total_latency as f64 / submitted as f64
        } else {
            0.0
        };

        let success_rate = if submitted > 0 {
            (success as f64 / submitted as f64) * 100.0
        } else {
            0.0
        };

        info!("=== STRESS TEST RESULTS ===");
        info!("Duration: {:.2}s", elapsed.as_secs_f64());
        info!("Transactions: {} submitted, {} success, {} failed", submitted, success, failed);
        info!("TPS: {:.2}", tps);
        info!("Average Latency: {:.2}ms", avg_latency);
        info!("Success Rate: {:.2}%", success_rate);
    }
}

/// Generate a random game move payload based on game type
fn generate_move_payload(game_type: GameType, rng: &mut StdRng, move_number: u32) -> Vec<u8> {
    match game_type {
        GameType::Baccarat => {
            if move_number == 0 {
                // Place a bet: [0, bet_type, amount_bytes...]
                let bet_type = rng.gen_range(0..=2u8); // Player, Banker, or Tie
                let amount = 10u64;
                let mut payload = vec![0, bet_type];
                payload.extend_from_slice(&amount.to_be_bytes());
                payload
            } else {
                // Deal: [1]
                vec![1]
            }
        }
        GameType::Blackjack => {
            // Stand to finish quickly: [1]
            vec![1]
        }
        GameType::CasinoWar => {
            // Just wait for deal - no initial move needed
            vec![]
        }
        GameType::Craps => {
            if move_number == 0 {
                // Place pass bet: [0, 0, 0, amount_bytes...]
                let mut payload = vec![0, 0, 0];
                payload.extend_from_slice(&10u64.to_be_bytes());
                payload
            } else {
                // Roll dice: [2]
                vec![2]
            }
        }
        GameType::VideoPoker => {
            // Hold all cards: [0b11111] = 31
            vec![31]
        }
        GameType::HiLo => {
            // Random guess: 0=higher, 1=lower, 2=cashout
            let choice = rng.gen_range(0..=1u8);
            vec![choice]
        }
        GameType::Roulette => {
            // Bet on red: [1, 0]
            vec![1, 0]
        }
        GameType::SicBo => {
            // Bet on small: [0, 0]
            vec![0, 0]
        }
        GameType::ThreeCard => {
            // Play: [0]
            vec![0]
        }
        GameType::UltimateHoldem => {
            // Check or fold randomly
            if move_number < 2 {
                vec![0] // Check
            } else {
                vec![4] // Fold
            }
        }
    }
}

/// Helper function to flush a batch of transactions
async fn flush_batch(
    client: &Arc<Client>,
    pending_txs: &mut Vec<Transaction>,
    metrics: &Arc<Metrics>,
) {
    if pending_txs.is_empty() {
        return;
    }

    let start = Instant::now();
    let num_txs = pending_txs.len();

    match client.submit_transactions(pending_txs.drain(..).collect()).await {
        Ok(_) => {
            let latency = start.elapsed().as_millis() as u64;
            for _ in 0..num_txs {
                metrics.record_submit(true, latency);
            }
        }
        Err(_) => {
            let latency = start.elapsed().as_millis() as u64;
            for _ in 0..num_txs {
                metrics.record_submit(false, latency);
            }
        }
    }
}

/// Run a single bot
async fn run_bot(
    client: Arc<Client>,
    bot: Arc<BotState>,
    games_to_play: usize,
    delay_ms: u64,
    metrics: Arc<Metrics>,
) {
    let mut rng = StdRng::from_entropy();
    let mut pending_txs: Vec<Transaction> = Vec::with_capacity(5);

    // Register the bot
    let register_tx = Transaction::sign(
        &bot.keypair,
        bot.next_nonce(),
        Instruction::CasinoRegister {
            name: bot.name.clone(),
        },
    );
    pending_txs.push(register_tx);

    // Flush registration immediately
    flush_batch(&client, &mut pending_txs, &metrics).await;
    info!("Bot {} registered", bot.name);

    // Small delay after registration
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Play games
    for game_num in 0..games_to_play {
        // Pick a random game type
        let game_type = match rng.gen_range(0..10u8) {
            0 => GameType::Baccarat,
            1 => GameType::Blackjack,
            2 => GameType::CasinoWar,
            3 => GameType::Craps,
            4 => GameType::VideoPoker,
            5 => GameType::HiLo,
            6 => GameType::Roulette,
            7 => GameType::SicBo,
            8 => GameType::ThreeCard,
            _ => GameType::UltimateHoldem,
        };

        let session_id = bot.next_session_id();
        let bet = 10; // Small consistent bet

        // Start game
        let start_tx = Transaction::sign(
            &bot.keypair,
            bot.next_nonce(),
            Instruction::CasinoStartGame {
                game_type,
                bet,
                session_id,
            },
        );
        pending_txs.push(start_tx);

        // Make moves until game completes (max 5 moves to prevent infinite loops)
        for move_num in 0..5u32 {
            let payload = generate_move_payload(game_type, &mut rng, move_num);
            if payload.is_empty() {
                break;
            }

            let move_tx = Transaction::sign(
                &bot.keypair,
                bot.next_nonce(),
                Instruction::CasinoGameMove {
                    session_id,
                    payload,
                },
            );
            pending_txs.push(move_tx);

            // Flush batch when it reaches size 5
            if pending_txs.len() >= 5 {
                flush_batch(&client, &mut pending_txs, &metrics).await;
                // Small delay between batches
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }

        // Flush remaining transactions after each game
        flush_batch(&client, &mut pending_txs, &metrics).await;

        // Record game played (we don't track win/loss without reading state)
        bot.record_game(rng.gen_bool(0.5)); // Random for now

        if game_num < games_to_play - 1 {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }
    }

    // Flush any remaining transactions
    flush_batch(&client, &mut pending_txs, &metrics).await;

    info!(
        "Bot {} finished: {} games played",
        bot.name,
        bot.games_played.load(Ordering::Relaxed)
    );
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse args
    let args = Args::parse();

    // Setup logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Parse identity
    let identity_bytes =
        commonware_utils::from_hex(&args.identity).ok_or("Invalid identity hex format")?;
    let identity: Identity =
        Identity::decode(&mut identity_bytes.as_slice()).map_err(|_| "Failed to decode identity")?;

    info!(
        "Starting stress test with {} bots, {} games each",
        args.num_bots, args.games_per_bot
    );
    info!("Connecting to {}", args.url);

    // Create client
    let client = Arc::new(Client::new(&args.url, identity));

    // Create bots
    let mut master_rng = StdRng::seed_from_u64(42);
    let bots: Vec<Arc<BotState>> = (0..args.num_bots)
        .map(|i| Arc::new(BotState::new(i, &mut master_rng)))
        .collect();

    // Create metrics
    let metrics = Arc::new(Metrics::new());

    // Start timer
    let start_time = Instant::now();

    // Spawn bot tasks
    let mut handles = Vec::new();
    for bot in bots {
        let client = Arc::clone(&client);
        let metrics = Arc::clone(&metrics);
        let games_per_bot = args.games_per_bot;
        let delay_ms = args.delay_ms;

        handles.push(tokio::spawn(async move {
            run_bot(client, bot, games_per_bot, delay_ms, metrics).await;
        }));
    }

    // Wait for all bots to complete
    for handle in handles {
        let _ = handle.await;
    }

    // Print results
    let elapsed = start_time.elapsed();
    metrics.print_summary(elapsed);

    Ok(())
}
