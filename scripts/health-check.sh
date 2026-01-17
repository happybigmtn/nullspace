#!/bin/bash

# Health Check Monitoring Script for Staging Environment
# Checks critical endpoints and reports their status

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track overall health
ALL_HEALTHY=true
NODE_METRICS_URLS="${NODE_METRICS_URLS:-}"
METRICS_AUTH_TOKEN="${METRICS_AUTH_TOKEN:-}"
AGGREGATION_TIP_MAX_AGE_SEC="${AGGREGATION_TIP_MAX_AGE_SEC:-120}"
FINALIZED_HEIGHT_MAX_AGE_SEC="${FINALIZED_HEIGHT_MAX_AGE_SEC:-120}"
MEMPOOL_CONNECTED_MAX_AGE_SEC="${MEMPOOL_CONNECTED_MAX_AGE_SEC:-30}"
SUMMARY_UPLOAD_MAX_AGE_SEC="${SUMMARY_UPLOAD_MAX_AGE_SEC:-120}"

# Function to check endpoint health
check_endpoint() {
    local name="$1"
    local url="$2"
    local extra_args="${3:-}"

    echo -n "Checking ${name}... "

    # Use curl with timeout and follow redirects
    # -s: silent, -f: fail on HTTP errors, -L: follow redirects, --max-time: timeout
    if eval "curl -s -f -L --max-time 10 ${extra_args} -o /dev/null -w '%{http_code}' '${url}'" > /dev/null 2>&1; then
        echo -e "${GREEN}UP${NC}"
        return 0
    else
        echo -e "${RED}DOWN${NC}"
        ALL_HEALTHY=false
        return 1
    fi
}

check_block_freshness() {
    local url="$1"
    local max_age_sec="${2:-120}"
    echo -n "Checking chain freshness... "

    local json
    if ! json=$(curl -s --max-time 10 "$url"); then
        echo -e "${RED}DOWN${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local indexed_ms
    indexed_ms=$(echo "$json" | python3 -c '
import json,sys
try:
    data=json.load(sys.stdin)
    blocks = data.get("blocks", [])
    if not blocks or blocks[0] is None:
        print(-1)
    else:
        print(blocks[0].get("indexed_at_ms", -1))
except Exception as e:
    print(-1)
')
    if [ "$indexed_ms" = "-1" ]; then
        echo -e "${RED}NO_BLOCKS${NC}"
        ALL_HEALTHY=false
        return 1
    fi
    local now_ms
    now_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
    )
    local age_sec=$(( (now_ms - indexed_ms) / 1000 ))
    if [ "$age_sec" -le "$max_age_sec" ]; then
        echo -e "${GREEN}UP${NC} (${age_sec}s)"
        return 0
    else
        echo -e "${RED}STALE${NC} (${age_sec}s)"
        ALL_HEALTHY=false
        return 1
    fi
}

fetch_metrics() {
    local url="$1"
    local auth_header=()
    if [ -n "$METRICS_AUTH_TOKEN" ]; then
        auth_header=(-H "x-metrics-token: ${METRICS_AUTH_TOKEN}")
    fi
    curl -s --max-time 5 "${auth_header[@]}" "$url"
}

read_metric() {
    local metrics="$1"
    local name="$2"
    echo "$metrics" | python3 -c "
import sys
name = '$name'
lines = []
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    parts = line.split()
    if len(parts) < 2:
        continue
    lines.append(parts)

exact = None
suffix = []
for metric, value in lines:
    if metric == name:
        exact = value
    elif metric.endswith('_' + name):
        suffix.append((metric, value))

if exact is not None:
    print(exact)
elif len(suffix) == 1:
    print(suffix[0][1])
else:
    print('')
"
}

check_metric_age() {
    local label="$1"
    local url="$2"
    local metric="$3"
    local updated_metric="$4"
    local max_age="$5"

    echo -n "Checking ${label}... "

    local metrics
    if ! metrics="$(fetch_metrics "$url")"; then
        echo -e "${RED}DOWN${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local value
    value="$(read_metric "$metrics" "$metric")"
    local updated_ms
    updated_ms="$(read_metric "$metrics" "$updated_metric")"

    if [ -z "$value" ] || [ -z "$updated_ms" ]; then
        echo -e "${RED}MISSING${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local now_ms
    now_ms=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
    )
    local age_sec=$(( (now_ms - updated_ms) / 1000 ))
    if [ "$age_sec" -le "$max_age" ]; then
        echo -e "${GREEN}UP${NC} (${age_sec}s)"
        return 0
    else
        echo -e "${RED}STALE${NC} (${age_sec}s)"
        ALL_HEALTHY=false
        return 1
    fi
}

