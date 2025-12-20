#!/bin/bash
#
# Start a local consensus network with simulator as indexer.
#
# Usage: ./scripts/start-local-network.sh [CONFIG_DIR] [NODES] [OPTIONS]
#
# Options:
#   --fresh    Clean data directory before starting (recommended for dev)
#   --no-build Skip cargo build (use existing binaries)
#
# Prerequisites:
#   1. Generate keys: cargo run --bin generate-keys -- --nodes 4 --output configs/local
#   2. Copy env to frontend: cp configs/local/.env.local website/.env.local
#
set -euo pipefail

# Parse options
FRESH=false
NO_BUILD=false
POSITIONAL=()

for arg in "$@"; do
    case $arg in
        --fresh)
            FRESH=true
            shift
            ;;
        --no-build)
            NO_BUILD=true
            shift
            ;;
        *)
            POSITIONAL+=("$arg")
            ;;
    esac
done

set -- "${POSITIONAL[@]:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

CONFIG_DIR="${1:-configs/local}"
NODES="${2:-4}"

echo -e "${CYAN}Starting local consensus network${NC}"
echo "Config directory: $CONFIG_DIR"
echo "Number of nodes: $NODES"
echo

# Check if configs exist
if [ ! -f "$CONFIG_DIR/node0.yaml" ]; then
    echo -e "${RED}Error: Config files not found in $CONFIG_DIR${NC}"
    echo "Run: cargo run --bin generate-keys -- --nodes $NODES --output $CONFIG_DIR"
    exit 1
fi

if [ ! -f "$CONFIG_DIR/peers.yaml" ]; then
    echo -e "${RED}Error: peers.yaml not found in $CONFIG_DIR${NC}"
    exit 1
fi

# Extract identity (polynomial) from first node config for simulator
# The polynomial starts with the public identity
POLYNOMIAL=$(grep "^polynomial:" "$CONFIG_DIR/node0.yaml" | head -1 | awk '{print $2}' | tr -d '"')
if [ -z "$POLYNOMIAL" ]; then
    echo -e "${RED}Error: Could not extract polynomial from config${NC}"
    exit 1
fi

# The identity is the first 96 bytes (192 hex chars) of the polynomial
IDENTITY="${POLYNOMIAL:0:192}"
echo -e "${GREEN}Network identity:${NC} ${IDENTITY:0:32}..."

# Array to store PIDs
declare -a PIDS=()

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    # Wait for processes to die gracefully
    sleep 1
    # Force kill any remaining
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
    echo -e "${GREEN}All processes stopped${NC}"
}

trap cleanup EXIT INT TERM

# Clean data if --fresh flag is set
if [ "$FRESH" = true ]; then
    echo -e "${YELLOW}Cleaning node data directories...${NC}"
    rm -rf ./data/node* 2>/dev/null || true
fi

# Build if not skipped
if [ "$NO_BUILD" = true ]; then
    echo -e "${CYAN}Skipping build (--no-build)${NC}"
    # Verify binaries exist
    if [ ! -f "target/release/nullspace-simulator" ] || [ ! -f "target/release/nullspace-node" ]; then
        echo -e "${RED}Error: Binaries not found. Run without --no-build first.${NC}"
        exit 1
    fi
else
    echo -e "${CYAN}Building binaries...${NC}"
    cargo build --release -p nullspace-simulator -p nullspace-node 2>&1 | tail -5
fi

# Create data directories
for i in $(seq 0 $((NODES - 1))); do
    mkdir -p "./data/node$i"
done

# Start simulator/indexer (use binary directly for speed)
echo -e "${GREEN}Starting simulator (indexer mode)...${NC}"
./target/release/nullspace-simulator \
    --host 0.0.0.0 \
    --port 8080 \
    --identity "$IDENTITY" &
PIDS+=($!)

# Wait for simulator to be ready
echo "Waiting for simulator to be ready..."
for i in {1..30}; do
    if curl -sf http://localhost:8080/healthz > /dev/null 2>&1; then
        echo -e "${GREEN}Simulator ready on http://localhost:8080${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Simulator failed to start within 30 seconds${NC}"
        exit 1
    fi
    sleep 1
done

# Start nodes (use binary directly for speed, reduced stagger)
for i in $(seq 0 $((NODES - 1))); do
    echo -e "${GREEN}Starting node $i...${NC}"
    ./target/release/nullspace-node \
        --config "$CONFIG_DIR/node$i.yaml" \
        --peers "$CONFIG_DIR/peers.yaml" &
    PIDS+=($!)
    sleep 0.5  # Brief stagger for peer discovery
done

echo
echo -e "${GREEN}=== Local Consensus Network Running ===${NC}"
echo
echo -e "  ${CYAN}Simulator:${NC} http://localhost:8080"
echo -e "  ${CYAN}API Docs:${NC}  http://localhost:8080/healthz"
echo -e "  ${CYAN}Nodes:${NC}     ${NODES} nodes on ports 9000-$((9000 + NODES - 1))"
echo -e "  ${CYAN}Metrics:${NC}   Ports 9090-$((9090 + NODES - 1))"
echo
echo -e "  ${CYAN}Frontend:${NC}  Copy configs/local/.env.local to website/.env.local"
echo -e "             Then: cd website && npm run dev"
echo
echo -e "${YELLOW}Press Ctrl+C to stop all processes${NC}"
echo

# Wait for any process to exit (this will catch crashes)
wait -n "${PIDS[@]}" 2>/dev/null || true

# If we get here, a process died
echo -e "${RED}A process exited unexpectedly${NC}"
echo "Check the logs above for errors."
exit 1
