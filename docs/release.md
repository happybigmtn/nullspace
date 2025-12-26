# Release Management

## Staging Environment
- Separate domain, keys, and Convex deployment from production.
- Use staging Stripe keys and a dedicated webhook endpoint.
- Run E2E scripts before each release:
  - `website/scripts/e2e-auth-billing.mjs`
  - `website/scripts/layout-smoke.mjs`
- Run load tests against staging before major releases.

## Security Scanning
- Rust: `cargo audit` in CI.
- Node: `npm audit --omit=dev --audit-level=high` in CI (warn-only until tuned).
- Optional: container scan with Trivy and code scan with Semgrep.

## Rollback Plan
1) Keep the last two container images tagged and ready to redeploy.
2) Roll back by redeploying the previous image and reverting env changes.
3) Database changes must be forward-compatible; avoid destructive migrations.
4) If a migration must be reverted, restore from backup snapshot and replay
   queued events where applicable.

## Release Checklist
- CI green (Rust, web, wasm, audits).
- Staging E2E + smoke runs complete.
- Health checks and metrics dashboards clean.
- Backup snapshot taken before deploy.
