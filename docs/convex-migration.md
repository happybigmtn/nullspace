# Convex Self-Hosting and Migration Runbook

**Last Updated**: 2026-01-09

This runbook covers self-hosting Convex for Nullspace, data export/import procedures, and rollback strategies.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Self-Hosted Setup](#2-self-hosted-setup)
3. [Data Export](#3-data-export)
4. [Data Import](#4-data-import)
5. [Migration Procedures](#5-migration-procedures)
6. [Rollback Procedures](#6-rollback-procedures)
7. [Monitoring and Troubleshooting](#7-monitoring-and-troubleshooting)

---

## 1. Overview

### 1.1 What Convex Stores

Nullspace uses Convex as the backend for user accounts, entitlements, and billing:

| Table | Purpose | Critical Data |
|-------|---------|---------------|
| `users` | User accounts linked to auth providers | Auth subject, public key, Stripe customer ID |
| `entitlements` | Subscription tiers and access | Tier, status, Stripe subscription ID |
| `stripe_events` | Webhook idempotency | Event ID, processed timestamp |
| `stripe_reconcile_state` | Reconciliation cursor | Pagination state |
| `auth_challenges` | Wallet auth challenges | Challenge, expiry, usage |
| `admin_nonces` | Admin nonce tracking | Public key, nonce counter |
| `evm_links` | EVM wallet links | User ID, address, chain ID |
| `evm_challenges` | EVM linking challenges | Challenge, signature verification |

### 1.2 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients                                   │
│  (Website, Mobile, Auth Service)                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTP/WebSocket
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              Convex Backend (Self-Hosted)                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │  Dashboard  │ │  Functions  │ │  Stripe Webhooks        │   │
│  │  :6791      │ │  :3210      │ │  /stripe/webhook        │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
│                        │                                         │
│                        ▼                                         │
│              ┌─────────────────┐                                │
│              │  Data Storage   │                                │
│              │  (SQLite/Volume)│                                │
│              └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Self-Hosted Setup

### 2.1 Prerequisites

- Docker and Docker Compose
- Persistent volume for data storage
- Service token for API authentication
- Stripe keys (if billing enabled)

### 2.2 Docker Compose Configuration

Use the provided `docker/convex/docker-compose.yml`:

```bash
cd docker/convex
cp .env.example .env
# Edit .env with your configuration
docker compose up -d
```

### 2.3 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Backend HTTP port | No (default: 3210) |
| `SITE_PROXY_PORT` | Site proxy port | No (default: 3211) |
| `DASHBOARD_PORT` | Dashboard UI port | No (default: 6791) |
| `CONVEX_SERVICE_TOKEN` | API authentication token | Yes |
| `STRIPE_SECRET_KEY` | Stripe API key | If billing enabled |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | If billing enabled |
| `AUTH_CHALLENGE_RETENTION_MS` | Auth challenge TTL | No (default: 3600000) |
| `STRIPE_EVENT_RETENTION_MS` | Stripe event retention | No (default: 30 days) |

### 2.4 Initial Deployment

1. **Generate service token:**
   ```bash
   openssl rand -hex 32
   ```

2. **Start backend:**
   ```bash
   docker compose up -d backend
   docker compose logs -f backend  # Wait for "Ready" message
   ```

3. **Deploy functions:**
   ```bash
   cd website
   npx convex deploy --url http://localhost:3210 --admin-key $CONVEX_SERVICE_TOKEN
   ```

4. **Start dashboard:**
   ```bash
   docker compose up -d dashboard
   ```

5. **Verify deployment:**
   - Dashboard: http://localhost:6791
   - Health check: `curl http://localhost:3210/version`

### 2.5 Production Configuration

For production deployments:

```yaml
# docker-compose.prod.yml additions
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16G
        reservations:
          cpus: '2'
          memory: 4G
    volumes:
      - /var/lib/convex:/convex/data  # Persistent storage
    environment:
      - RUST_LOG=info
      - REDACT_LOGS_TO_CLIENT=true
```

---

## 3. Data Export

### 3.1 Using Convex CLI

Export all tables to JSON:

```bash
cd website

# Export all tables
npx convex export --url $CONVEX_URL --admin-key $CONVEX_SERVICE_TOKEN \
  --path /tmp/convex-backup-$(date +%Y%m%d)

# Export specific tables
npx convex export --url $CONVEX_URL --admin-key $CONVEX_SERVICE_TOKEN \
  --tables users,entitlements \
  --path /tmp/convex-users-$(date +%Y%m%d)
```

### 3.2 Using HTTP API

Query specific documents via HTTP:

```bash
# Get all users (paginated)
curl -X POST "$CONVEX_URL/api/query" \
  -H "Authorization: Bearer $CONVEX_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path": "users:list", "args": {"paginationOpts": {"numItems": 100, "cursor": null}}}'
```

### 3.3 Volume Snapshot (Recommended for Production)

For production backups, snapshot the data volume:

```bash
# Stop writes temporarily
docker compose exec backend curl -X POST http://localhost:3210/admin/pause

# Create volume snapshot
docker run --rm -v convex_data:/data -v $(pwd):/backup alpine \
  tar cvzf /backup/convex-data-$(date +%Y%m%d-%H%M).tar.gz -C /data .

# Resume writes
docker compose exec backend curl -X POST http://localhost:3210/admin/resume
```

### 3.4 Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-convex.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/convex}"
CONVEX_URL="${CONVEX_URL:-http://localhost:3210}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

DATE=$(date +%Y%m%d-%H%M)
BACKUP_PATH="$BACKUP_DIR/convex-$DATE"

mkdir -p "$BACKUP_DIR"

# Export data
cd /opt/nullspace/website
npx convex export --url "$CONVEX_URL" --admin-key "$CONVEX_SERVICE_TOKEN" \
  --path "$BACKUP_PATH"

# Compress
tar cvzf "$BACKUP_PATH.tar.gz" -C "$BACKUP_DIR" "convex-$DATE"
rm -rf "$BACKUP_PATH"

# Cleanup old backups
find "$BACKUP_DIR" -name "convex-*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_PATH.tar.gz"
```

---

## 4. Data Import

### 4.1 Using Convex CLI

Import from JSON export:

```bash
cd website

# Import all tables (DESTRUCTIVE - replaces existing data)
npx convex import --url $CONVEX_URL --admin-key $CONVEX_SERVICE_TOKEN \
  --path /tmp/convex-backup-20260109

# Import specific tables
npx convex import --url $CONVEX_URL --admin-key $CONVEX_SERVICE_TOKEN \
  --tables users,entitlements \
  --path /tmp/convex-backup-20260109
```

### 4.2 Incremental Import

For merging data without full replacement:

```bash
# Export to review
npx convex export --url $NEW_CONVEX_URL --admin-key $NEW_TOKEN \
  --path /tmp/new-export

# Use custom mutation for merge (see convex/admin.ts)
node scripts/merge-convex-data.mjs \
  --source /tmp/old-export \
  --target $NEW_CONVEX_URL \
  --token $NEW_TOKEN
```

### 4.3 Volume Restore

Restore from volume snapshot:

```bash
# Stop services
docker compose down

# Restore volume
docker run --rm -v convex_data:/data -v $(pwd):/backup alpine \
  sh -c "rm -rf /data/* && tar xvzf /backup/convex-data-20260109-1200.tar.gz -C /data"

# Restart services
docker compose up -d
```

---

## 5. Migration Procedures

### 5.1 Cloud to Self-Hosted Migration

**Planning Phase:**
1. Provision self-hosted infrastructure (see RUNBOOK.md §2.3)
2. Configure DNS for new Convex endpoint
3. Schedule maintenance window (30-60 minutes)

**Execution:**

```bash
# Step 1: Export from Convex Cloud
cd website
npx convex export --path /tmp/convex-cloud-export

# Step 2: Deploy self-hosted backend
cd docker/convex
docker compose up -d backend
# Wait for healthy status

# Step 3: Deploy functions
cd ../website
npx convex deploy --url http://new-convex:3210 --admin-key $NEW_TOKEN

# Step 4: Import data
npx convex import --url http://new-convex:3210 --admin-key $NEW_TOKEN \
  --path /tmp/convex-cloud-export

# Step 5: Verify data integrity
node scripts/verify-convex-migration.mjs \
  --source-export /tmp/convex-cloud-export \
  --target-url http://new-convex:3210 \
  --target-token $NEW_TOKEN

# Step 6: Update service configuration
# Auth service: Update CONVEX_URL in .env
# Website: Update convex.json or VITE_CONVEX_URL

# Step 7: Cutover DNS / restart services
systemctl restart nullspace-auth
```

### 5.2 Self-Hosted to Self-Hosted Migration

For infrastructure moves or upgrades:

```bash
# Step 1: Set up new instance
# (Follow §2.2-2.4)

# Step 2: Pause writes on old instance
docker compose exec backend curl -X POST http://localhost:3210/admin/pause

# Step 3: Export and transfer
npx convex export --path /tmp/migration-export
scp -r /tmp/migration-export new-host:/tmp/

# Step 4: Import on new instance
ssh new-host "cd /opt/nullspace/website && \
  npx convex import --url http://localhost:3210 --admin-key $TOKEN \
  --path /tmp/migration-export"

# Step 5: Verify and cutover
# Update DNS, restart services pointing to new Convex
```

### 5.3 Version Upgrade

Upgrade Convex backend version:

```bash
# Step 1: Pull new image
docker pull ghcr.io/get-convex/convex-backend:latest

# Step 2: Backup current data
./scripts/backup-convex.sh

# Step 3: Rolling restart
docker compose up -d --no-deps backend

# Step 4: Verify health
curl http://localhost:3210/version
# Check dashboard at :6791
```

---

## 6. Rollback Procedures

### 6.1 Function Rollback

Rollback to previous function version:

```bash
cd website

# List deployments
npx convex deployments list --url $CONVEX_URL --admin-key $TOKEN

# Rollback to specific deployment
npx convex deploy --url $CONVEX_URL --admin-key $TOKEN \
  --deployment $PREVIOUS_DEPLOYMENT_ID
```

### 6.2 Data Rollback

Restore from backup:

```bash
# Step 1: Pause the application
systemctl stop nullspace-auth

# Step 2: Restore data (see §4.3 for volume restore)

# Step 3: Verify data integrity
node scripts/verify-convex-data.mjs

# Step 4: Restart application
systemctl start nullspace-auth
```

### 6.3 Full Rollback to Convex Cloud

If self-hosting fails:

```bash
# Step 1: Export from self-hosted
npx convex export --url http://localhost:3210 --admin-key $SELF_TOKEN \
  --path /tmp/self-hosted-export

# Step 2: Import to Convex Cloud
npx convex import --path /tmp/self-hosted-export
# (Uses project configured in convex.json)

# Step 3: Update service configuration
# Revert CONVEX_URL changes in auth service and website

# Step 4: Restart services
systemctl restart nullspace-auth
```

### 6.4 Emergency Procedures

**Data Corruption:**
1. Stop all writes immediately: `docker compose exec backend curl -X POST http://localhost:3210/admin/pause`
2. Identify last known good backup
3. Restore from backup (§4.3)
4. Replay any recoverable transactions from logs

**Service Unavailable:**
1. Check container health: `docker compose ps`
2. Check logs: `docker compose logs backend --tail 100`
3. Restart backend: `docker compose restart backend`
4. If persistent, restore from backup

---

## 7. Monitoring and Troubleshooting

### 7.1 Health Checks

```bash
# Backend health
curl http://localhost:3210/version

# Dashboard availability
curl http://localhost:6791

# Function execution
curl -X POST "$CONVEX_URL/api/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path": "users:count", "args": {}}'
```

### 7.2 Common Issues

**Issue: "Service token invalid"**
- Verify `CONVEX_SERVICE_TOKEN` matches between backend and clients
- Check token format (should be hex-encoded)

**Issue: "Function not found"**
- Redeploy functions: `npx convex deploy`
- Check function exports in `convex/*.ts`

**Issue: "Database locked"**
- Check for concurrent writes
- Restart backend if necessary
- Review volume permissions

**Issue: "Stripe webhooks failing"**
- Verify `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard
- Check webhook endpoint is accessible: `curl -X POST http://convex:3210/stripe/webhook`
- Review rate limit settings in `.env`

### 7.3 Log Analysis

```bash
# Backend logs
docker compose logs backend --tail 500 | grep -E "(ERROR|WARN)"

# Stripe webhook logs
docker compose logs backend | grep "stripe"

# Auth challenge issues
docker compose logs backend | grep "auth_challenge"
```

### 7.4 Metrics

Convex exposes metrics for monitoring:

```bash
# Basic stats
curl http://localhost:3210/admin/stats

# Prometheus metrics (if enabled)
curl http://localhost:3210/metrics
```

---

## Related Documentation

- [RUNBOOK.md §1.1](RUNBOOK.md#11-prerequisites) - Convex prerequisites
- [RUNBOOK.md §2.3](RUNBOOK.md#23-host-layout-5k-target) - Convex host sizing
- [convex-guidelines.md](convex-guidelines.md) - Development standards
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture

---

## Changelog

- **2026-01-09**: Initial runbook created (US-238)
