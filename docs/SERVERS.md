# Nullspace Staging Server Infrastructure

Last Updated: 2026-01-08

## Domain Configuration

- **Main Domain**: `regenesis.dev`
- **Testnet Subdomain**: `testnet.regenesis.dev`

## Server Inventory

| Server IP | Role | Domain | Ports |
|-----------|------|--------|-------|
| 178.156.212.135 | Website + Gateway | testnet.regenesis.dev, api.testnet.regenesis.dev | 80, 443, 8080 (internal), 9010 (internal) |
| 5.161.209.39 | Auth Service | auth.testnet.regenesis.dev | 80, 443, 4000 (internal) |
| 5.161.67.36 | Simulator/Indexer | indexer.testnet.regenesis.dev | 80, 443, 8080 (internal) |
| 5.161.101.39 | Validator Node 1 | N/A (internal only) | 9001 (P2P), 9100 (metrics) |
| 5.161.71.166 | Validator Node 2 | N/A (internal only) | 9002 (P2P), 9101 (metrics) |
| 178.156.221.113 | Validator Node 3 | N/A (internal only) | 9003 (P2P), 9102 (metrics) |

## SSH Access

### Connection Details

```bash
# SSH Key Location
~/.ssh/id_ed25519_github

# SSH Config (~/.ssh/config)
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
```

### Connecting to Servers

```bash
# Gateway/Website Server
ssh root@178.156.212.135 -i ~/.ssh/id_ed25519_github

# Auth Server
ssh root@5.161.209.39 -i ~/.ssh/id_ed25519_github

# Indexer/Simulator Server
ssh root@5.161.67.36 -i ~/.ssh/id_ed25519_github

# Validator Nodes
ssh root@5.161.101.39 -i ~/.ssh/id_ed25519_github   # Node 1
ssh root@5.161.71.166 -i ~/.ssh/id_ed25519_github   # Node 2
ssh root@178.156.221.113 -i ~/.ssh/id_ed25519_github # Node 3
```

## Service Configuration

### Gateway Server (178.156.212.135)

**Caddy Reverse Proxy Configuration:**
```
testnet.regenesis.dev {
    reverse_proxy localhost:8080
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
}

api.testnet.regenesis.dev {
    reverse_proxy localhost:9010
}
```

**Docker Containers:**
- `nullspace-website`: Port 8080 (serves React frontend)
- `nullspace-gateway`: Port 9010 (WebSocket gateway)
- `caddy`: Ports 80, 443 (TLS termination)

**Environment Files:**
- `/etc/nullspace/gateway.env`
- `/etc/nullspace/website.env`

### Auth Server (5.161.209.39)

**Docker Containers:**
- `nullspace-auth`: Port 4000

**Environment Files:**
- `/etc/nullspace/auth.env`

### Indexer Server (5.161.67.36)

**Docker Containers:**
- `nullspace-simulator`: Port 8080

**Environment Files:**
- `/etc/nullspace/simulator.env`

### Validator Nodes

**Docker Containers (each node):**
- `nullspace-node`: P2P port varies (9001-9003), metrics port varies (9100-9102)

**Environment Files:**
- `/etc/nullspace/node.env`

## DNS Records (Cloudflare)

| Type | Name | Content | TTL |
|------|------|---------|-----|
| A | testnet | 178.156.212.135 | 300 |
| A | api.testnet | 178.156.212.135 | 300 |
| A | auth.testnet | 5.161.209.39 | 300 |
| A | indexer.testnet | 5.161.67.36 | 300 |

## Health Check Endpoints

```bash
# Verify all services are running
curl -s https://testnet.regenesis.dev | head -1
curl -s https://api.testnet.regenesis.dev/healthz
curl -s https://auth.testnet.regenesis.dev/healthz
curl -s https://indexer.testnet.regenesis.dev/healthz
```

## Common Operations

### Viewing Logs

```bash
# On any server
docker logs -f nullspace-gateway --tail 100
docker logs -f nullspace-auth --tail 100
docker logs -f nullspace-simulator --tail 100
docker logs -f nullspace-node --tail 100
```

### Restarting Services

```bash
# Restart a specific container
docker restart nullspace-gateway

# View running containers
docker ps

# Recreate container with latest image
docker pull ghcr.io/happybigmtn/nullspace-gateway:latest
docker stop nullspace-gateway
docker rm nullspace-gateway
docker run -d --name nullspace-gateway \
  --env-file /etc/nullspace/gateway.env \
  -p 127.0.0.1:9010:9010 \
  ghcr.io/happybigmtn/nullspace-gateway:latest
```

### Caddy Management

```bash
# Reload Caddy configuration
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# View Caddy logs
docker logs caddy --tail 50

# Check certificate status
docker exec caddy caddy list-certificates
```

## GitHub Container Registry

All images are stored at:
- `ghcr.io/happybigmtn/nullspace-simulator:latest`
- `ghcr.io/happybigmtn/nullspace-gateway:latest`
- `ghcr.io/happybigmtn/nullspace-node:latest`
- `ghcr.io/happybigmtn/nullspace-auth:latest`
- `ghcr.io/happybigmtn/nullspace-website:latest`

To pull images, authenticate with GHCR:
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

## Related Documentation

- [DNS_RECORDS.md](../infrastructure/staging/DNS_RECORDS.md) - Full DNS configuration
- [RUNBOOK.md](./RUNBOOK.md) - Operational procedures
- [docker-compose.yml](../infrastructure/staging/docker-compose.yml) - Full staging stack
