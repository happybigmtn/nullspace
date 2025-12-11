//! Ecosystem Simulation (Enhanced)
//! 
//! Simulates a high-volume economy with:
//! - Periodic Tournaments (MTT style, accelerated)
//! - Whales (Buy/Sell pressure)
//! - Retail (Lending/Borrowing/Trading)
//! - Maximizer Agent (Optimized Strategy)
//! - Epoch Keeper (Triggers distributions)
//! 
//! Connects to a live network.

use nullspace_client::Client;
use nullspace_types::{
    casino::{GameType, HouseState, AmmPool},
    execution::{Instruction, Transaction, Key, Value},
    Identity,
};
use clap::Parser;
use commonware_codec::DecodeExt;
use commonware_cryptography::{
    ed25519::{PrivateKey, PublicKey}, 
    PrivateKeyExt, Signer
};
use rand::{rngs::StdRng, Rng, SeedableRng};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
    fs::File,
    io::Write,
};
use tracing::{info, warn, error};
use tokio::time;
use serde::Serialize;

#[derive(Parser, Debug)]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(long, default_value = "300")]
    duration: u64,
}

struct Bot {
    keypair: PrivateKey,
    nonce: AtomicU64,
    name: String,
}

impl Bot {
    fn new(name: &str, rng: &mut StdRng) -> Self {
        Self {
            keypair: PrivateKey::from_rng(rng),
            nonce: AtomicU64::new(0),
            name: name.to_string(),
        }
    }

    fn next_nonce(&self) -> u64 {
        self.nonce.fetch_add(1, Ordering::Relaxed)
    }
    
    fn public_key(&self) -> PublicKey {
        self.keypair.public_key()
    }
}

#[derive(Serialize)]
struct EconomySnapshot {
    timestamp: u64,
    house_pnl: i128,
    rng_price: f64,
    total_burned: u64,
    amm_rng: u64,
    amm_vusdt: u64,
    maximizer_nw: i64,
    total_txs: u64,
    epoch: u64,
}

async fn flush_batch(client: &Arc<Client>, txs: &mut Vec<Transaction>) {
    if txs.is_empty() { return; }
    let batch: Vec<Transaction> = txs.drain(..).collect();
    if let Err(e) = client.submit_transactions(batch).await {
         warn!("Batch submission failed: {}", e);
    }
}

async fn flush_tx(client: &Client, tx: Transaction) {
    if let Err(e) = client.submit_transactions(vec![tx]).await {
         warn!("Tx failed: {}", e);
    }
}

// === Epoch Keeper ===
async fn run_keeper(client: Arc<Client>, bot: Arc<Bot>, duration: Duration) {
    let start = Instant::now();
    
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoRegister { name: "Keeper".to_string() })).await;

    let mut interval = time::interval(Duration::from_secs(10)); // Trigger Epoch every 10s
    while start.elapsed() < duration {
        interval.tick().await;
        info!("Keeper: Processing Epoch...");
        flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::ProcessEpoch)).await;
    }
}

// === Whale Behavior (Buy/Sell/LP) ===
async fn run_whale(client: Arc<Client>, bot: Arc<Bot>, duration: Duration) {
    let mut rng = StdRng::from_entropy();
    let start = Instant::now();
    let mut held_rng = 0u64;

    // Register & Fund
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoRegister { name: bot.name.clone() })).await;
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoDeposit { amount: 50_000_000 })).await; 
    
    // Initial Liquidity
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CreateVault)).await;
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::DepositCollateral { amount: 20_000_000 })).await;
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::BorrowUSDT { amount: 10_000_000 })).await;
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::AddLiquidity { rng_amount: 5_000_000, usdt_amount: 5_000_000 })).await;

    let mut interval = time::interval(Duration::from_secs(5)); 
    while start.elapsed() < duration {
        interval.tick().await;
        
        // Strategy: Buy/Sell or Hold
        // If we have RNG, bias towards selling to realize profit? Or random.
        
        let action = rng.gen_range(0..3);
        match action {
            0 => { // Pump (Buy)
                let amount = rng.gen_range(10_000..50_000); // Reduced size
                info!("{}: PUMP Buying {} vUSDT of RNG", bot.name, amount);
                flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::Swap {
                    amount_in: amount,
                    min_amount_out: 0,
                    is_buying_rng: true,
                })).await;
                // Approx conversion, just tracking "some" held
                held_rng += amount; 
            },
            1 => { // Dump (Sell)
                if held_rng > 0 {
                    let amount = rng.gen_range(10_000..held_rng.min(50_000) + 1);
                    info!("{}: DUMP Selling {} RNG", bot.name, amount);
                    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::Swap {
                        amount_in: amount,
                        min_amount_out: 0,
                        is_buying_rng: false,
                    })).await;
                    held_rng = held_rng.saturating_sub(amount);
                }
            },
            _ => {} // Hold
        }
    }
}

