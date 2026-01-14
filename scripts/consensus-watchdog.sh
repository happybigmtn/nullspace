#!/usr/bin/env bash
set -euo pipefail

# Consensus watchdog for nullspace validators.
# Checks validator metrics for stalled progress or diverged heights
# and restarts lagging nodes. Optional data quarantine requires WIPE_STALE=1.

PORTS=(9100 9101 9102 9103)
NODE_NAMES=(nullspace-node-0 nullspace-node-1 nullspace-node-2 nullspace-node-3)
TOKEN_FILE="/etc/nullspace/node.env"
STATE_FILE="/var/lib/nullspace/consensus-watchdog.state"
LOG_FILE="/var/log/nullspace-consensus-watchdog.log"

LAG_THRESHOLD="${LAG_THRESHOLD:-100}"
STALL_SECONDS="${STALL_SECONDS:-120}"
RESTART_COOLDOWN="${RESTART_COOLDOWN:-60}"
WIPE_STALE="${WIPE_STALE:-0}"

heights=()
views=()

log() {
  local msg="$*"
  local ts
  ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "[$ts] $msg" | tee -a "$LOG_FILE" >/dev/null
}

load_token() {
  if [[ ! -f "$TOKEN_FILE" ]]; then
    log "ERROR: metrics token file missing: $TOKEN_FILE"
    return 1
  fi
  local token
  token="$(grep -m1 '^METRICS_AUTH_TOKEN=' "$TOKEN_FILE" | cut -d= -f2- || true)"
  if [[ -z "${token:-}" ]]; then
    log "ERROR: METRICS_AUTH_TOKEN not found in $TOKEN_FILE"
    return 1
  fi
  echo "$token"
}

fetch_metric() {
  local metrics="$1"
  local name="$2"
  awk -v n="$name" '$1 == n { print $2; exit }' <<<"$metrics"
}

ensure_state_dir() {
  local dir
  dir="$(dirname "$STATE_FILE")"
  mkdir -p "$dir"
}

read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
}

write_state() {
  {
    echo "last_max_height=${last_max_height:-0}"
    echo "last_max_height_ts=${last_max_height_ts:-0}"
    echo "last_restart_ts=${last_restart_ts:-0}"
    for i in "${!PORTS[@]}"; do
      local key="node_${PORTS[$i]}_height"
      printf "%s=%s\n" "$key" "${heights[$i]:-0}"
    done
  } >"$STATE_FILE"
}

quarantine_data() {
  local node_name="$1"
  local node_dir="/var/lib/nullspace/${node_name#nullspace-}"
  local ts
  ts="$(date -u '+%Y%m%dT%H%M%SZ')"
  if [[ -d "$node_dir" ]]; then
    local target="${node_dir}.bak-${ts}"
    log "Quarantining data dir for $node_name: $node_dir -> $target"
    mv "$node_dir" "$target"
  else
    log "WARN: data dir not found for $node_name: $node_dir"
  fi
}

restart_node() {
  local node_name="$1"
  log "Restarting $node_name"
  docker restart "$node_name" >/dev/null
}

main() {
  ensure_state_dir
  touch "$LOG_FILE"
  read_state

  local now
  now="$(date +%s)"

  local token
  if ! token="$(load_token)"; then
    exit 1
  fi

  local max_height=0
  local min_height=0
  heights=()
  views=()
  local bad_ports=()

  for i in "${!PORTS[@]}"; do
    local port="${PORTS[$i]}"
    local metrics
    if ! metrics="$(curl -sf --max-time 2 -H "Authorization: Bearer ${token}" "http://127.0.0.1:${port}/metrics")"; then
      log "ERROR: failed to fetch metrics from port ${port}"
      heights[$i]=0
      views[$i]=0
      bad_ports+=("$i")
      continue
    fi

    local height view
    height="$(fetch_metric "$metrics" "nullspace_engine_marshal_finalized_height")"
    view="$(fetch_metric "$metrics" "nullspace_engine_consensus_voter_state_current_view")"
    height="${height:-0}"
    view="${view:-0}"
    heights[$i]="$height"
    views[$i]="$view"

    if [[ "$height" =~ ^[0-9]+$ ]]; then
      if [[ "$max_height" -eq 0 || "$height" -gt "$max_height" ]]; then
        max_height="$height"
      fi
      if [[ "$min_height" -eq 0 || "$height" -lt "$min_height" ]]; then
        min_height="$height"
      fi
    fi
  done

  if [[ "$max_height" -eq 0 ]]; then
    log "ERROR: no valid heights collected"
    exit 1
  fi

  local stalled=0
  if [[ "${last_max_height:-0}" -eq "$max_height" ]]; then
    local last_ts="${last_max_height_ts:-0}"
    if [[ $((now - last_ts)) -ge "$STALL_SECONDS" ]]; then
      stalled=1
    fi
  else
    last_max_height="$max_height"
    last_max_height_ts="$now"
  fi

  local lagging=()
  for i in "${!PORTS[@]}"; do
    local height="${heights[$i]:-0}"
    if [[ "$height" -gt 0 && $((max_height - height)) -ge "$LAG_THRESHOLD" ]]; then
      lagging+=("$i")
    fi
  done

  log "heights: 9100=${heights[0]:-0} 9101=${heights[1]:-0} 9102=${heights[2]:-0} 9103=${heights[3]:-0} max=${max_height} min=${min_height} stalled=${stalled} lagging=${#lagging[@]}"

  local do_restart=0
  if [[ "${#bad_ports[@]}" -gt 0 ]]; then
    log "WARN: metrics unreachable on ports: ${bad_ports[*]}"
    do_restart=1
    lagging+=("${bad_ports[@]}")
  fi

  if [[ "$stalled" -eq 1 ]]; then
    log "WARN: consensus stalled (max_height=${max_height}, age=$((now - last_max_height_ts))s)"
    do_restart=1
    if [[ "${#lagging[@]}" -eq 0 ]]; then
      # no obvious lagger, restart all nodes
      lagging=("${!PORTS[@]}")
    fi
  fi

  if [[ "$do_restart" -eq 1 ]]; then
    local last_restart="${last_restart_ts:-0}"
    if [[ $((now - last_restart)) -lt "$RESTART_COOLDOWN" ]]; then
      log "INFO: restart cooldown active ($((now - last_restart))s < ${RESTART_COOLDOWN}s), skipping"
    else
      last_restart_ts="$now"
      for idx in "${lagging[@]}"; do
        local node_name="${NODE_NAMES[$idx]}"
        if [[ "$WIPE_STALE" == "1" ]]; then
          quarantine_data "$node_name"
        fi
        restart_node "$node_name"
      done
    fi
  fi

  write_state
}

main "$@"
