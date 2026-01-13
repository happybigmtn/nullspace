# Infrastructure Updates

## 2026-01-13: Consolidated Validator Architecture (4 Validators for BFT)

**Change**: All 4 validator nodes now run on a single host instead of separate machines.

**Motivation**:
- Cost reduction: consolidated to 1x larger instance
- BFT compliance: 4 validators satisfies n≥3f+1 for f=1 fault tolerance

**Byzantine Fault Tolerance**:
- With n=4 validators, the network can tolerate f=1 faulty/malicious node
- Quorum size = 2f+1 = 3 (need 3 of 4 validators to agree)

**Deployment Changes**:
- `.github/workflows/deploy-staging.yml` updated to deploy all 4 validators to a single host
- Containers: `nullspace-node-1`, `nullspace-node-2`, `nullspace-node-3`, `nullspace-node-4`
- Port mappings:
  - Node 1: 9001 (P2P), 9100 (metrics)
  - Node 2: 9002 (P2P), 9101 (metrics)
  - Node 3: 9003 (P2P), 9102 (metrics)
  - Node 4: 9004 (P2P), 9103 (metrics)
- Data volumes: `/var/lib/nullspace/node-1`, `node-2`, `node-3`, `node-4`

**GitHub Secrets**:
- Set `STAGING_HOST_VALIDATORS` to the consolidated validator host IP
- Or continue using `STAGING_HOST_NODE1` (fallback if `STAGING_HOST_VALIDATORS` is not set)
- `STAGING_HOST_NODE2`, `STAGING_HOST_NODE3`, `STAGING_HOST_NODE4` are no longer used

**Manual Migration** (if needed):
```bash
# On the consolidated validator host, stop old container naming
docker stop nullspace-node 2>/dev/null || true
docker rm nullspace-node 2>/dev/null || true

# Create data directories for all 4 validators
mkdir -p /var/lib/nullspace/node-{1,2,3,4}
```

---

## 2026-01-13: JSX Syntax Fixes

**Fixed**: JSX compilation errors in `RouletteView.tsx` and `GameControlBar.tsx`.

**Root Cause**: Extra `</div>` closing tags that didn't match any opening tag.

**Commit**: 874a64e
