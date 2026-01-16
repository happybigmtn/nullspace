#!/usr/bin/env bash
set -euo pipefail

# Consensus recovery helper (staging/testnet).
# Non-destructive by default. Destructive wipe requires WIPE=1 and CONFIRM_RESET=1.

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
SSH_USER="${SSH_USER:-root}"

NS_DB_HOST="${NS_DB_HOST:-5.161.124.82}"
NS_SIM_HOST="${NS_SIM_HOST:-5.161.67.36}"
NS_GW_HOST="${NS_GW_HOST:-178.156.212.135}"

VALIDATOR_CONTAINERS=(nullspace-node-0 nullspace-node-1 nullspace-node-2 nullspace-node-3)
SIMULATOR_CONTAINERS=(nullspace-simulator)
GATEWAY_CONTAINERS=(nullspace-gateway nullspace-website)

WIPE="${WIPE:-0}"
CONFIRM_RESET="${CONFIRM_RESET:-0}"

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

if [[ "$WIPE" == "1" ]]; then
  if [[ "$CONFIRM_RESET" != "1" ]]; then
    echo "Refusing to wipe: set CONFIRM_RESET=1" >&2
    exit 1
  fi
  echo "==> Running destructive testnet recovery"
  CONFIRM_RESET=1 SSH_KEY="$SSH_KEY" SSH_USER="$SSH_USER" \
    NS_DB_HOST="$NS_DB_HOST" NS_SIM_HOST="$NS_SIM_HOST" NS_GW_HOST="$NS_GW_HOST" \
    ./scripts/testnet-consensus-recover.sh
  exit 0
fi

if [[ "$CONFIRM_RESET" == "1" ]]; then
  echo "CONFIRM_RESET is set but WIPE=0; continuing with non-destructive restart." >&2
fi

echo "==> Restarting validators on ${NS_DB_HOST}"
remote "$NS_DB_HOST" "docker restart ${VALIDATOR_CONTAINERS[*]}"
remote "$NS_DB_HOST" "systemctl enable --now nullspace-consensus-watchdog.timer"

echo "==> Restarting simulator on ${NS_SIM_HOST}"
remote "$NS_SIM_HOST" "docker restart ${SIMULATOR_CONTAINERS[*]}"

echo "==> Restarting gateway + website on ${NS_GW_HOST}"
remote "$NS_GW_HOST" "docker restart ${GATEWAY_CONTAINERS[*]}"

echo "==> Verifying public endpoints"
./scripts/health-check.sh

cat <<'MSG'
Done. If the chain remains stalled:
- Re-run with WIPE=1 CONFIRM_RESET=1 (destructive).
- Inspect validator metrics and logs for aggregation_tip/finalized_height staleness.
MSG
