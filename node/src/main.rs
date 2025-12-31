use anyhow::{Context, Result};
use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use clap::{Arg, ArgAction, Command};
use commonware_codec::DecodeExt;
use commonware_cryptography::{ed25519::PublicKey, Signer};
use commonware_deployer::ec2::Hosts;
use commonware_p2p::authenticated::discovery as authenticated;
use commonware_runtime::{tokio, Metrics, Runner, Spawner};
use commonware_runtime::tokio::tracing::Config as TraceConfig;
use commonware_utils::{from_hex_formatted, union_unique};
use futures::future::try_join_all;
use governor::Quota;
use nullspace_client::Client;
use nullspace_node::{engine, parse_peer_public_key, Config, Peers};
use nullspace_types::NAMESPACE;
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    str::FromStr,
    sync::Arc,
};
use tracing::{error, info, Level};

const PENDING_CHANNEL: u32 = 0;
const RECOVERED_CHANNEL: u32 = 1;
const RESOLVER_CHANNEL: u32 = 2;
const BROADCASTER_CHANNEL: u32 = 3;
const BACKFILL_BY_DIGEST_CHANNEL: u32 = 4;
const SEEDER_CHANNEL: u32 = 5;
const AGGREGATOR_CHANNEL: u32 = 6;
const AGGREGATION_CHANNEL: u32 = 7;

type PeerList = Vec<PublicKey>;
type BootstrapList = Vec<(PublicKey, SocketAddr)>;
type PeerConfig = (IpAddr, PeerList, BootstrapList);

fn format_bytes(bytes: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = 1024 * 1024;
    const GIB: u64 = 1024 * 1024 * 1024;

    if bytes >= GIB {
        format!("{:.2} GiB", bytes as f64 / GIB as f64)
    } else if bytes >= MIB {
        format!("{:.2} MiB", bytes as f64 / MIB as f64)
    } else if bytes >= KIB {
        format!("{:.2} KiB", bytes as f64 / KIB as f64)
    } else {
        format!("{bytes} B")
    }
}

fn resolve_trace_config() -> Option<TraceConfig> {
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok()?;
    if endpoint.trim().is_empty() {
        return None;
    }
    let name = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "nullspace-node".to_string());
    let rate = std::env::var("OTEL_SAMPLING_RATE")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value.clamp(0.0, 1.0))
        .unwrap_or(1.0);
    Some(TraceConfig {
        endpoint,
        name,
        rate,
    })
}

struct MetricsState {
    context: tokio::Context,
    auth_token: Option<String>,
}

