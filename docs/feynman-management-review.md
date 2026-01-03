# Feynman Callout Review (Management + Limits)

This report lists every lesson that contains a **Limits & management callouts** section and shows the mapped action items plus their current status.

Note: some callouts are informational or already enforced by compile-time/consensus rules; they may not require a new action item beyond documentation.

Status legend:
- [x] Implemented
- [~] Needs decision
- [ ] Pending

## E01-architecture-overview
Mapped action items: Item 38 [x], Item 39 [x]

- 1) **Single table per game is a deliberate non-goal for sharding** - The architecture explicitly avoids multiple tables per game. - This simplifies UX but limits concurrency growth.
- 2) **Timing defaults are intentionally conservative** - Default round timings are not aggressive to avoid rushing players. - Keep defaults for 5k until telemetry suggests change. ---

## E02-component-roles-topology
Mapped action items: Item 37 [x], Item 38 [x], Item 8 [x]

- 1) **Private network is mandatory for security** - Only public-facing services should have public IPs. - Leaving internal ports open to the internet is a critical risk.
- 2) **Gateway session caps are per-host** - `MAX_TOTAL_SESSIONS` is per gateway instance. - Scale gateways horizontally as concurrency grows; raise per-IP caps for NAT-heavy traffic.
- 3) **Single simulator/indexer at 5k** - Above 5k players, the runbook recommends adding replicas behind an LB. ---

## E03-node-entrypoint
Mapped action items: Item 2 [x], Item 12 [x]

- 1) **Metrics auth is required in production** - If `NODE_ENV=production`, `METRICS_AUTH_TOKEN` must be set. - Without it, metrics requests are rejected.
- 2) **Network channels are rate-limited** - Each channel has a `Quota::per_second(...)` limit. - Misconfigured rates can cause stalls or flooding. ---

## E04-consensus-seeding
Mapped action items: Item 14 [x], Item 12 [x]

- 1) **Proof sizes are explicitly bounded** - Proof decoding uses constants like `MAX_STATE_PROOF_NODES` and `MAX_EVENTS_PROOF_NODES`. - If these are too small, valid proofs will be rejected.
- 2) **Batch sizes and retry delays are fixed** - Both actors use `BATCH_ENQUEUE = 20` and `RETRY_DELAY = 10s`. - If the network is large, these may need tuning. ---

## E05-storage-persistence
Mapped action items: Item 16 [x], Item 17 [x], Item 40 [x]

- 1) **Retention limits are configurable** - Explorer retention uses flags like `--explorer-max-blocks`. - If set too low, historical data disappears.
- 2) **RPO/RTO targets are defined** - RPO 15 minutes, RTO 4 hours are initial targets. - Validate with quarterly restore drills + annual failover rehearsal. ---

## E06-execution-engine
Mapped action items: Item 15 [x]

- 1) **Super mode fee is fixed at 20%** - `get_super_mode_fee` returns `bet / 5`. - Changing this affects economics and must be coordinated.
- 2) **Dispatch is exhaustive over GameType** - If a new game is added, it must be wired into both `init_game` and `process_game_move`. ---

## E07-rng-fairness
Mapped action items: Item 14 [x]

- 1) **RNG is deterministic, not private** - This RNG is for consensus determinism, not secrecy. - If you need hidden randomness, use commit-reveal or VRF.
- 2) **Bias prevention only for bounded draws** - `next_bounded` uses rejection sampling. - If you bypass it, you can introduce bias. ---

## E08-protocol-packages
Mapped action items: Item 14 [x]

- 1) **Schema drift is a real risk** - If Rust and TS schemas diverge, clients and nodes will disagree. - Any schema change must be coordinated across packages.
- 2) **Runtime validation costs CPU** - Zod validation adds overhead; avoid validating large payloads repeatedly. ---

## E09-mobile-app
Mapped action items: Item 28 [x]

- 1) **WebSocket reconnects on foreground** - The app reconnects when returning to the foreground. - Exponential backoff (1s -> 30s) avoids gateway spam.
- 2) **Balance parsing expects numeric strings** - If the gateway changes balance formats, parsing will fail. ---

