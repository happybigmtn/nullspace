//! Key generation for local consensus network
//!
//! Usage: cargo run --bin generate-keys -- --nodes 3 --output configs/local
//!
//! This generates:
//! - nodeN.yaml files with Ed25519 keys and BLS threshold shares
//! - peers.yaml with all peer addresses
//! - .env.local with the network identity for the frontend

use anyhow::{Context, Result};
use clap::Parser;
use commonware_codec::Encode;
use commonware_cryptography::{
    bls12381::{dkg, primitives::variant::MinSig},
    ed25519::PrivateKey,
    Signer,
};
use commonware_utils::{hex, quorum, NZU32};
use nullspace_node::defaults::{
    DEFAULT_DEQUE_SIZE, DEFAULT_EXECUTION_CONCURRENCY, DEFAULT_LOG_LEVEL,
    DEFAULT_MAILBOX_SIZE, DEFAULT_MAX_PENDING_SEED_LISTENERS, DEFAULT_MEMPOOL_MAX_BACKLOG,
    DEFAULT_MEMPOOL_MAX_TRANSACTIONS, DEFAULT_MESSAGE_BACKLOG, DEFAULT_WORKER_THREADS,
};
use rand::{rngs::StdRng, SeedableRng};
use std::fs;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "generate-keys")]
#[command(about = "Generate keys and configs for a local consensus network")]
struct Args {
    /// Number of nodes in the network
    #[arg(short, long, default_value_t = 4)]
    nodes: u32,

    /// Output directory for configuration files
    #[arg(short, long, default_value = "configs/local")]
    output: PathBuf,

    /// Random seed for key generation (use different seeds for different networks)
    #[arg(short, long, default_value_t = 42)]
    seed: u64,

    /// Base port for P2P communication (nodes use base_port, base_port+1, etc.)
    #[arg(long, default_value_t = 9000)]
    base_port: u16,

    /// Base port for Prometheus metrics (nodes use base+0, base+1, etc.)
    #[arg(long, default_value_t = 9100)]
    metrics_base_port: u16,

