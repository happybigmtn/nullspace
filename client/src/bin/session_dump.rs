//! Session dump tool - fetches casino session/player state and recent game history.
//!
//! Usage:
//!   cargo run --release --bin session-dump -- --identity <IDENTITY_HEX> --session-id <ID>
//!   cargo run --release --bin session-dump -- --identity <IDENTITY_HEX> --player <PUBKEY_HEX>

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use commonware_codec::{DecodeExt, Encode};
use commonware_utils::hex;
use nullspace_client::{operation_value, Client};
use nullspace_types::{
    casino::{CasinoLeaderboard, Tournament},
    execution::{Key, Value},
    Identity,
};
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::warn;

#[derive(Parser, Debug)]
#[command(author, version, about = "Dump casino session/player state for diagnostics")]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(long)]
    session_id: Option<u64>,

    #[arg(long)]
    player: Option<String>,

    #[arg(long, default_value = "10")]
    history_limit: usize,
}

#[derive(Serialize)]
struct SessionSummary {
    id: u64,
    player: String,
    game_type: String,
    bet: u64,
    move_count: u32,
    created_at: u64,
    is_complete: bool,
    is_tournament: bool,
    tournament_id: Option<u64>,
    state_blob_len: usize,
    state_blob_head_hex: String,
}

#[derive(Serialize)]
struct SessionDump {
    generated_at_ms: u64,
    session_id: Option<u64>,
    player_public_key: Option<String>,
    session: Option<SessionSummary>,
    player_debug: Option<String>,
    tournament_debug: Option<String>,
    leaderboard_debug: Option<String>,
    game_history: Option<JsonValue>,
}

fn decode_identity(hex_str: &str) -> Result<Identity> {
    let bytes = commonware_utils::from_hex(hex_str).ok_or_else(|| anyhow!("Invalid identity hex"))?;
    Identity::decode(&mut bytes.as_slice()).context("Failed to decode identity")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn state_blob_head_hex(blob: &[u8]) -> String {
    let preview_len = blob.len().min(64);
    hex(&blob[..preview_len])
}

async fn fetch_leaderboard(client: &Client) -> Result<Option<CasinoLeaderboard>> {
    let lookup = client.query_state(&Key::CasinoLeaderboard).await?;
    Ok(match lookup.and_then(|lookup| operation_value(&lookup.operation).cloned()) {
        Some(Value::CasinoLeaderboard(leaderboard)) => Some(leaderboard),
        _ => None,
    })
}

async fn fetch_tournament(client: &Client, tournament_id: u64) -> Result<Option<Tournament>> {
    let lookup = client.query_state(&Key::Tournament(tournament_id)).await?;
    Ok(match lookup.and_then(|lookup| operation_value(&lookup.operation).cloned()) {
        Some(Value::Tournament(tournament)) => Some(tournament),
        _ => None,
    })
}

async fn fetch_game_history(
    client: &Client,
    player_hex: &str,
    limit: usize,
) -> Result<Option<JsonValue>> {
    let url = client
        .base_url
        .join(&format!("explorer/games/{player_hex}?limit={limit}"))?;
    let response = client.http_client.get(url).send().await?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let data = response.json::<JsonValue>().await?;
    Ok(Some(data))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    if args.session_id.is_none() && args.player.is_none() {
        return Err(anyhow!("Provide --session-id or --player"));
    }

    let identity = decode_identity(&args.identity)?;
    let client = Client::new(&args.url, identity)?;

    let mut session_summary = None;
    let mut player_hex = args.player.as_deref().map(|s| s.to_string());
    let mut tournament_debug = None;

    if let Some(session_id) = args.session_id {
        let lookup = client.query_state(&Key::CasinoSession(session_id)).await?;
        if let Some(Value::CasinoSession(session)) =
            lookup.and_then(|lookup| operation_value(&lookup.operation).cloned())
        {
            let pk_hex = hex(&session.player.encode());
            player_hex = Some(pk_hex.clone());
            session_summary = Some(SessionSummary {
                id: session.id,
                player: pk_hex,
                game_type: format!("{:?}", session.game_type),
                bet: session.bet,
                move_count: session.move_count,
                created_at: session.created_at,
                is_complete: session.is_complete,
                is_tournament: session.is_tournament,
                tournament_id: session.tournament_id,
                state_blob_len: session.state_blob.len(),
                state_blob_head_hex: state_blob_head_hex(&session.state_blob),
            });

            if let Some(tournament_id) = session.tournament_id {
                if let Ok(Some(tournament)) = fetch_tournament(&client, tournament_id).await {
                    tournament_debug = Some(format!("{tournament:?}"));
                }
            }
        } else {
            warn!(session_id, "casino session not found");
        }
    }

    let mut player_debug = None;
    if let Some(pk_hex) = player_hex.as_deref() {
        let raw = commonware_utils::from_hex(pk_hex).ok_or_else(|| anyhow!("Invalid player hex"))?;
        let public = commonware_cryptography::ed25519::PublicKey::decode(&mut raw.as_slice())
            .context("Failed to decode player public key")?;
        let lookup = client.query_state(&Key::CasinoPlayer(public)).await?;
        if let Some(Value::CasinoPlayer(player)) =
            lookup.and_then(|lookup| operation_value(&lookup.operation).cloned())
        {
            player_debug = Some(format!("{player:?}"));
        } else {
            warn!(player = %pk_hex, "casino player not found");
        }
    }

    let leaderboard_debug = fetch_leaderboard(&client)
        .await?
        .map(|leaderboard| format!("{leaderboard:?}"));

    let game_history = if let Some(pk_hex) = player_hex.as_deref() {
        fetch_game_history(&client, pk_hex, args.history_limit).await?
    } else {
        None
    };

    let output = SessionDump {
        generated_at_ms: now_ms(),
        session_id: args.session_id,
        player_public_key: player_hex,
        session: session_summary,
        player_debug,
        tournament_debug,
        leaderboard_debug,
        game_history,
    };

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
