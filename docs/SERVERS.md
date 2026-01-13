# Nullspace Staging Server Infrastructure

Last Updated: 2026-01-13

## Domain Configuration

- **Main Domain**: `regenesis.dev`
- **Testnet Subdomain**: `testnet.regenesis.dev`

## Server Inventory

> **Note**: Validators have been consolidated to a single host for cost efficiency.
> 4 validators are required for BFT consensus (n≥3f+1, f=1 fault tolerance).

| Server IP | Role | Domain | Ports |
|-----------|------|--------|-------|
| 178.156.212.135 | Website + Gateway | testnet.regenesis.dev, api.testnet.regenesis.dev | 80, 443, 8080 (internal), 9010 (internal) |
| 5.161.209.39 | Auth Service | auth.testnet.regenesis.dev | 80, 443, 4000 (internal) |
| 5.161.67.36 | Simulator/Indexer | indexer.testnet.regenesis.dev | 80, 443, 8080 (internal) |
| TBD | Validators (consolidated) | N/A (internal only) | 9001-9004 (P2P), 9100-9103 (metrics) |

### Validator Container Layout (single host)

| Container | NODE_ID | P2P Port | Metrics Port | Data Volume |
|-----------|---------|----------|--------------|-------------|
| nullspace-node-1 | 1 | 9001 | 9100 | /var/lib/nullspace/node-1 |
| nullspace-node-2 | 2 | 9002 | 9101 | /var/lib/nullspace/node-2 |
| nullspace-node-3 | 3 | 9003 | 9102 | /var/lib/nullspace/node-3 |
| nullspace-node-4 | 4 | 9004 | 9103 | /var/lib/nullspace/node-4 |

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

# Validators (consolidated - all 4 run on single host)
# Update IP below once consolidated validator host is provisioned
ssh root@<VALIDATORS_HOST_IP> -i ~/.ssh/id_ed25519_github
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

### Validator Nodes (Consolidated Host)

All 4 validators run on a single host for BFT consensus (n=4, f=1 fault tolerance).

**Docker Containers:**
- `nullspace-node-1`: P2P 9001, metrics 9100
- `nullspace-node-2`: P2P 9002, metrics 9101
- `nullspace-node-3`: P2P 9003, metrics 9102
- `nullspace-node-4`: P2P 9004, metrics 9103

**Environment Files:**
- `/etc/nullspace/node.env` (shared config, NODE_ID set per container)

**Data Volumes:**
- `/var/lib/nullspace/node-1` through `/var/lib/nullspace/node-4`

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

# Validator logs (on consolidated host)
docker logs -f nullspace-node-1 --tail 100
docker logs -f nullspace-node-2 --tail 100
docker logs -f nullspace-node-3 --tail 100
docker logs -f nullspace-node-4 --tail 100

# View all validator logs at once
docker logs -f nullspace-node-1 & docker logs -f nullspace-node-2 & \
docker logs -f nullspace-node-3 & docker logs -f nullspace-node-4
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