## E10-web-app
Mapped action items: Item 29 [x], Item 44 [x]

- 1) **Lazy loading hides runtime errors until route usage** - If a lazy component fails, the error appears only when the route is visited. - Monitor errors on all routes, not just home.
- 2) **Large UI state surfaces many feature flags** - The casino app uses feature flags and envs; misconfigurations can disable key UI flows. - Use the preflight check for required `VITE_*` values. ---

## E11-telemetry-ops
Mapped action items: Item 17 [x], Item 1 [x], Item 43 [x]

- 1) **Telemetry is disabled unless OTLP endpoint is set** - This is safe by default but can hide issues if you forget to configure it. - Set OTLP endpoint + sampling in testnet.
- 2) **Ops service stores data on disk** - If `OPS_DATA_DIR` is not persistent, analytics will be lost on restart.
- 3) **CORS allowlist default is permissive** - If `OPS_ALLOWED_ORIGINS` is empty, all origins are allowed. - This is risky in production; set an allowlist. ---

## E12-ci-docker
Mapped action items: Item 34 [x]

- 1) **Images are built on every push to main/master** - This can be expensive; ensure CI budgets are monitored.
- 2) **Website build args depend on secrets** - If secrets are missing, the website image may be misconfigured.
- 3) **Multi-stage Docker relies on stable Cargo.toml caching** - Changes to workspace manifests invalidate build cache and slow CI. ---

## E13-systemd-services
Mapped action items: Item 35 [x]

- 1) **File descriptor limit is explicit** - Gateway service sets `LimitNOFILE=100000`. - This is critical for high WebSocket concurrency.
- 2) **Environment file paths are hard-coded defaults** - If you deploy to a different layout, you must update unit files. ---

## E14-hetzner-runbook
Mapped action items: Item 1 [x], Item 2 [x], Item 3 [x]

- 1) **Gateway origins must be locked down** - `GATEWAY_ALLOWED_ORIGINS` is required in production. - Missing this risks cross-origin abuse.
- 2) **Metrics auth tokens are required** - `METRICS_AUTH_TOKEN` must be set for simulator, validators, and auth.
- 3) **Live-table admin keys should be file-based** - Env keys are blocked in production unless explicitly allowed. ---

## E15-testing-strategy
Mapped action items: Item 36 [x]

- 1) **Long test timeouts** - Integration tests default to 20 minutes (`TEST_TIMEOUT_MS`). - This is safe for slow environments but can hide stalls.
- 2) **Integration tests require a running gateway** - Tests depend on `RUN_INTEGRATION=true` and a live gateway port. - CI must provision a gateway or skip these tests. ---

## E16-limits-inventory
Mapped action items: Item 6 [x], Item 8 [x], Item 9 [x], Item 11 [x], Item 12 [x], Item 14 [x]

- 1) **Default submit limits are dev-only** - `submit_rate_limit_per_minute: 100` is far too low for public traffic. - The testnet profile sets higher 5k defaults.
- 2) **Per-IP caps can block NATed users** - Defaults like `ws_max_connections_per_ip: 10` can block many users behind a single NAT. - The testnet override suggests `500`; pair with L7 protections.
- 3) **Large message sizes increase DoS risk** - `max_message_size: 10 MB` and `ws_max_message_bytes: 4 MB` allow large payloads. - Keep upstream proxy/body limits aligned or attackers can force buffering.
- 4) **Consensus-critical limits require coordinated upgrade** - Casino and protocol caps are part of the consensus rules. - Changing them without a versioned upgrade can fork the network.
- 5) **High mempool limits require memory budget** - `mempool_max_transactions: 100000` can be large in RAM. - Reserve ~1-2 GiB RAM for mempool data at 5k and confirm with load tests. ---

## L01-gateway-index
Mapped action items: Item 8 [x], Item 1 [x]

