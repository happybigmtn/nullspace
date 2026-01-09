# Staging Environment Updates

## 2026-01-09: Staging Infrastructure Complete

### Deployed Services

| Service | URL | Server |
|---------|-----|--------|
| Website | https://testnet.regenesis.dev | ns-web-1 |
| Gateway | https://api.testnet.regenesis.dev | ns-gw-1 (178.156.212.135) |
| Indexer | https://indexer.testnet.regenesis.dev | ns-sim-1 (5.161.67.36) |
| Auth | https://auth.testnet.regenesis.dev | ns-auth-1 (5.161.209.39) |
| Convex API | https://convex.testnet.regenesis.dev | ns-db-1 (5.161.124.82) |
| Convex Dashboard | https://convex-dashboard.testnet.regenesis.dev | ns-db-1 (5.161.124.82) |

### Configuration

**Network Identity (Staging)**:
```
92124c5a292d8a6c083c732fa9b454d661c123ac4ba289e691f64e83a56ade2e7efd0abd8c2078b143a24f346192ed6518b670e6c26c9026d58e090592755bd1488f6dcea305d504fc2103ad9d35f81fc86cd143e10bbb736e6566f94fcf40ad
```

Generated with: `generate-keys --nodes 3 --seed 12345`

**Self-Hosted Convex**:
- Backend: `ghcr.io/get-convex/convex-backend:latest`
- Dashboard: `ghcr.io/get-convex/convex-dashboard:latest`
- Admin Key: Stored in `/opt/convex/` on ns-db-1
- Functions deployed from `website/convex/`

### Firewall Rules (Hetzner Cloud)

Firewall `public-ingress` applied to all staging servers:
- Port 22 (SSH)
- Port 80 (HTTP)
- Port 443 (HTTPS)
- Port 3210 (Convex Backend)
- Port 4000 (Auth Service)

### SSL Certificates

All certificates auto-managed by Caddy with Let's Encrypt:
- testnet.regenesis.dev
- api.testnet.regenesis.dev
- indexer.testnet.regenesis.dev
- auth.testnet.regenesis.dev
- convex.testnet.regenesis.dev
- convex-dashboard.testnet.regenesis.dev

### E2E Test Results

13/13 tests passed:
- Health checks (indexer, gateway, auth)
- CORS enforcement
- WebSocket connectivity
- SSL certificates valid
- API endpoints functional

### SSH Access

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@<server-ip>
```

### Monitoring

Health check script: `scripts/health-check.sh`

```bash
./scripts/health-check.sh
```
