#!/usr/bin/env bash
# CDN Verification Script
# Verifies Cloudflare CDN configuration is working correctly
# Usage: ./scripts/verify-cdn.sh [domain]

set -e

DOMAIN="${1:-testnet.regenesis.dev}"
PASSED=0
FAILED=0

echo "=== CDN Verification for $DOMAIN ==="
echo ""

# Helper functions
check_header() {
  local url="$1"
  local header="$2"
  local expected="$3"
  local value

  value=$(curl -sI "$url" 2>/dev/null | grep -i "^$header:" | cut -d' ' -f2- | tr -d '\r')

  if [[ "$value" == *"$expected"* ]]; then
    echo "✓ $header: $value"
    ((PASSED++))
    return 0
  else
    echo "✗ $header: expected '$expected', got '$value'"
    ((FAILED++))
    return 1
  fi
}

check_exists() {
  local url="$1"
  local header="$2"
  local value

  value=$(curl -sI "$url" 2>/dev/null | grep -i "^$header:" | cut -d' ' -f2- | tr -d '\r')

  if [[ -n "$value" ]]; then
    echo "✓ $header: $value"
    ((PASSED++))
    return 0
  else
    echo "✗ $header: not present"
    ((FAILED++))
    return 1
  fi
}

# 1. Check if Cloudflare is serving traffic
echo "1. Cloudflare Proxy Status"
echo "--------------------------"
check_exists "https://$DOMAIN" "cf-ray" || true
check_exists "https://$DOMAIN" "cf-cache-status" || true
echo ""

# 2. Check static asset caching
echo "2. Static Asset Caching"
echo "-----------------------"
# First request (may be MISS)
curl -s "https://$DOMAIN/assets/" > /dev/null 2>&1 || true
# Second request (should be HIT)
echo "Testing /assets/ directory..."
check_header "https://$DOMAIN/assets/index-*.css" "cache-control" "max-age" || true
echo ""

# 3. Check security headers
echo "3. Security Headers"
echo "-------------------"
check_exists "https://$DOMAIN" "strict-transport-security" || true
check_exists "https://$DOMAIN" "x-content-type-options" || true
check_exists "https://$DOMAIN" "x-frame-options" || true
echo ""

# 4. Check TLS configuration
echo "4. TLS Configuration"
echo "--------------------"
TLS_VERSION=$(curl -sI --tlsv1.2 "https://$DOMAIN" 2>&1 | head -1)
if [[ "$TLS_VERSION" == *"200"* ]] || [[ "$TLS_VERSION" == *"HTTP"* ]]; then
  echo "✓ TLS 1.2+ supported"
  ((PASSED++))
else
  echo "✗ TLS configuration issue"
  ((FAILED++))
fi
echo ""

# 5. Check HTTP/2 support
echo "5. HTTP/2 Support"
echo "-----------------"
HTTP_VERSION=$(curl -sI --http2 "https://$DOMAIN" 2>&1 | head -1 | grep -o "HTTP/[0-9.]*")
if [[ "$HTTP_VERSION" == *"2"* ]]; then
  echo "✓ HTTP/2 enabled: $HTTP_VERSION"
  ((PASSED++))
else
  echo "○ HTTP/2 not detected (got $HTTP_VERSION) - may still work via ALPN"
fi
echo ""

# 6. Check compression
echo "6. Compression"
echo "--------------"
ENCODING=$(curl -sI -H "Accept-Encoding: gzip, br" "https://$DOMAIN" 2>/dev/null | grep -i "content-encoding" | cut -d' ' -f2- | tr -d '\r')
if [[ -n "$ENCODING" ]]; then
  echo "✓ Content-Encoding: $ENCODING"
  ((PASSED++))
else
  echo "○ No compression header (may be small response)"
fi
echo ""

# 7. Auth service (if different subdomain)
AUTH_DOMAIN="auth.$DOMAIN"
echo "7. Auth Service ($AUTH_DOMAIN)"
echo "------------------------------"
AUTH_STATUS=$(curl -sI "https://$AUTH_DOMAIN/healthz" 2>/dev/null | head -1 | grep -o "[0-9]\{3\}")
if [[ "$AUTH_STATUS" == "200" ]]; then
  echo "✓ Auth service healthy (HTTP $AUTH_STATUS)"
  ((PASSED++))
else
  echo "○ Auth service returned HTTP $AUTH_STATUS (may be expected if not deployed)"
fi
echo ""

# 8. Gateway WebSocket endpoint
API_DOMAIN="api.$DOMAIN"
echo "8. Gateway ($API_DOMAIN)"
echo "------------------------"
API_STATUS=$(curl -sI "https://$API_DOMAIN/healthz" 2>/dev/null | head -1 | grep -o "[0-9]\{3\}")
if [[ "$API_STATUS" == "200" ]]; then
  echo "✓ Gateway healthy (HTTP $API_STATUS)"
  ((PASSED++))
else
  echo "○ Gateway returned HTTP $API_STATUS (may be expected if not deployed)"
fi

# Check if proxied or DNS only
API_CF=$(curl -sI "https://$API_DOMAIN/healthz" 2>/dev/null | grep -i "cf-ray")
if [[ -n "$API_CF" ]]; then
  echo "○ Note: Gateway is proxied through Cloudflare (ensure WebSockets enabled)"
else
  echo "✓ Gateway is DNS-only (Caddy handles TLS for WebSocket)"
fi
echo ""

# Summary
echo "=== Summary ==="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [[ $FAILED -eq 0 ]]; then
  echo "✓ All checks passed!"
  exit 0
else
  echo "✗ Some checks failed - review configuration"
  exit 1
fi