- 1) **MAX_CONNECTIONS_PER_IP (default 5)** - Protects against one IP consuming all sockets. - Too low will block legitimate users behind NAT. For 5k testnet, use >=200.
- 2) **MAX_TOTAL_SESSIONS (default 1000)** - Hard cap on concurrent users. Must match server capacity and scaling plan.
- 3) **FAUCET_COOLDOWN_MS (default 60s)** - Client‑side throttle only. If it is looser than on‑chain faucet rules, users will see confusing rejections.
- 4) **BALANCE_REFRESH_MS (default 60s)** - Shorter = fresher UI, higher backend load. - Longer = less load, more stale UI.
- 5) **GATEWAY_ALLOWED_ORIGINS** - Mandatory in production. Incorrect config can block all users or allow untrusted origins.
- 6) **GATEWAY_EVENT_TIMEOUT_MS** (validated here, used elsewhere) - If too short, games appear to “hang.” If too long, users wait too long on errors. ---

## L02-session-manager
Mapped action items: Item 8 [x], Item 30 [x]

- 1) **Session creation rate limits** ```ts points: 10 per window (default) window: 1 hour (default) block: 1 hour (default) ``` - These defaults can be too strict for NAT-heavy networks. - Use the 5k testnet profile and adjust with telemetry.
- 2) **DEFAULT_INITIAL_BALANCE = 10,000 (not actually applied)** - The on‑chain registration grants 1,000 chips; this constant is not used in `initializePlayer`. - If you want a different starting balance, change the on‑chain handler, not just this constant.
- 3) **Idle session cleanup (default 30 min)** - `cleanupIdleSessions` uses a default of 30 minutes. Too short can disconnect slow players; too long can waste resources.
- 4) **Faucet cooldown** - Passed in from gateway config (default 60s). Must be aligned with on‑chain faucet rules. ---

## L03-instructions-encoding
Mapped action items: Item 6 [x]

- 1) **Player name length is u32** - There is no gateway‑side cap in this file. A malicious client could send huge names. - Recommendation: enforce max length in the client and/or gateway.
- 2) **CasinoGameMove payload length is u32** - Theoretically allows payloads up to ~4GB. Must be capped elsewhere.
- 3) **GlobalTable maxBetsPerRound is u8** - Hard limit 255 bets per round. Real configs should be much lower.
- 4) **Roulette and SicBo bet counts are u8** - Max 255 bets per move. ---

## L04-transactions-signing
Mapped action items: Item 7 [x]

- 1) **Nonce is u64** - This caps the maximum number of transactions per account. It’s practically huge but still finite.
- 2) **No size caps here** - `wrapSubmission` does not enforce a max request size. The server must enforce payload limits elsewhere.
- 3) **Namespace is fixed** - Changing `_NULLSPACE_TX` would invalidate all existing signatures. This is a network‑wide breaking change. ---

## L05-submit-client
Mapped action items: Item 8 [x], Item 47 [x]

- 1) **Default submit timeout = 10s** - Too low = false failures on slow backends. - Too high = client waits too long before seeing errors.
- 2) **Health check timeout = 5s** - Good for a fast liveness check. If your backend is under heavy load, you may need to adjust.
- 3) **Account query timeout = 5s** - If this is too low, balance refresh may fail; too high increases request pile‑up under failure.
- 4) **Origin must match backend allowlist** - If origin is misconfigured, all submissions can be rejected even if the backend is healthy. ---

## L11-casino-handlers
Mapped action items: Item 13 [x], Item 14 [x], Item 41 [x]

- 1) **Time is derived from block view** - This file assumes `1 view = ~3 seconds` by using `seed_view * 3`. - If block time changes, all time-based rules (cooldowns, expiries) change too.
- 2) **Faucet limits** - Uses constants like `FAUCET_MIN_ACCOUNT_AGE_SECS`, `FAUCET_MIN_SESSIONS`, and `FAUCET_RATE_LIMIT`. - Daily faucet is enforced by day boundary (`/ 86_400`). - Keep defaults for 5k testnet and revisit after telemetry.
- 3) **Tournament limits** - `TOURNAMENT_JOIN_COOLDOWN_SECS` enforces a cooldown between joins. - `FREEROLL_DAILY_LIMIT_FREE` / `FREEROLL_DAILY_LIMIT_TRIAL` cap daily tournaments. - Defaults are the 5k baseline.
- 4) **Tournament duration is fixed** - `TOURNAMENT_DURATION_SECS` is enforced even if clients send other end times. - This prevents payout abuse via shortened or extended tournaments.
- 5) **Prize pool emissions are capped** - Emission is based on `TOTAL_SUPPLY`, `ANNUAL_EMISSION_RATE_BPS`, `TOURNAMENTS_PER_DAY`. - Reward pool is capped by `REWARD_POOL_BPS` of total supply.
- 6) **Global table bet limits** - Enforces `min_bet`, `max_bet`, `max_bets_per_round` from config. - Totals list is capped at 64 entries (hardcoded in this file).
- 7) **Progressive jackpot parsing is layout-dependent** - Helper parsers assume exact offsets in `state_blob`. - Changing game state layout requires updating these offsets. ---

