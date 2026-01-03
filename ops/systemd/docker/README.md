# Docker Systemd Units

These units run the GHCR images under systemd. Create `/etc/nullspace/docker.env`
with your registry + tag and re-use the existing service env files.

Example `/etc/nullspace/docker.env`:
```ini
IMAGE_REGISTRY=ghcr.io/<org>
IMAGE_TAG=latest
```

Notes:
- All units mount `/etc/nullspace` (read-only) for config + key files.
- All units mount `/var/lib/nullspace` for persistence where needed.
- Use tagged images for releases (avoid `latest` for production).
- Ensure GHCR packages are public or `docker login ghcr.io` with a PAT on each host.
- `nullspace-node` requires `NODE_CONFIG` plus `NODE_PEERS` or `NODE_HOSTS` in `/etc/nullspace/node.env`.
- `nullspace-website` reads `VITE_*` config at build time; set GitHub Actions
  `vars`/`secrets` (e.g., `VITE_URL`, `VITE_AUTH_URL`) before building the image.
- `nullspace-live-table` expects `LIVE_TABLE_HOST` and `LIVE_TABLE_PORT` (defaults are ok).
- `nullspace-ops` should set `OPS_ALLOWED_ORIGINS` and `OPS_ADMIN_TOKEN` for production.
- If gateway live-table is enabled, set `GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE` (mounted under `/etc/nullspace`).

Enable a unit after copying into `/etc/systemd/system/`:
```bash
sudo systemctl daemon-reload
sudo systemctl enable nullspace-simulator-docker
sudo systemctl start nullspace-simulator-docker
```