    /// Indexer URL (simulator endpoint)
    #[arg(long, default_value = "http://localhost:8080")]
    indexer: String,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("generate-keys failed: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = Args::parse();

    let n = args.nodes;
    let threshold = quorum(n);

    println!("Generating keys for {n}-node network");
    println!("  Threshold: {threshold} of {n} signatures required");
    println!("  Output: {}", args.output.display());
    println!();

    // Use deterministic RNG for reproducibility
    // IMPORTANT: Use different seeds for different environments!
    // Using StdRng for compatibility with commonware tests
    let mut rng = StdRng::seed_from_u64(args.seed);

    // Generate BLS threshold sharing and shares
    let (sharing, shares) = dkg::deal_anonymous::<MinSig>(&mut rng, Default::default(), NZU32!(n));
    let identity = sharing.public().clone();

    let polynomial_hex = hex(&sharing.encode());
    let identity_hex = hex(&identity.encode());

    // Create output directory
    fs::create_dir_all(&args.output).with_context(|| {
        format!(
            "Failed to create output directory {}",
            args.output.display()
        )
    })?;

    // Generate Ed25519 keys first
    let node_data: Vec<_> = (0..n)
        .map(|i| {
            let ed25519_key = PrivateKey::from_seed(args.seed + i as u64);
            let ed25519_pub = ed25519_key.public_key();
            let p2p_port = args.base_port + i as u16;
            let metrics_port = args.metrics_base_port + i as u16;
            (i, ed25519_key, ed25519_pub, p2p_port, metrics_port)
        })
        .collect();

    // Sort by Ed25519 public key to match supervisor's sorting
    // This ensures BLS share indices match participant indices
    let mut sorted_indices: Vec<_> = (0..n as usize).collect();
    sorted_indices.sort_by_key(|&i| node_data[i].2.clone());

    // Create mapping: sorted_index -> original_node_index
    // sorted_indices[sorted_idx] = original_idx
    // shares[sorted_idx] should go to node sorted_indices[sorted_idx]

    println!("Ed25519 key order (sorted -> participant index):");
    for (sorted_idx, &original_idx) in sorted_indices.iter().enumerate() {
        println!(
            "  Node {} (key {}...) -> participant index {}",
            original_idx,
            &hex(&node_data[original_idx as usize].2.encode())[..8],
            sorted_idx
        );
    }
    println!();

    // Generate configs with correct share assignment
    let mut peers_content = String::from("addresses:\n");
    let mut ed25519_keys = Vec::new();

    for i in 0..n {
        let (_, ref ed25519_key, ref ed25519_pub, p2p_port, metrics_port) =
            node_data[i as usize];

        // Find this node's participant index (position in sorted order)
        let participant_idx = sorted_indices
            .iter()
            .position(|&idx| idx == i as usize)
            .with_context(|| format!("Missing participant index for node {i}"))?;

        // Assign the share with matching index
        let share = &shares[participant_idx];

        let bootstrapper = if i == 0 {
            // Node 0 bootstraps from node 1
            let node1_pub = &node_data[1].2;
            format!(
                "bootstrappers: [\"{}\"]",
                hex(&node1_pub.encode())
            )
        } else {
            // Other nodes bootstrap from node 0
            let node0_pub = &node_data[0].2;
            format!(
                "bootstrappers: [\"{}\"]",
                hex(&node0_pub.encode())
            )
        };

        let config = format!(
            r#"# Node {i} Configuration
# Generated by generate-keys (seed: {seed})
# DO NOT commit private keys to version control!

# Cryptographic material
private_key: "{private_key}"
share: "{share}"
polynomial: "{polynomial}"

# Network
port: {p2p_port}
metrics_port: {metrics_port}
indexer: "{indexer}"

# Storage
directory: "./data/node{i}"

# Performance tuning
worker_threads: {worker_threads}
log_level: "{log_level}"

# P2P settings
allowed_peers: []
{bootstrapper}
message_backlog: {message_backlog}
mailbox_size: {mailbox_size}
deque_size: {deque_size}

# Execution settings
execution_concurrency: {execution_concurrency}
mempool_max_backlog: {mempool_max_backlog}
mempool_max_transactions: {mempool_max_transactions}
max_pending_seed_listeners: {max_pending_seed_listeners}
"#,
            i = i,
            seed = args.seed,
            private_key = hex(&ed25519_key.encode()),
            share = hex(&share.encode()),
            polynomial = polynomial_hex,
            p2p_port = p2p_port,
            metrics_port = metrics_port,
            indexer = args.indexer,
            bootstrapper = bootstrapper,
            worker_threads = DEFAULT_WORKER_THREADS,
            log_level = DEFAULT_LOG_LEVEL,
            message_backlog = DEFAULT_MESSAGE_BACKLOG,
            mailbox_size = DEFAULT_MAILBOX_SIZE,
            deque_size = DEFAULT_DEQUE_SIZE,
            execution_concurrency = DEFAULT_EXECUTION_CONCURRENCY,
            mempool_max_backlog = DEFAULT_MEMPOOL_MAX_BACKLOG,
            mempool_max_transactions = DEFAULT_MEMPOOL_MAX_TRANSACTIONS,
            max_pending_seed_listeners = DEFAULT_MAX_PENDING_SEED_LISTENERS,
        );

        let config_path = args.output.join(format!("node{}.yaml", i));
        fs::write(&config_path, config).with_context(|| {
            format!("Failed to write config {}", config_path.display())
        })?;
        println!(
            "Created: {} (participant idx: {}, share idx: {:02})",
            config_path.display(),
            participant_idx,
            participant_idx
        );

        // Add to peers file
        peers_content.push_str(&format!(
            "  \"{}\": \"127.0.0.1:{}\"\n",
            hex(&ed25519_pub.encode()),
            p2p_port
        ));

        ed25519_keys.push((ed25519_pub.clone(), p2p_port));
    }

    // Write peers file
    let peers_path = args.output.join("peers.yaml");
    fs::write(&peers_path, peers_content)
        .with_context(|| format!("Failed to write peers file {}", peers_path.display()))?;
    println!("Created: {}", peers_path.display());

    // Write identity for frontend (.env.local format)
    let env_content = format!(
        "# Network identity for frontend\n# Generated by generate-keys (seed: {})\nVITE_IDENTITY={}\nVITE_URL={}\n",
        args.seed, identity_hex, args.indexer
    );
    let env_path = args.output.join(".env.local");
    fs::write(&env_path, &env_content)
        .with_context(|| format!("Failed to write .env.local {}", env_path.display()))?;
    println!("Created: {}", env_path.display());

    println!();
    println!("=== Network Configuration ===");
    println!();
    println!("Identity (96 bytes BLS public key):");
    println!("  {}", identity_hex);
    println!();
    println!("Nodes:");
    for (i, (pk, port)) in ed25519_keys.iter().enumerate() {
        println!("  Node {}: port {} ({}...)", i, port, &hex(&pk.encode())[..16]);
    }
    println!();
    println!("Threshold: {}/{} signatures required for consensus", threshold, n);
    println!();
    println!("=== Next Steps ===");
    println!();
    println!("1. Copy frontend env:");
    println!("   cp {} website/.env.local", env_path.display());
    println!();
    println!("2. Start the network:");
    println!("   ./scripts/start-local-network.sh {} {}", args.output.display(), n);
    println!();
    println!("3. Start frontend:");
    println!("   cd website && npm run dev");

    Ok(())
}