## L12-updates-and-events
Mapped action items: Item 1 [x], Item 10 [x]

- 1) **WS send timeout = 2 seconds** (`WS_SEND_TIMEOUT`) - If a client cannot receive within 2s, the simulator closes the connection. - Too low = disconnects on slow clients; too high = memory growth.
- 2) **WS message size caps** - `ws_max_message_bytes` is enforced at upgrade time. - If you increase payload sizes, you must update this too.
- 3) **Outbound queue capacity** - `ws_outbound_capacity()` controls the per-client queue. - If too small, clients lag and drop updates; if too large, memory grows.
- 4) **Binary reader limits** (`events.ts`) - Vec length capped at 10,000. - String length capped at 10,000. - Varint is rejected if shift > 35. These prevent malformed payloads from allocating huge memory.
- 5) **Origin allowlist** - If `ALLOWED_WS_ORIGINS` is empty, all browser origins are rejected. - `ALLOW_WS_NO_ORIGIN` must be set for native clients without Origin headers. ---

## L13-gateway-register-faucet
Mapped action items: Item 8 [x], Item 1 [x], Item 41 [x]

- 1) **FAUCET_COOLDOWN_MS** - Used in `requestFaucet` to throttle claims. - Must align with on‑chain faucet rules to avoid confusing rejections.
- 2) **DEFAULT_FAUCET_AMOUNT** - Used when the client does not specify an amount. - If this differs from backend expectations, users will see mismatched balances.
- 3) **Origin allowlist** (`GATEWAY_ALLOWED_ORIGINS`) - If set, connections without origin are rejected unless `GATEWAY_ALLOW_NO_ORIGIN` is true.
- 4) **Connection limits** - `MAX_CONNECTIONS_PER_IP` and `MAX_TOTAL_SESSIONS` enforce caps. - For 5k testnet, use the runbook defaults and adjust with telemetry. ---

## L14-session-register-faucet
Mapped action items: Item 30 [x]

- 1) **Client‑side faucet cooldown** - Enforced by `requestFaucet` using the `cooldownMs` argument. - This must match or be stricter than the on‑chain faucet rules.
- 2) **Initial balance assumption = 1000** - After registration, the session sets `hasBalance=true` and `balance=1000n`. - If the backend changes initial chips, this will show incorrect balances until refreshed.
- 3) **Update subscription is best‑effort** - If updates stream fails to connect, registration still proceeds but real‑time events are missed. ---

## L15-register-instructions
Mapped action items: Item 6 [x]

- 1) **Player name length uses u32** - No explicit max length enforced here. - Clients should cap name size to prevent huge payloads.
- 2) **Deposit amount is u64** - Max deposit is `2^64 - 1` in binary, but policy limits should cap this elsewhere. ---

## L16-register-transactions
Mapped action items: Item 14 [x]

- 1) **Nonce must strictly increase** - If you reuse a nonce, the backend rejects the transaction.
- 2) **Namespace signing is fixed** - The `TRANSACTION_NAMESPACE` is a protocol constant. Changing it invalidates all signatures. ---

## L17-register-submit-client
Mapped action items: Item 8 [x], Item 47 [x]

- 1) **Default submit timeout = 10s** - Long enough for normal processing, short enough to keep UI responsive.
- 2) **Origin header must match backend allowlist** - If origin mismatches, even valid submissions will be rejected. ---

## L18-register-submit-http
Mapped action items: Item 6 [x]

