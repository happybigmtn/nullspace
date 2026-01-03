#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-live-table}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8080}"
GATEWAY_PORT="${GATEWAY_PORT:-9010}"
BOT_COUNT="${GATEWAY_LIVE_TABLE_BOT_COUNT:-100}"
BOT_PARTICIPATION="${GATEWAY_LIVE_TABLE_BOT_PARTICIPATION:-1}"
BOT_BET_MIN="${GATEWAY_LIVE_TABLE_BOT_BET_MIN:-5}"
BOT_BET_MAX="${GATEWAY_LIVE_TABLE_BOT_BET_MAX:-25}"
BOT_BETS_MIN="${GATEWAY_LIVE_TABLE_BOT_BETS_MIN:-1}"
BOT_BETS_MAX="${GATEWAY_LIVE_TABLE_BOT_BETS_MAX:-1}"
BOT_BATCH="${GATEWAY_LIVE_TABLE_BOT_BATCH:-10}"
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
LAN_IP="${LAN_IP:-127.0.0.1}"
GATEWAY_WS_URL="${GATEWAY_WS_URL:-ws://${LAN_IP}:${GATEWAY_PORT}}"
ATTACH="${ATTACH:-1}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required. Install tmux and re-run."
  exit 1
fi

if [ ! -f "${ROOT_DIR}/website/.env.local" ]; then
  echo "Missing website/.env.local (required for VITE_IDENTITY)."
  echo "Create it or copy configs/local/.env.local manually."
  exit 1
fi

VITE_IDENTITY="$(awk -F= '/^VITE_IDENTITY=/{print $2}' "${ROOT_DIR}/website/.env.local")"
if [ -z "${VITE_IDENTITY}" ]; then
  echo "Missing VITE_IDENTITY in website/.env.local."
  exit 1
fi

SIMULATOR_PID="$(pgrep -f "nullspace-simulator --host 127.0.0.1 --port 8080" | head -n 1 || true)"
SIMULATOR_IDENTITY=""
if [ -n "${SIMULATOR_PID}" ]; then
  SIMULATOR_IDENTITY="$(ps -o args= -p "${SIMULATOR_PID}" | awk '{for (i=1;i<=NF;i++) if ($i=="--identity") {print $(i+1); exit}}')"
fi
if [ -n "${SIMULATOR_IDENTITY}" ]; then
  VITE_IDENTITY="${SIMULATOR_IDENTITY}"
fi

ADMIN_KEY_FILE="${CASINO_ADMIN_PRIVATE_KEY_FILE:-}"
ADMIN_KEY_HEX="${CASINO_ADMIN_PRIVATE_KEY_HEX:-}"
if [[ -z "${ADMIN_KEY_FILE}" && -z "${ADMIN_KEY_HEX}" && -f "${ROOT_DIR}/configs/local/casino-admin-key.hex" ]]; then
  ADMIN_KEY_FILE="${ROOT_DIR}/configs/local/casino-admin-key.hex"
fi

if [[ -z "${ADMIN_KEY_FILE}" && -z "${ADMIN_KEY_HEX}" ]]; then
  echo "Set CASINO_ADMIN_PRIVATE_KEY_FILE or CASINO_ADMIN_PRIVATE_KEY_HEX for the casino admin key."
  exit 1
fi

