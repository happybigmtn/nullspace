# Nullspace Production Runbook

**Last Updated**: 2026-01-06

This consolidated runbook covers all operational procedures for deployment, infrastructure, database operations, security, testnet operations, mobile QA, and release management.

---

## Table of Contents

1. [Deployment](#1-deployment)
2. [Infrastructure (Hetzner)](#2-infrastructure-hetzner)
3. [Database Operations (Postgres)](#3-database-operations-postgres)
4. [Security](#4-security)
5. [Testnet Operations](#5-testnet-operations)
6. [Mobile QA](#6-mobile-qa)
7. [Release Process](#7-release-process)
8. [Incident Response](#8-incident-response)
9. [CCA Testnet (Uniswap v4)](#9-cca-testnet-uniswap-v4)

---

## 1. Deployment

### 1.1 Prerequisites

**Required Inputs:**
- Staging/testnet hosts with SSH access (simulator/indexer, validators, gateway, auth, website)
- Domains + TLS termination plan (LB/CDN)
- Admin key files (casino admin ed25519)
- Convex self-hosted backend provisioned (URL + service token)
- Stripe testnet prices (if membership flows enabled)
- Validator network identity (`VITE_IDENTITY`) and indexer URL
- Metrics auth token (`METRICS_AUTH_TOKEN`)
- Ops admin token (`OPS_ADMIN_TOKEN`) and origin allowlist (`OPS_ALLOWED_ORIGINS`)

### 1.2 Generate Validator Configs

```bash
NODES=4 OUTPUT=configs/testnet INDEXER=http://<INDEXER_HOST>:8080 \
  ./scripts/bootstrap-testnet.sh
```

This produces:
- `configs/testnet/nodeN.yaml` (validator config + key material)
- `configs/testnet/peers.yaml` (needs real IPs)
- `configs/testnet/.env.local` (identity for frontends)

**Note:** `peers.yaml` entries must be sorted and unique; the node will refuse to start otherwise.

### 1.3 Environment Configuration

Use env templates from `configs/staging/` or `configs/production/`:
- `configs/staging/simulator.env.example`
- `configs/staging/gateway.env.example`
- `configs/staging/ops.env.example`
- `services/auth/.env.example`
- `website/.env.staging.example`

**Production-Required Envs:**
```bash
# Gateway
GATEWAY_ORIGIN=https://gateway.example.com
GATEWAY_DATA_DIR=/var/lib/nullspace/gateway
GATEWAY_ALLOWED_ORIGINS=https://app.example.com,https://auth.example.com
GATEWAY_ALLOW_NO_ORIGIN=1  # for native mobile clients
TRUSTED_PROXY_CIDRS=172.18.0.0/16  # for X-Forwarded-For extraction behind Caddy

# Metrics
METRICS_AUTH_TOKEN=<secure-token>
AUTH_REQUIRE_METRICS_AUTH=1

# Ops Service
OPS_DATA_DIR=/var/lib/nullspace/ops
OPS_ADMIN_TOKEN=<admin-token>
OPS_REQUIRE_ADMIN_TOKEN=1
OPS_ALLOWED_ORIGINS=https://staging.example.com
OPS_REQUIRE_ALLOWED_ORIGINS=1

# Global Table
GATEWAY_LIVE_TABLE_CRAPS=1
GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE=/etc/nullspace/casino-admin-key.hex
GATEWAY_LIVE_TABLE_ADMIN_GRACE_MS=3000
GATEWAY_INSTANCE_ID=<unique-id>  # for multi-gateway presence

# Frontend (vault-only)
VITE_ALLOW_LEGACY_KEYS=0
VITE_ENABLE_SIMULATOR_PASSKEYS=0
VITE_AUTH_URL=https://auth.example.com
```

### 1.4 Rate Limit Profile (Testnet Default)

**Simulator:**
```bash
RATE_LIMIT_HTTP_PER_SEC=5000
RATE_LIMIT_HTTP_BURST=10000
RATE_LIMIT_SUBMIT_PER_MIN=120000
RATE_LIMIT_SUBMIT_BURST=20000
RATE_LIMIT_WS_CONNECTIONS=30000
RATE_LIMIT_WS_CONNECTIONS_PER_IP=500
```

**Gateway:**
```bash
MAX_CONNECTIONS_PER_IP=200
MAX_TOTAL_SESSIONS=20000
GATEWAY_SESSION_RATE_LIMIT_POINTS=1000
GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS=3600000
GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS=600000
GATEWAY_EVENT_TIMEOUT_MS=30000
```

**Note:** For NAT-heavy mobile traffic, keep per-IP caps at or above these defaults to avoid false throttling.

### 1.4.1 Reverse Proxy Configuration (US-248)

When running Gateway behind a reverse proxy (Caddy, nginx), configure `TRUSTED_PROXY_CIDRS` to enable proper client IP extraction from `X-Forwarded-For` headers.

**Why this matters:**
- Without this, all clients appear to come from the proxy's IP
- Per-IP rate limits become global rate limits (one user hitting limit blocks everyone)
- Metrics show proxy IP instead of actual client IPs

**Configuration:**
```bash
# Docker bridge network (typical staging setup)
TRUSTED_PROXY_CIDRS=172.18.0.0/16

# Multiple ranges (comma-separated)
TRUSTED_PROXY_CIDRS=172.18.0.0/16,192.168.0.0/16

# Shorthands available:
# - "loopback" = 127.0.0.0/8 and ::1
# - "private" = RFC 1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
# - "docker" = 172.16.0.0/12
TRUSTED_PROXY_CIDRS=docker
```

**Security:** Only IPs matching `TRUSTED_PROXY_CIDRS` will have their `X-Forwarded-For` headers trusted. Requests from other IPs use `socket.remoteAddress` to prevent header spoofing.

**Caddy Configuration:**
Caddy automatically adds `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` headers when using `reverse_proxy`. No additional configuration needed.

### 1.5 Preflight Config Check

```bash
node scripts/preflight-management.mjs \
  gateway /etc/nullspace/gateway.env \
  simulator /etc/nullspace/simulator.env \
  node /etc/nullspace/node.env \
  auth /etc/nullspace/auth.env \
  ops /etc/nullspace/ops.env
```

### 1.6 Bring-Up Sequence

1. Start simulator/indexer with rate limits
2. Start validators (one per host)
3. Start gateway pointing at simulator
4. Start Auth service with Convex + Stripe configured
5. Start website with vault-only defaults
6. Enable global craps table (`GATEWAY_LIVE_TABLE_CRAPS=1`)
7. (Optional) Start ops service for analytics

### 1.7 Start Commands

**Simulator/Indexer:**
```bash
RATE_LIMIT_HTTP_PER_SEC=5000 RATE_LIMIT_HTTP_BURST=10000 \
RATE_LIMIT_SUBMIT_PER_MIN=120000 RATE_LIMIT_SUBMIT_BURST=20000 \
RATE_LIMIT_WS_CONNECTIONS=30000 RATE_LIMIT_WS_CONNECTIONS_PER_IP=500 \
NODE_ENV=production METRICS_AUTH_TOKEN=<token> \
./target/release/nullspace-simulator --host 0.0.0.0 --port 8080 --identity <IDENTITY_HEX>
```

**Gateway:**
```bash
MAX_CONNECTIONS_PER_IP=200 MAX_TOTAL_SESSIONS=20000 \
GATEWAY_SESSION_RATE_LIMIT_POINTS=1000 \
GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS=3600000 \
GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS=600000 \
GATEWAY_EVENT_TIMEOUT_MS=30000 \
GATEWAY_ALLOWED_ORIGINS=https://staging.example.com \
GATEWAY_ALLOW_NO_ORIGIN=1 \
NODE_ENV=production \
BACKEND_URL=http://<INDEXER_HOST>:8080 GATEWAY_PORT=9010 \
GATEWAY_ORIGIN=https://gateway-staging.example.com \
GATEWAY_DATA_DIR=/var/lib/nullspace/gateway \
pnpm -C gateway build && node gateway/dist/index.js
```

**Validators:**
```bash
NODE_ENV=production METRICS_AUTH_TOKEN=<token> \
./target/release/nullspace-node --config configs/testnet/nodeN.yaml --peers configs/testnet/peers.yaml
```

**Auth Service:**
```bash
NODE_ENV=production AI_STRATEGY_DISABLED=1 \
AUTH_REQUIRE_METRICS_AUTH=1 METRICS_AUTH_TOKEN=<token> \
pnpm -C services/auth build && pnpm -C services/auth start
```

**Ops Service:**
```bash
OPS_ALLOWED_ORIGINS=https://staging.example.com \
OPS_REQUIRE_ALLOWED_ORIGINS=1 OPS_ADMIN_TOKEN=<token> \
NODE_ENV=production \
pnpm -C services/ops build && pnpm -C services/ops start
```

### 1.8 Systemd Supervision

Copy unit files from `ops/systemd/` to `/etc/systemd/system/` and set `EnvironmentFile` to your `/etc/nullspace/*.env` files:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website nullspace-ops
sudo systemctl start nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website nullspace-ops

# Optional: economy snapshot generator
sudo systemctl enable nullspace-economy-snapshot.timer
sudo systemctl start nullspace-economy-snapshot.timer
```

**Docker Alternative:** Copy units from `ops/systemd/docker/` and create `/etc/nullspace/docker.env` with `IMAGE_REGISTRY` + `IMAGE_TAG`.

---

## 2. Infrastructure (Hetzner)

### 2.1 Project + Network Setup

1. Create Hetzner Cloud project: `nullspace-staging` or `nullspace-testnet`
2. Create private network: `10.0.0.0/16` with subnet `10.0.1.0/24`
3. Attach every server to private network; only LBs and bastion get public IPs

### 2.2 Firewall Rules

**Public Ingress (LBs/Bastion):**
- 22/tcp (SSH): from office/home IPs only
- 80/443 (HTTP/HTTPS): website + auth + gateway (via LB)

**Private Network Ingress:**
- 8080/tcp: simulator/indexer HTTP + WS
- 9010/tcp: gateway WS (behind LB)
- 4000/tcp: auth service
- 9020/tcp: ops service
- 9001-9004/tcp: validator P2P (between validators only)
- 9100-9104/tcp: metrics (Prometheus only)
- 5432/tcp: Postgres (simulator/indexer only)

### 2.3 Host Layout (5k Target)

| Host | Type | Specs |
|------|------|-------|
| `ns-gw-1..2` | Gateway | CPX31 (4 vCPU, 8 GB) |
| `ns-sim-1` | Simulator/Indexer | CPX41/CPX51 (8-16 vCPU, 16-32 GB) |
| `ns-node-1..3` | Validators | CPX31 (4 vCPU, 8 GB) |
| `ns-auth-1` | Auth | CPX21 (2 vCPU, 4 GB) |
| `ns-convex-1` | Convex | CPX41 (8 vCPU, 16 GB) + persistent volume |
| `ns-db-1` | Postgres | CPX41 (8 vCPU, 16 GB) + dedicated volume |
| `ns-obs-1` | Prometheus/Grafana/Loki | CPX31 (optional) |
| `ns-ops-1` | Ops/analytics | CPX21 (optional) |

**Notes:**
- Scale gateways horizontally; each has its own `MAX_TOTAL_SESSIONS`
- Validators should be on separate hosts to maintain quorum
- For 20k+ guidance, see "Resource Sizing" in `README.md`

### 2.4 Base Server Setup

On each host:
1. Create `nullspace` user and directories:
   - `/opt/nullspace` (repo checkout)
   - `/etc/nullspace` (env files)
   - `/var/lib/nullspace` (gateway nonces, logs)
2. Install dependencies: Node 20+, pnpm, Rust toolchain (or Docker + Compose)
3. Clone repo and build (`cargo build --release`) or use GHCR images

### 2.5 Load Balancers

**Gateway WS (TCP 9010):** L4 LB with TCP health checks
**Simulator/Indexer (HTTP 8080):** L7 LB with `/healthz` checks
**Auth + Website (HTTP/HTTPS):** L7 LB or Nginx

**Recommended Settings:**
- Enable PROXY protocol only if services parse it
- Increase idle timeout for WS to 5-10 minutes
- Use Cloudflare for TLS + WAF
- Align proxy/body size limits with simulator `http_body_limit_bytes`

---

## 3. Database Operations (Postgres)

### 3.1 Provision Host

- Use dedicated VM with NVMe storage
- Attach data volume at `/var/lib/postgresql`
- Ensure VM is on private network; do not expose 5432 to internet

### 3.2 Install Postgres

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
psql --version
```

### 3.3 Core Configuration

Edit `/etc/postgresql/<version>/main/postgresql.conf`:
```
listen_addresses = '10.0.1.10'
shared_buffers = 8GB
effective_cache_size = 24GB
work_mem = 16MB
maintenance_work_mem = 1GB
max_connections = 200
wal_level = replica
max_wal_size = 8GB
min_wal_size = 2GB
checkpoint_completion_target = 0.9
wal_compression = on
shared_preload_libraries = 'pg_stat_statements'
```

### 3.4 Network Access

Edit `/etc/postgresql/<version>/main/pg_hba.conf`:
```
host  all  all  10.0.0.0/16  scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

### 3.5 Create Database + User

```bash
sudo -u postgres psql
CREATE USER nullspace WITH PASSWORD '<strong-password>';
CREATE DATABASE nullspace_explorer OWNER nullspace;
GRANT ALL PRIVILEGES ON DATABASE nullspace_explorer TO nullspace;
\q
```

Connection string: `postgres://nullspace:<password>@10.0.1.10:5432/nullspace_explorer`

### 3.6 Connection Pooling (pgbouncer)

```bash
sudo apt-get install -y pgbouncer
```

Edit `/etc/pgbouncer/pgbouncer.ini`:
```
[databases]
nullspace_explorer = host=127.0.0.1 port=5432 dbname=nullspace_explorer

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 50
reserve_pool_size = 50
```

Create `/etc/pgbouncer/userlist.txt`:
```
"nullspace" "<md5-or-scram-password>"
```

```bash
sudo systemctl restart pgbouncer
```

Update simulator to point at port 6432.

### 3.7 Backups (pgbackrest)

```bash
sudo apt-get install -y pgbackrest
```

Example `/etc/pgbackrest.conf`:
```
[global]
repo1-type=s3
repo1-s3-endpoint=s3.us-east-1.amazonaws.com
repo1-s3-region=us-east-1
repo1-s3-bucket=nullspace-backups
repo1-s3-key=<access-key>
repo1-s3-key-secret=<secret>
repo1-retention-full=7
start-fast=y

[nullspace]
pg1-path=/var/lib/postgresql/<version>/main
```

Enable archiving in `postgresql.conf`:
```
archive_mode = on
archive_command = 'pgbackrest --stanza=nullspace archive-push %p'
```

Initialize:
```bash
sudo -u postgres pgbackrest --stanza=nullspace stanza-create
sudo -u postgres pgbackrest --stanza=nullspace --type=full backup
```

### 3.8 Restore Drill (Quarterly)

```bash
sudo systemctl stop postgresql
sudo -u postgres pgbackrest --stanza=nullspace restore --delta
sudo systemctl start postgresql
```

Validate with a read-only simulator pointing at the restored instance.

### 3.9 Monitoring

- Enable `pg_stat_statements` and export via `postgres_exporter`
- Track: connection count, cache hit rate, slow queries, WAL lag

---

## 4. Security

### 4.1 Credential Management

**Placeholder Detection:** Gateway validates all critical env vars at startup and rejects:
- Strings containing `your_*_here`
- Common placeholders: `placeholder`, `changeme`, `default`, `example`
- Values shorter than 8 characters for secrets
- Empty or whitespace-only values

**Validated Variables:**
```bash
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
TWITTER_API_KEY, TWITTER_API_SECRET
METRICS_AUTH_TOKEN, JWT_SECRET, SESSION_SECRET
```

### 4.2 CORS Configuration

```bash
# Production
GATEWAY_ALLOWED_ORIGINS=https://app.nullspace.io,https://mobile.nullspace.io
AUTH_ALLOWED_ORIGINS=https://app.nullspace.io
ALLOWED_HTTP_ORIGINS=https://app.nullspace.io  # For simulator/indexer

# Staging
GATEWAY_ALLOWED_ORIGINS=https://staging.nullspace.io
AUTH_ALLOWED_ORIGINS=https://staging.nullspace.io
```

- Empty values rejected at startup (production)
- Set `GATEWAY_ALLOW_NO_ORIGIN=true` for development only

**Important: Reverse Proxy CORS**

Do NOT set `Access-Control-Allow-Origin: *` in the reverse proxy (Caddy/nginx) for auth, gateway, or indexer services. Each service handles its own CORS:

- **Auth service:** Uses `AUTH_ALLOWED_ORIGINS` and sets `credentials: true`. Wildcard origin breaks cookie-based auth (browsers reject credentials with `*`).
- **Gateway:** Uses `GATEWAY_ALLOWED_ORIGINS` for defense-in-depth origin validation.
- **Simulator/Indexer:** Uses `ALLOWED_HTTP_ORIGINS` for API access control.

The reverse proxy should only set security headers (HSTS, X-Content-Type-Options) not CORS headers.

### 4.3 Metrics Authentication

Generate token:
```bash
openssl rand -base64 32
```

Set in environment:
```bash
METRICS_AUTH_TOKEN=<your-generated-token>
```

Configure Prometheus:
```yaml
scrape_configs:
  - job_name: 'nullspace-gateway'
    static_configs:
      - targets: ['gateway.nullspace.io:9010']
    metrics_path: '/metrics'
    authorization:
      type: Bearer
      credentials: <your-generated-token>
```

### 4.4 Transport Security

**HTTPS Enforcement:** All HTTP requests are redirected (301) to HTTPS in production.

**HSTS Header:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Security Headers:**
```
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

### 4.5 Connection Limits

- Per-IP: `MAX_CONNECTIONS_PER_IP` (default: 5)
- Total: `MAX_TOTAL_SESSIONS` (default: 1000)

### 4.6 Credential Rotation

**Metrics Token:**
```bash
NEW_TOKEN=$(openssl rand -base64 32)
kubectl set env deployment/gateway METRICS_AUTH_TOKEN=$NEW_TOKEN
```

**Rollback:**
```bash
kubectl rollout undo deployment/gateway
```

### 4.7 Security Monitoring Alerts

**Critical (page on-call):**
- `gateway.messages.error` rate > 5% of total
- Metrics endpoint 403 errors > 10/minute
- Connection rejections > 100/minute
- Active sessions > 90% of MAX_TOTAL_SESSIONS

**Warning:**
- CORS rejections > 50/minute
- Faucet claims > 1000/hour
- WebSocket errors > 10/minute

### 4.8 Dependency Audits

```bash
# Node.js
cd gateway && npm audit

# Rust
cargo audit
```

**Schedule:** Security patches within 48 hours, minor versions monthly, major versions quarterly.

### 4.9 Authentication Security

**Challenge-Response Flow:**
1. Client requests challenge via `POST /auth/challenge`
2. Server generates 32-byte random challenge
3. Client signs with ED25519 private key
4. Server verifies signature (timing-safe comparison)
5. Challenge consumed after use (one-time)

**Challenge Parameters:**
| Parameter | Value |
|-----------|-------|
| TTL | 5 minutes (AUTH_CHALLENGE_TTL_MS) |
| Max TTL | 15 minutes (AUTH_CHALLENGE_TTL_MAX_MS) |
| Format | 32 bytes random |
| Signature | 128 hex chars (64 bytes) |

**CSRF Protection:**
- Cookie: `token|hash` format
- Hash: SHA256(token + AUTH_SECRET)
- Timing-safe comparison
- Protected routes: `/profile/*`, `/billing/*`, `/ai/*`

### 4.10 Admin Key Management

**Key Loading Priority:**
1. `CASINO_ADMIN_PRIVATE_KEY_URL` (with optional vault token)
2. `CASINO_ADMIN_PRIVATE_KEY_FILE`
3. `CASINO_ADMIN_PRIVATE_KEY_HEX` (dev only, blocked in NODE_ENV=production)

**Admin Operations:**
- Set freeroll limits per player
- Sync tournament limits from entitlements
- Bridge pause/unpause (emergency)

**Key Rotation Procedure:**
1. Generate new ED25519 keypair
2. Update secret storage (vault/file)
3. Restart auth service with new key
4. Verify admin operations functioning
5. Revoke old key after confirmation

### 4.11 Rate Limiting Summary

| Layer | Limit | Window |
|-------|-------|--------|
| Gateway connections/IP | 5 | Concurrent |
| Gateway sessions/IP | 10 | 1 hour |
| Auth challenges | 30 | 1 minute |
| Auth profile ops | 60 | 1 minute |
| Auth billing ops | 20 | 1 minute |
| Simulator HTTP | 1,000 | 1 second |
| Simulator submit | 100 | 1 minute |

### 4.12 Stripe Billing Configuration

**Billing is optional for testnet deployments.** To disable billing:

```bash
AUTH_BILLING_ENABLED=0
# STRIPE_PRICE_TIERS can be omitted when billing is disabled
```

When billing is disabled:
- Auth service starts without requiring `STRIPE_PRICE_TIERS`
- `/billing/checkout`, `/billing/portal`, `/billing/reconcile` return 503 with `billing_disabled` error
- Entitlement checks still work (free tier)

**To enable billing:**

```bash
AUTH_BILLING_ENABLED=1  # default when not set
STRIPE_PRICE_TIERS=member:price_xxx,premium:price_yyy
```

### 4.13 Game Engine Monitoring

**Super Mode Payout Saturation:**

The casino game engine uses `saturating_mul` for payout calculations to prevent overflow panics. When payouts saturate to `u64::MAX` (18,446,744,073,709,551,615), a warning is logged:

```
WARN Super mode payout saturated to u64::MAX base_payout=<value> total_multiplier=<value>
```

**Alert Configuration:**
- Search logs for: `"Super mode payout saturated"`
- Alert threshold: Any occurrence (this should never happen with normal bet sizes)
- Action: Investigate bet amount and multiplier configuration

**Affected Functions:**
- `apply_super_multiplier_cards` - Card-based games (Blackjack, Baccarat, Poker variants)
- `apply_super_multiplier_number` - Number-based games (Roulette)
- `apply_super_multiplier_total` - Total-based games (Sic Bo, Craps)

**Why This Matters:**
- Silent saturation could mask payout calculation bugs
- Extreme multiplier stacking (e.g., 4+ matching super cards) can reach astronomical values
- Realistic scenarios (8x × 8x × 8x × 8x = 4096x) are safe; edge cases (65535x^4) saturate

---

## 5. Testnet Operations

### 5.1 Local Smoke Run

```bash
./scripts/testnet-local-runbook.sh configs/local 4
```

### 5.2 Health Checks

```bash
# Health endpoints
curl http://<INDEXER_IP>:8080/healthz
curl http://<GATEWAY_IP>:9010/healthz
curl http://<AUTH_IP>:4000/healthz
curl http://<OPS_IP>:9020/healthz  # if running ops

# Metrics (with auth)
# All services accept both "Authorization: Bearer <TOKEN>" and "x-metrics-token: <TOKEN>"
curl -H "x-metrics-token: <TOKEN>" http://<GATEWAY_IP>:9010/metrics
curl -H "x-metrics-token: <TOKEN>" http://<INDEXER_IP>:8080/metrics/prometheus
curl -H "x-metrics-token: <TOKEN>" http://<NODE_IP>:9100/metrics
curl -H "x-metrics-token: <TOKEN>" http://<AUTH_IP>:4000/metrics/prometheus
```

### 5.3 Smoke Checks (Must Pass)

- Health endpoints return 200
- Metrics scrape visible in Prometheus
- Faucet flow: register, claim, verify balance
- Full game flow for: Blackjack, Roulette, Craps, Sic Bo, Baccarat, Video Poker, Casino War
- Tournament scheduler run for 1-2 intervals

### 5.4 Bet Coverage Tests

```bash
RUN_INTEGRATION=true pnpm -C gateway exec vitest run tests/all-bet-types.test.ts
pnpm -C packages/game-state test
pnpm -C website exec vitest run src/services/games/__tests__/game-state.test.ts
```

### 5.5 Load Tests

**Soak Test (10 min):**
```bash
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 DURATION_SECONDS=600 \
  ./scripts/soak-test.sh configs/testnet 4
```

**Bot Load:**
```bash
NUM_BOTS=300 DURATION_SECONDS=300 RATE_PER_SEC=3.0 \
  ./scripts/run-bots.sh configs/testnet http://<INDEXER_HOST>:8080
```

**Global Table Fanout:**
```bash
URL=ws://<GATEWAY_HOST>:9010 ORIGIN=https://gateway.example.com \
  TOTAL=5000 RAMP_PER_SEC=500 DURATION=300 \
  node scripts/load-test-global-table.mjs
```

### 5.6 Recovery Drills

- Restart validator and confirm it rejoins
- Restart gateway and confirm sessions can re-register
- (Optional) Restart simulator and verify indexer recovery

### 5.7 Tournament Scheduler

```bash
CASINO_ADMIN_PRIVATE_KEY_FILE=/path/to/casino-admin-key.hex \
  ./scripts/run-tournament-scheduler.sh configs/testnet http://<INDEXER_HOST>:8080
```

### 5.8 Bot Load Runner

```bash
NUM_BOTS=300 DURATION_SECONDS=300 RATE_PER_SEC=3.0 \
  ./scripts/run-bots.sh configs/testnet http://<INDEXER_HOST>:8080
```

### 5.9 Bridge Relayer (Optional)

```bash
cargo run --release --bin bridge-relayer -- \
  --url http://<INDEXER_HOST>:8080 \
  --identity <IDENTITY_HEX> \
  --admin-key <ADMIN_KEY_HEX> \
  --evm-rpc-url <RPC_URL> \
  --evm-private-key <EVM_KEY> \
  --lockbox-address <LOCKBOX_ADDR> \
  --evm-chain-id <CHAIN_ID>
```

### 5.10 Session Dump Diagnostics

```bash
cargo run --release --bin session-dump -- \
  --url http://<INDEXER_HOST>:8080 \
  --identity <IDENTITY_HEX> \
  --session-id <SESSION_ID>
```

### 5.11 Observability Stack

```bash
cd docker/observability
docker compose up -d
```

Update `docker/observability/prometheus.yml` targets to match host IPs.

### 5.12 Go/No-Go Criteria

Approve testnet launch only if:
- All smoke checks pass without manual retries
- Bet coverage test passes (87/87)
- Soak + bot load complete without sustained errors
- Observability is live and alerting verified
- Vault-only login works on iOS and Android with recovery key export/import

---

## 6. Mobile QA

### 6.1 Test Devices

- iOS (latest + one previous major)
- Android (latest + one previous major)

### 6.2 Preconditions

- Gateway running with stable rate limits
- Simulator running with faucet enabled
- Mobile app pointed at gateway (`ws://<LAN-IP>:9010`)

### 6.3 Passkey Vault (Where Supported)

- [ ] Create passkey vault
- [ ] Confirm `session_ready` and balance available within 5s
- [ ] Start a game, complete, and see payout
- [ ] Lock + unlock vault; confirm signing resumes
- [ ] Delete vault; confirm key reset and no legacy keys remain

### 6.4 Password Vault Fallback (All Devices)

- [ ] Create password vault with recovery key
- [ ] Enforce password min length 10 (PBKDF2-SHA256, 310k iterations)
- [ ] Export recovery key; store out-of-band
- [ ] Lock app, relaunch, unlock with password
- [ ] Import recovery key on second device; confirm public key matches

**Note:** Passkey vaults are device-bound; migrating requires passkey sync or password vault recovery key.

### 6.5 Failure Modes

- [ ] Wrong password 3 times: no lockout, clear error messaging
- [ ] Background app 30s: reconnect + state restore
- [ ] Airplane mode mid-game: reconnect, no crash

### 6.6 Success Criteria

- No crashes during vault create/unlock/import
- Signing fails gracefully when vault locked
- Recovery flow restores correct public key

---

## 7. Release Process

### 7.1 Staging Environment

- Separate domain, keys, and Convex deployment from production
- Use staging Stripe keys and dedicated webhook endpoint
- Run E2E scripts before each release:
  ```bash
  website/scripts/e2e-auth-billing.mjs
  website/scripts/layout-smoke.mjs
  ```
- If running WebKit layout smoke on Arch, use `website/scripts/setup-webkit-libs.sh`

### 7.2 Security Scanning

```bash
# Rust
cargo audit

# Node
npm audit --omit=dev --audit-level=high
```

Optional: Container scan with Trivy, code scan with Semgrep.

### 7.3 CI Image Builds

- `build-images.yml` builds/publishes container images on main/master and PRs
- Website builds depend on `VITE_*` vars/secrets in CI

#### 7.3.1 Required GitHub Repository Variables

The website image build **requires** these GitHub repository variables (Settings > Secrets and variables > Actions > Variables). Builds will fail fast if any are missing or empty:

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_URL` | WebSocket gateway URL | `wss://gateway.nullspace.io` |
| `VITE_AUTH_URL` | Auth service URL | `https://auth.nullspace.io` |
| `VITE_AUTH_PROXY_URL` | Auth proxy/callback URL | `https://auth.nullspace.io/api/auth` |
| `VITE_IDENTITY` | Network identity (hex) | `abc123...` |

**Optional variables** (used if set, no build failure if missing):
- `VITE_STRIPE_TIERS` - Stripe tier configuration JSON
- `VITE_STRIPE_PRICE_ID` - Stripe price ID
- `VITE_STRIPE_TIER` - Default tier name

**Why validation matters:** Without these variables, Vite falls back to localhost defaults during build, shipping a broken UI to production that cannot connect to the real services.

### 7.4 Rollback Plan

1. Keep last two container images tagged and ready
2. Roll back by redeploying previous image and reverting env changes
3. Database changes must be forward-compatible
4. If migration must be reverted, restore from backup and replay queued events

### 7.5 Release Checklist

- [ ] CI green (Rust, web, wasm, audits)
- [ ] Staging E2E + smoke runs complete
- [ ] Health checks and metrics dashboards clean
- [ ] Backup snapshot taken before deploy
- [ ] All OAuth credentials provisioned
- [ ] `GATEWAY_ALLOWED_ORIGINS` configured
- [ ] `METRICS_AUTH_TOKEN` generated and stored securely
- [ ] Security headers tested (securityheaders.com)

### 7.6 Post-Deployment Verification

```bash
# Health check
curl https://gateway.nullspace.io/healthz

# Metrics auth (should reject without token)
curl https://gateway.nullspace.io/metrics  # Expected: 401

# Metrics auth (should succeed with token - either header works)
curl -H "Authorization: Bearer $METRICS_AUTH_TOKEN" \
  https://gateway.nullspace.io/metrics  # Expected: 200
curl -H "x-metrics-token: $METRICS_AUTH_TOKEN" \
  https://gateway.nullspace.io/metrics  # Expected: 200

# HTTP redirect
curl -I http://gateway.nullspace.io/healthz  # Expected: 301

# Security headers
curl -I https://gateway.nullspace.io/healthz
```

---

## 8. Incident Response

### 8.1 On-Call Basics

- Primary responds within 15 minutes; secondary within 30 minutes
- Escalate to engineering lead if downtime > 30 minutes
- Document every incident with root cause and follow-ups in team incident log

### 8.2 Consensus Stall

**Symptoms:** No new blocks, validators idle, simulator height not advancing.

1. Check validator logs for quorum or networking errors
2. Verify peer connectivity and clock sync (NTP)
3. Restart one validator at a time if block production stalled
4. Post-incident: collect logs and review consensus configs

### 8.3 WS Error Spike

**Symptoms:** `ws_*_send_errors_total` or `ws_*_queue_full_total` rising.

1. Confirm simulator CPU/memory headroom
2. Check WS connection limits and outbound buffer sizes
3. Scale read/indexer nodes or increase `ws_outbound_buffer`
4. Inspect network drops or LB idle timeouts

### 8.4 Updates WS Origin Rejection

**Symptoms:** `/updates` WebSocket returns 403, browser console shows CORS/origin errors.

1. Ensure `ALLOWED_WS_ORIGINS` includes gateway/web origins
2. For non-browser clients, set `ALLOW_WS_NO_ORIGIN=1`
3. Restart simulator after updating env

### 8.5 Auth Service Outage

**Symptoms:** `/healthz` fails, 5xx spike, login failures.

1. Check Auth service logs and Convex health
2. Roll back to last known-good deploy
3. Validate Convex service token and Stripe env vars
4. Confirm `AUTH_ALLOWED_ORIGINS` and CORS settings

### 8.6 Stripe Webhook Backlog

**Symptoms:** Delayed entitlements, webhook retries.

1. Check Convex webhook logs for failures
2. Verify Stripe signing secret matches Convex env
3. Re-run entitlement reconciliation endpoint
4. Confirm Auth service can reach Convex

### 8.7 Explorer Persistence Backpressure

**Symptoms:** `explorer_persistence_queue_depth` rising, drops reported.

1. Check Postgres latency and connection pool health
2. Increase persistence buffer or batch size
3. Scale Postgres or move to faster storage
4. If persistent, lower retention limits temporarily

### 8.8 Summary Upload Backlog

**Symptoms:** Explorer heights lag, `tx_count` stays 0, `summary_upload_lag` rising.

1. Check node metrics: `summary_upload_lag`, `summary_upload_failures_total`
2. Check simulator rate limiting on `/submit`
3. Increase `RATE_LIMIT_SUBMIT_PER_MIN`/`RATE_LIMIT_SUBMIT_BURST`
4. If backlog persists, scale indexer or prune proofs

### 8.9 Oracle Feed Staleness

**Symptoms:** Oracle timestamp lag, AMM risk controls tripping.

1. Check oracle ingestion job and data source health
2. Confirm `UpdateOracle` submissions being accepted
3. If stale, reduce borrow caps or pause new borrows

### 8.10 CORS Violation Spike

1. Check rejected origins in logs
2. Determine if legitimate (new client domain) or attack
3. If legitimate: update `GATEWAY_ALLOWED_ORIGINS` and redeploy
4. If attack: monitor for DDoS patterns

### 8.11 Connection Limit Exceeded

1. Check if legitimate traffic spike or attack
2. If legitimate: scale horizontally or increase limits
3. If attack: implement additional rate limiting or IP blocking

---

## 9. CCA Testnet (Uniswap v4)

### 9.1 Preconditions

- Testnet RPC configured in `evm/hardhat.config.js`
- Deployer wallet funded on target chain
- External addresses set: `VIRTUAL_LBP_FACTORY`, `CCA_FACTORY`, `PERMIT2_ADDRESS`
- Currency token: `PHASE2_CURRENCY` or deploy `MockUSDT`

### 9.2 Deployment Flow

```bash
cd evm
npm install
npx hardhat run scripts/deployPhase2.js --network <network>
```

Captures output in `evm/deployments/<network>.json`.

### 9.3 Parameter Validation

- `auctionParams.floorPrice` divides cleanly by `tickSpacing`
- `startBlock < endBlock < claimBlock < migrationBlock < sweepBlock`
- `requiredCurrencyRaised` aligned to minimum liquidity needs
- `tokenSplitToAuction` correct for allocation ratio
- `POOL_LP_FEE` and `POOL_TICK_SPACING` match intended params

### 9.4 Bid Simulation

```bash
node scripts/generateBidders.js --out bidders.json
BIDDER_KEYS_FILE=./bidders.json npx hardhat run scripts/simulateCcaBids.js --network <network>
```

Verify auction receives bids and total raised meets `requiredCurrencyRaised`.

### 9.5 Finalization

```bash
npx hardhat run scripts/finalizeCca.js --network <network>
```

Validate:
- Auction status transitions to finalized
- Liquidity launcher migrates and seeds Uniswap v4 pool
- LP position recipient owns the NFT

### 9.6 Failure/Rollback

- If minimum raise not met: do not finalize, wait for governance decision
- If migration fails: pause bids, investigate config, redeploy with corrected params

### 9.7 Artifacts to Save

- `deployments/<network>.json`
- Auction event logs
- Bidder key list (testnet only)
- Final pool address + LP NFT recipient

---

## Appendix: Key Contacts

- **Security Team:** security@nullspace.io
- **On-Call:** PagerDuty rotation
- **Incident Commander:** Engineering Manager