// === Retail Behavior (Leverage/Trade) ===
async fn run_retail(client: Arc<Client>, bot: Arc<Bot>, duration: Duration) {
    let mut rng = StdRng::from_entropy();
    let start = Instant::now();

    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoRegister { name: bot.name.clone() })).await;
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoDeposit { amount: 500_000 })).await;

    // Open Vault
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CreateVault)).await;

    let mut interval = time::interval(Duration::from_secs(rng.gen_range(2..5)));
    while start.elapsed() < duration {
        interval.tick().await;
        
        let r = rng.gen_range(0..10);
        if r < 3 {
            // Leverage Up: Deposit RNG, Borrow vUSDT, Buy RNG
            let amount = 10_000;
            let mut txs = Vec::new();
            txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::DepositCollateral { amount }));
            txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::BorrowUSDT { amount: amount / 2 })); // 50% LTV safe-ish
            txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::Swap { amount_in: amount/2, min_amount_out: 0, is_buying_rng: true }));
            flush_batch(&client, &mut txs).await;
        } else if r < 6 {
            // Trade
            let amount = rng.gen_range(1000..5000);
            let buy = rng.gen_bool(0.5);
            flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::Swap {
                amount_in: amount,
                min_amount_out: 0,
                is_buying_rng: buy,
            })).await;
        } else {
            // Play Game
            let session_id = bot.next_nonce() * 12345;
            flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoStartGame {
                game_type: GameType::Blackjack,
                bet: 500,
                session_id,
            })).await;
            flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoGameMove {
                session_id,
                payload: vec![1], // Stand
            })).await;
        }
    }
}

// === Maximizer Bot ===
async fn run_maximizer(client: Arc<Client>, bot: Arc<Bot>, duration: Duration) {
    let start = Instant::now();
    info!("Maximizer: Started.");

    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoRegister { name: "MAXIMIZER".to_string() })).await;
    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoDeposit { amount: 1_000_000 })).await;

    let mut interval = time::interval(Duration::from_millis(500));
    while start.elapsed() < duration {
        interval.tick().await;
        // Strategy: High volume Baccarat Banker bets to farm House Edge distribution (via Staking)
        // Also stake frequently.
        
        let session_id = bot.next_nonce() * 99999;
        let mut txs = Vec::new();
        
        // 1. Play
        txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoStartGame {
            game_type: GameType::Baccarat,
            bet: 2000,
            session_id,
        }));
        txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoGameMove {
            session_id,
            payload: vec![0, 1], // Banker
        }));
        txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoGameMove {
            session_id,
            payload: vec![1], // Deal
        }));
        
        // 2. Stake Winnings (every ~10s)
        if start.elapsed().as_secs() % 10 == 0 {
             txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::Stake {
                 amount: 1000,
                 duration: 1000,
             }));
        }

        flush_batch(&client, &mut txs).await;
    }
}

