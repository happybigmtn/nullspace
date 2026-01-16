#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${CONFIG:-configs/review-agents.json}"
AGENT_ID="${AGENT:-}"
STRICT="${STRICT:-0}"

cmd=(node "$ROOT_DIR/scripts/review-agents.mjs" --config "$CONFIG")
if [ -n "$AGENT_ID" ]; then
  cmd+=(--agent "$AGENT_ID")
fi
if [ "$STRICT" = "1" ]; then
  cmd+=(--strict)
fi

printf "[agent-review] %s\n" "${cmd[*]}"
"${cmd[@]}"
