# Operations (CI/CD, Testing, Recovery)

## CI/CD

Workflows:

- `build-images.yml` - Builds Docker images on push to main
- `deploy-staging.yml` - Deploys to staging (auto on push, manual via workflow_dispatch)

GitHub Secrets: `STAGING_SSH_PRIVATE_KEY`, `STAGING_HOST_*`, `SOPS_AGE_KEY_STAGING`
GitHub Variables: `VITE_IDENTITY`, `VITE_URL`, `VITE_AUTH_URL`, etc.

## Testing

```bash
cargo test                           # Rust unit tests
pnpm test                            # JS/TS tests (all packages)
pnpm -C website test                 # Website tests only
pnpm -C gateway test                 # Gateway tests only
scripts/health-check.sh              # Staging health check
scripts/agent-review.sh              # Review agents (line-level audits)
```

## Recovery

```bash
scripts/recover-consensus.sh          # Non-destructive restarts (set WIPE=1 CONFIRM_RESET=1 to reset)
```
