//! Phase 1/2 economic simulation runner.
//! Simulates daily actor behavior against a running simulator node.

use clap::Parser;
use commonware_codec::DecodeExt;
use commonware_codec::Encode;
use commonware_cryptography::{
    ed25519::{PrivateKey, PublicKey},
    PrivateKeyExt, Signer,
};
use commonware_utils::hex;
use nullspace_client::Client;
use nullspace_types::{
    casino::GameType,
    execution::{Instruction, Transaction},
    Identity,
};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::time;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(author, version, about = "Phase 1/2 economic simulation")]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(long, default_value = "365")]
    days: u32,

    #[arg(long, default_value = "5")]
    day_seconds: u64,

    #[arg(long, default_value = "1000")]
    initial_players: usize,

    #[arg(long, default_value = "25")]
    daily_new_players: usize,

    #[arg(long, default_value = "50")]
    daily_churn_bps: u32,

    #[arg(long, default_value = "2500")]
    daily_active_bps: u32,

    #[arg(long, default_value = "500")]
    member_share_bps: u32,

    #[arg(long, default_value = "1000")]
    initial_deposit: u64,

    #[arg(long, default_value = "42")]
    seed: u64,

    #[arg(long)]
    output: Option<String>,

    #[arg(long)]
    export_keys: Option<String>,

    #[arg(long)]
    dry_run: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
enum ActorKind {
    Grinder,
    Casual,
    Whale,
    DeFi,
    Subscriber,
    Lurker,
}

#[derive(Debug, Serialize)]
struct ActorSnapshot {
    name: String,
    public_key_hex: String,
    kind: ActorKind,
    member: bool,
    sessions: u64,
    swaps: u64,
    vault_actions: u64,
    liquidity_actions: u64,
    stakes: u64,
}

#[derive(Debug, Serialize)]
struct ActorKeySnapshot {
    name: String,
    public_key_hex: String,
    private_key_hex: String,
    kind: ActorKind,
    member: bool,
}

struct ActorState {
    keypair: PrivateKey,
    name: String,
    nonce: u64,
    session_counter: u64,
    kind: ActorKind,
    member: bool,
    has_vault: bool,
    staked_once: bool,
    sessions: u64,
    swaps: u64,
    vault_actions: u64,
    liquidity_actions: u64,
    stakes: u64,
}

impl ActorState {
    fn new(id: usize, kind: ActorKind, member: bool, rng: &mut StdRng) -> Self {
        let keypair = PrivateKey::from_rng(rng);
        Self {
            keypair,
            name: format!("Player{:05}", id),
            nonce: 0,
            session_counter: id as u64 * 1_000_000,
            kind,
            member,
            has_vault: false,
            staked_once: false,
            sessions: 0,
            swaps: 0,
            vault_actions: 0,
            liquidity_actions: 0,
            stakes: 0,
        }
    }

    fn next_nonce(&mut self) -> u64 {
        let nonce = self.nonce;
        self.nonce += 1;
        nonce
    }

    fn next_session_id(&mut self) -> u64 {
        let session = self.session_counter;
        self.session_counter += 1;
        session
    }

    fn public_key(&self) -> PublicKey {
        self.keypair.public_key()
    }

    fn snapshot(&self) -> ActorSnapshot {
        ActorSnapshot {
            name: self.name.clone(),
            public_key_hex: hex(&self.public_key().encode()),
            kind: self.kind,
            member: self.member,
            sessions: self.sessions,
            swaps: self.swaps,
            vault_actions: self.vault_actions,
            liquidity_actions: self.liquidity_actions,
            stakes: self.stakes,
        }
    }

    fn key_snapshot(&self) -> ActorKeySnapshot {
        ActorKeySnapshot {
            name: self.name.clone(),
            public_key_hex: hex(&self.public_key().encode()),
            private_key_hex: hex(&self.keypair.encode()),
            kind: self.kind,
            member: self.member,
        }
    }
}

struct DayPlan {
    sessions: u32,
    swaps: u32,
    vault_actions: u32,
    liquidity_actions: u32,
    stake_actions: u32,
}

fn choose_actor_kind(rng: &mut StdRng) -> ActorKind {
    match rng.gen_range(0..100u32) {
        0..=39 => ActorKind::Grinder,
        40..=64 => ActorKind::Casual,
        65..=74 => ActorKind::Whale,
        75..=86 => ActorKind::DeFi,
        87..=94 => ActorKind::Subscriber,
        _ => ActorKind::Lurker,
    }
}

