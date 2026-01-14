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
    indexed_ms=$(python - <<'PY' <<<"$json"
import json,sys
data=json.load(sys.stdin)
print(data["blocks"][0]["indexed_at_ms"])
PY
    )
    local now_ms
    now_ms=$(python - <<'PY'
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
