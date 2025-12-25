#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

URL="${URL:-http://localhost:8080}"
IDENTITY="${IDENTITY:-}"
DAYS="${DAYS:-365}"
DAY_SECONDS="${DAY_SECONDS:-5}"
INITIAL_PLAYERS="${INITIAL_PLAYERS:-1000}"
DAILY_NEW_PLAYERS="${DAILY_NEW_PLAYERS:-25}"
DAILY_CHURN_BPS="${DAILY_CHURN_BPS:-50}"
DAILY_ACTIVE_BPS="${DAILY_ACTIVE_BPS:-2500}"
MEMBER_SHARE_BPS="${MEMBER_SHARE_BPS:-500}"
INITIAL_DEPOSIT="${INITIAL_DEPOSIT:-1000}"
SEED="${SEED:-42}"
OUTPUT="${OUTPUT:-phase1-snapshot.json}"
KEYS_OUT="${KEYS_OUT:-}"
DRY_RUN="${DRY_RUN:-false}"

if [[ -z "${IDENTITY}" ]]; then
  echo "IDENTITY is required (validator identity hex)." >&2
  echo "Example: IDENTITY=<hex> URL=${URL} $0" >&2
  exit 1
fi

ARGS=(
  --url "${URL}"
  --identity "${IDENTITY}"
  --days "${DAYS}"
  --day-seconds "${DAY_SECONDS}"
  --initial-players "${INITIAL_PLAYERS}"
  --daily-new-players "${DAILY_NEW_PLAYERS}"
  --daily-churn-bps "${DAILY_CHURN_BPS}"
  --daily-active-bps "${DAILY_ACTIVE_BPS}"
  --member-share-bps "${MEMBER_SHARE_BPS}"
  --initial-deposit "${INITIAL_DEPOSIT}"
  --seed "${SEED}"
  --output "${OUTPUT}"
)

if [[ -n "${KEYS_OUT}" ]]; then
  ARGS+=(--export-keys "${KEYS_OUT}")
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  ARGS+=(--dry-run)
fi

cargo run --release --bin phase_simulation -- "${ARGS[@]}"