- 1) **Decode failure = 400** - Any malformed bytes are rejected immediately.
- 2) **Apply failure = 400** - If the transaction fails validation, the simulator returns a 400. ---

## L24-register-types
Mapped action items: Item 6 [x]

- 1) **CASINO_MAX_NAME_LENGTH** - Enforced at decode time for `CasinoRegister`. - Must match client-side limits to avoid confusing rejections.
- 2) **CASINO_MAX_PAYLOAD_LENGTH** - Used for game moves, but shows how Rust enforces payload bounds. ---

## L25-web-nonce-manager
Mapped action items: Item 35 [x]

- 1) **Data directory permissions = 0700** - Nonces are sensitive; permissions restrict access to the gateway user.
- 2) **Nonce file permissions = 0600** - Prevents other users from reading or editing nonce state.
- 3) **On‑chain nonce sync** - `syncFromBackend` relies on `/account/<pubkey>`. If that endpoint is down, nonce recovery fails. ---

## L26-freeroll-scheduler-ui
Mapped action items: Item 28 [x]

- 1) **Polling intervals** - `NETWORK_POLL_FAST_MS = 2000` - `NETWORK_POLL_IDLE_MS = 8000` - `NETWORK_POLL_HIDDEN_MS = 30000` These trade responsiveness for bandwidth. - Pair with reconnect backoff to avoid gateway spikes.
- 2) **WS idle thresholds** - `WS_IDLE_FAST_MS = 4000` - `WS_IDLE_SLOW_MS = 15000` - `WS_IDLE_HIDDEN_MS = 60000` Used to decide when to fall back to polling.
- 3) **Leaderboard polling** - `LEADERBOARD_POLL_MIN_MS = 15000` Avoids hammering the leaderboard endpoint. ---

## L27-tournament-scheduler
Mapped action items: Item 31 [x], Item 41 [x]

- 1) **Poll interval** - Default `--poll-secs` is 5 seconds. Too slow can miss boundaries; too fast increases load.
- 2) **DAY_MS = 86,400,000** - Schedule boundaries are fixed in UTC ms. Any clock skew affects accuracy.
- 3) **TOURNAMENT_DURATION_SECS / TOURNAMENTS_PER_DAY** - These constants define registration length and active length. - Defaults are the 5k testnet baseline. ---

## L28-auth-admin-sync
Mapped action items: Item 20 [x], Item 2 [x], Item 41 [x]

- 1) **AUTH_ALLOWED_ORIGINS is required** - If it’s empty, the server throws at startup. - Misconfiguration blocks all clients.
- 2) **AUTH_CHALLENGE_TTL_MS default = 300000 (5 minutes)** - Too short causes login failures; too long increases replay risk.
- 3) **Metrics auth can be required** - `AUTH_REQUIRE_METRICS_AUTH` + `METRICS_AUTH_TOKEN` gate `/metrics` endpoints.
- 4) **Freeroll limit caps to 255** - `parseLimit` clamps daily limits to `<= 255`. ---

## L29-convex-admin-nonce-store
Mapped action items: Item 23 [x]

- 1) **Nonce values are normalized** - `normalizeNonce` clamps to `>= 0` and floors to an integer. - This avoids negative or NaN values corrupting nonce state. ---

## L32-auth-server
Mapped action items: Item 20 [x], Item 1 [x]

- 1) **AUTH_CHALLENGE_TTL_MS default = 300000** - Challenges expire after 5 minutes to prevent replay.
- 2) **Rate limits (challenge/profile/billing)** - Each endpoint applies a rate limiter. Adjust carefully to avoid blocking legitimate users.
- 3) **AUTH_ALLOWED_ORIGINS must be set** - If empty, server throws on startup. ---

## L33-convex-auth
Mapped action items: Item 18 [x], Item 21 [x]

- 1) **TTL is enforced by the caller, not by Convex** - This file trusts the `expiresAtMs` value it is given. - If the auth service sets a long TTL, replay risk goes up. - If it sets a short TTL, login may fail for slow users.
- 2) **No cleanup job here** - Used and expired challenges are not deleted in this file. - You should consider TTL cleanup or a scheduled purge to keep the table small.
- 3) **Challenge ID uniqueness relies on UUID quality** - There is no explicit dedupe on insert; the code assumes UUID collision is practically impossible. - This is usually fine, but it is still a trust assumption. ---

