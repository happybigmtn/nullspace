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

# Optional: enable ops analytics + leaderboards in the UI
# echo "VITE_OPS_URL=http://127.0.0.1:9020" >> website/.env.local

# Read required vars from website/.env.local (avoid `source` because keys can contain `|`)
VITE_IDENTITY=$(awk -F= '/^VITE_IDENTITY=/{print $2}' website/.env.local)
CONVEX_SELF_HOSTED_URL=$(awk -F= '/^CONVEX_SELF_HOSTED_URL=/{print $2}' website/.env.local)
CONVEX_SELF_HOSTED_ADMIN_KEY=$(awk -F= '/^CONVEX_SELF_HOSTED_ADMIN_KEY=/{print $2}' website/.env.local)

missing=()
if [ -z "${VITE_IDENTITY}" ]; then
  missing+=("VITE_IDENTITY (website/.env.local)")
fi
if [ -z "${CONVEX_SELF_HOSTED_URL}" ]; then
  missing+=("CONVEX_SELF_HOSTED_URL (website/.env.local)")
fi
if [ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY}" ]; then
  missing+=("CONVEX_SELF_HOSTED_ADMIN_KEY (website/.env.local)")
fi
if [ "${#missing[@]}" -ne 0 ]; then
  echo "Missing required configuration:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

# Build simulator + validator if missing
if [ ! -f target/release/nullspace-simulator ] || [ ! -f target/release/nullspace-node ]; then
  echo "Building nullspace-simulator and nullspace-node..."
  cargo build --release -p nullspace-simulator -p nullspace-node
fi

# Derive casino admin public key from env or local key file
derive_admin_public() {
  node -e "const fs=require('fs'); const { ed25519 } = require('@noble/curves/ed25519'); const hex=fs.readFileSync(process.argv[1],'utf8').trim(); if (!hex) process.exit(1); const pk=ed25519.getPublicKey(Buffer.from(hex,'hex')); console.log(Buffer.from(pk).toString('hex'));" "$1"
}

if [ -z "${CASINO_ADMIN_PUBLIC_KEY_HEX:-}" ] && [ -f configs/local/casino-admin-key.hex ]; then
  if ! command -v node > /dev/null 2>&1; then
    echo "node is required to derive the casino admin public key."
    exit 1
  fi
  CASINO_ADMIN_PUBLIC_KEY_HEX=$(derive_admin_public configs/local/casino-admin-key.hex)
fi

if [ -z "${CASINO_ADMIN_PUBLIC_KEY_HEX:-}" ]; then
  echo "Missing CASINO_ADMIN_PUBLIC_KEY_HEX. Set it or generate configs/local/casino-admin-key.hex (scripts/generate-admin-key.sh)."
  exit 1
fi
export CASINO_ADMIN_PUBLIC_KEY_HEX

# Ensure Convex env file exists before starting
if [ ! -f docker/convex/.env ]; then
  echo "Missing docker/convex/.env. Create it before starting Convex."
  exit 1
fi

# Start Convex (self-hosted)
docker compose --env-file docker/convex/.env -f docker/convex/docker-compose.yml up -d --wait

# Ensure Convex env is set (safe to rerun)
CONVEX_SERVICE_TOKEN=$(awk -F= '/^CONVEX_SERVICE_TOKEN=/{print $2}' docker/convex/.env)
STRIPE_SECRET_KEY=$(awk -F= '/^STRIPE_SECRET_KEY=/{print $2}' docker/convex/.env)
STRIPE_WEBHOOK_SECRET=$(awk -F= '/^STRIPE_WEBHOOK_SECRET=/{print $2}' docker/convex/.env)
missing=()
if [ -z "${CONVEX_SERVICE_TOKEN}" ]; then
  missing+=("CONVEX_SERVICE_TOKEN (docker/convex/.env)")
fi
if [ -z "${STRIPE_SECRET_KEY}" ]; then
  missing+=("STRIPE_SECRET_KEY (docker/convex/.env)")
fi
if [ -z "${STRIPE_WEBHOOK_SECRET}" ]; then
  missing+=("STRIPE_WEBHOOK_SECRET (docker/convex/.env)")
fi
if [ "${#missing[@]}" -ne 0 ]; then
  echo "Missing required Convex configuration:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi
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

# Start local validator network (simulator + validators)
WEB_PORT=5173
ALLOWED_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://localhost:3000,http://127.0.0.1:3000"
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 ALLOWED_HTTP_ORIGINS="${ALLOWED_ORIGINS}" ALLOWED_WS_ORIGINS="${ALLOWED_ORIGINS}" \
CASINO_ADMIN_PUBLIC_KEY_HEX="${CASINO_ADMIN_PUBLIC_KEY_HEX}" \
  nohup ./scripts/start-local-network.sh configs/local 4 --no-build > network.log 2>&1 &
echo $! > network.pid

# Start auth service
( cd services/auth && nohup npm run dev > ../../auth.log 2>&1 & echo $! > ../../auth.pid )

# Start ops service (analytics + league + CRM)
( cd services/ops && nohup npm run dev > ../../ops.log 2>&1 & echo $! > ../../ops.pid )

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
wait_for "ops" "http://127.0.0.1:9020/healthz" 20 || true
wait_for "web" "http://127.0.0.1:${WEB_PORT}" 120 || true

echo "UI: http://127.0.0.1:${WEB_PORT}"

echo "Streaming logs (Ctrl+C to stop viewing; services keep running)."
tail -f network.log auth.log ops.log website.log
```

Stop everything:

```bash
for pidfile in network.pid auth.pid ops.pid website.pid; do
  if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null || true; fi
done
```
