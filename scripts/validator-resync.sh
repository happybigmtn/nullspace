#!/usr/bin/env bash
set -euo pipefail

# Resync one or more validators from a source validator snapshot.
# Non-destructive: moves existing data aside instead of deleting.
# Optional consensus reset clears consensus/marshal caches to avoid signer mismatch on replay.

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
SSH_USER="${SSH_USER:-root}"
NS_DB_HOST="${NS_DB_HOST:-5.161.124.82}"

SOURCE_NODE="${SOURCE_NODE:-0}"
TARGET_NODES="${TARGET_NODES:-1}"
RESET_CONSENSUS="${RESET_CONSENSUS:-1}"

DATA_ROOT="${DATA_ROOT:-/var/lib/nullspace}"
NODE_PREFIX="${NODE_PREFIX:-nullspace-node-}"

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

IFS=',' read -r -a TARGETS <<< "$TARGET_NODES"
if [[ "${#TARGETS[@]}" -eq 0 ]]; then
  echo "No target nodes provided (TARGET_NODES is empty)." >&2
  exit 1
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"

for target in "${TARGETS[@]}"; do
  if [[ "$target" == "$SOURCE_NODE" ]]; then
    echo "Skipping target ${target} (same as source)."
    continue
  fi

  echo "==> Resyncing node-${target} from node-${SOURCE_NODE} (ts=${TS})"
  remote "$NS_DB_HOST" "set -euo pipefail;
    SRC=\"${DATA_ROOT}/node-${SOURCE_NODE}\";
    DST=\"${DATA_ROOT}/node-${target}\";
    BACKUP=\"${DATA_ROOT}/node-${target}-resync-${TS}\";
    CONSENSUS_BACKUP=\"${DATA_ROOT}/node-${target}-consensus-reset-${TS}\";

    docker stop ${NODE_PREFIX}${target} || true;

    if [[ -d \"$DST\" ]]; then
      mv \"$DST\" \"$BACKUP\";
    fi
    install -d -o nullspace -g nullspace \"$DST\";

    rsync -a --numeric-ids \"$SRC/engine-application-\"* \"$DST/\";
    rsync -a --numeric-ids \"$SRC/engine-aggregator-\"* \"$DST/\";
    rsync -a --numeric-ids \"$SRC/engine-seeder-\"* \"$DST/\";
    rsync -a --numeric-ids \"$SRC/engine-marshal-application-metadata\" \"$DST/\";

    if [[ \"$RESET_CONSENSUS\" == \"1\" ]]; then
      mkdir -p \"$CONSENSUS_BACKUP\";
      shopt -s nullglob;
      mv \"$DST/engine-consensus\" \"$CONSENSUS_BACKUP\"/ || true;
      mv \"$DST/engine-marshal-cache-\"* \"$CONSENSUS_BACKUP\"/ || true;
      mv \"$DST/engine-marshal-finalizations-\"* \"$CONSENSUS_BACKUP\"/ || true;
      mv \"$DST/engine-marshal-finalized-blocks\" \"$CONSENSUS_BACKUP\"/ || true;
      shopt -u nullglob;
    fi

    chown -R nullspace:nullspace \"$DST\";
    docker start ${NODE_PREFIX}${target};
  "

done

echo "Done. Verify metrics on target nodes for application_finalized_height and aggregation_tip."
