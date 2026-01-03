//! Heuristic sybil scan for player registry clustering.
//!
//! Usage:
//!   cargo run --release --bin sybil_scan -- --identity <IDENTITY_HEX> [OPTIONS]
//!
//! Metadata input (optional):
//! - JSON array or JSONL file with fields:
//!   - public_key_hex (or public_key / player / player_public_key_hex)
//!   - ip (or ip_address), device_id (or device / device_fingerprint / fingerprint), user_agent
//!   - created_ts, last_seen_ts

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use commonware_codec::{DecodeExt, Encode, ReadExt};
use commonware_cryptography::ed25519::PublicKey;
use commonware_utils::{from_hex, hex};
use nullspace_client::{operation_value, Client};
use nullspace_types::{
    execution::{Key, Value},
    Identity,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Parser, Debug)]
#[command(author, version, about = "Heuristic sybil scan for player registry clustering")]
struct Args {
    /// Nullspace simulator base URL (http(s)://host:port)
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    /// Network identity hex (for verifying simulator responses)
    #[arg(short, long)]
    identity: String,

    /// Output JSON path
    #[arg(short, long, default_value = "data/sybil-scan.json")]
    output: String,

    /// Creation time bucket size in seconds
    #[arg(long, default_value = "3600")]
    bucket_seconds: u64,

    /// Minimum cluster size to flag
    #[arg(long, default_value = "3")]
    min_cluster_size: usize,

    /// Optional metadata file (JSON array or JSONL)
    #[arg(long)]
    metadata: Option<String>,

    /// Include all players in the output (default: only flagged players)
    #[arg(long)]
    include_all: bool,
}

#[derive(Deserialize, Debug, Clone)]
struct ExternalSignal {
    #[serde(
        alias = "public_key",
        alias = "player",
        alias = "player_public_key_hex"
    )]
    public_key_hex: String,
    #[serde(default, alias = "ip_address")]
    ip: Option<String>,
    #[serde(
        default,
        alias = "device",
        alias = "device_fingerprint",
        alias = "fingerprint"
    )]
    device_id: Option<String>,
    #[serde(default, alias = "ua")]
    user_agent: Option<String>,
    #[serde(default, alias = "created_at")]
    created_ts: Option<u64>,
    #[serde(default, alias = "last_seen")]
    last_seen_ts: Option<u64>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
struct PlayerSignal {
    public_key_hex: String,
    name: String,
    created_ts: u64,
    last_session_ts: u64,
    sessions_played: u64,
    play_seconds: u64,
    last_tournament_ts: u64,
    ips: Vec<String>,
    device_ids: Vec<String>,
    user_agents: Vec<String>,
    flags: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "snake_case")]
struct Cluster {
    kind: String,
    key: String,
    player_count: usize,
    players: Vec<String>,
    created_ts_min: Option<u64>,
    created_ts_max: Option<u64>,
    avg_sessions_played: f64,
    avg_play_seconds: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "snake_case")]
struct Output {
    generated_at_unix: u64,
    view: u64,
    height: u64,
    bucket_seconds: u64,
    min_cluster_size: usize,
    metadata_records: usize,
    metadata_matched: usize,
    total_players: usize,
    flagged_players: usize,
    clusters: Vec<Cluster>,
    players: Vec<PlayerSignal>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let args = Args::parse();
    let identity = decode_identity(&args.identity)?;
    let client = Client::new(&args.url, identity)?;

    let registry_lookup = client
        .query_state(&Key::PlayerRegistry)
        .await?
        .ok_or_else(|| anyhow!("Player registry not found"))?;
    let registry = match operation_value(&registry_lookup.operation) {
        Some(Value::PlayerRegistry(registry)) => registry.clone(),
        _ => return Err(anyhow!("Unexpected registry value")),
    };

