# DNS Configuration for regenesis.dev Testnet

Configure these DNS records in your domain registrar/DNS provider.

## Required DNS Records

Replace `YOUR_SERVER_IP` with your staging server's public IP address.

### A Records (IPv4)

| Host | Type | Value | TTL |
|------|------|-------|-----|
| `testnet` | A | YOUR_SERVER_IP | 300 |
| `auth.testnet` | A | YOUR_SERVER_IP | 300 |
| `api.testnet` | A | YOUR_SERVER_IP | 300 |
| `indexer.testnet` | A | YOUR_SERVER_IP | 300 |

### AAAA Records (IPv6, optional)

If your server has an IPv6 address:

| Host | Type | Value | TTL |
|------|------|-------|-----|
| `testnet` | AAAA | YOUR_IPV6_ADDRESS | 300 |
| `auth.testnet` | AAAA | YOUR_IPV6_ADDRESS | 300 |
| `api.testnet` | AAAA | YOUR_IPV6_ADDRESS | 300 |
| `indexer.testnet` | AAAA | YOUR_IPV6_ADDRESS | 300 |

## Service URLs After Configuration

Once DNS propagates (usually 5-15 minutes):

- **Website**: https://testnet.regenesis.dev
- **Auth API**: https://auth.testnet.regenesis.dev
- **Gateway API**: https://api.testnet.regenesis.dev
- **Indexer API**: https://indexer.testnet.regenesis.dev

## Verification Commands

```bash
# Check DNS propagation
dig testnet.regenesis.dev +short
dig auth.testnet.regenesis.dev +short
dig api.testnet.regenesis.dev +short
dig indexer.testnet.regenesis.dev +short

# Test HTTPS (after Caddy obtains certificates)
curl -I https://testnet.regenesis.dev
curl -I https://auth.testnet.regenesis.dev/healthz
curl -I https://api.testnet.regenesis.dev/healthz
curl -I https://indexer.testnet.regenesis.dev/healthz
```

## Cloudflare CDN Configuration

Cloudflare provides CDN caching, TLS termination, and WAF protection. See RUNBOOK.md §2.6 for complete configuration details.

### Initial Setup (DNS Only)

For initial deployment with Caddy handling TLS:

1. Set proxy status to **DNS only** (gray cloud) for all records
2. Caddy will obtain Let's Encrypt certificates automatically
3. This is the simplest approach for development/staging

### Production Setup (Proxied + CDN)

For production with Cloudflare CDN:

1. Set proxy status to **Proxied** (orange cloud) for website and auth
2. Configure SSL/TLS mode to **Full (strict)**
3. Create Cache Rules for static assets (see RUNBOOK.md §2.6.2)
4. For WebSocket (api.testnet): Keep **DNS only** on Free plan, or enable WebSockets on Pro plan

### Proxy Status by Service

| Subdomain | Proxy Status | Notes |
|-----------|--------------|-------|
| `testnet` (website) | Proxied | Static assets cached at edge |
| `auth.testnet` | Proxied | CORS handled by upstream |
| `api.testnet` (gateway) | DNS only* | WebSocket requires Pro plan for proxying |
| `indexer.testnet` | DNS only | Real-time data, no caching benefit |

*Can be Proxied on Cloudflare Pro plan with WebSockets enabled

### Cache Verification

After enabling Cloudflare proxy:

```bash
# Check cache hit status
curl -sI https://testnet.regenesis.dev/assets/index-*.js | grep -i "cf-cache-status"
# Expected: cf-cache-status: HIT (after first request)

# Verify Cloudflare is serving traffic
curl -sI https://testnet.regenesis.dev | grep -i "cf-ray"
# Expected: cf-ray: <id>-<IATA-CODE>
```

## Common DNS Providers

### Cloudflare
1. Go to DNS settings for regenesis.dev
2. Add A records as shown above
3. Set proxy status per the table above (DNS only initially)

### Namecheap
1. Go to Advanced DNS
2. Add A records with host values: `testnet`, `auth.testnet`, etc.

### Google Domains / Squarespace
1. Go to DNS settings
2. Add custom records as A type

### Route 53 (AWS)
1. Create hosted zone if not exists
2. Create A record sets for each subdomain
