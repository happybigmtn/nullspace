#!/bin/bash
# Start services for LAN testing (desktop + mobile on same network)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Get local IP
LOCAL_IP=$(ip addr show | grep -E 'inet (192|10|172)' | awk '{print $2}' | cut -d'/' -f1 | head -1)
if [ -z "$LOCAL_IP" ]; then
    echo "Could not detect local IP address"
    exit 1
fi

echo "=== Network Testing Setup ==="
echo "Local IP: $LOCAL_IP"
echo ""

# Prune any leftover validator data
"$REPO_DIR/scripts/prune-node-data.sh"

# Get identity (prefer generated configs/local/.env.local)
IDENTITY=$(grep VITE_IDENTITY "$REPO_DIR/configs/local/.env.local" 2>/dev/null | cut -d'=' -f2)
if [ -z "$IDENTITY" ]; then
    IDENTITY=$(grep VITE_IDENTITY "$REPO_DIR/website/.env.local" 2>/dev/null | cut -d'=' -f2)
fi
if [ -z "$IDENTITY" ]; then
    echo "Error: No VITE_IDENTITY found in website/.env.local"
    echo "Run: cargo run --release --bin generate-keys -- --nodes 4 --output configs/local"
    exit 1
fi

# Update .env.network with current IP
cat > "$REPO_DIR/website/.env.network" << EOF
# Network config for LAN testing (desktop + mobile)
VITE_IDENTITY=$IDENTITY
VITE_URL=http://$LOCAL_IP:8080
EOF

echo "Updated website/.env.network with IP: $LOCAL_IP"
echo ""

# Build if needed
if [ ! -f "$REPO_DIR/target/release/nullspace-simulator" ] || [ ! -f "$REPO_DIR/target/release/nullspace-node" ]; then
    echo "Building simulator + validator..."
    cargo build --release -p nullspace-simulator -p nullspace-node
fi

# Kill any existing processes
pkill -9 -f nullspace-simulator 2>/dev/null || true
pkill -9 -f nullspace-node 2>/dev/null || true
sleep 1

# Start local validator network
NODES="${NODES:-4}"
echo "Starting validator network (${NODES} nodes)..."
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 \
  "$REPO_DIR/scripts/start-local-network.sh" "$REPO_DIR/configs/local" "$NODES" --no-build > /tmp/localnet.log 2>&1 &
LOCALNET_PID=$!

# Wait for simulator to be ready
echo "Waiting for simulator to be ready..."
for i in {1..30}; do
    if curl -s "http://127.0.0.1:8080/seed/00" > /dev/null 2>&1; then
        echo "Simulator ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "ERROR: Simulator failed to start. Check /tmp/simulator.log"
        cat /tmp/simulator.log
        exit 1
    fi
    sleep 0.5
done

# Wait for validators to initialize
echo "Waiting for validators to initialize..."
sleep 3

# Start frontend
echo ""
echo "Starting frontend..."
echo ""
cd "$REPO_DIR/website"
cp .env.network .env.local.bak 2>/dev/null || true
cp .env.network .env.local

npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo ""
echo "=== Ready! ==="
echo ""
echo "Desktop:  http://localhost:5173"
echo "Mobile:   http://$LOCAL_IP:5173"
echo ""
echo "Backend:  http://$LOCAL_IP:8080"
echo ""
echo "Press Ctrl+C to stop all services"

# Cleanup on exit
cleanup() {
    echo ""
    echo "Stopping services..."
    kill $FRONTEND_PID 2>/dev/null || true
    kill $LOCALNET_PID 2>/dev/null || true
    # Restore original .env.local
    if [ -f "$REPO_DIR/website/.env.local.bak" ]; then
        mv "$REPO_DIR/website/.env.local.bak" "$REPO_DIR/website/.env.local"
    fi
    echo "Done."
}

trap cleanup EXIT

# Wait for Ctrl+C
wait
