# Systemd Units

These unit templates provide a baseline for production supervision. Copy them
to `/etc/systemd/system/` and adjust the `EnvironmentFile` entries and paths
to match your deployment layout.

For container-based deployments, see `ops/systemd/docker/` (GHCR images).

Common setup:
- Install binaries under `/usr/local/bin/` and the repo under `/opt/nullspace`.
- Create `/etc/nullspace/` env files per service (examples in `configs/`).
- Build the auth service (`npm run build` in `services/auth`) before starting.
- Build the ops service (`npm run build` in `services/ops`) before starting.
- Install gateway dependencies and build (`pnpm -C gateway install` then `pnpm -C gateway build`) before starting.
- Use `website/nginx.ssl.conf` (or your own) as `/etc/nginx/nullspace.conf`.
- Optional: set up the economy snapshot timer for public dashboards.
- For `nullspace-node`, set `NODE_CONFIG` and either `NODE_PEERS` or `NODE_HOSTS`.
- In production, set `METRICS_AUTH_TOKEN` for simulator + node metrics.

Enable and start:
```
sudo systemctl daemon-reload
sudo systemctl enable nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website nullspace-ops
sudo systemctl start nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website nullspace-ops

# Optional: public economy snapshot generator
sudo systemctl enable nullspace-economy-snapshot.timer
sudo systemctl start nullspace-economy-snapshot.timer
```

Consensus watchdog (recommended for 24/7 staging uptime):
```
sudo install -m 0755 scripts/consensus-watchdog.sh /usr/local/bin/nullspace-consensus-watchdog.sh
sudo systemctl daemon-reload
sudo systemctl enable nullspace-consensus-watchdog.timer
sudo systemctl start nullspace-consensus-watchdog.timer
```

Defaults:
- Restarts validators that fall behind by `LAG_THRESHOLD` (default 100).
- Detects stalled consensus when max finalized height doesn’t advance for `STALL_SECONDS` (default 120s).
- Optional data quarantine requires `WIPE_STALE=1` (not enabled by default).