## L34-convex-users
Mapped action items: Item 23 [x]

- 1) **Public key uniqueness is enforced** - `linkPublicKey` throws if a public key is already linked to another user. - This is good for safety but makes key migration hard without an admin tool.
- 2) **Fields can only be updated, not cleared** - `upsertUser` only patches fields that are provided. - There is no way to erase a field (like `email`) through this API.
- 3) **Stripe reconcile pagination depends on caller input** - `listUsersForStripeReconcile` accepts pagination options; the caller controls batch size. - Very large batches could increase latency or cost. ---

## L35-convex-http-stripe
Mapped action items: Item 25 [x]

- 1) **Rate limit window defaults to 60 seconds** - `STRIPE_WEBHOOK_RATE_LIMIT_WINDOW_MS` default is 60,000 ms. - 5k testnet baseline sets `STRIPE_WEBHOOK_RATE_LIMIT_MAX=600`.
- 2) **Bucket memory cap defaults to 10,000 IPs** - `STRIPE_WEBHOOK_RATE_LIMIT_BUCKET_MAX` prevents unbounded memory growth. - 5k baseline uses 20,000.
- 3) **Rate limiting is per instance only** - Buckets live in memory, so limits reset if the instance restarts. - In a multi-instance deployment, each instance has its own counters. ---

## L36-convex-stripe-actions
Mapped action items: Item 27 [x]

- 1) **Subscription list limit is capped at 100** - `resolveSubscriptionLimit` clamps to 100. - This is safe for rate limits but may miss very large customer histories.
- 2) **Batch size capped at 200** - `resolveBatchSize` caps to 200 customers per reconcile batch. - Good for safety, but full backfills can take many runs.
- 3) **Stripe API version fixed** - `apiVersion: "2023-10-16"` locks behavior. - When Stripe deprecates fields, you must update and test. ---

## L37-convex-stripe-store
Mapped action items: Item 18 [x], Item 26 [x]

- 1) **Stripe events are stored forever** - There is no TTL or cleanup in this file. - Over time, `stripe_events` can grow large.
- 2) **Entitlements are updated per item, not per subscription only** - Each subscription item can create or update an entitlement. - This is good for multi-product subscriptions but increases row count.
- 3) **Cancellation logic depends on `items` being present** - If `items` are missing from an event, entitlements may not be marked canceled. - Reconcile should include items to fix missing updates. ---

## L38-convex-entitlements
Mapped action items: Item 22 [x], Item 4 [x]

- 1) **No pagination here** - The query returns all entitlements for a user. - If entitlements grow large, you may need pagination.
- 2) **Service token is the only access control** - If the token is leaked, entitlements become readable. - Rotate every 90 days and after incidents. ---

## L39-auth-casino-admin
Mapped action items: Item 3 [x], Item 23 [x], Item 41 [x]

- 1) **Admin private key must be 64 hex chars** - `CASINO_ADMIN_PRIVATE_KEY_*` must decode to 32 bytes (64 hex chars). - If missing or invalid, admin sync is disabled.
- 2) **Identity hex must be 192 hex chars** - `CASINO_IDENTITY_HEX` must be 96 bytes (192 hex chars). - Without it, state decoding and submissions fail.
- 3) **Freeroll limits are capped at 255** - `parseLimit` clamps limits to 255. - Defaults: free=1, member=10 (kept for 5k testnet).
- 4) **Env-based admin keys are blocked in production** - `ALLOW_INSECURE_ADMIN_KEY_ENV` must be set to allow env keys in prod. - This is the right default; file or URL secrets are safer.
- 5) **Nonce store is optional but important** - If Convex nonce store is unavailable, the service uses an in-memory counter. - This can drift across restarts, causing nonce conflicts. ---

## L40-convex-admin-nonce-integration
Mapped action items: Item 19 [x]

