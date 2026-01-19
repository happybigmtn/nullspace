#!/usr/bin/env bash
# faucet.sh - Fund a test wallet with chips (AC-1.3)
#
# This script wraps faucet.mjs to provide a simple CLI interface
# for funding test wallets during local development.
#
# Usage:
#   ./scripts/faucet.sh                      # Fund a new random wallet
#   ./scripts/faucet.sh --amount 5000        # Fund with 5000 chips
#   ./scripts/faucet.sh [PUBLIC_KEY_HEX] [PRIVATE_KEY_HEX]  # Fund specific wallet
#
# Environment:
#   SIMULATOR_URL  - Simulator API URL (default: http://localhost:8080)
#   FAUCET_AMOUNT  - Amount to deposit (default: 1000)
#
# Exit codes:
#   0 - Success
#   1 - Transaction failed
#   2 - Rate limited
#   3 - Configuration error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIMULATOR_URL="${SIMULATOR_URL:-http://localhost:8080}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()      { printf "${CYAN}[faucet]${NC} %s\n" "$*"; }
log_ok()   { printf "${GREEN}[faucet]${NC} %s\n" "$*"; }
log_warn() { printf "${YELLOW}[faucet]${NC} %s\n" "$*"; }
log_err()  { printf "${RED}[faucet]${NC} %s\n" "$*" >&2; }

# Check for Node.js
if ! command -v node &>/dev/null; then
    log_err "Node.js is required but not installed."
    log_err "Install from: https://nodejs.org/"
    exit 3
fi

# Check for @noble/curves (needed for ed25519)
NOBLE_CHECK=$(node -e "try { require('@noble/curves/ed25519'); console.log('ok'); } catch { console.log('missing'); }" 2>/dev/null || echo "missing")
if [ "$NOBLE_CHECK" = "missing" ]; then
    log_warn "@noble/curves not found, installing..."
    npm install --no-save @noble/curves 2>/dev/null || {
        log_err "Failed to install @noble/curves. Run: npm install @noble/curves"
        exit 3
    }
fi

# Health check
log "Checking simulator at $SIMULATOR_URL..."
if ! curl -sf --max-time 5 "$SIMULATOR_URL/healthz" > /dev/null 2>&1; then
    log_err "Simulator not healthy at $SIMULATOR_URL"
    log_err "Make sure the local stack is running (./scripts/agent-loop.sh)"
    exit 3
fi
log_ok "Simulator is healthy"

# Run the faucet script
log "Funding wallet..."
RESULT=$(SIMULATOR_URL="$SIMULATOR_URL" node "$SCRIPT_DIR/faucet.mjs" --json "$@" 2>&1) || {
    EXIT_CODE=$?
    # Try to parse error from JSON
    ERROR_MSG=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("error","Unknown error"))' 2>/dev/null || echo "$RESULT")

    if [ $EXIT_CODE -eq 2 ]; then
        log_warn "Rate limited: $ERROR_MSG"
        log_warn "The faucet has daily limits. Try again later or use a different wallet."
    else
        log_err "Faucet failed: $ERROR_MSG"
    fi
    exit $EXIT_CODE
}

# Parse and display results
PUBLIC_KEY=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("publicKey",""))' 2>/dev/null || echo "")
PRIVATE_KEY=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("privateKey",""))' 2>/dev/null || echo "")
PREV_BALANCE=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("previousBalance","0"))' 2>/dev/null || echo "0")
NEW_BALANCE=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("newBalance","0"))' 2>/dev/null || echo "0")
DEPOSITED=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("deposited","0"))' 2>/dev/null || echo "0")
REGISTERED=$(echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("registered",False))' 2>/dev/null || echo "false")

echo ""
log_ok "Wallet funded successfully!"
echo ""
echo "  Public Key:      $PUBLIC_KEY"
echo "  Private Key:     $PRIVATE_KEY"
echo ""
if [ "$REGISTERED" = "True" ] || [ "$REGISTERED" = "true" ]; then
    echo "  Registered:      yes (new account)"
fi
echo "  Deposited:       $DEPOSITED chips"
echo "  Previous Balance: $PREV_BALANCE chips"
echo "  New Balance:     $NEW_BALANCE chips"
echo ""

# Output JSON for scripting (optional)
if [ "${JSON_OUTPUT:-0}" = "1" ]; then
    echo "$RESULT"
fi