// === Tournament Grinder ===
async fn run_tournament_grinder(client: Arc<Client>, bot: Arc<Bot>, duration: Duration) {
    let mut rng = StdRng::from_entropy();
    let start = Instant::now();
    let mut tournament_id = 1000;

    flush_tx(&client, Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoRegister { name: bot.name.clone() })).await;

    let mut interval = time::interval(Duration::from_millis(2000)); // 2s actions
    while start.elapsed() < duration {
        interval.tick().await;
        
        // Join (fire and forget)
        let join_tx = Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoJoinTournament { tournament_id });
        flush_tx(&client, join_tx).await;
        
        // Play to accumulate chips
        if rng.gen_bool(0.5) {
            let session_id = bot.next_nonce() * 777;
            let mut txs = Vec::new();
            txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoStartGame {
                game_type: GameType::Baccarat,
                bet: 1000,
                session_id,
            }));
            txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoGameMove {
                session_id,
                payload: vec![0, 1], // Banker
            }));
            txs.push(Transaction::sign(&bot.keypair, bot.next_nonce(), Instruction::CasinoGameMove {
                session_id,
                payload: vec![1], // Deal
            }));
            flush_batch(&client, &mut txs).await;
        }

        // Simulating Tournament cycle
        if start.elapsed().as_secs() % 5 == 0 {
             tournament_id += 1;
        }
    }
}

// === Tournament Organizer ===
async fn run_tournaments(client: Arc<Client>, organizer: Arc<Bot>, duration: Duration) {
    let start = Instant::now();
    let mut tournament_id = 1000;

    while start.elapsed() < duration {
        // Start Active Phase
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        flush_tx(&client, Transaction::sign(&organizer.keypair, organizer.next_nonce(), Instruction::CasinoStartTournament {
            tournament_id,
            start_time_ms: now,
            end_time_ms: now + 5000, // 5s duration for sim
        })).await;
        
        // Wait for duration
        time::sleep(Duration::from_secs(5)).await;
        
        // End & Payout
        flush_tx(&client, Transaction::sign(&organizer.keypair, organizer.next_nonce(), Instruction::CasinoEndTournament {
            tournament_id,
        })).await;
        
        tournament_id += 1;
    }
}