fn plan_day(actor: &ActorState, rng: &mut StdRng) -> DayPlan {
    let mut sessions = match actor.kind {
        ActorKind::Grinder => rng.gen_range(6..=14),
        ActorKind::Casual => rng.gen_range(1..=4),
        ActorKind::Whale => rng.gen_range(3..=6),
        ActorKind::DeFi => rng.gen_range(1..=3),
        ActorKind::Subscriber => rng.gen_range(8..=16),
        ActorKind::Lurker => rng.gen_range(0..=1),
    };

    if actor.member {
        sessions += 2;
    }

    let swaps = match actor.kind {
        ActorKind::Whale => rng.gen_range(1..=3),
        ActorKind::DeFi => rng.gen_range(2..=5),
        _ => rng.gen_range(0..=1),
    };

    let vault_actions = match actor.kind {
        ActorKind::Whale => rng.gen_range(1..=2),
        ActorKind::DeFi => rng.gen_range(1..=3),
        _ => 0,
    };

    let liquidity_actions = match actor.kind {
        ActorKind::DeFi => rng.gen_range(0..=2),
        ActorKind::Whale => rng.gen_range(0..=1),
        _ => 0,
    };

    let stake_actions = match actor.kind {
        ActorKind::Subscriber => 1,
        ActorKind::Whale => rng.gen_range(0..=1),
        _ => 0,
    };

    DayPlan {
        sessions,
        swaps,
        vault_actions,
        liquidity_actions,
        stake_actions,
    }
}

fn generate_move_payload(game_type: GameType, rng: &mut StdRng, move_number: u32) -> Vec<u8> {
    match game_type {
        GameType::Baccarat => match move_number {
            0 => {
                let bet_type = if rng.gen_bool(0.08) {
                    2u8
                } else if rng.gen_bool(0.5) {
                    0u8
                } else {
                    1u8
                };
                let amount = rng.gen_range(5u64..=25u64);
                let mut payload = vec![0, bet_type];
                payload.extend_from_slice(&amount.to_be_bytes());
                payload
            }
            1 => vec![1],
            _ => vec![],
        },
        GameType::Blackjack => match move_number {
            0 => vec![4],
            1 => vec![1],
            2 => vec![6],
            _ => vec![],
        },
        GameType::CasinoWar => match move_number {
            0 => vec![0],
            1 => vec![1],
            _ => vec![],
        },
        GameType::Craps => match move_number {
            0 => {
                let amount = rng.gen_range(5u64..=25u64);
                let mut payload = vec![0, 4, 0];
                payload.extend_from_slice(&amount.to_be_bytes());
                payload
            }
            1 => vec![2],
            _ => vec![],
        },
        GameType::VideoPoker => {
            if move_number == 0 {
                vec![rng.gen_range(0u8..=31u8)]
            } else {
                vec![]
            }
        }
        GameType::HiLo => match move_number {
            0 => vec![rng.gen_range(0u8..=1u8)],
            1 => vec![2],
            _ => vec![],
        },
        GameType::Roulette => match move_number {
            0 => {
                let (bet_type, number) = if rng.gen_bool(0.15) {
                    (0u8, rng.gen_range(0u8..=36u8))
                } else {
                    let bt = if rng.gen_bool(0.5) { 1u8 } else { 2u8 };
                    (bt, 0u8)
                };
                let amount = rng.gen_range(5u64..=25u64);
                let mut payload = vec![0, bet_type, number];
                payload.extend_from_slice(&amount.to_be_bytes());
                payload
            }
            1 => vec![1],
            _ => vec![],
        },
        GameType::SicBo => match move_number {
            0 => {
                let (bet_type, number) = if rng.gen_bool(0.12) {
                    (8u8, rng.gen_range(1u8..=6u8))
                } else if rng.gen_bool(0.12) {
                    (7u8, rng.gen_range(3u8..=18u8))
                } else {
                    (if rng.gen_bool(0.5) { 0u8 } else { 1u8 }, 0u8)
                };
                let amount = rng.gen_range(5u64..=25u64);
                let mut payload = vec![0, bet_type, number];
                payload.extend_from_slice(&amount.to_be_bytes());
                payload
            }
            1 => vec![1],
            _ => vec![],
        },
        GameType::ThreeCard => match move_number {
            0 => vec![2],
            1 => vec![0],
            2 => vec![4],
            _ => vec![],
        },
        GameType::UltimateHoldem => match move_number {
            0 => vec![5],
            1 => vec![0],
            2 => vec![0],
            3 => vec![4],
            _ => vec![],
        },
    }
}

