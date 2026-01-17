#!/bin/bash

# Nonce Reset Script for Recovery
# AC-3.1: Clear browser nonce state for fresh start after chain reset
#
# This script helps recover from nonce mismatch issues by:
# 1. Clearing gateway-side nonce cache (server-side)
# 2. Providing console commands for browser-side localStorage clearing
#
# Usage:
#   ./scripts/clear-browser-nonce.sh [--remote]
#
# Options:
#   --remote   Clear gateway nonces on remote testnet servers (requires SSH access)
#   (default)  Show instructions for local development

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# SSH configuration for remote access
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
SSH_USER="${SSH_USER:-root}"
NS_GW_HOST="${NS_GW_HOST:-178.156.212.135}"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o UserKnownHostsFile="$HOME/.ssh/known_hosts"
)

remote() {
  local host="$1"
  shift
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${host}" "$@"
}

clear_gateway_remote() {
  echo -e "${CYAN}==> Clearing gateway nonce cache on ${NS_GW_HOST}${NC}"

  if [[ ! -f "$SSH_KEY" ]]; then
    echo -e "${RED}Missing SSH key: $SSH_KEY${NC}" >&2
    echo "Set SSH_KEY environment variable or use --local mode" >&2
    exit 1
  fi

  remote "$NS_GW_HOST" "docker exec nullspace-gateway rm -rf /app/.gateway-data/nonces.json 2>/dev/null || true"
  echo -e "${GREEN}Gateway nonce cache cleared${NC}"

  echo -e "${YELLOW}Note: Gateway restart not required - nonces are synced on-demand${NC}"
}

clear_gateway_local() {
  echo -e "${CYAN}==> Clearing local gateway nonce cache${NC}"

  local GATEWAY_DATA_DIR="${GATEWAY_DATA_DIR:-.gateway-data}"
  local NONCE_FILE="${GATEWAY_DATA_DIR}/nonces.json"

  if [[ -f "$NONCE_FILE" ]]; then
    rm -f "$NONCE_FILE"
    echo -e "${GREEN}Removed ${NONCE_FILE}${NC}"
  else
    echo -e "${YELLOW}No nonce file found at ${NONCE_FILE}${NC}"
  fi
}

print_browser_instructions() {
  echo
  echo -e "${CYAN}=========================================="
  echo "Browser Nonce Reset Instructions"
  echo -e "==========================================${NC}"
  echo
  echo -e "${YELLOW}Run these commands in browser DevTools Console (F12):${NC}"
  echo
  echo -e "${GREEN}Option 1: Reset nonce only (keeps pending transactions for retry)${NC}"
  cat <<'EOF'
localStorage.setItem('casino_nonce', '0');
console.log('Nonce reset to 0');
EOF
  echo
  echo -e "${GREEN}Option 2: Full reset (clears nonce AND pending transactions)${NC}"
  cat <<'EOF'
localStorage.setItem('casino_nonce', '0');
Object.keys(localStorage)
  .filter(k => k.startsWith('casino_tx_'))
  .forEach(k => localStorage.removeItem(k));
console.log('Nonce and pending transactions cleared');
EOF
  echo
  echo -e "${GREEN}Option 3: Complete casino state reset (includes identity)${NC}"
  cat <<'EOF'
['casino_nonce', 'casino_identity']
  .concat(Object.keys(localStorage).filter(k => k.startsWith('casino_tx_')))
  .forEach(k => localStorage.removeItem(k));
console.log('Full casino state cleared - will resync on next page load');
EOF
  echo
  echo -e "${GREEN}Option 4: Use built-in QA recovery (if NonceManager exposed)${NC}"
  cat <<'EOF'
// If using the casino app with NonceManager accessible:
window.__NONCE_MANAGER__?.forceSyncFromChain();
console.log('Nonce synced from chain');
EOF
  echo
  echo -e "${YELLOW}After running commands, refresh the page to resync with chain.${NC}"
  echo
}

print_qa_mode_instructions() {
  echo
  echo -e "${CYAN}=========================================="
  echo "QA Mode (Alternative)"
  echo -e "==========================================${NC}"
  echo
  echo "Add ?qa=1 to URL to enable QA mode, which:"
  echo "  - Disables hardcoded nonce floors"
  echo "  - Enables automatic chain sync"
  echo
  echo "Example: https://testnet.regenesis.dev?qa=1"
  echo
}

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo
  echo "Clear nonce state for recovery after chain reset."
  echo
  echo "Options:"
  echo "  --remote    Clear gateway nonces on remote testnet servers"
  echo "  --local     Clear local gateway nonces (default)"
  echo "  --help      Show this help message"
  echo
  echo "Environment Variables:"
  echo "  SSH_KEY             SSH key for remote access (default: ~/.ssh/id_ed25519_hetzner)"
  echo "  NS_GW_HOST          Gateway host IP (default: 178.156.212.135)"
  echo "  GATEWAY_DATA_DIR    Local gateway data directory (default: .gateway-data)"
  echo
}

# Parse arguments
MODE="local"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      MODE="remote"
      shift
      ;;
    --local)
      MODE="local"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      usage
      exit 1
      ;;
  esac
done

echo "=========================================="
echo "Nonce Reset Tool"
echo "Started at: $(date)"
echo "=========================================="
echo

case "$MODE" in
  remote)
    clear_gateway_remote
    ;;
  local)
    clear_gateway_local
    ;;
esac

print_browser_instructions
print_qa_mode_instructions

echo -e "${GREEN}Done.${NC}"
