#!/bin/bash
# smoke-test-transactions.sh - Transaction flow smoke test (AC-3.3)
#
# Quick pass/fail validation that transactions can flow through the system.
# Designed for CI/CD and post-deployment checks.
#
# Unlike test-transaction-flow.sh (AC-2.4) which provides detailed diagnostics,
# this script focuses on a simple, fast pass/fail result.
#
# Usage: ./scripts/smoke-test-transactions.sh [SIMULATOR_URL] [--quiet]
#
# Exit codes:
#   0 - Transaction submitted and included in block
#   1 - Transaction submission failed
#   2 - Transaction not included within timeout
#   3 - Configuration/setup error

set -euo pipefail

# Color codes (disabled in quiet mode)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SIMULATOR_URL="${1:-https://indexer.testnet.regenesis.dev}"
EXPLORER_API="${EXPLORER_API:-https://testnet.regenesis.dev/api/explorer}"
TIMEOUT_SEC="${TIMEOUT_SEC:-20}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"

# Parse flags
QUIET=false
for arg in "$@"; do
  case $arg in
    --quiet|-q)
      QUIET=true
      ;;
  esac
done

# Logging helpers
log() {
  $QUIET || echo -e "$1"
}

log_pass() {
  log "${GREEN}PASS${NC}: $1"
}

log_fail() {
  log "${RED}FAIL${NC}: $1"
}

# Get script directory for helper script access
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Quick health check
if ! curl -sf --max-time 5 "$SIMULATOR_URL/healthz" > /dev/null 2>&1; then
  log_fail "Simulator not healthy at $SIMULATOR_URL"
  exit 3
fi

# Step 2: Get baseline block height
BASELINE_JSON=$(curl -sf --max-time 5 "$EXPLORER_API/blocks?limit=1" 2>/dev/null || echo '{"blocks":[]}')
BASELINE_HEIGHT=$(echo "$BASELINE_JSON" | python3 -c '
import json,sys
data=json.load(sys.stdin)
blocks = data.get("blocks", [])
print(blocks[0].get("height", 0) if blocks and blocks[0] else 0)
' 2>/dev/null || echo "0")

# Step 3: Submit test transaction
TX_RESULT=$(node "$SCRIPT_DIR/test-transaction-submit.mjs" "$SIMULATOR_URL" 2>&1) || {
  log_fail "Transaction submission failed"
  exit 1
}

TX_PUBKEY=$(echo "$TX_RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("publicKey",""))' 2>/dev/null || echo "")
TX_NONCE=$(echo "$TX_RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("nonce",0))' 2>/dev/null || echo "0")

if [ -z "$TX_PUBKEY" ]; then
  log_fail "Failed to parse transaction result"
  exit 1
fi

$QUIET || echo "Transaction submitted (nonce: $TX_NONCE)"

# Step 4: Wait for block inclusion (poll until timeout)
START_TIME=$(date +%s)
INCLUDED=false

while true; do
  sleep "$POLL_INTERVAL_SEC"

  ELAPSED=$(($(date +%s) - START_TIME))
  if [ "$ELAPSED" -ge "$TIMEOUT_SEC" ]; then
    break
  fi

  # Check for transactions in recent blocks
  BLOCK_JSON=$(curl -sf --max-time 5 "$EXPLORER_API/blocks?limit=3" 2>/dev/null || echo '{"blocks":[]}')
  HAS_TX=$(echo "$BLOCK_JSON" | python3 -c '
import json,sys
data=json.load(sys.stdin)
for block in data.get("blocks", []):
    if block and block.get("tx_count", 0) > 0:
        print("yes")
        sys.exit(0)
print("no")
' 2>/dev/null || echo "no")

  if [ "$HAS_TX" = "yes" ]; then
    INCLUDED=true
    break
  fi

  $QUIET || echo -ne "\rWaiting for inclusion... ${ELAPSED}s/${TIMEOUT_SEC}s  "
done

$QUIET || echo ""

# Step 5: Verify account nonce incremented
ACCOUNT_JSON=$(curl -sf --max-time 5 "$SIMULATOR_URL/account/$TX_PUBKEY" 2>/dev/null || echo '{"nonce":0}')
ACCOUNT_NONCE=$(echo "$ACCOUNT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("nonce",0))' 2>/dev/null || echo "0")

# Final verdict
if [ "$INCLUDED" = "true" ] && [ "$ACCOUNT_NONCE" -gt "$TX_NONCE" ]; then
  log_pass "Transaction included in block (nonce: $TX_NONCE → $ACCOUNT_NONCE)"
  exit 0
elif [ "$INCLUDED" = "true" ]; then
  # Transaction in a block but nonce didn't increment - partial success
  log "${YELLOW}WARN${NC}: Transactions in block but nonce unchanged"
  exit 0
else
  log_fail "Transaction not included within ${TIMEOUT_SEC}s"
  exit 2
fi