async fn submit_batch(client: &Client, txs: &mut Vec<Transaction>, dry_run: bool) {
    if txs.is_empty() {
        return;
    }
    if dry_run {
        txs.clear();
        return;
    }
    if let Err(err) = client.submit_transactions(std::mem::take(txs)).await {
        warn!("Transaction batch failed: {err}");
    }
}

async fn register_actor(
    client: &Client,
    actor: &mut ActorState,
    initial_deposit: u64,
    dry_run: bool,
) {
    let mut txs = Vec::with_capacity(2);
    let register_nonce = actor.next_nonce();
    let register_tx = Transaction::sign(
        &actor.keypair,
        register_nonce,
        Instruction::CasinoRegister {
            name: actor.name.clone(),
        },
    );
    txs.push(register_tx);
    let deposit_nonce = actor.next_nonce();
    let deposit_tx = Transaction::sign(
        &actor.keypair,
        deposit_nonce,
        Instruction::CasinoDeposit {
            amount: initial_deposit,
        },
    );
    txs.push(deposit_tx);
    submit_batch(client, &mut txs, dry_run).await;
}

async fn play_session(client: &Client, actor: &mut ActorState, rng: &mut StdRng, dry_run: bool) {
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

    let session_id = actor.next_session_id();
    let bet = match game_type {
        GameType::Baccarat | GameType::Craps | GameType::Roulette | GameType::SicBo => 0,
        _ => rng.gen_range(5u64..=25u64),
    };

    let mut txs = Vec::with_capacity(6);
    let start_nonce = actor.next_nonce();
    let start_tx = Transaction::sign(
        &actor.keypair,
        start_nonce,
        Instruction::CasinoStartGame {
            game_type,
            bet,
            session_id,
        },
    );
    txs.push(start_tx);

    for move_num in 0..20u32 {
        let payload = generate_move_payload(game_type, rng, move_num);
        if payload.is_empty() {
            break;
        }
        let move_nonce = actor.next_nonce();
        let move_tx = Transaction::sign(
            &actor.keypair,
            move_nonce,
            Instruction::CasinoGameMove {
                session_id,
                payload,
            },
        );
        txs.push(move_tx);
    }

    submit_batch(client, &mut txs, dry_run).await;
    actor.sessions += 1;
}

