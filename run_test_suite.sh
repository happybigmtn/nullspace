#!/bin/bash
set -e

# Cleanup first
pkill -f nullspace || true
pkill -f dev-executor || true
pkill -f vite || true

echo "Starting Simulator..."
nohup ./target/release/nullspace-simulator --host 0.0.0.0 -i 92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55 -p 8080 > simulator.log 2>&1 &
SIM_PID=$!

echo "Starting Executor..."
nohup ./target/release/dev-executor -i 92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55 -u http://127.0.0.0:8080 > executor.log 2>&1 &
EXEC_PID=$!

echo "Starting Vite..."
cd website
export VITE_IDENTITY=92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55
nohup ./node_modules/.bin/vite --host 0.0.0.0 --port 3000 > vite.log 2>&1 &
VITE_PID=$!
cd ..

echo "Waiting for Vite to be ready..."
timeout 60s bash -c 'until grep -q "Local:" website/vite.log; do sleep 1; done' || { echo "Vite timed out"; cat website/vite.log; exit 1; }

echo "Vite is Ready. Running Test..."
node website/scripts/mobile-test-running.mjs

EXIT_CODE=$?

echo "Test finished with exit code $EXIT_CODE"

# Cleanup
kill $SIM_PID $EXEC_PID $VITE_PID || true
exit $EXIT_CODE
