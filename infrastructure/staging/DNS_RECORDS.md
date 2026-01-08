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

## Cloudflare-Specific Notes

If using Cloudflare:

1. Set proxy status to "DNS only" (gray cloud) initially for certificate issuance
2. After SSL works, you can enable "Proxied" (orange cloud) if desired
3. Or keep "DNS only" to use Caddy's built-in SSL

## Common DNS Providers

### Cloudflare
1. Go to DNS settings for regenesis.dev
2. Add A records as shown above
3. Set proxy status to "DNS only"

### Namecheap
1. Go to Advanced DNS
2. Add A records with host values: `testnet`, `auth.testnet`, etc.

### Google Domains / Squarespace
1. Go to DNS settings
2. Add custom records as A type

### Route 53 (AWS)
1. Create hosted zone if not exists
2. Create A record sets for each subdomain