- 1) **No TTL on nonce records** - `admin_nonces` rows are never deleted. - This is usually fine, but the table can grow with multiple admin keys.
- 2) **Normalization only clamps to >= 0** - `normalizeNonce` does not enforce a maximum. - If a bug sets an extremely large nonce, it will be stored as-is. ---

## L41-gateway-craps-handler
Mapped action items: Item 33 [x]

- 1) **No explicit bet limits here** - Bet limits are enforced later in the execution layer or live-table service. - If those layers are misconfigured, the gateway will not block large bets.
- 2) **Session counter is local** - `gameSessionCounter` increments in memory. If the gateway restarts, counters reset. - This is usually fine because the session ID also uses the public key. ---

## L42-live-craps-table
Mapped action items: Item 31 [x]

- 1) **Timeouts are short by default** - `GATEWAY_LIVE_TABLE_TIMEOUT_MS` defaults to 5000 ms. - Slow networks or overloaded services may cause false timeouts.
- 2) **Reconnect cadence defaults to 1500 ms** - `GATEWAY_LIVE_TABLE_RECONNECT_MS` controls retry frequency. - Too aggressive can hammer the service; too slow hurts UX.
- 3) **Live-table can be disabled** - `GATEWAY_LIVE_TABLE_CRAPS` or `GATEWAY_LIVE_TABLE_CRAPS_ONCHAIN` must be set. - If disabled, all live-table requests return errors. ---

## L43-live-table-service
Mapped action items: Item 31 [x], Item 32 [x]

- 1) **Timing defaults** - Betting: 18s, Lock: 2s, Payout: 2s, Cooldown: 8s. - These are in `LIVE_TABLE_*` env vars and control UX and throughput.
- 2) **Broadcast buffer is 1024** - `broadcast::channel::<OutboundEvent>(1024)` limits queued events. - If clients are slow, messages may drop.
- 3) **Bot settings are defaults** - `LIVE_TABLE_BOT_COUNT` defaults to 0 in production. - Bot counts and bet sizes can distort economics if misconfigured. ---

## L44-onchain-craps-table
Mapped action items: Item 31 [x], Item 3 [x]

- 1) **Bet and timing limits are env-configured** - `GATEWAY_LIVE_TABLE_MIN_BET`, `MAX_BET`, `MAX_BETS_PER_ROUND`. - Timing windows: `BETTING_MS`, `LOCK_MS`, `PAYOUT_MS`, `COOLDOWN_MS`. - Misconfiguration will break UX or economics.
- 2) **Admin key handling in prod** - Production requires a key file unless `GATEWAY_LIVE_TABLE_ALLOW_ADMIN_ENV=1`. - This is important for security.
- 3) **Retry throttling** - `GATEWAY_LIVE_TABLE_ADMIN_RETRY_MS` limits how often admin actions are retried. - Too low can spam the chain; too high can stall rounds. ---

## L45-global-table-handlers
Mapped action items: Item 13 [x], Item 14 [x]

- 1) **Time is derived from block view** - `now_ms = seed_view * 3_000` assumes ~3 seconds per view. - If block timing changes, round timing changes.
- 2) **Bet caps and limits are enforced here** - `min_bet`, `max_bet`, and `max_bets_per_round` are enforced on-chain. - Misconfiguration here will reject valid player bets.
- 3) **Totals list capped at 64 entries** - `add_table_total` refuses to grow totals beyond 64. - This avoids unbounded state growth but may drop rare bet types. ---

## L46-live-vs-normal-craps
Mapped action items: Item 33 [x]

- 1) **Normal mode relies on atomic batch payloads** - If clients do not use the atomic batch, latency and UX degrade.
- 2) **Live-table mode has more moving parts** - Requires admin key, global table config, and round orchestration. - Misconfiguration can stall the table for all players.
- 3) **Bet limits enforced in different layers** - Normal mode relies on execution-layer checks. - Live-table mode enforces additional global table limits. ---

## L47-simulator-http-api
Mapped action items: Item 1 [x], Item 9 [x], Item 11 [x]