async fn perform_defi_actions(
    client: &Client,
    actor: &mut ActorState,
    rng: &mut StdRng,
    plan: &DayPlan,
    dry_run: bool,
) {
    let mut txs = Vec::with_capacity(6);

    for _ in 0..plan.swaps {
        let amount_in = rng.gen_range(10u64..=150u64);
        let is_buying_rng = rng.gen_bool(0.5);
        let swap_nonce = actor.next_nonce();
        let tx = Transaction::sign(
            &actor.keypair,
            swap_nonce,
            Instruction::Swap {
                amount_in,
                min_amount_out: 0,
                is_buying_rng,
            },
        );
        txs.push(tx);
        actor.swaps += 1;
    }

    for _ in 0..plan.liquidity_actions {
        let rng_amount = rng.gen_range(20u64..=200u64);
        let usdt_amount = rng.gen_range(20u64..=200u64);
        let lp_nonce = actor.next_nonce();
        let tx = Transaction::sign(
            &actor.keypair,
            lp_nonce,
            Instruction::AddLiquidity {
                rng_amount,
                usdt_amount,
            },
        );
        txs.push(tx);
        actor.liquidity_actions += 1;
    }

    for _ in 0..plan.vault_actions {
        if !actor.has_vault {
            let vault_nonce = actor.next_nonce();
            let tx = Transaction::sign(
                &actor.keypair,
                vault_nonce,
                Instruction::CreateVault,
            );
            txs.push(tx);
            actor.has_vault = true;
        }
        let collateral = rng.gen_range(25u64..=150u64);
        let borrow = rng.gen_range(10u64..=75u64);
        let deposit_nonce = actor.next_nonce();
        let deposit_tx = Transaction::sign(
            &actor.keypair,
            deposit_nonce,
            Instruction::DepositCollateral { amount: collateral },
        );
        let borrow_nonce = actor.next_nonce();
        let borrow_tx = Transaction::sign(
            &actor.keypair,
            borrow_nonce,
            Instruction::BorrowUSDT { amount: borrow },
        );
        txs.push(deposit_tx);
        txs.push(borrow_tx);
        actor.vault_actions += 1;
    }

    for _ in 0..plan.stake_actions {
        if !actor.staked_once {
            let duration = rng.gen_range(7u64..=30u64);
            let amount = rng.gen_range(50u64..=200u64);
            let stake_nonce = actor.next_nonce();
            let tx = Transaction::sign(
                &actor.keypair,
                stake_nonce,
                Instruction::Stake { amount, duration },
            );
            txs.push(tx);
            actor.staked_once = true;
            actor.stakes += 1;
        } else if rng.gen_bool(0.3) {
            let claim_nonce = actor.next_nonce();
            let tx = Transaction::sign(&actor.keypair, claim_nonce, Instruction::ClaimRewards);
            txs.push(tx);
            actor.stakes += 1;
        }
    }

    submit_batch(client, &mut txs, dry_run).await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let identity_bytes =
        commonware_utils::from_hex(&args.identity).ok_or("Invalid identity hex format")?;
    let identity: Identity = Identity::decode(&mut identity_bytes.as_slice())
        .map_err(|_| "Failed to decode identity")?;

    let client = Client::new(&args.url, identity)?;

    let mut rng = StdRng::seed_from_u64(args.seed);
    let mut actors: Vec<ActorState> = Vec::with_capacity(args.initial_players);

    for id in 0..args.initial_players {
        let kind = choose_actor_kind(&mut rng);
        let member = rng.gen_ratio(args.member_share_bps, 10_000);
        let mut actor = ActorState::new(id, kind, member, &mut rng);
        register_actor(&client, &mut actor, args.initial_deposit, args.dry_run).await;
        actors.push(actor);
    }

    let start = Instant::now();
    for day in 0..args.days {
        let day_start = Instant::now();
        info!("Simulating day {} (actors: {})", day + 1, actors.len());

        let churned = actors
            .iter()
            .filter(|_| rng.gen_ratio(args.daily_churn_bps, 10_000))
            .count();
        for _ in 0..churned {
            if !actors.is_empty() {
                let idx = rng.gen_range(0..actors.len());
                actors.swap_remove(idx);
            }
        }

        let start_id = actors.len();
        for id in start_id..start_id + args.daily_new_players {
            let kind = choose_actor_kind(&mut rng);
            let member = rng.gen_ratio(args.member_share_bps, 10_000);
            let mut actor = ActorState::new(id, kind, member, &mut rng);
            register_actor(&client, &mut actor, args.initial_deposit, args.dry_run).await;
            actors.push(actor);
        }

        for actor in actors.iter_mut() {
            if !rng.gen_ratio(args.daily_active_bps, 10_000) {
                continue;
            }
            let plan = plan_day(actor, &mut rng);
            for _ in 0..plan.sessions {
                play_session(&client, actor, &mut rng, args.dry_run).await;
            }
            perform_defi_actions(&client, actor, &mut rng, &plan, args.dry_run).await;
        }

        let elapsed = day_start.elapsed();
        if elapsed < Duration::from_secs(args.day_seconds) {
            time::sleep(Duration::from_secs(args.day_seconds) - elapsed).await;
        }
    }

    let snapshots: Vec<ActorSnapshot> = actors.iter().map(|actor| actor.snapshot()).collect();
    if let Some(output) = args.output {
        let payload = serde_json::json!({
            "days": args.days,
            "elapsed_seconds": start.elapsed().as_secs(),
            "actors": snapshots,
        });
        std::fs::write(output, serde_json::to_string_pretty(&payload)?)?;
    }

    if let Some(keys_out) = args.export_keys {
        let keys: Vec<ActorKeySnapshot> = actors.iter().map(|actor| actor.key_snapshot()).collect();
        let payload = serde_json::json!({
            "days": args.days,
            "actors": keys,
        });
        std::fs::write(keys_out, serde_json::to_string_pretty(&payload)?)?;
    }

    info!("Simulation complete. Active actors: {}", actors.len());
    Ok(())
}
