#!/bin/bash
# health-check-full.sh - Full-stack health check (AC-3.2)
#
# Comprehensive health check for the entire testnet stack:
# - Validators (4 Docker containers)
# - Simulator
# - Gateway
# - Website
# - Explorer API
# - WebSocket connections
# - Mempool subscribers
# - Recent tx_count > 0
#
# Usage: ./scripts/health-check-full.sh [--verbose] [--no-ssh]

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration (can be overridden via env)
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
SSH_USER="${SSH_USER:-root}"
NS_DB_HOST="${NS_DB_HOST:-5.161.124.82}"
NS_SIM_HOST="${NS_SIM_HOST:-5.161.67.36}"
NS_GW_HOST="${NS_GW_HOST:-178.156.212.135}"

INDEXER_URL="${INDEXER_URL:-https://indexer.testnet.regenesis.dev}"
EXPLORER_API="${EXPLORER_API:-https://testnet.regenesis.dev/api/explorer}"
WEBSITE_URL="${WEBSITE_URL:-https://testnet.regenesis.dev}"
GATEWAY_URL="${GATEWAY_URL:-https://api.testnet.regenesis.dev}"
AUTH_URL="${AUTH_URL:-https://auth.testnet.regenesis.dev}"

VALIDATOR_CONTAINERS=(nullspace-node-0 nullspace-node-1 nullspace-node-2 nullspace-node-3)
MIN_MEMPOOL_SUBSCRIBERS="${MIN_MEMPOOL_SUBSCRIBERS:-4}"
TX_CHECK_BLOCKS="${TX_CHECK_BLOCKS:-10}"

# Flags
VERBOSE=false
NO_SSH=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --no-ssh)
      NO_SSH=true
      shift
      ;;
  esac
done

# Track results
ALL_HEALTHY=true
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNED=0

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; CHECKS_PASSED=$((CHECKS_PASSED + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; CHECKS_FAILED=$((CHECKS_FAILED + 1)); ALL_HEALTHY=false; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; CHECKS_WARNED=$((CHECKS_WARNED + 1)); }
log_verbose() { $VERBOSE && echo -e "       $1" || true; }

SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=5
  -o UserKnownHostsFile="$HOME/.ssh/known_hosts"
)

remote() {
  local host="$1"
  shift
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${host}" "$@" 2>/dev/null
}

# Check HTTP endpoint health
check_endpoint() {
  local name="$1"
  local url="$2"
  local extra_args="${3:-}"

  if eval "curl -sf --max-time 10 $extra_args -o /dev/null '$url'" 2>/dev/null; then
    log_ok "$name"
    return 0
  else
    log_fail "$name (unreachable: $url)"
    return 1
  fi
}

# Check Docker container status via SSH
check_container() {
  local host="$1"
  local container="$2"

  if $NO_SSH; then
    log_warn "$container (SSH disabled)"
    return 0
  fi

  local status
  if ! status=$(remote "$host" "docker inspect -f '{{.State.Status}}' $container" 2>/dev/null); then
    log_fail "$container (not found on $host)"
    return 1
  fi

  if [ "$status" = "running" ]; then
    log_ok "$container"
    return 0
  else
    log_fail "$container (status: $status)"
    return 1
  fi
}

echo "=========================================="
echo "Full-Stack Health Check"
echo "Started at: $(date)"
echo "=========================================="
echo

# ─────────────────────────────────────────────
# Section 1: Public Endpoints
# ─────────────────────────────────────────────
echo "─── Public Endpoints ───"

check_endpoint "Website" "$WEBSITE_URL"
check_endpoint "Gateway /healthz" "$GATEWAY_URL/healthz" "-H 'Origin: $WEBSITE_URL'"
check_endpoint "Indexer /healthz" "$INDEXER_URL/healthz"
check_endpoint "Auth /healthz" "$AUTH_URL/healthz"
check_endpoint "Explorer API" "$EXPLORER_API/blocks?limit=1"

echo

# ─────────────────────────────────────────────
# Section 2: Validator Containers
# ─────────────────────────────────────────────
if $NO_SSH; then
  echo "─── Validators (SSH disabled, skipping) ───"
else
  echo "─── Validators ───"

  if [ ! -f "$SSH_KEY" ]; then
    log_warn "SSH key not found ($SSH_KEY), skipping container checks"
    NO_SSH=true
  else
    for container in "${VALIDATOR_CONTAINERS[@]}"; do
      check_container "$NS_DB_HOST" "$container"
    done
  fi
fi

echo

# ─────────────────────────────────────────────
# Section 3: Infrastructure Containers
# ─────────────────────────────────────────────
if ! $NO_SSH; then
  echo "─── Infrastructure Containers ───"

  check_container "$NS_SIM_HOST" "nullspace-simulator"
  check_container "$NS_GW_HOST" "nullspace-gateway"
  check_container "$NS_GW_HOST" "nullspace-website"

  echo
fi

# ─────────────────────────────────────────────
# Section 4: Mempool Health (WebSocket subscribers)
# ─────────────────────────────────────────────
echo "─── Mempool Health ───"

PROMETHEUS_URL="$INDEXER_URL/metrics/prometheus"
METRICS_AUTH="${METRICS_AUTH_TOKEN:-}"

fetch_prometheus_metric() {
  local metric_name="$1"
  local auth_header=""
  [ -n "$METRICS_AUTH" ] && auth_header="-H 'x-metrics-token: $METRICS_AUTH'"

  local metrics
  if ! metrics=$(eval "curl -sf --max-time 5 $auth_header '$PROMETHEUS_URL'" 2>/dev/null); then
    echo ""
    return 1
  fi

  echo "$metrics" | grep "^$metric_name " | awk '{print $2}' | head -1
}

