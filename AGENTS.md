# Agent Instructions

- Never edit `.env` or any environment-variable files.
- Don't delete or revert work you didn't author; coordinate if unsure (especially after git operations).
- Never run destructive git commands (`git reset --hard`, `git restore`, `git checkout` to older commits, `rm`) unless the user explicitly instructs it in this thread.
- Ask before deleting files to resolve type/lint failures.
- Always check `git status` before committing; never amend without explicit approval.

## Infrastructure

### Staging Environment (testnet.regenesis.dev)

**SSH Access:** `ssh -i ~/.ssh/id_ed25519_hetzner root@<server-ip>`

| Server | IP | Private IP | Role |
|--------|-----|------------|------|
| ns-sim-1 | 5.161.67.36 | 10.0.1.2 | Indexer/Simulator |
| ns-gw-1 | 178.156.212.135 | 10.0.1.6 | Gateway + Website |
| ns-auth-1 | 5.161.209.39 | 10.0.1.5 | Auth Service |
| ns-db-1 | 5.161.124.82 | 10.0.1.1 | Convex (self-hosted) |
| ns-node-1/2/3 | - | 10.0.1.3/4/7 | Validator Nodes |

**Services & URLs:**
- Website: https://testnet.regenesis.dev (ns-gw-1:8080)
- Gateway: https://api.testnet.regenesis.dev (ns-gw-1:9010)
- Indexer: https://indexer.testnet.regenesis.dev (ns-sim-1:8080)
- Auth: https://auth.testnet.regenesis.dev (ns-auth-1:4000)
- Convex: https://convex.testnet.regenesis.dev (ns-db-1:3210)

**Hetzner CLI:** Use `hcloud` for firewall/server management:
```bash
hcloud firewall list
hcloud server list
hcloud firewall add-rule <firewall> --direction in --protocol tcp --port <port> --source-ips <cidr>
```

**Private Network:** Servers communicate via `10.0.1.0/24` (nullspace-private). Gateway uses private IPs to reach backend services.

**Config Locations:** `/etc/nullspace/*.env` on each server. Docker containers use `--env-file`.

### Network Identity (Staging)
```
92124c5a292d8a6c083c732fa9b454d661c123ac4ba289e691f64e83a56ade2e7efd0abd8c2078b143a24f346192ed6518b670e6c26c9026d58e090592755bd1488f6dcea305d504fc2103ad9d35f81fc86cd143e10bbb736e6566f94fcf40ad
```

### CI/CD

**Workflows:**
- `build-images.yml` - Builds Docker images on push to main
- `deploy-staging.yml` - Deploys to staging (auto on push, manual via workflow_dispatch)

**GitHub Secrets:** `STAGING_SSH_PRIVATE_KEY`, `STAGING_HOST_*`, `SOPS_AGE_KEY_STAGING`
**GitHub Variables:** `VITE_IDENTITY`, `VITE_URL`, `VITE_AUTH_URL`, etc.

### Testing

**Local Development:**
```bash
cargo run --bin nullspace-simulator -- --identity <hex>  # Backend
pnpm -C website dev                                       # Frontend
```

**Test Commands:**
```bash
cargo test                           # Rust unit tests
pnpm test                            # JS/TS tests (all packages)
pnpm -C website test                 # Website tests only
pnpm -C gateway test                 # Gateway tests only
scripts/health-check.sh              # Staging health check
```

**E2E Tests:** `website/scripts/smoke-playwright.mjs` for browser automation

## Protocol Versioning (US-149)

When modifying binary protocol encoding/decoding:

1. **Version Header**: Wire format is `[version][opcode][payload...]` (1-byte version header first).
2. **Cross-Package Updates**: Update `packages/protocol/src/encode.ts`, `packages/protocol/src/games/actions.ts`, `packages/protocol/test/`, and `gateway/tests/unit/codec.test.ts`.
3. **Golden Vectors**: Update `packages/protocol/test/fixtures/golden-vectors.json` and any hardcoded byte expectations.
4. **Round-Trip Tests**: If Rust doesn’t support the version yet, strip the header before sending to Rust.
5. **Craps HARDWAY**: Encode via `CRAPS_HARDWAY_MAP`; target becomes 0.