// === Monitor ===
async fn run_monitor(client: Arc<Client>, maximizer: Arc<Bot>, sample_whale: Arc<Bot>, duration: Duration) {
    let start = Instant::now();
    let mut log = Vec::new();
    let mut tx_count = 0;

    info!("Starting Monitor...");
    let mut interval = time::interval(Duration::from_millis(500));

    while start.elapsed() < duration {
        interval.tick().await;
        tx_count += 125; 

        // Debug Whale State
        if start.elapsed().as_secs() % 5 == 0 {
             if let Ok(Some(lookup)) = client.query_state(&Key::CasinoPlayer(sample_whale.public_key())).await {
                if let Some(Value::CasinoPlayer(p)) = lookup.operation.value() {
                    info!("DEBUG: Whale0 State - Name: {}, Chips: {}, vUSDT: {}", p.name, p.chips, p.vusdt_balance);
                }
            }
            
            // Debug Maximizer State
            if let Ok(Some(lookup)) = client.query_state(&Key::CasinoPlayer(maximizer.public_key())).await {
                if let Some(Value::CasinoPlayer(p)) = lookup.operation.value() {
                    info!("DEBUG: Maximizer State - Chips: {}", p.chips);
                }
            }
        }

        let house = match client.query_state(&Key::House).await {
            Ok(Some(lookup)) => if let Some(Value::House(h)) = lookup.operation.value() { Some(h.clone()) } else { None },
            _ => None
        };

        let amm = match client.query_state(&Key::AmmPool).await {
            Ok(Some(lookup)) => if let Some(Value::AmmPool(p)) = lookup.operation.value() { Some(p.clone()) } else { None },
            _ => None
        };
        
        // Calculate Maximizer NW
        let mut max_nw = 0i64;
        if let Ok(Some(lookup)) = client.query_state(&Key::CasinoPlayer(maximizer.public_key())).await {
            if let Some(Value::CasinoPlayer(p)) = lookup.operation.value() {
                if let Some(ref a) = amm {
                    let price = if a.reserve_rng > 0 { a.reserve_vusdt as f64 / a.reserve_rng as f64 } else { 1.0 };
                    let vusdt_val = if price > 0.0 { (p.vusdt_balance as f64 / price) as i64 } else { 0 };
                    max_nw = p.chips as i64 + vusdt_val;
                }
            }
        }

        // Use defaults if state not found yet
        let h = house.unwrap_or(HouseState::new(0));
        let a = amm.unwrap_or_default(); 

        let price = if a.reserve_rng > 0 { a.reserve_vusdt as f64 / a.reserve_rng as f64 } else { 0.0 };
        
        log.push(EconomySnapshot {
            timestamp: start.elapsed().as_millis() as u64,
            house_pnl: h.net_pnl,
            rng_price: price,
            total_burned: h.total_burned,
            amm_rng: a.reserve_rng,
            amm_vusdt: a.reserve_vusdt,
            maximizer_nw: max_nw,
            total_txs: tx_count, 
            epoch: h.current_epoch,
        });
        
        if let Ok(json) = serde_json::to_string_pretty(&log) {
            let _ = File::create("economy_log.json").and_then(|mut f| f.write_all(json.as_bytes()));
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    tracing_subscriber::fmt().with_max_level(tracing::Level::INFO).init();

    let identity_bytes = commonware_utils::from_hex(&args.identity).ok_or("Invalid identity")?;
    let identity = Identity::decode(&mut identity_bytes.as_slice())?;
    let client = Arc::new(Client::new(&args.url, identity)?);
    let mut rng = StdRng::from_entropy();

    info!("Starting Enhanced Ecosystem Simulation");

    // Agents
    let organizer = Arc::new(Bot::new("Organizer", &mut rng));
    let keeper = Arc::new(Bot::new("Keeper", &mut rng));
    let maximizer = Arc::new(Bot::new("Maximizer", &mut rng));
    let whales: Vec<_> = (0..2).map(|i| Arc::new(Bot::new(&format!("Whale{}", i), &mut rng))).collect();
    let retail: Vec<_> = (0..50).map(|i| Arc::new(Bot::new(&format!("Retail{}", i), &mut rng))).collect();
    let grinders: Vec<_> = (0..100).map(|i| Arc::new(Bot::new(&format!("Grinder{}", i), &mut rng))).collect();

    // Funding
    flush_tx(&client, Transaction::sign(&organizer.keypair, organizer.next_nonce(), Instruction::CasinoRegister { name: "Organizer".to_string() })).await;
    
    // Spawn
    let duration = Duration::from_secs(args.duration);
    let mut handles = Vec::new();

    // Monitor
    let c = client.clone();
    let m = maximizer.clone();
    let w = whales[0].clone();
    handles.push(tokio::spawn(async move { run_monitor(c, m, w, duration).await; }));

    // Keeper
    let c = client.clone();
    let k = keeper.clone();
    handles.push(tokio::spawn(async move { run_keeper(c, k, duration).await; }));

    // Organizer
    let c = client.clone();
    let o = organizer.clone();
    handles.push(tokio::spawn(async move { run_tournaments(c, o, duration).await; }));

    // Maximizer
    let c = client.clone();
    let m = maximizer.clone();
    handles.push(tokio::spawn(async move { run_maximizer(c, m, duration).await; }));

    // Whales
    for bot in whales {
        let c = client.clone();
        handles.push(tokio::spawn(async move { run_whale(c, bot, duration).await; }));
    }

    // Retail
    for bot in retail {
        let c = client.clone();
        handles.push(tokio::spawn(async move { run_retail(c, bot, duration).await; }));
    }

    // Grinders
    for bot in grinders {
        let c = client.clone();
        handles.push(tokio::spawn(async move { run_tournament_grinder(c, bot, duration).await; }));
    }

    // Wait
    for handle in handles {
        let _ = handle.await;
    }

    info!("Simulation Complete");
    Ok(())
}
