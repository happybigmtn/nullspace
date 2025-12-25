#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
if [[ -z "$STRIPE_SECRET_KEY" ]]; then
  echo "STRIPE_SECRET_KEY is required (Stripe test key is fine)." >&2
  exit 1
fi

CONVEX_PORT="${CONVEX_PORT:-3210}"
SITE_PROXY_PORT="${SITE_PROXY_PORT:-3211}"
AUTH_PORT="${AUTH_PORT:-3401}"
AUTH_ALLOWED_ORIGINS="${AUTH_ALLOWED_ORIGINS:-http://127.0.0.1:3000}"
E2E_ORIGIN="${E2E_ORIGIN:-$AUTH_ALLOWED_ORIGINS}"
STRIPE_TIER="${STRIPE_TIER:-member}"
STRIPE_AMOUNT="${STRIPE_AMOUNT:-500}"
STRIPE_CURRENCY="${STRIPE_CURRENCY:-usd}"
STRIPE_INTERVAL="${STRIPE_INTERVAL:-month}"
STRIPE_PRICE_ID="${STRIPE_PRICE_ID:-}"
E2E_SKIP_STRIPE="${E2E_SKIP_STRIPE:-}"
E2E_SKIP_ENTITLEMENTS="${E2E_SKIP_ENTITLEMENTS:-}"
E2E_EXPECT_ADMIN="${E2E_EXPECT_ADMIN:-}"

if [[ ! -d "website/node_modules" ]]; then
  echo "Missing website dependencies. Run: (cd website && npm install)" >&2
  exit 1
fi

if [[ ! -d "services/auth/node_modules" ]]; then
  echo "Missing auth dependencies. Run: (cd services/auth && npm install)" >&2
  exit 1
fi

tmp_env="$(mktemp /tmp/convex.env.XXXXXX)"
auth_pid=""

cleanup() {
  if [[ -n "$auth_pid" ]] && kill -0 "$auth_pid" 2>/dev/null; then
    kill "$auth_pid" || true
  fi
  ( cd "$ROOT_DIR/docker/convex" && docker compose --env-file "$tmp_env" down ) || true
  rm -f "$tmp_env"
}
trap cleanup EXIT

CONVEX_SERVICE_TOKEN="local-e2e-service-token"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_$(openssl rand -hex 16)}"

{
  echo "CONVEX_SERVICE_TOKEN=$CONVEX_SERVICE_TOKEN"
  echo "STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY"
  echo "STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET"
  echo "PORT=$CONVEX_PORT"
  echo "SITE_PROXY_PORT=$SITE_PROXY_PORT"
} > "$tmp_env"

cd "$ROOT_DIR/docker/convex"
docker compose --env-file "$tmp_env" up -d --wait
admin_key="$(docker compose --env-file "$tmp_env" exec -T backend ./generate_admin_key.sh | tail -n 1 | tr -d '\r')"

cd "$ROOT_DIR/website"
export CONVEX_SELF_HOSTED_URL="http://127.0.0.1:$CONVEX_PORT"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$admin_key"
export CONVEX_SELF_HOSTED_SERVICE_TOKEN="$CONVEX_SERVICE_TOKEN"
export VITE_CONVEX_URL="$CONVEX_SELF_HOSTED_URL"
export CONVEX_ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY"

npx convex dev --once
npx convex env set CONVEX_SERVICE_TOKEN "$CONVEX_SELF_HOSTED_SERVICE_TOKEN"
npx convex env set STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
npx convex env set STRIPE_WEBHOOK_SECRET "$STRIPE_WEBHOOK_SECRET"

if [[ -z "$STRIPE_PRICE_ID" ]]; then
  if [[ -n "$E2E_SKIP_STRIPE" ]]; then
    STRIPE_PRICE_ID="price_e2e"
  else
    price_json="$(STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" node scripts/create-stripe-membership.mjs \
      --tier "$STRIPE_TIER" \
      --amount "$STRIPE_AMOUNT" \
      --currency "$STRIPE_CURRENCY" \
      --interval "$STRIPE_INTERVAL")"
    STRIPE_PRICE_ID="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); console.log(data.priceId);" <<< "$price_json")"
  fi
fi

cd "$ROOT_DIR/services/auth"
npm run build

export PORT="$AUTH_PORT"
export AUTH_PUBLIC_URL="http://127.0.0.1:$AUTH_PORT"
export AUTH_BASE_URL="http://127.0.0.1:$AUTH_PORT"
export AUTH_SECRET="${AUTH_SECRET:-local-auth-secret}"
export SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-ns_session}"
export AUTH_ALLOWED_ORIGINS="$AUTH_ALLOWED_ORIGINS"
export CONVEX_URL="$CONVEX_SELF_HOSTED_URL"
export CONVEX_SERVICE_TOKEN="$CONVEX_SELF_HOSTED_SERVICE_TOKEN"
export STRIPE_PRICE_TIERS="$STRIPE_TIER:$STRIPE_PRICE_ID"
export STRIPE_WEBHOOK_BASE_URL="$AUTH_BASE_URL"
export STRIPE_SECRET_KEY
export STRIPE_WEBHOOK_SECRET

node dist/server.js &
auth_pid=$!

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$AUTH_PORT/auth/providers" > /dev/null; then
    break
  fi
  sleep 0.5
done

cd "$ROOT_DIR/website"
export AUTH_PUBLIC_URL="http://127.0.0.1:$AUTH_PORT"
export AUTH_BASE_URL="http://127.0.0.1:$AUTH_PORT"
export AUTH_SECRET="$AUTH_SECRET"
export AUTH_ALLOWED_ORIGINS="$AUTH_ALLOWED_ORIGINS"
export STRIPE_PRICE_TIERS="$STRIPE_TIER:$STRIPE_PRICE_ID"
export E2E_ORIGIN
export E2E_AUTH_URL="http://127.0.0.1:$AUTH_PORT"
export E2E_STRIPE_PRICE_ID="$STRIPE_PRICE_ID"
export E2E_STRIPE_TIER="$STRIPE_TIER"
export CONVEX_URL="$CONVEX_SELF_HOSTED_URL"
export CONVEX_ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY"
export E2E_SKIP_STRIPE
export E2E_SKIP_ENTITLEMENTS
export E2E_EXPECT_ADMIN

node scripts/e2e-auth-billing.mjs
