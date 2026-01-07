#!/bin/bash
# Run integration tests with stable gateway (no hot-reload)
#
# This script ensures the gateway runs in a stable mode without file watching,
# preventing hot-reload from killing the gateway mid-test.

set -e

echo "🧪 Integration Test Runner (Stable Mode)"
echo "========================================"
echo ""

# Check if network is running
echo "Checking backend availability..."
if ! curl -s http://localhost:8080/healthz > /dev/null 2>&1; then
    echo "❌ Backend not available at http://localhost:8080"
    echo "   Start the network first:"
    echo "   ./scripts/start-local-network.sh"
    exit 1
fi
echo "✓ Backend is ready"
echo ""

# Kill any existing gateway processes
echo "Stopping any existing gateway processes..."
pkill -f "tsx.*gateway" 2>/dev/null || true
fuser -k 9010/tcp 2>/dev/null || true
sleep 2

# Build gateway if needed
if [ ! -d "dist" ] || [ "src" -nt "dist" ]; then
    echo "Building gateway..."
    npm run build
    echo "✓ Gateway built"
else
    echo "✓ Gateway already built (dist/ up to date)"
fi
echo ""

# Start gateway in stable mode (no watch)
echo "Starting gateway in stable mode..."
node dist/index.js > /tmp/gateway-integration.log 2>&1 &
GATEWAY_PID=$!

# Wait for gateway to be ready
sleep 3
if ! ps -p $GATEWAY_PID > /dev/null; then
    echo "❌ Gateway failed to start. Check /tmp/gateway-integration.log"
    cat /tmp/gateway-integration.log
    exit 1
fi
echo "✓ Gateway started (PID: $GATEWAY_PID)"
echo ""

# Run tests
echo "Running integration tests..."
echo "──────────────────────────────────────────"
export RUN_INTEGRATION=true
npm test tests/integration/integration.test.ts
TEST_EXIT=$?
echo "──────────────────────────────────────────"
echo ""

# Cleanup
echo "Stopping gateway..."
kill $GATEWAY_PID 2>/dev/null || true
sleep 1

# Report results
if [ $TEST_EXIT -eq 0 ]; then
    echo "✅ All tests passed!"
    echo ""
    echo "Gateway log saved to: /tmp/gateway-integration.log"
else
    echo "❌ Some tests failed (exit code: $TEST_EXIT)"
    echo ""
    echo "Check logs:"
    echo "  Gateway: /tmp/gateway-integration.log"
    echo "  Network: tail -f /tmp/network*.log"
fi

exit $TEST_EXIT