    let mut players: HashMap<String, PlayerSignal> = HashMap::new();
    for public in registry.players.iter() {
        let lookup = client.query_state(&Key::CasinoPlayer(public.clone())).await?;
        let Some(lookup) = lookup else {
            continue;
        };
        let Some(Value::CasinoPlayer(player)) = operation_value(&lookup.operation) else {
            continue;
        };

        let public_key_hex = hex(&public.encode());
        players.insert(
            public_key_hex.clone(),
            PlayerSignal {
                public_key_hex,
                name: player.profile.name.clone(),
                created_ts: player.profile.created_ts,
                last_session_ts: player.session.last_session_ts,
                sessions_played: player.session.sessions_played,
                play_seconds: player.session.play_seconds,
                last_tournament_ts: player.tournament.last_tournament_ts,
                ips: Vec::new(),
                device_ids: Vec::new(),
                user_agents: Vec::new(),
                flags: Vec::new(),
            },
        );
    }

    let mut metadata_records = 0usize;
    let mut metadata_matched = 0usize;
    if let Some(path) = args.metadata.as_ref() {
        let entries = load_metadata(Path::new(path))?;
        metadata_records = entries.len();
        for entry in entries {
            let public_key_hex = match normalize_public_key_hex(&entry.public_key_hex) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let Some(signal) = players.get_mut(&public_key_hex) else {
                continue;
            };
            metadata_matched += 1;
            if let Some(ip) = clean_optional(entry.ip) {
                push_unique(&mut signal.ips, ip);
            }
            if let Some(device) = clean_optional(entry.device_id) {
                push_unique(&mut signal.device_ids, device);
            }
            if let Some(ua) = clean_optional(entry.user_agent) {
                push_unique(&mut signal.user_agents, ua);
            }
            if signal.created_ts == 0 {
                if let Some(created_ts) = entry.created_ts {
                    signal.created_ts = created_ts;
                }
            }
            if let Some(last_seen_ts) = entry.last_seen_ts {
                signal.last_session_ts = signal.last_session_ts.max(last_seen_ts);
            }
        }
    }

    let mut ip_clusters: HashMap<String, Vec<String>> = HashMap::new();
    let mut device_clusters: HashMap<String, Vec<String>> = HashMap::new();
    let mut time_clusters: HashMap<String, Vec<String>> = HashMap::new();

    if args.bucket_seconds > 0 {
        for (pk, player) in players.iter() {
            if player.created_ts == 0 {
                continue;
            }
            let bucket = player.created_ts / args.bucket_seconds;
            let bucket_start = bucket.saturating_mul(args.bucket_seconds);
            let bucket_end = bucket_start.saturating_add(args.bucket_seconds);
            let key = format!("{bucket_start}-{bucket_end}");
            time_clusters.entry(key).or_default().push(pk.clone());
        }
    }

    for (pk, player) in players.iter() {
        for ip in &player.ips {
            ip_clusters.entry(ip.clone()).or_default().push(pk.clone());
        }
        for device in &player.device_ids {
            device_clusters
                .entry(device.clone())
                .or_default()
                .push(pk.clone());
        }
    }

    let mut clusters = Vec::new();
    clusters.extend(build_clusters(
        "ip",
        ip_clusters,
        &players,
        args.min_cluster_size,
    ));
    clusters.extend(build_clusters(
        "device",
        device_clusters,
        &players,
        args.min_cluster_size,
    ));
    clusters.extend(build_clusters(
        "created_bucket",
        time_clusters,
        &players,
        args.min_cluster_size,
    ));

    let mut flags_by_player: HashMap<String, Vec<String>> = HashMap::new();
    for cluster in &clusters {
        let flag = format!("{}:{}", cluster.kind, cluster.key);
        for player in &cluster.players {
            flags_by_player
                .entry(player.clone())
                .or_default()
                .push(flag.clone());
        }
    }

    for (pk, flags) in flags_by_player {
        if let Some(signal) = players.get_mut(&pk) {
            let mut flags = flags;
            flags.sort();
            signal.flags = flags;
        }
    }