fn metrics_auth_token() -> Option<String> {
    let token = std::env::var("METRICS_AUTH_TOKEN").ok()?;
    let trimmed = token.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn metrics_handler(
    State(state): State<Arc<MetricsState>>,
    headers: HeaderMap,
) -> Result<Response<Body>, StatusCode> {
    if let Some(token) = state.auth_token.as_deref() {
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "));
        let header_token = headers
            .get("x-metrics-token")
            .and_then(|value| value.to_str().ok());

        if bearer != Some(token) && header_token != Some(token) {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/plain; version=0.0.4")
        .body(Body::from(state.context.encode()))
        .expect("Failed to create metrics response"))
}

fn spawn_metrics_server(context: tokio::Context, addr: SocketAddr) {
    let state = Arc::new(MetricsState {
        context: context.clone(),
        auth_token: metrics_auth_token(),
    });
    context.with_label("metrics").spawn(move |_context| async move {
        let listener = ::tokio::net::TcpListener::bind(addr)
            .await
            .expect("Failed to bind metrics server");
        let app = Router::new()
            .route("/metrics", get(metrics_handler))
            .with_state(state);
        axum::serve(listener, app.into_make_service())
            .await
            .expect("Could not serve metrics");
    });
}

fn print_dry_run_report(config: &nullspace_node::ValidatedConfig, peer_count: usize, ip: IpAddr) {
    let pool_bytes = (config.buffer_pool_page_size.get() as u64)
        .saturating_mul(config.buffer_pool_capacity.get() as u64);

    println!("dry-run report");
    println!("  identity: {:?}", config.identity);
    println!("  public_key: {:?}", config.public_key);
    println!("  ip: {ip}");
    println!("  peers: {peer_count}");
    println!(
        "  ports: p2p={} metrics={}",
        config.port, config.metrics_port
    );
    println!("  storage_dir: {}", config.directory.display());
    println!(
        "  buffer_pool: page_size={}B capacity={} (~{})",
        config.buffer_pool_page_size.get(),
        config.buffer_pool_capacity.get(),
        format_bytes(pool_bytes)
    );
    println!(
        "  freezer_tables: blocks_init={} finalized_init={}",
        config.blocks_freezer_table_initial_size, config.finalized_freezer_table_initial_size
    );
    println!(
        "  consensus: leader_timeout={:?} notarization_timeout={:?} fetch_timeout={:?} fetch_concurrent={}",
        config.leader_timeout, config.notarization_timeout, config.fetch_timeout, config.fetch_concurrent
    );
    println!(
        "  fetch: max_fetch_count={} max_fetch_size={}B fetch_rate_per_peer={} rps",
        config.max_fetch_count,
        config.max_fetch_size,
        config.fetch_rate_per_peer_per_second.get()
    );
    println!(
        "  mempool: max_backlog={} max_transactions={}",
        config.mempool_max_backlog, config.mempool_max_transactions
    );
    println!(
        "  mempool_stream: buffer_size={}",
        config.mempool_stream_buffer_size
    );
    println!(
        "  nonce_cache: capacity={} ttl_seconds={}",
        config.nonce_cache_capacity,
        config.nonce_cache_ttl.as_secs()
    );
    println!("  network: max_message_size={}B", config.max_message_size);
    println!(
        "  seeder: max_pending_seed_listeners={}",
        config.max_pending_seed_listeners
    );
    println!(
        "  uploads: max_outstanding={}",
        config.max_uploads_outstanding
    );
    println!("  execution: concurrency={}", config.execution_concurrency);
}

fn parse_bootstrappers(
    peers: &HashMap<PublicKey, SocketAddr>,
    bootstrappers: &[String],
    source: &'static str,
) -> Result<BootstrapList> {
    let mut bootstrap_sockets = Vec::new();
    for bootstrapper in bootstrappers {
        let key = from_hex_formatted(bootstrapper)
            .with_context(|| format!("Could not parse bootstrapper key {bootstrapper}"))?;
        let key = PublicKey::decode(key.as_ref())
            .with_context(|| format!("Bootstrapper key is invalid: {bootstrapper}"))?;
        let socket = peers
            .get(&key)
            .with_context(|| format!("Could not find bootstrapper {bootstrapper} in {source}"))?;
        bootstrap_sockets.push((key, *socket));
    }
    Ok(bootstrap_sockets)
}

fn load_peers(
    hosts_file: Option<String>,
    peers_file: Option<String>,
    bootstrappers: &[String],
    port: u16,
    public_key: &PublicKey,
) -> Result<PeerConfig> {
    let (peers, source) = if let Some(hosts_file) = hosts_file {
        let hosts_file_contents = std::fs::read_to_string(&hosts_file)
            .with_context(|| format!("Could not read hosts file {hosts_file}"))?;
        let hosts: Hosts =
            serde_yaml::from_str(&hosts_file_contents).context("Could not parse hosts file")?;
        let peers: HashMap<PublicKey, SocketAddr> = hosts
            .hosts
            .into_iter()
            .filter_map(|peer| match parse_peer_public_key(&peer.name) {
                Some(key) => Some((key, SocketAddr::new(peer.ip, port))),
                None => {
                    info!(name = peer.name, "Skipping non-peer host");
                    None
                }
            })
            .collect();
        (peers, "hosts")
    } else {
        let peers_file = peers_file.context("missing --peers")?;
        let peers_file_contents = std::fs::read_to_string(&peers_file)
            .with_context(|| format!("Could not read peers file {peers_file}"))?;
        let peers: Peers =
            serde_yaml::from_str(&peers_file_contents).context("Could not parse peers file")?;
        let peers: HashMap<PublicKey, SocketAddr> = peers
            .addresses
            .into_iter()
            .filter_map(|peer| match parse_peer_public_key(&peer.0) {
                Some(key) => Some((key, peer.1)),
                None => {
                    info!(name = peer.0, "Skipping non-peer address");
                    None
                }
            })
            .collect();
        (peers, "peers")
    };

    let peer_keys = peers.keys().cloned().collect::<Vec<_>>();
    let bootstrap_sockets = parse_bootstrappers(&peers, bootstrappers, source)?;
    let ip = peers
        .get(public_key)
        .with_context(|| format!("Could not find self in {source}"))?
        .ip();
    Ok((ip, peer_keys, bootstrap_sockets))
}

fn main() {
    if let Err(err) = main_result() {
        eprintln!("{err:?}");
        std::process::exit(1);
    }
}

fn main_result() -> Result<()> {
    // Parse arguments
    let matches = Command::new("node")
        .about("Node for a nullspace chain.")
        .arg(Arg::new("hosts").long("hosts").required(false))
        .arg(Arg::new("peers").long("peers").required(false))
        .arg(
            Arg::new("dry-run")
                .long("dry-run")
                .help("Validate config/peers and exit without starting the node")
                .action(ArgAction::SetTrue),
        )
        .arg(Arg::new("config").long("config").required(true))
        .get_matches();

    // Load ip file
    let hosts_file = matches.get_one::<String>("hosts").cloned();
    let peers_file = matches.get_one::<String>("peers").cloned();
    let dry_run = matches.get_flag("dry-run");
    if hosts_file.is_none() && peers_file.is_none() {
        anyhow::bail!("Either --hosts or --peers must be provided");
    }

    // Load config
    let config_file = matches
        .get_one::<String>("config")
        .context("missing --config")?;
    let config_file = std::fs::read_to_string(config_file)
        .with_context(|| format!("Could not read config file {config_file}"))?;
    let config: Config =
        serde_yaml::from_str(&config_file).context("Could not parse config file")?;

    if dry_run {
        println!("{:#?}", config.redacted_debug());

        let signer = config.parse_signer().context("Private key is invalid")?;
        let public_key = signer.public_key();

        let (ip, peers, _bootstrappers) = load_peers(
            hosts_file,
            peers_file,
            &config.bootstrappers,
            config.port,
            &public_key,
        )?;
        let peers_u32 = peers.len() as u32;

        let config = config.validate_with_signer(signer, peers_u32)?;
        let _indexer = Client::new(&config.indexer, config.identity)
            .context("Failed to create indexer client")?;

        print_dry_run_report(&config, peers.len(), ip);
        println!("config ok");
        return Ok(());
    }

    // Initialize runtime
    let cfg = tokio::Config::default()
        .with_tcp_nodelay(Some(true))
        .with_worker_threads(config.worker_threads)
        .with_storage_directory(PathBuf::from(&config.directory))
        .with_catch_panics(true);
    let executor = tokio::Runner::new(cfg);

    // Start runtime
    executor.start(|context| async move {
        let context = context.with_label("nullspace");
        let result: Result<()> = async {
            let use_json_logs = hosts_file.is_some();

            // Configure telemetry
            let log_level = Level::from_str(&config.log_level).context("Invalid log level")?;
            tokio::telemetry::init(
                context.with_label("telemetry"),
                tokio::telemetry::Logging {
                    level: log_level,
                    // If we are using `commonware-deployer`, we should use structured logging.
                    json: use_json_logs,
                },
                None,
                resolve_trace_config(),
            );
            spawn_metrics_server(
                context.clone(),
                SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), config.metrics_port),
            );
            info!(config = ?config.redacted_debug(), "loaded config file");

            let signer = config.parse_signer().context("Private key is invalid")?;
            let public_key = signer.public_key();

            // Load peers
            let (ip, peers, bootstrappers) = load_peers(
                hosts_file,
                peers_file,
                &config.bootstrappers,
                config.port,
                &public_key,
            )?;
            info!(peers = peers.len(), "loaded peers");
            let peers_u32 = peers.len() as u32;

            let config = config.validate_with_signer(signer, peers_u32)?;
            let identity = config.identity;
            info!(
                ?config.public_key,
                ?identity,
                ?ip,
                port = config.port,
                "loaded config"
            );

            // Configure network
            let p2p_namespace = union_unique(NAMESPACE, b"_P2P");
            let mut p2p_cfg = authenticated::Config::aggressive(
                config.signer.clone(),
                &p2p_namespace,
                SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), config.port),
                SocketAddr::new(ip, config.port),
                bootstrappers,
                config.max_message_size,
            );
            p2p_cfg.mailbox_size = config.mailbox_size;

            // Start p2p
            let (mut network, mut oracle) =
                authenticated::Network::new(context.with_label("network"), p2p_cfg);

            // Provide authorized peers
            oracle.register(0, peers.clone()).await;

            // Register pending channel
            let pending_limit = Quota::per_second(config.pending_rate_per_second);
            let pending = network.register(PENDING_CHANNEL, pending_limit, config.message_backlog);

            // Register recovered channel
            let recovered_limit = Quota::per_second(config.recovered_rate_per_second);
            let recovered =
                network.register(RECOVERED_CHANNEL, recovered_limit, config.message_backlog);

            // Register resolver channel
            let resolver_limit = Quota::per_second(config.resolver_rate_per_second);
            let resolver =
                network.register(RESOLVER_CHANNEL, resolver_limit, config.message_backlog);

            // Register broadcast channel
            let broadcaster_limit = Quota::per_second(config.broadcaster_rate_per_second);
            let broadcaster = network.register(
                BROADCASTER_CHANNEL,
                broadcaster_limit,
                config.message_backlog,
            );

            // Register backfill channel
            let backfill_quota = Quota::per_second(config.backfill_rate_per_second);
            let backfill = network.register(
                BACKFILL_BY_DIGEST_CHANNEL,
                backfill_quota,
                config.message_backlog,
            );

            // Register seeder channel
            let seeder = network.register(SEEDER_CHANNEL, backfill_quota, config.message_backlog);

            // Register aggregator channel
            let aggregator =
                network.register(AGGREGATOR_CHANNEL, backfill_quota, config.message_backlog);

            // Register aggregation channel
            let aggregation_quota = Quota::per_second(config.aggregation_rate_per_second);
            let aggregation = network.register(
                AGGREGATION_CHANNEL,
                aggregation_quota,
                config.message_backlog,
            );

            // Create network
            let p2p = network.start();

            // Create indexer
            let indexer = Client::new(&config.indexer, identity)
                .context("Failed to create indexer client")?;

            // Create engine
            let config = engine::Config {
                blocker: oracle,
                identity: engine::IdentityConfig {
                    signer: config.signer,
                    polynomial: config.polynomial,
                    share: config.share,
                    participants: peers,
                },
                storage: engine::StorageConfig {
                    partition_prefix: "engine".to_string(),
                    blocks_freezer_table_initial_size: config.blocks_freezer_table_initial_size,
                    finalized_freezer_table_initial_size: config
                        .finalized_freezer_table_initial_size,
                    buffer_pool_page_size: config.buffer_pool_page_size,
                    buffer_pool_capacity: config.buffer_pool_capacity,
                    prunable_items_per_section: config.prunable_items_per_section,
                    immutable_items_per_section: config.immutable_items_per_section,
                    freezer_table_resize_frequency: config.freezer_table_resize_frequency,
                    freezer_table_resize_chunk_size: config.freezer_table_resize_chunk_size,
                    freezer_journal_target_size: config.freezer_journal_target_size,
                    freezer_journal_compression: config.freezer_journal_compression,
                    mmr_items_per_blob: config.mmr_items_per_blob,
                    log_items_per_section: config.log_items_per_section,
                    locations_items_per_blob: config.locations_items_per_blob,
                    certificates_items_per_blob: config.certificates_items_per_blob,
                    cache_items_per_blob: config.cache_items_per_blob,
                    replay_buffer: config.replay_buffer_bytes,
                    write_buffer: config.write_buffer_bytes,
                    max_repair: config.max_repair,
                },
                consensus: engine::ConsensusConfig {
                    mailbox_size: config.mailbox_size,
                    backfill_quota,
                    deque_size: config.deque_size,
                    leader_timeout: config.leader_timeout,
                    notarization_timeout: config.notarization_timeout,
                    nullify_retry: config.nullify_retry,
                    fetch_timeout: config.fetch_timeout,
                    activity_timeout: config.activity_timeout,
                    skip_timeout: config.skip_timeout,
                    max_fetch_count: config.max_fetch_count,
                    max_fetch_size: config.max_fetch_size,
                    fetch_concurrent: config.fetch_concurrent,
                    fetch_rate_per_peer: Quota::per_second(config.fetch_rate_per_peer_per_second),
                },
                application: engine::ApplicationConfig {
                    indexer,
                    execution_concurrency: config.execution_concurrency,
                    max_uploads_outstanding: config.max_uploads_outstanding,
                    mempool_max_backlog: config.mempool_max_backlog,
                    mempool_max_transactions: config.mempool_max_transactions,
                    max_pending_seed_listeners: config.max_pending_seed_listeners,
                    mempool_stream_buffer_size: config.mempool_stream_buffer_size,
                    nonce_cache_capacity: config.nonce_cache_capacity,
                    nonce_cache_ttl: config.nonce_cache_ttl,
                    prune_interval: config.prune_interval,
                    ancestry_cache_entries: config.ancestry_cache_entries,
                    proof_queue_size: config.proof_queue_size,
                },
            };
            let engine = engine::Engine::new(context.with_label("engine"), config).await;

            // Start engine
            let engine = engine.start(
                pending,
                recovered,
                resolver,
                broadcaster,
                backfill,
                seeder,
                aggregator,
                aggregation,
            );

            // Wait for any task to error
            if let Err(e) = try_join_all(vec![p2p, engine]).await {
                error!(?e, "task failed");
            }
            Ok(())
        }
        .await;

        if let Err(e) = result {
            error!(?e, "node initialization failed");
        }
    });

    Ok(())
}