SUBSCRIBER_COUNT=$(fetch_prometheus_metric "nullspace_simulator_mempool_subscriber_count" || true)
PENDING_COUNT=$(fetch_prometheus_metric "nullspace_simulator_mempool_pending_count" || true)

if [ -z "$SUBSCRIBER_COUNT" ]; then
  log_warn "Mempool subscribers (metrics unavailable - set METRICS_AUTH_TOKEN)"
else
  log_verbose "Mempool subscribers: $SUBSCRIBER_COUNT"
  if [ "$SUBSCRIBER_COUNT" -ge "$MIN_MEMPOOL_SUBSCRIBERS" ]; then
    log_ok "Mempool subscribers ($SUBSCRIBER_COUNT >= $MIN_MEMPOOL_SUBSCRIBERS expected)"
  else
    log_warn "Mempool subscribers low ($SUBSCRIBER_COUNT < $MIN_MEMPOOL_SUBSCRIBERS expected)"
  fi
fi

if [ -n "$PENDING_COUNT" ]; then
  log_verbose "Mempool pending: $PENDING_COUNT"
  if [ "$PENDING_COUNT" -gt 100 ]; then
    log_warn "Mempool backlog high ($PENDING_COUNT pending)"
  else
    log_ok "Mempool depth ($PENDING_COUNT pending)"
  fi
fi

echo

# ─────────────────────────────────────────────
# Section 5: Chain Activity (tx_count > 0)
# ─────────────────────────────────────────────
echo "─── Chain Activity ───"

BLOCKS_JSON=$(curl -sf --max-time 10 "$EXPLORER_API/blocks?limit=$TX_CHECK_BLOCKS" 2>/dev/null || echo '{"blocks":[]}')

CHAIN_HEIGHT=$(echo "$BLOCKS_JSON" | python3 -c '
import json,sys
data=json.load(sys.stdin)
blocks = data.get("blocks", [])
if blocks and blocks[0]:
    print(blocks[0].get("height", 0))
else:
    print(0)
')

log_verbose "Chain height: $CHAIN_HEIGHT"

if [ "$CHAIN_HEIGHT" -eq 0 ]; then
  log_fail "Chain height (no blocks found)"
else
  log_ok "Chain height ($CHAIN_HEIGHT)"
fi

TX_ANALYSIS=$(echo "$BLOCKS_JSON" | python3 -c "
import json,sys
data=json.load(sys.stdin)
blocks = data.get('blocks', [])
total_tx = 0
blocks_with_tx = 0
for block in blocks:
    if block:
        tx_count = block.get('tx_count', 0)
        total_tx += tx_count
        if tx_count > 0:
            blocks_with_tx += 1
print(f'{total_tx}|{blocks_with_tx}|{len(blocks)}')
")

TOTAL_TX=$(echo "$TX_ANALYSIS" | cut -d'|' -f1)
BLOCKS_WITH_TX=$(echo "$TX_ANALYSIS" | cut -d'|' -f2)
BLOCKS_CHECKED=$(echo "$TX_ANALYSIS" | cut -d'|' -f3)

log_verbose "Transactions in last $BLOCKS_CHECKED blocks: $TOTAL_TX"
log_verbose "Blocks with transactions: $BLOCKS_WITH_TX"

if [ "$TOTAL_TX" -gt 0 ]; then
  log_ok "Transaction flow ($TOTAL_TX tx in last $BLOCKS_CHECKED blocks)"
else
  log_warn "No transactions in last $BLOCKS_CHECKED blocks (tx_count=0)"
fi

# Check block freshness (latest block should be < 120 seconds old)
BLOCK_FRESHNESS=$(echo "$BLOCKS_JSON" | python3 -c "
import json,sys,time
data=json.load(sys.stdin)
blocks = data.get('blocks', [])
if not blocks or not blocks[0]:
    print('-1')
else:
    indexed_at = blocks[0].get('indexed_at_ms', 0)
    now_ms = int(time.time() * 1000)
    age_sec = (now_ms - indexed_at) // 1000
    print(age_sec)
")

if [ "$BLOCK_FRESHNESS" -eq -1 ]; then
  log_fail "Block freshness (no data)"
elif [ "$BLOCK_FRESHNESS" -le 120 ]; then
  log_ok "Block freshness (${BLOCK_FRESHNESS}s old)"
else
  log_fail "Block freshness (${BLOCK_FRESHNESS}s old, > 120s threshold)"
fi

echo

# ─────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "  Passed:  $CHECKS_PASSED"
echo "  Failed:  $CHECKS_FAILED"
echo "  Warned:  $CHECKS_WARNED"
echo

if [ "$ALL_HEALTHY" = true ]; then
  echo -e "${GREEN}All critical checks passed!${NC}"
  if [ "$CHECKS_WARNED" -gt 0 ]; then
    echo -e "${YELLOW}Review warnings above for potential issues.${NC}"
  fi
  exit 0
else
  echo -e "${RED}One or more critical checks failed!${NC}"
  echo
  echo "Troubleshooting:"
  echo "  - Run './scripts/testnet-consensus-recover.sh' for full reset"
  echo "  - Check logs: ssh root@<host> docker logs <container>"
  echo "  - Run './scripts/test-transaction-flow.sh' to diagnose tx issues"
  exit 1
fi
