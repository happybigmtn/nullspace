# Systemd Units

These unit templates provide a baseline for production supervision. Copy them
to `/etc/systemd/system/` and adjust the `EnvironmentFile` entries and paths
to match your deployment layout.

Common setup:
- Install binaries under `/usr/local/bin/` and the repo under `/opt/nullspace`.
- Create `/etc/nullspace/` env files per service (examples in `configs/`).
- Build the auth service (`npm run build` in `services/auth`) before starting.
- Install gateway dependencies (`pnpm -C gateway install`) before starting.
- Use `website/nginx.ssl.conf` (or your own) as `/etc/nginx/nullspace.conf`.

Enable and start:
```
sudo systemctl daemon-reload
sudo systemctl enable nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website
sudo systemctl start nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website
```