check_mempool_connected() {
    local url="$1"
    echo -n "Checking mempool connectivity... "

    local metrics
    if ! metrics="$(fetch_metrics "$url")"; then
        echo -e "${RED}DOWN${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local connected
    connected="$(read_metric "$metrics" "mempool_connected")"
    local updated_ms
    updated_ms="$(read_metric "$metrics" "mempool_connected_updated_ms")"

    if [ -z "$connected" ] || [ -z "$updated_ms" ]; then
        echo -e "${RED}MISSING${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local now_ms
    now_ms=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
    )
    local age_sec=$(( (now_ms - updated_ms) / 1000 ))
    if [ "$connected" = "1" ] && [ "$age_sec" -le "$MEMPOOL_CONNECTED_MAX_AGE_SEC" ]; then
        echo -e "${GREEN}UP${NC} (${age_sec}s)"
        return 0
    else
        echo -e "${RED}DOWN${NC} (connected=${connected}, age=${age_sec}s)"
        ALL_HEALTHY=false
        return 1
    fi
}

check_summary_upload_activity() {
    local url="$1"
    echo -n "Checking summary uploads (${url})... "

    local metrics
    if ! metrics="$(fetch_metrics "$url")"; then
        echo -e "${RED}DOWN${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local summary_last_ms
    summary_last_ms="$(read_metric "$metrics" "summary_upload_last_attempt_ms")"
    local finalized_updated_ms
    finalized_updated_ms="$(read_metric "$metrics" "finalized_height_updated_ms")"

    if [ -z "$summary_last_ms" ] || [ -z "$finalized_updated_ms" ]; then
        echo -e "${RED}MISSING${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local now_ms
    now_ms=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
    )
    local finalized_age_sec=$(( (now_ms - finalized_updated_ms) / 1000 ))
    if [ "$finalized_age_sec" -gt "$FINALIZED_HEIGHT_MAX_AGE_SEC" ]; then
        echo -e "${YELLOW}SKIP${NC} (finalized stale)"
        return 0
    fi

    local summary_age_sec=$(( (now_ms - summary_last_ms) / 1000 ))
    if [ "$summary_age_sec" -le "$SUMMARY_UPLOAD_MAX_AGE_SEC" ]; then
        echo -e "${GREEN}UP${NC} (${summary_age_sec}s)"
        return 0
    else
        echo -e "${RED}STALE${NC} (${summary_age_sec}s)"
        ALL_HEALTHY=false
        return 1
    fi
}

echo "=========================================="
echo "Staging Environment Health Check"
echo "Started at: $(date)"
echo "=========================================="
echo

# Check all endpoints
check_endpoint "Website" "https://testnet.regenesis.dev"
check_endpoint "Auth Service" "https://auth.testnet.regenesis.dev/healthz"
check_endpoint "Indexer Service" "https://indexer.testnet.regenesis.dev/healthz"
check_endpoint "Gateway API" "https://api.testnet.regenesis.dev/healthz" "-H 'Origin: https://testnet.regenesis.dev'"
check_endpoint "Convex Service" "https://convex.testnet.regenesis.dev"
check_block_freshness "https://testnet.regenesis.dev/api/explorer/blocks?offset=0&limit=1" "120"

if [ -n "$NODE_METRICS_URLS" ]; then
    IFS=',' read -ra METRICS_URL_LIST <<<"$NODE_METRICS_URLS"
    for metrics_url in "${METRICS_URL_LIST[@]}"; do
        [ -z "$metrics_url" ] && continue
        check_metric_age "Aggregation tip (${metrics_url})" "$metrics_url" \
            "aggregation_tip" "aggregation_tip_updated_ms" "$AGGREGATION_TIP_MAX_AGE_SEC" || true
        check_metric_age "Finalized height (${metrics_url})" "$metrics_url" \
            "finalized_height" "finalized_height_updated_ms" "$FINALIZED_HEIGHT_MAX_AGE_SEC" || true
        check_mempool_connected "$metrics_url" || true
        check_summary_upload_activity "$metrics_url" || true
    done
fi

echo
echo "=========================================="

# Report final status
if [ "$ALL_HEALTHY" = true ]; then
    echo -e "${GREEN}All endpoints are healthy!${NC}"
    exit 0
else
    echo -e "${RED}One or more endpoints are down!${NC}"
    exit 1
fi