- 1) **ALLOWED_HTTP_ORIGINS empty rejects browsers** - The router warns when `ALLOWED_HTTP_ORIGINS` is empty. - If you forget to configure it, browser calls will be rejected.
- 2) **Submit rate limits are per-minute and separate** - `RATE_LIMIT_SUBMIT_PER_MIN` and `RATE_LIMIT_SUBMIT_BURST` control /submit. - Use the 5k testnet baseline and adjust with telemetry.
- 3) **Body size limits are enforced** - `http_body_limit_bytes` can reject oversized payloads. - This prevents large body DoS. ---

## L48-explorer-persistence
Mapped action items: Item 16 [x], Item 45 [x]

- 1) **Backpressure policy matters** - `ExplorerPersistenceBackpressure::Block` can stall indexing if the DB is slow. - Use `block` for testnet/prod; `drop` only for dev load tests.
- 2) **Retention uses max blocks** - `max_blocks` prunes old explorer data. - If set too low, historical queries will be missing.
- 3) **Public Postgres is blocked by default** - You must set `EXPLORER_PERSISTENCE_ALLOW_PUBLIC=1` to allow public hosts. ---

## L49-simulator-passkeys
Mapped action items: Item 5 [x]

- 1) **Feature-gated** - Passkey endpoints only compile with the `passkeys` feature. - They are intentionally off by default.
- 2) **Session TTL = 30 minutes** - Passkey sessions expire after 30 minutes. - Shorter TTL reduces risk but increases friction.
- 3) **Private keys live in memory** - Credentials store raw ed25519 private keys server-side. - This is acceptable only in dev environments. ---

## L50-web-vault-passkeys
Mapped action items: Item 46 [x], Item 5 [x]

- 1) **Password min length = 10** - `PASSWORD_MIN_LENGTH` enforces a baseline. - This is the testnet default.
- 2) **PBKDF2 iterations = 310,000** - This is a CPU cost knob for password vaults. - Higher values improve security but can slow low-end devices.
- 3) **Passkey fallback mode (v2) stores a key in IndexedDB** - If PRF/largeBlob are not supported, it falls back to a non-extractable AES key. - This is device-local and not portable across devices; use password vault for portability. ---

## S01-networking-primer
Mapped action items: Item 1 [x]

- 1) **CORS only affects browsers** - Mobile apps and servers are not restricted by CORS. - You still need auth or origin checks server-side.
- 2) **WebSockets still have origin concerns** - Browsers send the Origin header during WebSocket upgrades. - Gateways should enforce an allowlist in production. ---

## S02-distributed-systems-primer
Mapped action items: Item 12 [x]

- 1) **Mempool size must be bounded** - If unbounded, attackers can fill memory and crash nodes. - Budget mempool RAM explicitly.
- 2) **Consensus latency sets UX floor** - Even if UI updates are fast, finality depends on consensus timing. ---

## S03-crypto-primer
Mapped action items: Item 5 [x]

- 1) **Private keys must never be logged** - Even a single leak compromises all funds controlled by that key.
- 2) **Nonce mismatches cause rejection** - If the nonce is too low or too high, the transaction fails. ---

## S04-wasm-primer
Mapped action items: Item 5 [x]

- 1) **Private keys in WASM are risky** - The WASM `Signer` holds raw private key material in memory. - The code explicitly warns not to use this in production. ---

## S05-auth-primer
Mapped action items: Item 1 [x], Item 20 [x]

- 1) **Challenge TTL must be short** - Long TTLs increase replay risk. - Very short TTLs can break login on slow networks.
- 2) **Origin allowlists are required** - Browsers can be tricked into calling APIs from untrusted origins. - Always enforce allowlists for auth endpoints. ---

## S06-payments-primer
Mapped action items: Item 24 [x]

- 1) **Webhooks must be verified** - Always validate the signature to prevent forged events.
- 2) **Idempotency is mandatory** - Without it, duplicates can create duplicate entitlements or double-grant access. ---

## S07-ops-primer
Mapped action items: Item 2 [x], Item 36 [x], Item 42 [x]

- 1) **Metrics should be authenticated in production** - Exposing metrics publicly leaks internal state.
- 2) **Health checks must be fast** - Health endpoints should not depend on slow downstream calls. ---
