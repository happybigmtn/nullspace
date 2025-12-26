# Local Quickstart (After Reboot)

Copy/paste this from the repo root to start everything at once. It assumes you already have
Docker, Node, Rust, and wasm-pack installed, and that the repo is configured.

```bash
cd /home/r/Coding/nullspace
set -euo pipefail

# Ensure website/.env.local exists (seeded from configs/local/.env.local if needed)
if [ ! -f website/.env.local ]; then
  if [ -f configs/local/.env.local ]; then
    cp configs/local/.env.local website/.env.local
  else
    echo "Missing website/.env.local and configs/local/.env.local. Run generate-keys or create website/.env.local first."
    exit 1
  fi
fi

# Read required vars from website/.env.local (avoid `source` because keys can contain `|`)
VITE_IDENTITY=$(awk -F= '/^VITE_IDENTITY=/{print $2}' website/.env.local)
CONVEX_SELF_HOSTED_URL=$(awk -F= '/^CONVEX_SELF_HOSTED_URL=/{print $2}' website/.env.local)
CONVEX_SELF_HOSTED_ADMIN_KEY=$(awk -F= '/^CONVEX_SELF_HOSTED_ADMIN_KEY=/{print $2}' website/.env.local)

if [ -z "${VITE_IDENTITY}" ]; then
  echo "Missing VITE_IDENTITY in website/.env.local"
  exit 1
fi
if [ -z "${CONVEX_SELF_HOSTED_URL}" ] || [ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY}" ]; then
  echo "Missing CONVEX_SELF_HOSTED_URL or CONVEX_SELF_HOSTED_ADMIN_KEY in website/.env.local"
  exit 1
fi

# Start Convex (self-hosted)
docker compose --env-file docker/convex/.env -f docker/convex/docker-compose.yml up -d --wait

# Ensure Convex env is set (safe to rerun)
CONVEX_SERVICE_TOKEN=$(awk -F= '/^CONVEX_SERVICE_TOKEN=/{print $2}' docker/convex/.env)
STRIPE_SECRET_KEY=$(awk -F= '/^STRIPE_SECRET_KEY=/{print $2}' docker/convex/.env)
STRIPE_WEBHOOK_SECRET=$(awk -F= '/^STRIPE_WEBHOOK_SECRET=/{print $2}' docker/convex/.env)
(
  cd website
  CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL}" CONVEX_SELF_HOSTED_ADMIN_KEY="${CONVEX_SELF_HOSTED_ADMIN_KEY}" \
    npx convex env set CONVEX_SERVICE_TOKEN "${CONVEX_SERVICE_TOKEN}"
  CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL}" CONVEX_SELF_HOSTED_ADMIN_KEY="${CONVEX_SELF_HOSTED_ADMIN_KEY}" \
    npx convex env set STRIPE_SECRET_KEY "${STRIPE_SECRET_KEY}"
  CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL}" CONVEX_SELF_HOSTED_ADMIN_KEY="${CONVEX_SELF_HOSTED_ADMIN_KEY}" \
    npx convex env set STRIPE_WEBHOOK_SECRET "${STRIPE_WEBHOOK_SECRET}"
  CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL}" CONVEX_SELF_HOSTED_ADMIN_KEY="${CONVEX_SELF_HOSTED_ADMIN_KEY}" \
    npx convex dev --once
)

# Start simulator + dev-executor (chain)
WEB_PORT=5173
ALLOWED_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://localhost:3000,http://127.0.0.1:3000"
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 ALLOWED_HTTP_ORIGINS="${ALLOWED_ORIGINS}" ALLOWED_WS_ORIGINS="${ALLOWED_ORIGINS}" \
  nohup ./target/release/nullspace-simulator --host 127.0.0.1 --port 8080 --identity "${VITE_IDENTITY}" > simulator.log 2>&1 &
echo $! > simulator.pid

CASINO_ADMIN_PUBLIC_KEY_HEX=ae2817b9b6a4038dac68cfc9f109b1d800a56b86eae035e616f901ea96a0565d \
  nohup ./target/release/dev-executor --url http://127.0.0.1:8080 --identity "${VITE_IDENTITY}" --block-interval-ms 100 > executor.log 2>&1 &
echo $! > executor.pid

# Start auth service
( cd services/auth && nohup npm run dev > ../../auth.log 2>&1 & echo $! > ../../auth.pid )

# Start website (UI)
( cd website && nohup npm run dev -- --host 127.0.0.1 --port "${WEB_PORT}" > ../website.log 2>&1 & echo $! > ../website.pid )

wait_for() {
  local name="$1"
  local url="$2"
  local tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "$name ok"
      return 0
    fi
    sleep 1
  done
  echo "$name failed"
  return 1
}

wait_for "simulator" "http://127.0.0.1:8080/healthz" 20 || true
wait_for "auth" "http://127.0.0.1:4000/healthz" 20 || true
wait_for "web" "http://127.0.0.1:${WEB_PORT}" 120 || true

echo "UI: http://127.0.0.1:${WEB_PORT}"

echo "Streaming logs (Ctrl+C to stop viewing; services keep running)."
tail -f simulator.log executor.log auth.log website.log
```

Stop everything:

```bash
for pidfile in simulator.pid executor.pid auth.pid website.pid; do
  if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null || true; fi
done
```