if [ -z "${CASINO_ADMIN_PUBLIC_KEY_HEX:-}" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to derive CASINO_ADMIN_PUBLIC_KEY_HEX."
    exit 1
  fi
  if [ -n "${ADMIN_KEY_HEX}" ]; then
    CASINO_ADMIN_PUBLIC_KEY_HEX="$(ADMIN_KEY_HEX="${ADMIN_KEY_HEX}" node -e "const { ed25519 } = require('@noble/curves/ed25519'); const hex=(process.env.ADMIN_KEY_HEX||'').replace(/^0x/,''); const pk=ed25519.getPublicKey(Buffer.from(hex,'hex')); console.log(Buffer.from(pk).toString('hex'));" )"
  else
    CASINO_ADMIN_PUBLIC_KEY_HEX="$(ADMIN_KEY_FILE="${ADMIN_KEY_FILE}" node -e "const fs=require('fs'); const { ed25519 } = require('@noble/curves/ed25519'); const hex=fs.readFileSync(process.env.ADMIN_KEY_FILE,'utf8').trim().replace(/^0x/,''); const pk=ed25519.getPublicKey(Buffer.from(hex,'hex')); console.log(Buffer.from(pk).toString('hex'));" )"
  fi
fi

if [ -z "${CASINO_ADMIN_PUBLIC_KEY_HEX}" ]; then
  echo "Failed to derive CASINO_ADMIN_PUBLIC_KEY_HEX."
  exit 1
fi

if [ ! -f "${ROOT_DIR}/target/release/nullspace-simulator" ] || [ ! -f "${ROOT_DIR}/target/release/nullspace-node" ]; then
  echo "Building nullspace-simulator + validators..."
  (cd "${ROOT_DIR}" && cargo build --release -p nullspace-simulator -p nullspace-node)
fi

ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:9010,http://127.0.0.1:9010"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists."
  if [ "${ATTACH}" = "1" ]; then
    tmux attach -t "${SESSION_NAME}"
  else
    echo "Attach with: tmux attach -t ${SESSION_NAME}"
  fi
  exit 0
fi

tmux new-session -d -s "${SESSION_NAME}" -n chain -c "${ROOT_DIR}"

tmux set-environment -t "${SESSION_NAME}" VITE_IDENTITY "${VITE_IDENTITY}"
tmux set-environment -t "${SESSION_NAME}" CASINO_ADMIN_PUBLIC_KEY_HEX "${CASINO_ADMIN_PUBLIC_KEY_HEX}"
tmux set-environment -t "${SESSION_NAME}" BACKEND_URL "${BACKEND_URL}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_PORT "${GATEWAY_PORT}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_CRAPS "1"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_CRAPS_ONCHAIN "1"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_COUNT "${BOT_COUNT}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_PARTICIPATION "${BOT_PARTICIPATION}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_BET_MIN "${BOT_BET_MIN}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_BET_MAX "${BOT_BET_MAX}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_BETS_MIN "${BOT_BETS_MIN}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_BETS_MAX "${BOT_BETS_MAX}"
tmux set-environment -t "${SESSION_NAME}" GATEWAY_LIVE_TABLE_BOT_BATCH "${BOT_BATCH}"
tmux set-environment -t "${SESSION_NAME}" RATE_LIMIT_SUBMIT_PER_MIN "10000"
tmux set-environment -t "${SESSION_NAME}" RATE_LIMIT_SUBMIT_BURST "1000"
tmux set-environment -t "${SESSION_NAME}" EXPO_PUBLIC_WS_URL "${GATEWAY_WS_URL}"
tmux set-environment -t "${SESSION_NAME}" EXPO_PUBLIC_LIVE_TABLE_CRAPS "1"
tmux set-environment -t "${SESSION_NAME}" EXPO_PUBLIC_LIVE_TABLE_CRAPS_ONCHAIN "1"
tmux set-environment -t "${SESSION_NAME}" ALLOWED_ORIGINS "${ALLOWED_ORIGINS}"

if [ -n "${ADMIN_KEY_FILE}" ]; then
  tmux set-environment -t "${SESSION_NAME}" CASINO_ADMIN_PRIVATE_KEY_FILE "${ADMIN_KEY_FILE}"
elif [ -n "${ADMIN_KEY_HEX}" ]; then
  tmux set-environment -t "${SESSION_NAME}" CASINO_ADMIN_PRIVATE_KEY_HEX "${ADMIN_KEY_HEX}"
fi

tmux send-keys -t "${SESSION_NAME}:chain.0" 'cd "'"${ROOT_DIR}"'"; ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 ALLOWED_HTTP_ORIGINS="'"${ALLOWED_ORIGINS}"'" ALLOWED_WS_ORIGINS="'"${ALLOWED_ORIGINS}"'" CASINO_ADMIN_PUBLIC_KEY_HEX="'"${CASINO_ADMIN_PUBLIC_KEY_HEX}"'" ./scripts/start-local-network.sh configs/local 4 --no-build' C-m

tmux new-window -t "${SESSION_NAME}" -n gateway -c "${ROOT_DIR}"
tmux send-keys -t "${SESSION_NAME}:gateway" 'cd "'"${ROOT_DIR}"'"; BACKEND_URL="'"${BACKEND_URL}"'" GATEWAY_PORT="'"${GATEWAY_PORT}"'" GATEWAY_LIVE_TABLE_CRAPS=1 GATEWAY_LIVE_TABLE_CRAPS_ONCHAIN=1 pnpm -C gateway start' C-m

tmux new-window -t "${SESSION_NAME}" -n mobile -c "${ROOT_DIR}"
tmux send-keys -t "${SESSION_NAME}:mobile" 'cd "'"${ROOT_DIR}"'"; EXPO_PUBLIC_WS_URL="'"${GATEWAY_WS_URL}"'" EXPO_PUBLIC_LIVE_TABLE_CRAPS=1 EXPO_PUBLIC_LIVE_TABLE_CRAPS_ONCHAIN=1 pnpm -C mobile start' C-m

if [ "${ATTACH}" = "1" ]; then
  tmux attach -t "${SESSION_NAME}"
else
  echo "tmux session '${SESSION_NAME}' started."
  echo "Attach with: tmux attach -t ${SESSION_NAME}"
fi
