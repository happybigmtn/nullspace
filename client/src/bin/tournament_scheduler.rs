//! Tournament scheduler - starts/ends freeroll tournaments on schedule.
//!
//! Usage:
//!   cargo run --release --bin tournament-scheduler -- --identity <IDENTITY_HEX> --admin-key <ADMIN_KEY_HEX>
//!
//! Options:
//!   -u, --url         Node URL (default: http://localhost:8080)
//!   -i, --identity    Network identity hex (required)
//!   -a, --admin-key        Admin private key hex (or CASINO_ADMIN_PRIVATE_KEY_HEX env)
//!       --admin-key-file   Path to file with admin private key hex (or CASINO_ADMIN_PRIVATE_KEY_FILE env)
//!   -p, --poll-secs   Scheduler poll interval (default: 5)

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use commonware_codec::DecodeExt;
use commonware_cryptography::{
    ed25519::{PrivateKey, PublicKey},
    Signer,
};
use commonware_utils::from_hex;
use nullspace_client::{operation_value, Client};
use nullspace_types::{
    casino::{Tournament, TournamentPhase, TOURNAMENTS_PER_DAY, TOURNAMENT_DURATION_SECS},
    execution::{Instruction, Key, Transaction, Value},
    Identity,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::interval;
use tracing::{info, warn};

const DAY_MS: u64 = 86_400_000;

#[derive(Parser, Debug)]
#[command(author, version, about = "Freeroll tournament scheduler")]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(short = 'a', long)]
    admin_key: Option<String>,

    #[arg(long)]
    admin_key_file: Option<String>,

    #[arg(short, long, default_value = "5")]
    poll_secs: u64,
}

struct NonceTracker {
    next_nonce: Option<u64>,
}

impl NonceTracker {
    fn new() -> Self {
        Self { next_nonce: None }
    }

    async fn sync(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        let lookup = client.query_state(&Key::Account(public.clone())).await?;
        let nonce = match lookup.and_then(|lookup| operation_value(&lookup.operation).cloned()) {
            Some(Value::Account(account)) => account.nonce,
            _ => 0,
        };
        self.next_nonce = Some(nonce);
        Ok(nonce)
    }

    async fn next(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        if let Some(nonce) = self.next_nonce {
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        } else {
            let nonce = self.sync(client, public).await?;
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ScheduleSlot {
    slot: u64,
    start_time_ms: u64,
    end_time_ms: u64,
}

fn now_ms() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0))
}

fn schedule_for_time(now_ms: u64) -> ScheduleSlot {
    let cycle_ms = DAY_MS / TOURNAMENTS_PER_DAY.max(1);
    let tournament_ms = TOURNAMENT_DURATION_SECS.saturating_mul(1000);
    let registration_ms = cycle_ms.saturating_sub(tournament_ms);

    let slot = now_ms / cycle_ms.max(1);
    let slot_start_ms = slot * cycle_ms;
    let start_time_ms = slot_start_ms.saturating_add(registration_ms);
    let end_time_ms = start_time_ms.saturating_add(tournament_ms);

    ScheduleSlot {
        slot,
        start_time_ms,
        end_time_ms,
    }
}

fn decode_identity(hex_str: &str) -> Result<Identity> {
    let bytes = from_hex(hex_str).ok_or_else(|| anyhow!("Invalid identity hex"))?;
    Identity::decode(&mut bytes.as_slice()).context("Failed to decode identity")
}

fn read_secret_file(path: &str) -> Result<String> {
    let contents = std::fs::read_to_string(path).context("Failed to read secret file")?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Secret file is empty: {path}"));
    }
    Ok(trimmed.to_string())
}

fn require_arg_or_env_or_file(
    value: Option<String>,
    file: Option<String>,
    env: &str,
    env_file: &str,
) -> Result<String> {
    if let Some(value) = value {
        return Ok(value);
    }
    if let Some(file_path) = file {
        return read_secret_file(&file_path);
    }
    if let Ok(value) = std::env::var(env) {
        return Ok(value);
    }
    if let Ok(file_path) = std::env::var(env_file) {
        return read_secret_file(&file_path);
    }
    Err(anyhow!("Missing {env} or {env_file}"))
}

fn decode_admin_key(hex_str: &str) -> Result<PrivateKey> {
    let bytes = from_hex(hex_str).ok_or_else(|| anyhow!("Invalid admin key hex"))?;
    PrivateKey::decode(&mut bytes.as_slice()).context("Failed to decode admin key")
}

