# Local Development Guide

Bootstrap, teardown, and troubleshooting for the Nullspace local stack.

## Prerequisites

Before running the local stack, ensure you have:

- **cargo** - Rust toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- **pnpm** - Node package manager (`npm install -g pnpm`)
- **docker** - Container runtime (for Convex backend)
- **curl** - HTTP client (for health checks)
- **nc** (netcat) - For port availability checks

## Bootstrap

### Quick Start (Mock Backend)

For most development work, use the mock backend for deterministic testing:

```bash
cd /home/r/Coding/nullspace
SMOKE_BACKEND=mock ./scripts/agent-loop.sh
```

This runs the end-to-end agent loop with a deterministic mock backend by default.

### Full Stack Bootstrap

To start the complete local stack manually:

```bash
# From repository root
./scripts/agent-up.sh
```

This starts:
- **Convex** - Backend database (port 3210)
- **Simulator** - Local validator network (port 8080)
- **Gateway** - WebSocket/HTTP gateway (port 9010)
- **Auth** - Authentication service (port 4000)
- **Website** - Vite dev server (port 3000)

### Environment Variables

Configure the stack with environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SMOKE_BACKEND` | `mock` | `mock` for deterministic testing, `real` for full stack |
| `E2E_SEED` | `1` | Seed for mock backend determinism |
| `FAST` | `0` | Skip heavy test suites (website unit tests only) |
| `KEEP_UP` | `1` | Leave services running after tests |
| `WEB_PORT` | `3000` | Website dev server port |
| `CONFIG_DIR` | `configs/local` | Validator config directory |
| `NODES` | `1` | Number of validators to start |
| `SKIP_LOCALNET` | `0` | Skip simulator + validators + Convex bootstrap |
| `SKIP_AUTH` | `0` | Skip auth service |
| `SKIP_GATEWAY` | `0` | Skip gateway service |
| `SKIP_WEBSITE` | `0` | Skip website dev server |

Example with custom website port:

```bash
WEB_PORT=3001 ./scripts/agent-up.sh
```

### Selective Service Startup

Skip individual services:

```bash
SKIP_AUTH=1 SKIP_WEBSITE=1 ./scripts/agent-up.sh
```

Available skip flags: `SKIP_LOCALNET`, `SKIP_AUTH`, `SKIP_GATEWAY`, `SKIP_WEBSITE`

## Teardown

Stop all services and clean up:

```bash
./scripts/agent-down.sh
```

This kills processes via PID files (`/tmp/*.pid`) and stops Docker containers.

For a full cleanup:

```bash
./scripts/agent-down.sh
docker system prune -f  # Optional: remove unused containers
rm -rf /tmp/*.pid /tmp/*.log
```

## Funding Test Wallets

Use the faucet to fund test wallets (requires running stack):

```bash
# Fund a new random wallet (1000 chips default)
./scripts/faucet.sh

# Fund with specific amount
./scripts/faucet.sh --amount 5000

# Fund specific wallet
./scripts/faucet.sh [PUBLIC_KEY_HEX] [PRIVATE_KEY_HEX]
```

Output shows public key, private key, and balance changes.

## Health Checks

Validate the running stack:

```bash
./scripts/health-check.sh
```

Returns non-zero on any failure (AC-1.5). Configure metrics endpoints via
`NODE_METRICS_URLS` and `METRICS_AUTH_TOKEN` if needed.

## Troubleshooting

### Port Already in Use

**Symptom**: `The following ports are already in use: 3000 (website)`

**Solutions**:

1. Stop existing services:
   ```bash
   ./scripts/agent-down.sh
   ```

2. Use different ports:
   ```bash
   WEB_PORT=3001 GATEWAY_PORT=9011 ./scripts/agent-up.sh
   ```

3. Find and kill the process:
   ```bash
   lsof -i :3000  # Find PID
   kill <PID>
   ```

### Docker Daemon Not Running

**Symptom**: `Docker daemon is not running`

**Solutions**:

1. Start Docker:
   ```bash
   sudo systemctl start docker  # Linux
   open -a Docker               # macOS
   ```

2. Use mock backend (no Docker needed):
   ```bash
   SMOKE_BACKEND=mock ./scripts/agent-loop.sh
   ```

### Missing Config Files

**Symptom**: `Config validation failed` or `Validator config not found`

**Solutions**:

1. Generate local validator keys:
   ```bash
   cargo run --bin generate-keys -- --nodes 1 --output configs/local
   ```

2. Use mock backend (skips validator setup):
   ```bash
   SMOKE_BACKEND=mock ./scripts/agent-loop.sh
   ```

### Health Check Failures

**Symptom**: `Some health checks failed!`

**Diagnosis**:

1. Check logs:
   ```bash
   tail -f /tmp/simulator.log
   tail -f /tmp/gateway.log
   tail -f /tmp/auth.log
   tail -f /tmp/website.log
   ```

2. Check individual service status:
   ```bash
   curl -sf http://localhost:8080/healthz && echo "simulator OK"
   curl -sf http://localhost:9010/healthz && echo "gateway OK"
   curl -sf http://localhost:4000/healthz && echo "auth OK"
   curl -sf http://localhost:3000 && echo "website OK"
   ```

3. Verify processes:
   ```bash
   ps aux | grep -E "(simulator|gateway|auth|vite)" | grep -v grep
   ```

### Faucet Rate Limiting

**Symptom**: `Rate limited: ...`

**Solutions**:

1. Wait and retry (daily limits)
2. Use a different wallet
3. Restart the stack to reset limits (mock mode)

### Stale PID Files

**Symptom**: Services not starting, health checks fail but ports appear free

**Solution**:

```bash
rm -f /tmp/*.pid
./scripts/agent-down.sh
./scripts/agent-up.sh
```

### Gateway Connection Issues

**Symptom**: Website can't connect to gateway

**Diagnosis**:

1. Verify gateway is running:
   ```bash
   curl http://localhost:9010/healthz
   ```

2. Check `website/.env.local`:
   ```bash
   grep GATEWAY website/.env.local
   # Should show: VITE_GATEWAY_URL=ws://127.0.0.1:9010
   ```

3. Check browser console for CORS errors

4. Verify allowed origins include website URL

## Log Locations

| Service | Log File |
|---------|----------|
| Simulator/Validators | `/tmp/localnet.log` |
| Gateway | `/tmp/gateway.log` |
| Auth | `/tmp/auth.log` |
| Website | `/tmp/website.log` |
| Gateway install | `/tmp/gateway-install.log` |
| Auth install | `/tmp/auth-install.log` |

## Quick Reference

```bash
# Start everything (mock)
./scripts/agent-loop.sh

# Start everything (real)
SMOKE_BACKEND=real ./scripts/agent-up.sh

# Stop everything
./scripts/agent-down.sh

# Check health
./scripts/health-check.sh

# Fund test wallet
./scripts/faucet.sh

# View logs
tail -f /tmp/gateway.log
```
