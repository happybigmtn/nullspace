//! Build a Phase 1 freeroll snapshot for Phase 2 eligibility.
//!
//! Usage:
//!   cargo run --release --bin freeroll_snapshot -- --identity <IDENTITY_HEX> [OPTIONS]
//!
//! Options:
//!   -u, --url             Node URL (default: http://localhost:8080)
//!   -i, --identity        Validator identity hex (required)
//!   -o, --output          Output JSON path (default: data/phase1-freeroll-snapshot.json)
//!   --min-credits         Minimum total credits to include (default: 0)
//!   --unlocked-only       Only count unlocked freeroll credits

use clap::Parser;
use commonware_codec::{DecodeExt, Encode};
use commonware_utils::hex;
use nullspace_client::{operation_value, Client};
use nullspace_types::{
    execution::{Key, Value},
    Identity,
};
use serde::Serialize;
use std::path::Path;

#[derive(Parser, Debug)]
#[command(author, version, about = "Phase 1 freeroll snapshot exporter")]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(short, long, default_value = "data/phase1-freeroll-snapshot.json")]
    output: String,

    #[arg(long, default_value = "0")]
    min_credits: u64,

    #[arg(long)]
    unlocked_only: bool,
}

#[derive(Serialize)]
struct PlayerSnapshot {
    public_key_hex: String,
    name: String,
    freeroll_credits: u64,
    freeroll_credits_locked: u64,
    freeroll_credits_total: u64,
    created_ts: u64,
    last_tournament_ts: u64,
}

#[derive(Serialize)]
struct Snapshot {
    generated_at_unix: u64,
    view: u64,
    height: u64,
    unlocked_only: bool,
    min_credits: u64,
    total_players: usize,
    total_eligible: usize,
    total_credits: String,
    players: Vec<PlayerSnapshot>,
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
    let registry_lookup = client.query_state(&Key::PlayerRegistry).await?;
    let Some(registry_lookup) = registry_lookup else {
        return Err("Player registry not found".into());
    };

    let registry = match operation_value(&registry_lookup.operation) {
        Some(Value::PlayerRegistry(registry)) => registry.clone(),
        _ => return Err("Unexpected registry value".into()),
    };

    let mut players = Vec::new();
    let mut total_credits: u128 = 0;

    for public in registry.players.iter() {
        let lookup = client.query_state(&Key::CasinoPlayer(public.clone())).await?;
        let Some(lookup) = lookup else {
            continue;
        };
        let Some(Value::CasinoPlayer(player)) = operation_value(&lookup.operation) else {
            continue;
        };

        let unlocked = player.balances.freeroll_credits;
        let locked = player.balances.freeroll_credits_locked;
        let total = if args.unlocked_only {
            unlocked
        } else {
            unlocked.saturating_add(locked)
        };
        if total < args.min_credits {
            continue;
        }

        total_credits = total_credits.saturating_add(total as u128);
        players.push(PlayerSnapshot {
            public_key_hex: hex(&public.encode()),
            name: player.profile.name.clone(),
            freeroll_credits: unlocked,
            freeroll_credits_locked: locked,
            freeroll_credits_total: total,
            created_ts: player.profile.created_ts,
            last_tournament_ts: player.tournament.last_tournament_ts,
        });
    }

    let generated_at_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = Snapshot {
        generated_at_unix,
        view: registry_lookup.progress.view.get(),
        height: registry_lookup.progress.height,
        unlocked_only: args.unlocked_only,
        min_credits: args.min_credits,
        total_players: registry.players.len(),
        total_eligible: players.len(),
        total_credits: total_credits.to_string(),
        players,
    };

    let output_path = Path::new(&args.output);
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(output_path, serde_json::to_string_pretty(&payload)?)?;
    println!("Wrote snapshot to {}", output_path.display());

    Ok(())
}