    let mut output_players: Vec<PlayerSignal> = players
        .into_values()
        .filter(|player| args.include_all || !player.flags.is_empty())
        .collect();
    output_players.sort_by(|a, b| {
        b.flags
            .len()
            .cmp(&a.flags.len())
            .then_with(|| a.public_key_hex.cmp(&b.public_key_hex))
    });

    clusters.sort_by(|a, b| {
        b.player_count
            .cmp(&a.player_count)
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.key.cmp(&b.key))
    });

    let generated_at_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = Output {
        generated_at_unix,
        view: registry_lookup.progress.view.get(),
        height: registry_lookup.progress.height,
        bucket_seconds: args.bucket_seconds,
        min_cluster_size: args.min_cluster_size,
        metadata_records,
        metadata_matched,
        total_players: registry.players.len(),
        flagged_players: output_players.len(),
        clusters,
        players: output_players,
    };

    let output_path = Path::new(&args.output);
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(output_path, serde_json::to_string_pretty(&payload)?)?;
    println!("Wrote sybil scan report to {}", output_path.display());

    Ok(())
}

fn decode_identity(hex_str: &str) -> Result<Identity> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid identity hex"))?;
    let identity = Identity::decode(&mut bytes.as_slice()).context("Failed to decode identity")?;
    Ok(identity)
}

fn normalize_public_key_hex(hex_str: &str) -> Result<String> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid public key hex"))?;
    let mut buf: &[u8] = bytes.as_slice();
    let key = PublicKey::read(&mut buf).context("Failed to decode public key")?;
    if !buf.is_empty() {
        return Err(anyhow!("Unexpected trailing bytes in public key"));
    }
    Ok(hex(&key.encode()))
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn load_metadata(path: &Path) -> Result<Vec<ExternalSignal>> {
    let raw = std::fs::read_to_string(path).context("Failed to read metadata file")?;
    if let Ok(entries) = serde_json::from_str::<Vec<ExternalSignal>>(&raw) {
        return Ok(entries);
    }

    let mut entries = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let entry: ExternalSignal = serde_json::from_str(trimmed)
            .with_context(|| format!("Failed to parse metadata line {}", idx + 1))?;
        entries.push(entry);
    }
    Ok(entries)
}

fn build_clusters(
    kind: &str,
    clusters: HashMap<String, Vec<String>>,
    players: &HashMap<String, PlayerSignal>,
    min_cluster_size: usize,
) -> Vec<Cluster> {
    let mut out = Vec::new();
    for (key, mut members) in clusters {
        members.sort();
        members.dedup();
        if members.len() < min_cluster_size {
            continue;
        }

        let mut created_min: Option<u64> = None;
        let mut created_max: Option<u64> = None;
        let mut sessions_sum: u128 = 0;
        let mut play_sum: u128 = 0;
        let count = members.len();

        for pk in members.iter() {
            if let Some(player) = players.get(pk) {
                if player.created_ts > 0 {
                    created_min = Some(match created_min {
                        Some(value) => value.min(player.created_ts),
                        None => player.created_ts,
                    });
                    created_max = Some(match created_max {
                        Some(value) => value.max(player.created_ts),
                        None => player.created_ts,
                    });
                }
                sessions_sum = sessions_sum.saturating_add(player.sessions_played as u128);
                play_sum = play_sum.saturating_add(player.play_seconds as u128);
            }
        }

        let avg_sessions_played = if count == 0 {
            0.0
        } else {
            sessions_sum as f64 / count as f64
        };
        let avg_play_seconds = if count == 0 {
            0.0
        } else {
            play_sum as f64 / count as f64
        };

        out.push(Cluster {
            kind: kind.to_string(),
            key,
            player_count: count,
            players: members,
            created_ts_min: created_min,
            created_ts_max: created_max,
            avg_sessions_played,
            avg_play_seconds,
        });
    }
    out
}
