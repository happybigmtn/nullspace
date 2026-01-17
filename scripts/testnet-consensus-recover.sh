#!/usr/bin/env bash
set -euo pipefail

# Testnet consensus recovery (staging).
# Destructive: wipes validator state on ns-db-1.

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
SSH_USER="${SSH_USER:-root}"

NS_DB_HOST="${NS_DB_HOST:-5.161.124.82}"
NS_SIM_HOST="${NS_SIM_HOST:-5.161.67.36}"
NS_GW_HOST="${NS_GW_HOST:-178.156.212.135}"

VALIDATOR_CONTAINERS=(nullspace-node-0 nullspace-node-1 nullspace-node-2 nullspace-node-3)
VALIDATOR_DIRS=(/var/lib/nullspace/node-0 /var/lib/nullspace/node-1 /var/lib/nullspace/node-2 /var/lib/nullspace/node-3)

if [[ "${CONFIRM_RESET:-}" != "1" ]]; then
  echo "Refusing to run: destructive reset requires CONFIRM_RESET=1" >&2
  exit 1
fi

if [[ ! -f "$SSH_KEY" ]]; then
  echo "Missing SSH key: $SSH_KEY" >&2
  exit 1
fi

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

echo "==> Resetting validator state on ${NS_DB_HOST}"
remote "$NS_DB_HOST" "docker stop ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "rm -rf ${VALIDATOR_DIRS[*]}"
remote "$NS_DB_HOST" "install -d -o nullspace -g nullspace ${VALIDATOR_DIRS[*]}"
remote "$NS_DB_HOST" "docker start ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "systemctl enable --now nullspace-consensus-watchdog.timer"

echo "==> Restarting simulator on ${NS_SIM_HOST}"
remote "$NS_SIM_HOST" "docker restart nullspace-simulator"

echo "==> Clearing gateway nonce cache and restarting on ${NS_GW_HOST}"
# Clear gateway nonce data to prevent nonce mismatch after chain reset
remote "$NS_GW_HOST" "docker exec nullspace-gateway rm -rf /app/.gateway-data/nonces.json 2>/dev/null || true"
remote "$NS_GW_HOST" "docker restart nullspace-gateway nullspace-website"

echo "==> Verifying public endpoints"
./scripts/health-check.sh
curl -s "https://testnet.regenesis.dev/api/explorer/blocks?offset=0&limit=1" | head -c 300

echo "Done. Monitor validator metrics and explorer height for steady growth."
