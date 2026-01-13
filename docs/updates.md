# Infrastructure Updates

## 2026-01-13: Per-Node YAML Configuration for Validators

**Change**: Validators now use individual YAML config files instead of shared env files.

**Files**:
- `configs/staging/node{0-3}.yaml` - Per-node configuration with individual keys
- `configs/staging/peers.yaml` - Peer address mappings (host IP: 5.161.124.82)

**Container Layout** (0-indexed to match config files):
- `nullspace-node-0`: port 9001, config node0.yaml
- `nullspace-node-1`: port 9002, config node1.yaml
- `nullspace-node-2`: port 9003, config node2.yaml
- `nullspace-node-3`: port 9004, config node3.yaml

**Network Identity** (seed 20260113):
```
85a5cfe0aef544f32090e7740eda6c4714c8dc7ee861a6ecf9bf2a6d148611fb0e51d185356686a9af2ea4fafaec78dd051e683f366f7d81e7bb2da0877ed6001f769ba014b4c81dfc00ad776da9dffdf5dd39c1bc7eddfcf7d64139d6252867
```

**Threshold**: 3/4 signatures required for consensus.

**Node binary invocation**:
```bash
nullspace-node --config /etc/nullspace/node0.yaml --peers /etc/nullspace/peers.yaml
```

---

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
