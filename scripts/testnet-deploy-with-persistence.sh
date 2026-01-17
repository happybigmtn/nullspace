#!/usr/bin/env bash
set -euo pipefail

# Testnet deployment with explorer persistence.
# Updates simulator config to use postgres for explorer persistence,
# then performs consensus recovery to reset and restart all services.

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
SSH_USER="${SSH_USER:-root}"

NS_DB_HOST="${NS_DB_HOST:-5.161.124.82}"
NS_SIM_HOST="${NS_SIM_HOST:-5.161.67.36}"
NS_GW_HOST="${NS_GW_HOST:-178.156.212.135}"

# Postgres connection for explorer persistence (on the same host as validators)
EXPLORER_POSTGRES_URL="${EXPLORER_POSTGRES_URL:-postgres://nullspace:nullspace@${NS_DB_HOST}:5432/explorer}"

VALIDATOR_CONTAINERS=(nullspace-node-0 nullspace-node-1 nullspace-node-2 nullspace-node-3)
VALIDATOR_DIRS=(/var/lib/nullspace/node-0 /var/lib/nullspace/node-1 /var/lib/nullspace/node-2 /var/lib/nullspace/node-3)

if [[ "${CONFIRM_RESET:-}" != "1" ]]; then
  echo "This script will:"
  echo "  1. Update simulator config to add postgres explorer persistence"
  echo "  2. Wipe validator state and restart validators"
  echo "  3. Restart simulator, gateway, and website"
  echo ""
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

echo "==> Step 1: Setting up postgres database for explorer persistence on ${NS_DB_HOST}"
remote "$NS_DB_HOST" "docker exec -i postgres psql -U postgres -c \"CREATE DATABASE explorer\" 2>/dev/null || echo 'Database already exists'"
remote "$NS_DB_HOST" "docker exec -i postgres psql -U postgres -c \"CREATE USER nullspace WITH PASSWORD 'nullspace'\" 2>/dev/null || echo 'User already exists'"
remote "$NS_DB_HOST" "docker exec -i postgres psql -U postgres -c \"GRANT ALL PRIVILEGES ON DATABASE explorer TO nullspace\" 2>/dev/null || echo 'Privileges already granted'"

echo "==> Step 2: Updating simulator config on ${NS_SIM_HOST}"
# Add explorer persistence URL to simulator args if not already present
remote "$NS_SIM_HOST" "grep -q 'explorer-persistence-url' /etc/nullspace/simulator.env && echo 'Explorer persistence already configured' || sed -i 's|SIMULATOR_ARGS=|SIMULATOR_ARGS=--explorer-persistence-url=${EXPLORER_POSTGRES_URL} |' /etc/nullspace/simulator.env"

# Also set the env var to allow hostname (for Docker networking)
remote "$NS_SIM_HOST" "grep -q 'EXPLORER_PERSISTENCE_ALLOW_HOSTNAME' /etc/nullspace/simulator.env || echo 'EXPLORER_PERSISTENCE_ALLOW_HOSTNAME=1' >> /etc/nullspace/simulator.env"

echo "==> Step 3: Resetting validator state on ${NS_DB_HOST}"
remote "$NS_DB_HOST" "docker stop ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "rm -rf ${VALIDATOR_DIRS[*]}"
remote "$NS_DB_HOST" "install -d -o nullspace -g nullspace ${VALIDATOR_DIRS[*]}"
remote "$NS_DB_HOST" "docker start ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "systemctl enable --now nullspace-consensus-watchdog.timer"

echo "==> Step 4: Restarting simulator on ${NS_SIM_HOST}"
remote "$NS_SIM_HOST" "docker restart nullspace-simulator"

echo "==> Step 5: Clearing gateway nonce cache and restarting on ${NS_GW_HOST}"
remote "$NS_GW_HOST" "docker exec nullspace-gateway rm -rf /app/.gateway-data/nonces.json 2>/dev/null || true"
remote "$NS_GW_HOST" "docker restart nullspace-gateway nullspace-website"

echo "==> Step 6: Waiting for services to stabilize..."
sleep 10

echo "==> Step 7: Verifying public endpoints"
./scripts/health-check.sh || true

echo "==> Step 8: Checking explorer"
curl -s "https://testnet.regenesis.dev/api/explorer/blocks?offset=0&limit=1" | head -c 300
echo ""

echo ""
echo "Done. Monitor validator metrics and explorer height for steady growth."
echo ""
echo "Explorer persistence is now enabled. Data will survive simulator restarts."
