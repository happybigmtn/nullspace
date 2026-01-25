#!/usr/bin/env bash
set -euo pipefail

# Wrapper to upload and run the fix script
# Usage: ./scripts/ops/fix_validator_peers.sh [SSH_USER] [HOST_IP]

SSH_USER="${1:-root}"
HOST_IP="${2:-5.161.124.82}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
REMOTE_SCRIPT="scripts/ops/remote_fix_validator_inner.sh"

echo "==> Fixing validator peers on ${HOST_IP}..."

if [[ ! -f "$SSH_KEY" ]]; then
    echo "Error: SSH key not found at $SSH_KEY"
    exit 1
fi

SSH_OPTS=(
    -i "$SSH_KEY"
    -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new
    -o UserKnownHostsFile="$HOME/.ssh/known_hosts"
)

# Upload the script
echo "--> Uploading script..."
scp "${SSH_OPTS[@]}" "$REMOTE_SCRIPT" "${SSH_USER}@${HOST_IP}:/tmp/fix_validator.sh"

# Execute
echo "--> Executing remote script..."
ssh "${SSH_OPTS[@]}" "${SSH_USER}@${HOST_IP}" "chmod +x /tmp/fix_validator.sh && /tmp/fix_validator.sh"

echo "==> Done."