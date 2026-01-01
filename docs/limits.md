# Limits inventory (current defaults)

This file lists the current hard limits and defaults so we can tune them intentionally.
Consensus-critical limits are called out explicitly.

## Node (configurable via node config)
- message_backlog: 128 (generated in `node/src/bin/generate_keys.rs`)
- mailbox_size: 1024
- deque_size: 128
- mempool_max_backlog: 64
- mempool_max_transactions: 100000
- mempool_stream_buffer_size: 4096
- nonce_cache_capacity: 100000
- nonce_cache_ttl_seconds: 600
- max_pending_seed_listeners: 10000
- max_uploads_outstanding: 4
- max_message_size: 10 MB
- leader_timeout_ms: 1000
- notarization_timeout_ms: 2000
- nullify_retry_ms: 10000
- fetch_timeout_ms: 2000
- activity_timeout: 256
- skip_timeout: 32
- fetch_concurrent: 16
- max_fetch_count: 16
- max_fetch_size: 1 MB
- buffer_pool_page_size: 4096
- buffer_pool_capacity: 32768
- prunable_items_per_section: 4096
- immutable_items_per_section: 262144
- freezer_table_resize_frequency: 4
- freezer_table_resize_chunk_size: 65536
- freezer_journal_target_size: 1 GiB
- freezer_journal_compression: 3 (zstd level)
- mmr_items_per_blob: 128000
- log_items_per_section: 64000
- locations_items_per_blob: 128000
- certificates_items_per_blob: 128000
- cache_items_per_blob: 256
- replay_buffer_bytes: 8 MB
- write_buffer_bytes: 1 MB
- max_repair: 20
- prune_interval: 10000
- ancestry_cache_entries: 64
- proof_queue_size: 64
- pending_rate_per_second: 128
- recovered_rate_per_second: 128
- resolver_rate_per_second: 128
- broadcaster_rate_per_second: 32
- backfill_rate_per_second: 8
- aggregation_rate_per_second: 128
- fetch_rate_per_peer_per_second: 128

## Simulator (configurable via simulator config / CLI)
- http_rate_limit_per_second: 1000
- http_rate_limit_burst: 5000
- submit_rate_limit_per_minute: 100
- submit_rate_limit_burst: 10
- http_body_limit_bytes: 8 MB
- ws_outbound_buffer: 256
- ws_max_connections: 20000
- ws_max_connections_per_ip: 10
- ws_max_message_bytes: 4 MB
- updates_broadcast_buffer: 1024
- mempool_broadcast_buffer: 1024
- updates_index_concurrency: 8
- submission_history_limit: 10000
- seed_history_limit: 10000
- explorer_max_blocks: 10000
- explorer_max_account_entries: 2000
- explorer_max_accounts: 10000
- explorer_max_game_event_accounts: 10000
- state_max_key_versions: 1
- state_max_progress_entries: 10000

## Gateway (configurable via env)
- max_connections_per_ip: 5 (`MAX_CONNECTIONS_PER_IP`)
- max_total_sessions: 1000 (`MAX_TOTAL_SESSIONS`)
- session_rate_limit_points: 10 (`GATEWAY_SESSION_RATE_LIMIT_POINTS`)
- session_rate_limit_window_ms: 3600000 (`GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS`)
- session_rate_limit_block_ms: 3600000 (`GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS`)
- event_timeout_ms: 30000 (`GATEWAY_EVENT_TIMEOUT_MS`)

### Testnet recommended overrides (initial 5k concurrent target)
Simulator:
- `RATE_LIMIT_HTTP_PER_SEC=5000`
- `RATE_LIMIT_HTTP_BURST=10000`
- `RATE_LIMIT_SUBMIT_PER_MIN=120000`
- `RATE_LIMIT_SUBMIT_BURST=20000`
- `RATE_LIMIT_WS_CONNECTIONS=30000` (raise if >20k WS clients expected)
- `RATE_LIMIT_WS_CONNECTIONS_PER_IP=500`

Gateway:
- `MAX_CONNECTIONS_PER_IP=200`
- `MAX_TOTAL_SESSIONS=20000`
- `GATEWAY_SESSION_RATE_LIMIT_POINTS=1000`
- `GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS=3600000`
- `GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS=600000`
- `GATEWAY_EVENT_TIMEOUT_MS=30000`

## Casino engine (consensus-critical)
- baccarat_max_bets: 11
- craps_max_bets: 20
- roulette_max_bets: 20
- sic_bo_max_bets: 20
- casino_max_payload_length: 256
- casino_max_name_length: 32
- game_session_state_blob_max_bytes: 1024

## Protocol/API (consensus-critical)
- max_block_transactions: 500
- max_submission_transactions: 128
- max_state_proof_ops: 3000
- max_events_proof_ops: 2000
- max_lookup_proof_nodes: 500

Notes:
- Casino limits live in `execution/src/casino/limits.rs` and require a coordinated upgrade to change.
- Node/simulator limits live in config defaults and can be tuned per deployment.
