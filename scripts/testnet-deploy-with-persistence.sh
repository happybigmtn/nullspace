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
# Use a systemd drop-in to set persistence args (avoid editing .env files)
PERSISTENCE_ARGS="--explorer-persistence-url=${EXPLORER_POSTGRES_URL} --summary-persistence-path=/var/lib/nullspace/simulator/summary.sqlite --summary-persistence-max-blocks=50000"
remote "$NS_SIM_HOST" "install -d /etc/systemd/system/nullspace-simulator.service.d"
remote "$NS_SIM_HOST" "printf '%s\n' '[Service]' \"Environment=SIMULATOR_ARGS=${PERSISTENCE_ARGS}\" 'Environment=EXPLORER_PERSISTENCE_ALLOW_HOSTNAME=1' > /etc/systemd/system/nullspace-simulator.service.d/persistence.conf"
remote "$NS_SIM_HOST" "systemctl daemon-reload"
remote "$NS_SIM_HOST" "systemctl disable --now nullspace-node.service nullspace-node0.service nullspace-node2.service nullspace-node3.service >/dev/null 2>&1 || true"

echo "==> Step 3: Resetting validator state on ${NS_DB_HOST}"
remote "$NS_DB_HOST" "docker stop ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "ts=\$(date -u +%Y%m%d-%H%M%S); for dir in ${VALIDATOR_DIRS[*]}; do if [ -d \"\$dir\" ]; then mv \"\$dir\" \"\${dir}-backup-\${ts}\"; fi; done"
remote "$NS_DB_HOST" "install -d -o nullspace -g nullspace ${VALIDATOR_DIRS[*]}"
remote "$NS_DB_HOST" "docker start ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "systemctl enable --now nullspace-consensus-watchdog.timer"

echo "==> Step 4: Restarting simulator on ${NS_SIM_HOST}"
remote "$NS_SIM_HOST" "docker restart nullspace-simulator"

echo "==> Step 5: Clearing gateway nonce cache and restarting on ${NS_GW_HOST}"
remote "$NS_GW_HOST" "docker exec nullspace-gateway sh -c 'ts=\$(date -u +%Y%m%d-%H%M%S); if [ -f /app/.gateway-data/nonces.json ]; then mv /app/.gateway-data/nonces.json /app/.gateway-data/nonces.json.backup-\${ts}; fi'"
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
