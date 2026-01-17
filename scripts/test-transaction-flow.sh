#!/bin/bash
# test-transaction-flow.sh - End-to-end transaction test (AC-2.4)
#
# Tests the full transaction pipeline:
# 1. Submit a test transaction via API
# 2. Wait for block inclusion
# 3. Verify in explorer
# 4. Report success/failure with timing
#
# Usage: ./scripts/test-transaction-flow.sh [SIMULATOR_URL] [EXPLORER_URL]

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Defaults (can be overridden)
SIMULATOR_URL="${1:-https://indexer.testnet.regenesis.dev}"
EXPLORER_API="${2:-https://testnet.regenesis.dev/api/explorer}"
MAX_WAIT_BLOCKS="${MAX_WAIT_BLOCKS:-5}"
POLL_INTERVAL_MS="${POLL_INTERVAL_MS:-2000}"

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }

# Record start time
START_TIME=$(date +%s%3N)

echo "=========================================="
echo "End-to-End Transaction Flow Test"
echo "Started at: $(date)"
echo "=========================================="
echo
log_info "Simulator: $SIMULATOR_URL"
log_info "Explorer: $EXPLORER_API"
log_info "Max wait: $MAX_WAIT_BLOCKS blocks"
echo

# Step 1: Health check
log_info "Checking simulator health..."
if ! curl -sf --max-time 5 "$SIMULATOR_URL/healthz" > /dev/null 2>&1; then
  log_fail "Simulator health check failed"
  exit 1
fi
log_ok "Simulator healthy"

# Step 2: Get current block height (baseline)
log_info "Getting current block height..."
BASELINE_JSON=$(curl -sf --max-time 10 "$EXPLORER_API/blocks?limit=1")
if [ -z "$BASELINE_JSON" ]; then
  log_fail "Failed to get baseline block"
  exit 1
fi

BASELINE_HEIGHT=$(echo "$BASELINE_JSON" | python3 -c '
import json,sys
data=json.load(sys.stdin)
blocks = data.get("blocks", [])
if blocks and blocks[0]:
    print(blocks[0].get("height", 0))
else:
    print(0)
')
log_ok "Baseline height: $BASELINE_HEIGHT"

# Step 3: Submit test transaction using the Node.js helper
log_info "Submitting test transaction..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TX_RESULT=$(node "$SCRIPT_DIR/test-transaction-submit.mjs" "$SIMULATOR_URL" 2>&1) || {
  log_fail "Transaction submission failed: $TX_RESULT"
  exit 1
}

# Parse the result - expect JSON with publicKey and nonce
TX_PUBKEY=$(echo "$TX_RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("publicKey",""))')
TX_NONCE=$(echo "$TX_RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("nonce",0))')

if [ -z "$TX_PUBKEY" ]; then
  log_fail "Failed to parse transaction result: $TX_RESULT"
  exit 1
fi
log_ok "Transaction submitted (pubkey: ${TX_PUBKEY:0:16}..., nonce: $TX_NONCE)"

# Step 4: Wait for block inclusion
log_info "Waiting for block inclusion (max $MAX_WAIT_BLOCKS blocks)..."

INCLUDED=false
BLOCKS_CHECKED=0
TARGET_HEIGHT=$((BASELINE_HEIGHT + MAX_WAIT_BLOCKS))

# Convert poll interval to seconds (integer division, min 1s)
POLL_INTERVAL_SEC=$((POLL_INTERVAL_MS / 1000))
[ "$POLL_INTERVAL_SEC" -lt 1 ] && POLL_INTERVAL_SEC=1

# Maximum time to wait (in case chain is stuck)
MAX_WAIT_SEC="${MAX_WAIT_SEC:-30}"
WAIT_START=$(date +%s)

while true; do
  sleep "$POLL_INTERVAL_SEC"

  # Time-based fallback if chain is not producing blocks
  ELAPSED=$(($(date +%s) - WAIT_START))
  if [ "$ELAPSED" -ge "$MAX_WAIT_SEC" ]; then
    log_warn "Timeout waiting for blocks (chain may be stuck)"
    break
  fi

  CURRENT_JSON=$(curl -sf --max-time 10 "$EXPLORER_API/blocks?limit=3" 2>/dev/null || echo '{"blocks":[]}')
  CURRENT_HEIGHT=$(echo "$CURRENT_JSON" | python3 -c '
import json,sys
data=json.load(sys.stdin)
blocks = data.get("blocks", [])
if blocks and blocks[0]:
    print(blocks[0].get("height", 0))
else:
    print(0)
')

  # Check tx_count in recent blocks
  HAS_TX=$(echo "$CURRENT_JSON" | python3 -c '
import json,sys
data=json.load(sys.stdin)
for block in data.get("blocks", []):
    if block and block.get("tx_count", 0) > 0:
        print("yes")
        sys.exit(0)
print("no")
')

  BLOCKS_CHECKED=$((CURRENT_HEIGHT - BASELINE_HEIGHT))
  if [ $BLOCKS_CHECKED -lt 0 ]; then
    BLOCKS_CHECKED=0
  fi

  echo -ne "\r  Blocks since submit: $BLOCKS_CHECKED / $MAX_WAIT_BLOCKS (height: $CURRENT_HEIGHT, has_tx: $HAS_TX, ${ELAPSED}s)  "

  if [ "$HAS_TX" = "yes" ]; then
    INCLUDED=true
    break
  fi

  # Also exit if we've seen enough blocks
  if [ "$BLOCKS_CHECKED" -ge "$MAX_WAIT_BLOCKS" ]; then
    break
  fi
done
echo

# Step 5: Verify account state
log_info "Verifying account state..."
ACCOUNT_JSON=$(curl -sf --max-time 5 "$SIMULATOR_URL/account/$TX_PUBKEY" 2>/dev/null || echo '{"nonce":0}')
ACCOUNT_NONCE=$(echo "$ACCOUNT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("nonce",0))')

# Calculate timing
END_TIME=$(date +%s%3N)
ELAPSED_MS=$((END_TIME - START_TIME))
ELAPSED_SEC=$((ELAPSED_MS / 1000)).$((ELAPSED_MS % 1000 / 10))

echo
echo "=========================================="
echo "Test Results"
echo "=========================================="
echo "  Transaction submitted: YES"
echo "  Blocks waited: $BLOCKS_CHECKED"

if [ "$INCLUDED" = "true" ]; then
  echo -e "  Block inclusion: ${GREEN}YES${NC}"
else
  echo -e "  Block inclusion: ${RED}NO${NC} (tx_count=0 in all blocks)"
fi

echo "  Account nonce after: $ACCOUNT_NONCE (expected: $((TX_NONCE + 1)))"

if [ "$ACCOUNT_NONCE" -gt "$TX_NONCE" ]; then
  echo -e "  Nonce incremented: ${GREEN}YES${NC}"
else
  echo -e "  Nonce incremented: ${RED}NO${NC}"
fi

echo "  Total time: ${ELAPSED_SEC}s"
echo "=========================================="

# Final verdict
if [ "$INCLUDED" = "true" ] && [ "$ACCOUNT_NONCE" -gt "$TX_NONCE" ]; then
  log_ok "Transaction flow test PASSED"
  exit 0
else
  log_fail "Transaction flow test FAILED"
  if [ "$INCLUDED" = "false" ]; then
    log_warn "Transactions are being submitted but not included in blocks"
    log_warn "Check validator mempool subscription and block proposal logic"
  fi
  if [ "$ACCOUNT_NONCE" -le "$TX_NONCE" ]; then
    log_warn "Account nonce did not increment - transaction may not have been executed"
  fi
  exit 1
fi