async fn fetch_tournament(client: &Client, tournament_id: u64) -> Result<Option<Tournament>> {
    let lookup = client.query_state(&Key::Tournament(tournament_id)).await?;
    Ok(match lookup.and_then(|lookup| operation_value(&lookup.operation).cloned()) {
        Some(Value::Tournament(tournament)) => Some(tournament),
        _ => None,
    })
}

async fn submit_instruction(
    client: &Client,
    admin_private: &PrivateKey,
    admin_public: &PublicKey,
    nonce_tracker: &mut NonceTracker,
    instruction: Instruction,
) -> Result<()> {
    let nonce = nonce_tracker.next(client, admin_public).await?;
    let tx = Transaction::sign(admin_private, nonce, instruction);
    if let Err(err) = client.submit_transactions(vec![tx]).await {
        nonce_tracker.sync(client, admin_public).await?;
        return Err(anyhow!("Submit failed: {err}"));
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let identity = decode_identity(&args.identity)?;
    let admin_key = require_arg_or_env_or_file(
        args.admin_key,
        args.admin_key_file,
        "CASINO_ADMIN_PRIVATE_KEY_HEX",
        "CASINO_ADMIN_PRIVATE_KEY_FILE",
    )?;
    let admin_private = decode_admin_key(&admin_key)?;
    let admin_public = admin_private.public_key();

    let client = Client::new(&args.url, identity)?;
    let mut nonce_tracker = NonceTracker::new();
    let mut last_started_slot: Option<u64> = None;
    let mut last_ended_slot: Option<u64> = None;

    info!(
        url = %args.url,
        poll_secs = args.poll_secs,
        "tournament scheduler online"
    );

    let mut ticker = interval(Duration::from_secs(args.poll_secs.max(1)));
    loop {
        ticker.tick().await;
        let now_ms = now_ms()?;
        let slot = schedule_for_time(now_ms);
        let prev_slot = slot.slot.saturating_sub(1);
        let slots = if prev_slot == slot.slot {
            vec![slot.slot]
        } else {
            vec![prev_slot, slot.slot]
        };

        for tournament_id in slots {
            let schedule = if tournament_id == slot.slot {
                slot
            } else {
                let slot_start = schedule_for_time(slot.start_time_ms.saturating_sub(1));
                ScheduleSlot {
                    slot: prev_slot,
                    start_time_ms: slot_start.start_time_ms,
                    end_time_ms: slot_start.end_time_ms,
                }
            };

            let tournament = fetch_tournament(&client, tournament_id).await?;
            let phase = tournament
                .as_ref()
                .map(|t| t.phase)
                .unwrap_or(TournamentPhase::Registration);

            if now_ms >= schedule.end_time_ms {
                if phase == TournamentPhase::Active && last_ended_slot != Some(tournament_id) {
                    info!(
                        tournament_id,
                        end_time_ms = schedule.end_time_ms,
                        "ending tournament"
                    );
                    if let Err(err) = submit_instruction(
                        &client,
                        &admin_private,
                        &admin_public,
                        &mut nonce_tracker,
                        Instruction::CasinoEndTournament { tournament_id },
                    )
                    .await
                    {
                        warn!(tournament_id, "failed to end tournament: {err}");
                    } else {
                        last_ended_slot = Some(tournament_id);
                    }
                }
                continue;
            }

            if now_ms >= schedule.start_time_ms
                && now_ms < schedule.end_time_ms
                && phase != TournamentPhase::Active
                && phase != TournamentPhase::Complete
                && last_started_slot != Some(tournament_id)
            {
                info!(
                    tournament_id,
                    start_time_ms = schedule.start_time_ms,
                    end_time_ms = schedule.end_time_ms,
                    "starting tournament"
                );
                if let Err(err) = submit_instruction(
                    &client,
                    &admin_private,
                    &admin_public,
                    &mut nonce_tracker,
                    Instruction::CasinoStartTournament {
                        tournament_id,
                        start_time_ms: schedule.start_time_ms,
                        end_time_ms: schedule.end_time_ms,
                    },
                )
                .await
                {
                    warn!(tournament_id, "failed to start tournament: {err}");
                } else {
                    last_started_slot = Some(tournament_id);
                }
            }
        }
    }
}
