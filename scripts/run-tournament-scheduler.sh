#!/bin/bash
set -euo pipefail

CONFIG_DIR="${1:-configs/local}"
URL="${2:-http://localhost:8080}"
POLL_SECS="${POLL_SECS:-5}"
NO_BUILD="${NO_BUILD:-false}"

ADMIN_KEY="${CASINO_ADMIN_PRIVATE_KEY_HEX:-}"
ADMIN_KEY_FILE="${CASINO_ADMIN_PRIVATE_KEY_FILE:-}"
if [[ -z "$ADMIN_KEY" && -z "$ADMIN_KEY_FILE" ]]; then
  echo "Set CASINO_ADMIN_PRIVATE_KEY_FILE or CASINO_ADMIN_PRIVATE_KEY_HEX to the admin private key."
  exit 1
fi

IDENTITY="${IDENTITY_HEX:-}"
if [[ -z "$IDENTITY" ]]; then
  if [[ ! -f "$CONFIG_DIR/node0.yaml" ]]; then
    echo "Missing config: $CONFIG_DIR/node0.yaml"
    echo "Provide IDENTITY_HEX env or generate configs via scripts/bootstrap-testnet.sh"
    exit 1
  fi
  POLYNOMIAL=$(grep "^polynomial:" "$CONFIG_DIR/node0.yaml" | head -1 | awk '{print $2}' | tr -d '"')
  if [[ -z "$POLYNOMIAL" ]]; then
    echo "Could not extract polynomial from $CONFIG_DIR/node0.yaml"
    exit 1
  fi
  IDENTITY="${POLYNOMIAL:0:192}"
fi

if [[ "$NO_BUILD" == "true" ]]; then
  if [[ ! -f "target/release/tournament-scheduler" ]]; then
    echo "Missing target/release/tournament-scheduler; run without NO_BUILD to compile."
    exit 1
  fi
  if [[ -n "$ADMIN_KEY_FILE" ]]; then
    ./target/release/tournament-scheduler \
      --url "$URL" \
      --identity "$IDENTITY" \
      --admin-key-file "$ADMIN_KEY_FILE" \
      --poll-secs "$POLL_SECS"
  else
    ./target/release/tournament-scheduler \
      --url "$URL" \
      --identity "$IDENTITY" \
      --admin-key "$ADMIN_KEY" \
      --poll-secs "$POLL_SECS"
  fi
else
  if [[ -n "$ADMIN_KEY_FILE" ]]; then
    cargo run --release --bin tournament-scheduler -- \
      --url "$URL" \
      --identity "$IDENTITY" \
      --admin-key-file "$ADMIN_KEY_FILE" \
      --poll-secs "$POLL_SECS"
  else
    cargo run --release --bin tournament-scheduler -- \
      --url "$URL" \
      --identity "$IDENTITY" \
      --admin-key "$ADMIN_KEY" \
      --poll-secs "$POLL_SECS"
  fi
fi
